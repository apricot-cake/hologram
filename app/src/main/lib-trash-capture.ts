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
// ファイルシステムだけ。

import fs from 'node:fs';
import path from 'node:path';
import { TRASH_SUBDIR, resolveInSaveFolder } from './lib-save-folder-path.ts';
import { parseJsonLoose } from './lib-json.ts';
import { normalizePostRecord } from '../../../native-host/post-record.mts';
import type { PostRecordShape } from '../../../native-host/post-record.mts';
import { itemDirectoryAbsolute, itemDirectoryRelative } from '../../../native-host/item-storage.mts';

// ゴミ箱へ入れたキャプチャが一緒に連れて行かなければならない、DB にしかない状態。どれもレコード
// の中には無く、外部キーの ON DELETE CASCADE が posts の行と一緒に全部消してしまう。
// folders / manualGroups は #593＝復元した投稿が、以前はどこにも属さない状態で戻ってきていた。
export interface TrashCaptureFlags {
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
async function ownedFiles(folder: string, captureId: string, record: any | null, mediaExts: readonly string[]): Promise<Set<string>> {
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
  } catch {
    /* フォルダが読めない＝上で名指しした対象は、それでも試す価値がある */
  }
  return targets;
}

// このキャプチャのファイルを trashDir へ移し、その隣に <captureId>.json を書く。trashedAt を
// 押し（自動の期限切れ削除がそれを読む）、restore-post がほかのどこからも得られない DB にしか
// ない状態（tags / userKind / tagReviewed）を載せる。localViewCount は record 自体が既に運ぶ。
//
// 全体をできる範囲でやる。もう無いファイルは単に移さないし、レコードの書き込みに失敗しても、
// ファイルはゴミ箱に入ったまま自動の期限切れ削除の対象にならないだけ。投稿をライブラリから
// 消すのは呼び出し元の DB 側の半分。ここが例外を投げてそれを取り消してはいけない。
export async function trashCapture(opts: { folder: string; trashDir: string; mediaExts: readonly string[]; captureId: string; record: any | null; flags?: TrashCaptureFlags | null }): Promise<void> {
  const { folder, trashDir, mediaExts, captureId, record, flags } = opts;
  await fs.promises.mkdir(trashDir, { recursive: true });
  const itemKey = path.basename(itemDirectoryRelative(captureId));
  const itemDir = itemDirectoryAbsolute(folder, captureId);
  const trashItemDir = path.join(trashDir, itemKey);
  try {
    await fs.promises.rename(itemDir, trashItemDir);
  } catch {
    // 移行前の投稿、既に移動済み、または実体を持たない投稿。下で残る直下ファイルを拾う。
  }
  await fs.promises.mkdir(trashItemDir, { recursive: true });
  for (const name of await ownedFiles(folder, captureId, record, mediaExts)) {
    const src = resolveInSaveFolder(folder, name);
    if (!src) continue;
    try {
      await fs.promises.rename(src, path.join(trashItemDir, name));
    } catch {
      /* 見つからない（か、既に移動済み） */
    }
  }
  if (!record) return;
  const r: any = { ...record, trashedAt: new Date().toISOString() };
  if (flags) {
    if (flags.tags) r.tags = flags.tags;
    if (flags.userKind != null) r.userKind = flags.userKind;
    if (flags.tagReviewed != null) r.tagReviewed = flags.tagReviewed;
    // 空でないときだけ書く。どのフォルダにも属さない投稿が、読み手に解釈させるための空の配列を
    // 残すべきではない。
    if (flags.folders?.length) r.folders = flags.folders;
    if (flags.manualGroups?.length) r.manualGroups = flags.manualGroups;
  }
  try {
    await fs.promises.writeFile(path.join(trashDir, `${captureId}.json`), JSON.stringify(r, null, 2), 'utf8');
  } catch {
    /* できる範囲で＝ゴミ箱自体は働くが、自動の期限切れ削除と重複判定はされない */
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
  const inTrash = (name: string) => (nested ? `${TRASH_SUBDIR}/${itemKey}/${path.basename(name)}` : `${TRASH_SUBDIR}/${path.basename(name)}`);
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
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue; // レコードはオブジェクト。その配列はレコードではない
      // ファイル名こそが captureId で（trashCapture は `<captureId>.json` を書く）、復元と
      // 完全削除はそれでレコードを指す＝だから、自分の captureId の欄が無いか文字列でない
      // レコードは、捨てずにファイル名の下に並べる。
      const captureId = typeof rec.captureId === 'string' && rec.captureId ? rec.captureId : f.replace(/\.json$/i, '');
      // 取得時の原本は出て行く途中で落とす（#593）。ゴミ箱のレコードは、復元が元に戻せるよう今は
      // それを載せているが、ここから下流で原本を表示するものは何も無いし（#292 は開示のための
      // 画面を範囲外にしている）、落とさなければ、ゴミ箱の表示を開くたびに、ゴミ箱の投稿すべての
      // base64 が list-trash の IPC に乗ることになる。
      records.push(rebaseOntoTrash(normalizePostRecord({ ...rec, captureId }), trashDir));
    } catch {
      /* 壊れたレコードは飛ばす */
    }
  }
  records.sort((a, b) => new Date(b.trashedAt || 0).getTime() - new Date(a.trashedAt || 0).getTime());
  return records;
}
