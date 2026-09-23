'use strict';

// ウィンドウ・シェルの IPC ハンドラ。main.js から切り出した（機械的な移動＝ロジックは変えて
// いない）。open-external は https の URL を OS のブラウザで開く。open-image-window は
// asset:// のプロトコル経由で、ライブラリの画像1枚を専用のウィンドウへ出す。copy-image は
// ライブラリの原本画像をデコードしてクリップボードへ渡す（#132）。Electron の基本要素はここで
// 改めて import する。getSaveFolder と APP_ICON は ctx 経由で届く。
import { shell, BrowserWindow, clipboard, nativeImage, screen } from 'electron';
import { ipcMain } from './activity-ipc.ts';
import { isViewerImageName, libraryFilePath, libraryStoragePath } from './library-files.ts';
import { copyLibraryImage } from './image-clipboard.ts';
import { takePostLink } from './post-link.ts';
import type { IpcContext } from './ipc-context.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, APP_ICON, openNewWindow } = ctx;
  ipcMain.handle('take-post-link', () => takePostLink());

  // Ctrl+Shift+N（#32 St1）。`handle` ではなく `on`＝レンダラーは待つものの無いキーボードの
  // 操作を転送するだけ。
  ipcMain.on('open-new-window', () => openNewWindow());
  // 以下のハンドラはどれもライブラリのファイルをアプリの外の何かへ渡すので、自分でパスを
  // 繋ぐのではなく、全部が唯一の書き出しのゲート（library-files.ts）を通して解決する。
  const exportPath = (file: unknown) => libraryFilePath(file, getSaveFolder());
  const storagePath = (file: unknown) => libraryStoragePath(file, getSaveFolder());

  ipcMain.handle('open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return undefined;
  });

  // ライブラリのファイル1つを OS のファイルマネージャで表示する（カードの右クリックメニュー）。
  ipcMain.handle('show-in-folder', (_event, file) => {
    const p = storagePath(file);
    if (!p) return undefined;
    if (p === exportPath(file)) shell.showItemInFolder(p);
    else void shell.openPath(p);
    return undefined;
  });

  // ライブラリの画像1枚を、枠の無いような専用のウィンドウで開く（カードの中クリック）。
  // asset:// のプロトコルはアプリ全体に登録してあるので、素の loadURL で Chromium 内蔵の画像
  // 表示が出る（ズームと収まりが只で付いてくる）。
  //
  // ラスタだけ（isViewerImageName、#215）。このウィンドウが実際にやるのは、ライブラリのファイル
  // をライブラリ自身のオリジンの最上位の文書に変えることで、SVG ではその文書がスクリプトを
  // 含むものになる。断るときは false を返す。copy-image が「このファイルは表示できない」に
  // 既に使っているのと同じ形。
  ipcMain.handle('open-image-window', (_event, image) => {
    if (!isViewerImageName(image)) return false;
    const source = exportPath(image);
    if (!source) return false;
    // ウィンドウの大きさを画像の縦横比に合わせる（作業領域の約85%に収める）。
    let width = 1100;
    let height = 850;
    try {
      const sz = nativeImage.createFromPath(source).getSize();
      if (sz.width > 0 && sz.height > 0) {
        const wa = screen.getPrimaryDisplay().workAreaSize;
        const scale = Math.min(1, (wa.width * 0.85) / sz.width, (wa.height * 0.85) / sz.height);
        width = Math.max(320, Math.round(sz.width * scale));
        height = Math.max(240, Math.round(sz.height * scale));
      }
    } catch {
      /* 既定のままにする（nativeImage が復号できない webp など） */
    }
    const w = new BrowserWindow({
      width,
      height,
      // ヘッドレスのハーネスの実行（HOLOGRAM_SMOKE=1）は、主ウィンドウを含めてすべての
      // ウィンドウを隠して作る＝検証の実行が、開発者の使っている画面を乗っ取ってはいけない。
      // ウィンドウは今までどおり文書を読み込んで動かすので、上の asset:// の防ぎは端から端まで
      // 試験できる。
      show: process.env.HOLOGRAM_SMOKE !== '1',
      useContentSize: true,
      autoHideMenuBar: true,
      backgroundColor: '#101113',
      icon: APP_ICON,
      webPreferences: { sandbox: true },
    });
    w.loadURL('asset://img/' + encodeURIComponent(image));
    return true;
  });

  ipcMain.handle('copy-image', (_event, file) => copyLibraryImage(file, getSaveFolder()));

  // 選択したテキストをクリップボードへコピーする（選択の右クリックメニュー＝#167）。レンダラー
  // には頼れる組み込みのコピーの項目が無い（ウィンドウが removeMenu() を呼んでいて、それが
  // Chromium 自身の右クリックメニューも一緒に持って行く）ので、書き込みは navigator.clipboard
  // ではなく、上の copy-image とまったく同じく main を通す＝アプリのクリップボードの経路は1本、
  // secure context や権限の不意打ちも無い。空の書き込みは断る。そこにあったものを黙って消して
  // しまうため。
  ipcMain.handle('copy-text', async (_event, text) => {
    if (typeof text !== 'string' || !text) return false;
    await clipboard.writeText(text);
    return true;
  });
}

export { register };
