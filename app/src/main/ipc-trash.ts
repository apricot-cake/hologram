'use strict';

// ゴミ箱（論理削除）とタグ変更の IPC ハンドラ。delete-post はキャプチャの
// ファイルを .trash/ へ移し、DB の行を落とす。list/restore/empty/
// delete-from-trash はそのフォルダを管理する。update-tags は DB へ直接書く。
//
// なぜライブラリ本体は違うのに、ゴミ箱はアイテムごとの JSON を保持するのか:
// ゴミ箱行きの投稿は posts 行を一切持たないので、そのレコードはどこかに
// 住む必要があり、それが記述するファイルの隣というのが、プラットフォームの
// 慣習が置く場所——freedesktop.org のゴミ箱仕様は、ゴミ箱行きの各ファイルに
// `.trashinfo` を対にし、digiKam のコレクションのゴミ箱は `.dtrashinfo` を
// 対にする。これによりゴミ箱は自己記述的にもなる: DB を失っても生き延び、
// コピーされたライブラリと一緒に旅する。それが、#5 の scope が `.trash/` を
// ファイルシステム上に置き続けるという意味。キャプチャが一度も sidecar を
// 持たなかった時（#299）、レコードは DB「から」再生成される。#300 の
// エクスポートと同じ向き。
import { ipcMain } from './activity-ipc.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fillCardDims } from './lib-card-dims.ts';
import { fillMediaDims } from './lib-media-dims.ts';
import { parseJsonLoose } from './lib-json.ts';
import { postsByIds } from './lib-db-query.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { listTrashRecords, trashCapture } from './lib-trash-capture.ts';
import type { IpcContext } from './ipc-context.ts';
import type { OkResult, UpdateTagsResult } from './ipc-payloads.ts';
import { itemDirectoryAbsolute, itemDirectoryRelative } from '../../../native-host/item-storage.mts';

function register(ctx: IpcContext) {
  const { getSaveFolder, getTrashDir, baseOf, LIBRARY_MEDIA_EXTS, getDbWriter, ensurePostsSynced, scheduleSavedIndexWrite, send } = ctx;

  ipcMain.handle('delete-post', async (_e, image): Promise<OkResult> => {
    const folder = getSaveFolder();
    // trashDir が null になるのは保存フォルダが無い時とちょうど一致するので、
    // これを番人に畳み込んでも到達可能な分岐は増えない——コンパイラのために
    // それを述べているだけ。
    const trashDir = getTrashDir();
    if (!folder || !image || !trashDir) return { ok: false };
    // 論理削除: この captureId のすべてのファイルを（unlink するのではなく）
    // .trash/ へ移す。
    const base = baseOf(image);
    // 行が消える「前」に、レコードと DB だけが持つ状態（tags/userKind/
    // tagReviewed/localViewCount）を読む: それがゴミ箱側のレコードの内容のすべてであり、
    // restore-post がそれを読み戻し、legacy インポートの重複判定走査は、
    // 意図して削除された投稿が再インポートで復活しないよう、これを参照する。
    const handle = ensurePostsSynced();
    const flags = getDbWriter().getPostFlags(base);
    const rec: any = handle ? (await postsByIds(handle.sqlite, [base]))[0] || null : null;
    getDbWriter().deletePost(base);
    // ファイル側——#34 の置き換えの掃き寄せと共有し、両方が同じやり方で
    // キャプチャを退役させるようにする（lib-trash-capture.ts）。
    await trashCapture({ folder, trashDir, mediaExts: LIBRARY_MEDIA_EXTS, captureId: base, record: rec, flags });
    // ブリッジは保存済み投稿の索引だけを読むので、索引が知らない削除は、
    // タイムラインのバッジを点灯させたままにし、重複保存の警告に今はゴミ箱に
    // あるキャプチャを名指しさせてしまう。この書き直しは、ゴミ箱の通知
    // （#158）を公開するものでもある——削除された投稿は索引の `entries` から
    // `trashed` の map へ移る。
    if (handle) scheduleSavedIndexWrite(handle);
    return { ok: true };
  });

  // .trash/ の JSON を読んで正規化する処理は lib-trash-capture.ts
  // （listTrashRecords）にある——Electron に依存しないので、そこが課す信頼境界を
  // 単体テストできる（#324）。このハンドラは配線だけ。
  ipcMain.handle('list-trash', async () => {
    const trashDir = getTrashDir();
    if (!trashDir) return [];
    return await listTrashRecords(trashDir);
  });

  ipcMain.handle('restore-post', async (_e, image): Promise<OkResult> => {
    const trashDir = getTrashDir();
    const folder = getSaveFolder();
    if (!trashDir || !folder) return { ok: false };
    const base = baseOf(image);
    let names: string[];
    try {
      names = await fs.promises.readdir(trashDir);
    } catch {
      return { ok: false };
    }
    // 何かを動かす「前」にレコードを読む: それが posts 行を再生成するもの。
    const trashJson = path.join(trashDir, `${base}.json`);
    let restored: any = null;
    try {
      const parsed = parseJsonLoose(await fs.promises.readFile(trashJson, 'utf8'));
      // オブジェクトのみ: このファイルは外部入力であり（植え付けられた
      // `.trash/x.json` はどんな JSON 値でも持ちうる、#324）、素の数値／
      // 文字列／配列が下の writePost に届くと、代わりに NOT NULL の
      // captureId で書き込みが失敗してしまう。
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        restored = parsed;
        delete restored.trashedAt;
      }
    } catch {
      /* ゴミ箱にレコードが無い——メディアは孤児として戻される（#301） */
    }
    const itemKey = path.basename(itemDirectoryRelative(base));
    const trashItemDir = path.join(trashDir, itemKey);
    const liveItemDir = itemDirectoryAbsolute(folder, base);
    let movedItem = false;
    if (fs.existsSync(trashItemDir)) {
      try {
        await fs.promises.mkdir(path.dirname(liveItemDir), { recursive: true });
        // 同じ captureId の保存単位を上書きしない。通常は DB 行と一緒にこの場所も無い。
        if (fs.existsSync(liveItemDir)) return { ok: false };
        await fs.promises.rename(trashItemDir, liveItemDir);
        movedItem = true;
      } catch {
        return { ok: false };
      }
    }
    // メディアファイルはライブラリへ戻るが、レコードは戻らない。#302 以降、
    // ライブラリフォルダが持つのはメディアだけで、投稿は posts 行を持つことで
    // 存在する。
    for (const f of names) {
      if (f === `${base}.json`) continue;
      if (f.startsWith(base + '.') || f.startsWith(base + '-')) {
        try {
          await fs.promises.rename(path.join(trashDir, f), path.join(folder, f));
        } catch {}
      }
    }
    if (restored) {
      const handle = ensurePostsSynced();
      if (handle) {
        const sqlite = handle.sqlite;
        const stmts = preparePostStmts(sqlite);
        const resolveTagId = makeTagResolver(sqlite);
        sqlite.exec('BEGIN');
        try {
          writePost(stmts, resolveTagId, fillMediaDims(folder, fillCardDims(folder, restored)));
          sqlite.exec('COMMIT');
        } catch (err) {
          sqlite.exec('ROLLBACK');
          if (movedItem) {
            try {
              await fs.promises.rename(liveItemDir, trashItemDir);
            } catch {
              /* 次の整合性検査が回収できるよう、DBを復元したと偽らない */
            }
          }
          throw err;
        }
        // userKind/tagReviewed/localViewCount は writePost の対象ではない——delete-post が
        // ゴミ箱行き前の DB の値で刻んだレコードから、それらを再適用する。
        getDbWriter().restorePostFlags(base, restored);
      }
      try {
        await fs.promises.unlink(trashJson);
      } catch {
        /* ベストエフォート: 残ったレコードは list-trash に幽霊を見せてしまう */
      }
      // グリッドはこのイベントの時だけ再取得する（index.ts の取込キューの
      // ウォッチャー参照）——これが無いと、復元された投稿は次のアプリ起動まで
      // 行方不明のままになる。
      send('posts-changed', null);
      // ライブラリに戻ったので、索引はもう一度「保存済み」と言わなければ
      // ならない——そして、`.trash/` にいた間この投稿が持っていたゴミ箱の
      // 通知を落とす（#158）。
      if (handle) scheduleSavedIndexWrite(handle);
    }
    return { ok: true };
  });

  ipcMain.handle('empty-trash', async (): Promise<OkResult> => {
    const trashDir = getTrashDir();
    if (!trashDir) return { ok: true };
    try {
      await fs.promises.rm(trashDir, { recursive: true, force: true });
    } catch {}
    // このライブラリが持っていたゴミ箱の通知は、今やすべてどこにも存在しない
    // 投稿についてのもの（#158）——ゴミ箱を空にすることは「すべて忘れる」
    // という出口。
    const handle = ensurePostsSynced();
    if (handle) scheduleSavedIndexWrite(handle);
    return { ok: true };
  });

  ipcMain.handle('delete-from-trash', async (_e, image): Promise<OkResult> => {
    const trashDir = getTrashDir();
    if (!trashDir) return { ok: false };
    const base = baseOf(image);
    const itemKey = path.basename(itemDirectoryRelative(base));
    let names: string[];
    try {
      names = await fs.promises.readdir(trashDir);
    } catch {
      return { ok: false };
    }
    try {
      await fs.promises.rm(path.join(trashDir, itemKey), { recursive: true, force: true });
    } catch {}
    for (const f of names) {
      if (f.startsWith(base + '.') || f.startsWith(base + '-')) {
        try {
          await fs.promises.unlink(path.join(trashDir, f));
        } catch {}
      }
    }
    // empty-trash と同じことを、投稿1件について: その通知はレコードと運命を共にしなければならない（#158）。
    const handle = ensurePostsSynced();
    if (handle) scheduleSavedIndexWrite(handle);
    return { ok: true };
  });

  // #298/St5: タグの編集はアプリ内での書き込みなので、DB（post_tags +
  // posts.userKind/tagReviewed）へ直接書く——lib-db-write.ts の
  // replacePostTags 参照。
  ipcMain.handle('update-tags', async (_e, image, tags, patch): Promise<UpdateTagsResult> => {
    const captureId = baseOf(image);
    if (!captureId) return { ok: false };
    try {
      const handle = ensurePostsSynced(); // この編集がぶら下がれるようになる前に、captureId は posts 行を必要とする
      const ok = getDbWriter().setPostTags(captureId, tags, patch && typeof patch === 'object' ? patch : null);
      if (!ok || !handle) return { ok };
      // #774: 投稿のタグ配列を、この書き込みが残した状態で返す。レンダラーは
      // 読み込み済みのレコードをその場でパッチする（ライブラリの再読み込みは
      // しない）。id を知っているのは DB だけ——たった今入力されたタグは
      // 直前の行が作成したものだし、1つの名前が2つのエンティティに属する
      // こともある。他のすべての読み取りが使うのと同じ組み立て器でこの1行を
      // 読み直すことは、ここの effective 集合がまさに1つのコードだけで
      // 計算されることも意味する。
      const rec: any = (await postsByIds(handle.sqlite, [captureId]))[0] || null;
      if (!rec) return { ok };
      return { ok, tags: rec.tags, tagIds: rec.tagIds, effectiveTagIds: rec.effectiveTagIds, effectiveTags: rec.effectiveTags, effectiveTagLabels: rec.effectiveTagLabels };
    } catch {
      return { ok: false };
    }
  });
}

export { register };
