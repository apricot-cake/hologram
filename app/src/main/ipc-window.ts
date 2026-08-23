'use strict';

// ウィンドウ・シェルの IPC ハンドラ。main.js から切り出した（機械的な移動＝ロジックは変えて
// いない）。open-external は https の URL を OS のブラウザで開く。open-image-window は
// asset:// のプロトコル経由で、ライブラリの画像1枚を専用のウィンドウへ出す。drag-out と
// copy-image はライブラリの元ファイルをほかのアプリへ渡す（#132）。Electron の基本要素はここで
// 改めて import する。getSaveFolder と APP_ICON は ctx 経由で届く。
import { ipcMain, shell, BrowserWindow, clipboard, nativeImage, screen } from 'electron';
import fs from 'node:fs';
import { isViewerImageName, libraryFilePath, libraryFilePaths, libraryStoragePath } from './library-files.ts';
import { isOpenAllowed } from './lib-open-gate.ts';
import type { IpcContext } from './ipc-context.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, APP_ICON, openNewWindow } = ctx;

  // Ctrl+Shift+N（#32 St1）。`handle` ではなく `on`＝レンダラーは待つものの無いキーボードの
  // 操作を転送するだけで、下の drag-out が使うのと同じ「応答は要らない」形。
  ipcMain.on('open-new-window', () => openNewWindow());
  // 以下のハンドラはどれもライブラリのファイルをアプリの外の何かへ渡すので、自分でパスを
  // 繋ぐのではなく、全部が唯一の書き出しのゲート（library-files.ts）を通して解決する。
  const exportPath = (file: unknown) => libraryFilePath(file, getSaveFolder());
  const storagePath = (file: unknown) => libraryStoragePath(file, getSaveFolder());

  ipcMain.handle('open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // ライブラリのファイル1つを OS のファイルマネージャで表示する（カードの右クリックメニュー）。
  ipcMain.handle('show-in-folder', (_event, file) => {
    const p = storagePath(file);
    if (!p) return;
    if (p === exportPath(file)) shell.showItemInFolder(p);
    else void shell.openPath(p);
  });

  // フォルダ表示と同じ解決ゲートを通し、保存ファイルの絶対パスをコピーする。
  ipcMain.handle('copy-file-path', (_event, file) => {
    const p = storagePath(file);
    if (!p) return false;
    clipboard.writeText(p);
    return true;
  });

  // 収蔵品のカード（#236、assetClass:'file'）での "開く"。OS の既定のアプリへファイルを
  // 渡すのは、許可リスト（拡張子と、それを持つ形式についてはマジックバイト、lib-open-gate.ts）が
  // 今この瞬間に是と言うときだけ＝ファイルを取り込んだ時点で importLocalFile が下した判断では
  // ない。あれ以降にディスク上で入れ替わっているかもしれないため。それ以外は、きっぱり断るのでは
  // なくフォルダでの表示へ落とす（ボタン自身、それ以上のことを約束していない＝records.ts の
  // fileOpenLabel を参照）。どちらをやったかを返すので、レンダラーは何が起きたかを利用者へ
  // 伝えられる。
  ipcMain.handle('open-post-file', async (_event, file): Promise<{ opened: boolean }> => {
    const p = exportPath(file);
    if (!p) return { opened: false };
    if (await isOpenAllowed(p)) {
      shell.openPath(p);
      return { opened: true };
    }
    shell.showItemInFolder(p);
    return { opened: false };
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

  // カードをほかのアプリへドラッグで持ち出す（#132）。エクスプローラ、PureRef、チャットの
  // ウィンドウ＝落としたファイルを受け取るものなら何でも。`handle` ではなく `on`。startDrag は
  // レンダラーがまだ開いたまま保持している dragstart の中で走らなければならず、invoke の往復では
  // 操作が終わった後に着地してしまう。
  ipcMain.on('drag-out', (event, files) => {
    // 常に元ファイルを渡す。レンダラーが見るのは asset:// のサムネイルの URL だけなので、送って
    // くる名前はサイドカーのもの。それが本物のパスになるのがここ（無いファイルは落ちる＝
    // library-files.ts を参照）。
    const paths = libraryFilePaths(files, getSaveFolder(), fs.existsSync);
    if (!paths.length) return;
    try {
      // 実際に運ばれるのは `files`。`file` は複数ファイル以前からある欄で、型がまだそれを
      // 要求している（`files` があれば Electron はこちらを無視する）。
      event.sender.startDrag({ file: paths[0], files: paths, icon: dragIcon(paths[0]) });
    } catch (e) {
      // 弾かれたアイコン（や OS が断ったドラッグ）でアプリを落としてはいけない＝その操作が
      // 始まらないだけ。
      console.error('drag-out failed', e);
    }
  });

  // startDrag は空でないアイコンを必ず要求するので、nativeImage が復号できないもの（svg、動画、
  // 壊れたファイル）は、例外を投げずにアプリのアイコンを代わりに使う。
  function dragIcon(file: string) {
    const img = nativeImage.createFromPath(file);
    return (img.isEmpty() ? nativeImage.createFromPath(APP_ICON) : img).resize({ width: 64 });
  }

  // ライブラリの画像1枚をクリップボードへコピーする（カードのメニュー・Ctrl+C＝#132）。
  // nativeImage がそのファイルを復号できないとき（svg、一部の tiff）は false を返す。空の画像を
  // 書くとクリップボードを黙って消してしまうので、代わりにレンダラーが失敗を伝える。
  ipcMain.handle('copy-image', (_event, file) => {
    const p = exportPath(file);
    if (!p) return false;
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  });

  // 選択したテキストをクリップボードへコピーする（選択の右クリックメニュー＝#167）。レンダラー
  // には頼れる組み込みのコピーの項目が無い（ウィンドウが removeMenu() を呼んでいて、それが
  // Chromium 自身の右クリックメニューも一緒に持って行く）ので、書き込みは navigator.clipboard
  // ではなく、上の copy-image とまったく同じく main を通す＝アプリのクリップボードの経路は1本、
  // secure context や権限の不意打ちも無い。空の書き込みは断る。そこにあったものを黙って消して
  // しまうため。
  ipcMain.handle('copy-text', (_event, text) => {
    if (typeof text !== 'string' || !text) return false;
    clipboard.writeText(text);
    return true;
  });
}

export { register };
