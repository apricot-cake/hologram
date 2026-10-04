'use strict';

// 1つのキャプチャのファイルを .trash/ へ移し、その隣に自己記述のレコードを残すこと。#34 が
// 2つ目の呼び出し元をもたらしたとき、ipc-trash.ts の delete-post から切り出した。重複保存の警告
// に対する「置き換える」の回答は、置き換えた側のキャプチャを退役させる。置き換えが、削除とは違う
// ファイルの集合をゴミ箱へ入れるなら、それは「この投稿を消す」という定義がもう1つ、静かに枝分かれ
// することになる。
//
// ゴミ箱側の JSON が、ゴミ箱を自己記述にしている（ライブラリ自身が投稿ごとの JSON をもう持たない
// 理由は ipc-trash.ts を参照）。ゴミ箱へ入れた投稿には posts の行が無いので、そのレコードは自分が
// 記述するファイルの隣に置くしかない＝freedesktop.org の .trashinfo と digiKam の .dtrashinfo も
// 同じ組み方をしている。
//
// Electron に依存しない（node の組み込みだけ）ので、隣に並ぶ lib-db-* のモジュールと同じく素の
// node で単体テストできる。削除の DB 側は呼び出し元の仕事で、このモジュールが触るのは
// ファイルシステムと、削除を確定する同期コールバックを扱う。

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TRASH_SUBDIR, resolveInSaveFolder } from './lib-save-folder-path.ts';
import { parseJsonLoose } from './lib-json.ts';
import { renameWithoutOverwrite } from './lib-rename.ts';
import { normalizePostRecord } from '../../../native-host/post-record.mts';
import type { PostRecordShape } from '../../../native-host/post-record.mts';
import { itemDirectoryAbsolute, itemDirectoryRelative, itemFileRelative } from '../../../native-host/item-storage.mts';

// 保存済み索引は起動時にも更新されるので、ZIP から持ち込めるゴミ箱レコードを無制限に
// 読んではいけない。表示用の listTrashRecords とは違い、索引が要るのはこの小さな3欄だけ。
const TRASH_INDEX_RECORD_MAX_BYTES = 1024 * 1024;
const TRASH_INDEX_TOTAL_MAX_BYTES = 16 * TRASH_INDEX_RECORD_MAX_BYTES;
const TRASH_INDEX_MAX_FILES = 10_000;

export interface TrashIndexRecord {
  captureId: string;
  url: string | null;
  trashedAt: string | null;
}

// ゴミ箱へ入れたキャプチャが一緒に連れて行かなければならない、DB にしかない状態。どれもレコード
// の中には無く、外部キーの ON DELETE CASCADE が posts の行と一緒に全部消してしまう。
// folders / manualGroups は #593＝復元した投稿が、以前はどこにも属さない状態で戻ってきていた。
export interface TrashCaptureFlags {
  tagClassification?: import('../shared/tag-classification.ts').PortableTagClassification;
  tags?: string[];
  userKind?: string | null;
  tagReviewed?: boolean | null;
  folders?: string[];
  manualGroups?: Array<{ groupId: number; seq: number }>;
}

// このキャプチャが保存先フォルダで持っているファイルの全部。出所が3つあるのは、キャプチャの
// ファイルの名前の付き方が3通りあるため。
//   - ライブラリが持ち得るメディアの拡張子ごとの <captureId>.<ext>
//   - レコード自身が名指しするもの（image / video / media[].file / poster）
//   - <captureId>-media-N / -poster. / -avatar. の系列。列挙して見つける
// 共有ストアのアバター（avatars/<urlhash>.<ext>）は意図してそのままにする。その投稿者の
// キャプチャは全部それを参照しているので、1つの投稿をゴミ箱へ入れることで残りからアイコンを
// 取り上げてはいけない。
async function ownedFiles(folder: string, captureId: string, record: any | null, mediaExts: readonly string[], strict = false): Promise<Set<string>> {
  const targets = new Set<string>();
  for (const e of mediaExts) targets.add(`${captureId}.${e}`);
  if (record) {
    if (record.image) targets.add(path.basename(record.image));
    if (record.video) targets.add(path.basename(record.video));
    if (record.avatarFile && !/^avatars[\\/]/.test(record.avatarFile)) targets.add(path.basename(record.avatarFile));
    if (record.linkCard?.thumbnailFile) targets.add(path.basename(record.linkCard.thumbnailFile));
    for (const m of record.media || []) {
      if (m?.file) targets.add(path.basename(m.file));
      if (m?.posterFile) targets.add(path.basename(m.posterFile)); // #119 St1
    }
  }
  try {
    for (const f of await fs.promises.readdir(folder)) {
      if (f.startsWith(`${captureId}-media-`) || f.startsWith(`${captureId}-poster.`) || f.startsWith(`${captureId}-avatar.`)) targets.add(f);
    }
  } catch (error) {
    if (strict) throw error;
    /* フォルダが読めない＝上で名指しした対象は、それでも試す価値がある */
  }
  return targets;
}

// このキャプチャのファイルを trashDir へ移し、その隣に <captureId>.json を書く。trashedAt を
// 押し（自動の期限切れ削除がそれを読む）、restore-post がほかのどこからも得られない DB にしか
// ない状態（tags / userKind / tagReviewed）を載せる。localViewCount は record 自体が既に運ぶ。
//
// commitDelete がある場合、ファイルとレコードの保存後に DB の同期削除を確定する。
// 途中の失敗では元のファイルへ戻す。コールバックなしの既存利用は best-effort のまま。
const pendingTrash = new Set<string>();

export async function trashCapture(opts: { folder: string; trashDir: string; mediaExts: readonly string[]; captureId: string; record: any | null; flags?: TrashCaptureFlags | null; retainFiles?: boolean; commitDelete?: () => void }): Promise<void> {
  const { folder, trashDir, mediaExts, captureId, record, flags } = opts;
  const itemKey = path.basename(itemDirectoryRelative(captureId));
  const itemDir = itemDirectoryAbsolute(folder, captureId);
  const trashItemDir = path.join(trashDir, itemKey);
  const trashJson = path.join(trashDir, `${captureId}.json`);
  const strict = !!opts.commitDelete;
  const lock = path.resolve(itemDir);
  if (pendingTrash.has(lock)) throw new Error('Post deletion already in progress');
  pendingTrash.add(lock);
  const moved: Array<{ src: string; dest: string }> = [];
  const sharedCopies = new Set<string>();
  let createdItem = false;
  let createdJson = false;
  try {
    if (strict) {
      if (!record || path.dirname(path.resolve(trashItemDir)) !== path.resolve(trashDir) || path.dirname(path.resolve(trashJson)) !== path.resolve(trashDir)) throw new Error('Invalid trash target');
      for (const target of [trashItemDir, trashJson]) {
        try {
          await fs.promises.lstat(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        throw new Error('Trash target already exists');
      }
    }
    await fs.promises.mkdir(trashDir, { recursive: true });
    let sourceItemExists = false;
    try {
      if (strict) {
        await fs.promises.lstat(itemDir);
        sourceItemExists = true;
      }
      if (opts.retainFiles) {
        // cp は途中で失敗しても作成済みのファイルを残すため、先に所有を記録する。
        if (strict) createdItem = true;
        await fs.promises.cp(itemDir, trashItemDir, { recursive: true, force: !strict, errorOnExist: strict });
      } else {
        if (strict) await renameWithoutOverwrite(itemDir, trashItemDir);
        else await fs.promises.rename(itemDir, trashItemDir);
        if (strict) {
          createdItem = true;
          moved.push({ src: itemDir, dest: trashItemDir });
        }
      }
    } catch (error) {
      if (strict && (sourceItemExists || (error as NodeJS.ErrnoException).code !== 'ENOENT')) throw error;
      // 移行前の投稿、既に移動済み、または実体を持たない投稿。下で残る直下ファイルを拾う。
    }
    await fs.promises.mkdir(trashItemDir, { recursive: true });
    if (strict) createdItem = true;
    for (const name of await ownedFiles(folder, captureId, record, mediaExts, strict)) {
      const src = resolveInSaveFolder(folder, name);
      if (!src) continue;
      let sourceExists = false;
      try {
        // 候補の大半は存在しない。存在するものだけを動かし、読み取り拒否は失敗にする。
        if (strict) {
          await fs.promises.lstat(src);
          sourceExists = true;
        }
        const dest = path.join(trashItemDir, name);
        if (opts.retainFiles) await fs.promises.copyFile(src, dest, strict ? fs.constants.COPYFILE_EXCL : 0);
        else {
          if (strict && fs.existsSync(dest)) throw new Error('Trash media target already exists');
          if (strict) await renameWithoutOverwrite(src, dest);
          else await fs.promises.rename(src, dest);
          if (strict) moved.push({ src, dest });
        }
      } catch (error) {
        if (strict && (sourceExists || (error as NodeJS.ErrnoException).code !== 'ENOENT')) throw error;
        /* 見つからない（か、既に移動済み） */
      }
    }
    if (!record) return;
    const r: any = { ...record, trashedAt: new Date().toISOString() };
    // 単独保存へ引き継いだ引用画像は、別の保存単位にあることがある。
    // 共有元を動かさず、ゴミ箱にはこの投稿だけで復元できるコピーを置く。
    const copyShared = async (file: string | null) => {
      if (!file || !file.startsWith('items/') || file.startsWith(`${itemDirectoryRelative(captureId)}/`)) return file;
      const src = resolveInSaveFolder(folder, file);
      if (!src) return file;
      const name = `${createHash('sha256').update(file).digest('hex').slice(0, 16)}-${path.basename(file)}`;
      // 同じ共有画像を image と media の両方が指すことがある。
      const dest = path.join(trashItemDir, name);
      if (!strict) await fs.promises.copyFile(src, dest);
      else if (!sharedCopies.has(dest)) {
        if (fs.existsSync(dest)) throw new Error('Trash shared media target already exists');
        sharedCopies.add(dest);
        try {
          await fs.promises.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') sharedCopies.delete(dest);
          throw error;
        }
      }
      return itemFileRelative(captureId, name);
    };
    r.image = await copyShared(r.image);
    r.video = await copyShared(r.video);
    r.media = [];
    for (const m of record.media || []) r.media.push({ ...m, file: await copyShared(m.file), posterFile: await copyShared(m.posterFile) });
    if (flags) {
      if (flags.tags) r.tags = flags.tags;
      if (flags.tagClassification) r.tagClassification = flags.tagClassification;
      if (flags.userKind != null) r.userKind = flags.userKind;
      if (flags.tagReviewed != null) r.tagReviewed = flags.tagReviewed;
      // 空でないときだけ書く。どのフォルダにも属さない投稿が、読み手に解釈させるための空の配列を
      // 残すべきではない。
      if (flags.folders?.length) r.folders = flags.folders;
      if (flags.manualGroups?.length) r.manualGroups = flags.manualGroups;
    }
    try {
      if (strict) {
        const sidecar = await fs.promises.open(trashJson, 'wx');
        createdJson = true;
        try {
          await sidecar.writeFile(JSON.stringify(r, null, 2), 'utf8');
        } finally {
          await sidecar.close();
        }
      } else await fs.promises.writeFile(trashJson, JSON.stringify(r, null, 2), 'utf8');
    } catch (error) {
      if (strict) throw error;
      /* できる範囲で＝ゴミ箱自体は働くが、自動の期限切れ削除と重複判定はされない */
    }
    opts.commitDelete?.();
  } catch (error) {
    if (strict) {
      // DB の削除は同期トランザクション。失敗なら元の場所へ逆順に戻す。
      // 復元に失敗したものを、後続の掃除で消してはいけない。
      const rollbackErrors: unknown[] = [];
      for (const dest of sharedCopies) {
        try {
          await fs.promises.rm(dest, { force: true });
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      for (const move of moved.reverse()) {
        try {
          if (fs.existsSync(move.src)) throw new Error('Trash rollback target already exists');
          await renameWithoutOverwrite(move.dest, move.src);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (createdJson && !rollbackErrors.length) {
        try {
          await fs.promises.unlink(trashJson);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (createdItem && !rollbackErrors.length) {
        try {
          await fs.promises.rm(trashItemDir, { recursive: true, force: true });
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Trash deletion rollback failed');
    }
    throw error;
  } finally {
    pendingTrash.delete(lock);
  }
}

// アプリの外へ出るファイル名はすべて、保存先フォルダからの相対として読まれる。レンダラーがそれを
// `asset://img/<name>` に変え、main が唯一の内包の規則（lib-save-folder-path.ts）で解決し直す。
// ゴミ箱へ入れたキャプチャのレコードは、そのファイルがまだライブラリにあった時に書かれているので、
// 中の名前はフォルダのルートからの相対＝しかしファイル自体はその後 `.trash/` へ移っている。一覧を
// 組み立てながら基点を張り替えれば、ゴミ箱の表示は、ゴミ箱がどこにあるかを知らないままライブラリ
// 自身のカードを描ける（#267）。裸のままにすれば、ゴミ箱のサムネイルはどれも、ファイルがもう
// 無いパスを指す。
//
// 手を触れない名前が1つある。共有ストアのアバターで、trashCapture は意図して
// `avatars/<urlhash>.<ext>` を移さない（ownedFiles を参照）ので、それは今もレコードが言うとおり
// の場所にある。
//
// ここは trashDir が `<saveFolder>/<TRASH_SUBDIR>` であることを前提にする＝そもそも解決できるのは
// そのためだし、アプリはそのように組み立てている（index.ts の getTrashDir）。
function rebaseOntoTrash(rec: PostRecordShape, trashDir: string): PostRecordShape {
  const itemKey = path.basename(itemDirectoryRelative(rec.captureId));
  const nested = fs.existsSync(path.join(trashDir, itemKey));
  const inTrash = (name: string) => (name.startsWith('quoted-media/') ? name : nested ? `${TRASH_SUBDIR}/${itemKey}/${path.basename(name)}` : `${TRASH_SUBDIR}/${path.basename(name)}`);
  const sharedAvatar = !!rec.avatarFile && /^avatars[\\/]/.test(rec.avatarFile);
  return {
    ...rec,
    image: rec.image ? inTrash(rec.image) : rec.image,
    video: rec.video ? inTrash(rec.video) : rec.video,
    avatarFile: rec.avatarFile && !sharedAvatar ? inTrash(rec.avatarFile) : rec.avatarFile,
    media: rec.media.map((m) => ({ ...m, file: m.file ? inTrash(m.file) : m.file, posterFile: m.posterFile ? inTrash(m.posterFile) : m.posterFile })),
    linkCard: rec.linkCard ? { ...rec.linkCard, thumbnailFile: rec.linkCard.thumbnailFile ? inTrash(rec.linkCard.thumbnailFile) : rec.linkCard.thumbnailFile } : null,
  };
}

// レンダラーが描くゴミ箱の一覧（ipc-trash.ts の list-trash）を正規化したもの。
//
// ディスクから直接レンダラーへ届くレコードの形は、これが唯一。#302 以降、ライブラリフォルダが
// 持つのはメディアだけなので、UI が見るほかのレコードは全部、DB へ入る途中で normalizePostRecord
// を通っている（writePost）＝ゴミ箱へ入れた投稿には posts の行が無いので、そのレコードは自分の
// ファイルの隣に置くしかなく（上のモジュールのコメント）、あのビルダーに会うことがない。
//
// これが効くのは、ゴミ箱のディレクトリがアプリの外から書き込めるため。importCompleteZipToDb は
// 完全エクスポートの書庫の `.trash/` のエントリをそのままディスクへ写す（zip-slip の規則が
// 検めるのはエントリの名前で、エントリの中の欄の形は誰も検めない）。レンダラーのコードはこれらの
// 欄を文字列や配列として読むので、仕込まれた `"title": {}` はオブジェクトを React の子として
// 描画し、コンポーネントの木を丸ごと落とす＝起動し直しても同じファイルを読むので、落ちたままに
// なる（#324）。
//
// だから信頼の境界はここ、DB の生産者が全員使うのと同じビルダーに置く。消費者それぞれの防御的な
// 確認ではなく。返るレコードはちょうど PostRecordShape。ゴミ箱のレコードが併せて持つ DB にしか
// ない旗（userKind / tagReviewed）と利用履歴（localViewCount）は意図して入れていない＝
// restore-post はそれをファイル自身から読むし、レンダラーのどの画面にも出ない。出て行く途中で
// 書き換えるのはファイル名だけ（上の rebaseOntoTrash）。
export async function listTrashRecords(trashDir: string): Promise<PostRecordShape[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(trashDir);
  } catch {
    return [];
  }
  const records: PostRecordShape[] = [];
  for (const f of names) {
    if (!f.toLowerCase().endsWith('.json')) continue;
    try {
      const rec = parseJsonLoose(await fs.promises.readFile(path.join(trashDir, f), 'utf8'));
      const normalized = normalizePostRecord(rec);
      if (normalized.captureId !== f.replace(/\.json$/i, '')) throw new Error('Trash captureId mismatch');
      records.push(rebaseOntoTrash(normalized, trashDir));
    } catch {
      console.warn('Invalid trash record', { file: f });
    }
  }
  records.sort((a, b) => new Date(b.trashedAt || 0).getTime() - new Date(a.trashedAt || 0).getTime());
  return records;
}

// ブリッジ用索引のための、意図して小さく・仕事量に上限のある読み出し。完全 ZIP は .trash の
// JSON を検査せず置けるため、表示用一覧をここで使うと巨大な media/raw まで parse・正規化し、
// 起動時や索引更新のたびに main process のメモリを使い切れる。ファイル単位と走査全体の両方を
// 制限し、必要な欄だけを保持する。上限を超えたレコードは通知から欠けるだけで、ゴミ箱の中身や
// 復元には触れない。
export async function listTrashIndexRecords(trashDir: string): Promise<TrashIndexRecord[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(trashDir);
  } catch {
    return [];
  }
  const records: TrashIndexRecord[] = [];
  let bytesRead = 0;
  let filesExamined = 0;
  for (const f of names.sort()) {
    if (!f.toLowerCase().endsWith('.json')) continue;
    if (++filesExamined > TRASH_INDEX_MAX_FILES) break;
    let handle: fs.promises.FileHandle | null = null;
    try {
      const file = path.join(trashDir, f);
      handle = await fs.promises.open(file, 'r');
      const { size } = await handle.stat();
      if (size > TRASH_INDEX_RECORD_MAX_BYTES || bytesRead + size > TRASH_INDEX_TOTAL_MAX_BYTES) continue;
      bytesRead += size;
      // stat 後にファイルが伸びても readFile のように末尾まで追わず、確認したサイズだけ読む。
      const contents = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const { bytesRead: chunkSize } = await handle.read(contents, offset, size - offset, offset);
        if (!chunkSize) break;
        offset += chunkSize;
      }
      const rec = parseJsonLoose(contents.subarray(0, offset).toString('utf8'));
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
      const captureId = f.replace(/\.json$/i, '');
      if (rec.captureId !== captureId) continue;
      if (rec.url != null && typeof rec.url !== 'string') continue;
      if (rec.trashedAt != null && typeof rec.trashedAt !== 'string') continue;
      records.push({ captureId, url: rec.url || null, trashedAt: rec.trashedAt || null });
    } catch {
      /* 壊れたものと、走査中に消えたものは索引に載せない */
    } finally {
      await handle?.close();
    }
  }
  return records;
}
