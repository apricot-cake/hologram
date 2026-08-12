'use strict';

// 投稿の IPC ハンドラ。main.js から切り出した（機械的な移動＝ロジックは変えていない）。
// list-posts と list-posts-delta は、コアの索引の関数（差分の帳簿と一緒に main.js に残る）の
// 薄い包み。image-data-url は保存先フォルダのファイル1つを data: の URL として読む。コアの補助は
// ctx 経由で届く。
//
// うごイラの対（#506）がここに居るのは image-data-url と同じ理由。どちらも、同じ内包の確認を
// 通して、保存先フォルダからファイル1つを読むもの。書庫の仕掛けの2つ目の複製ではない＝zip は
// ディスクに留まり、この境界を越えるのは求められたフレームだけ。
import { ipcMain } from 'electron';
import fs from 'node:fs';
import { readUgoiraFrame, ugoiraFramesPresent } from './lib-archive.ts';
import type { IpcContext } from './ipc-context.ts';

function register(ctx: IpcContext) {
  const { listPosts, listPostsDelta, searchFullText, resolveInFolder, mimeForFile } = ctx;

  ipcMain.handle('list-posts', () => listPosts());
  // senderId（#32 St1）: main は今、差分の基準をレンダラーごとに持つ＝ipc-context.ts の
  // listPostsDelta の doc コメントを参照。
  ipcMain.handle('list-posts-delta', (_e, haveBaseline) => listPostsDelta(!!haveBaseline, _e.sender.id));
  // #29: タブをまたぐ全文検索＝posts_fts のヒットごとの bm25() の順位（関連順だけ。どの投稿が
  // 一致するかを決めるのはレンダラー。fulltext.ts を参照）。
  ipcMain.handle('search-full-text', (_e, query, limit) => searchFullText(typeof query === 'string' ? query : '', typeof limit === 'number' ? limit : undefined));

  ipcMain.handle('image-data-url', async (_e, image) => {
    const p = resolveInFolder(image);
    if (!p) return null;
    try {
      const buf = await fs.promises.readFile(p);
      return 'data:' + mimeForFile(image) + ';base64,' + buf.toString('base64');
    } catch {
      return null;
    }
  });

  // この入口から ZIP の読み手へ届くのは、保存先フォルダの中の .zip だけ。うごイラは、ライブラリ
  // が書庫として保存する唯一のメディアの種別。
  const ugoiraPath = (file: unknown) => (typeof file === 'string' && /\.zip$/i.test(file) ? resolveInFolder(file) : null);

  // 再生が始まる前に1回だけ尋ねる＝答えが全か無かである理由は ugoiraFramesPresent を参照。
  ipcMain.handle('ugoira-frames-present', async (_e, file, names) => {
    const p = ugoiraPath(file);
    if (!p) return false;
    try {
      return await ugoiraFramesPresent(p, Array.isArray(names) ? names.filter((n) => typeof n === 'string') : []);
    } catch {
      return false;
    }
  });

  // フレーム1枚分のバイト列、または null。レンダラーはそれを、自分が復号できる Blob で包む。
  // 途中で base64 にするものは無い（その膨張こそ、昔の書庫を丸ごと data: の URL にするやり方を
  // 高くしていたもの）。
  ipcMain.handle('ugoira-frame', async (_e, file, name) => {
    const p = ugoiraPath(file);
    if (!p) return null;
    try {
      return await readUgoiraFrame(p, typeof name === 'string' ? name : '');
    } catch {
      return null;
    }
  });
}

export { register };
