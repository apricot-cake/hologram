'use strict';

// ピン留め（浮動ミニビューア）ウィンドウ（#79）——createPinWindow、「送って
// ピン留め」がどのウィンドウに当たるかを決める中継、そして新しく作られた
// ウィンドウが自分の最初の描画で引き取る、一度限りの初期ペイロードの受け渡し。
//
// lib-window.ts の `windows[]` とは意図して「別の」登録簿にしてあり、
// 型タグを付けたあの配列にはしない: sendToWin/sendToOtherWins は #32 の
// ブロードキャスト（org-changed、posts-changed、tabs、
// 設定の変更……）のたびに `windows[]` を走査するが、ピン留め
// ウィンドウはそのどれも購読しない——それ自身のライブラリ状態は何も持たず、
// ウィンドウローカルなアイテム一覧を持つだけ。単純な2つ目の配列にすることで、
// それらのブロードキャストのすべてを、構造的にピン留めウィンドウ無縁にできる
// （フィルタする必要も無く、将来のブロードキャスト呼び出し箇所が除外を
// 忘れる余地も無い）。代償は、2つの登録簿が文字どおり1つではないこと
// ——ピン留めウィンドウは、Electron 自身の
// BrowserWindow.getAllWindows()（quit-when-all-closed、window-all-closed）には
// 他のウィンドウとまったく同じように現れ続けるので、分けておいてもライフ
// サイクルの配線が失われることは無い。
import { BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_ICON, DEV_SERVER_URL, isDarkTheme, resolveTheme } from './lib-window.ts';
import { pinIndexUrl } from './renderer-files.ts';
import type { PinItem } from './ipc-payloads.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pinWindows: BrowserWindow[] = [];
/** 最後に OS のフォーカスを受け取ったピン留めウィンドウ——newWindow 無しの
 * 「送ってピン留め」はこれを対象にするので、複数の間でフォーカスを切り替える
 * ことが「アクティブな送り先」の意味になる（それを選ぶ専用の UI は無い）。 */
let lastActiveId: number | null = null;
/** 新しく作られたピン留めウィンドウ自身が開いた時のアイテム集合。レンダラーが
 * それを求めてくる（pin-get-initial）まで保持する——なぜこれをナビゲーションに
 * 乗せるだけでは済まないかは、下の createPinWindow の loadURL のコメント参照。
 * webContents の id をキーにする。lastActiveId が使うのと同じキー。 */
const pendingInitial = new Map<number, PinItem[]>();

function livePinWindows(): BrowserWindow[] {
  return pinWindows.filter((w) => !w.isDestroyed());
}

function activePinWindow(): BrowserWindow | null {
  const list = livePinWindows();
  if (!list.length) return null;
  return list.find((w) => w.webContents.id === lastActiveId) || list[list.length - 1];
}

function createPinWindow(initialItems: PinItem[]): BrowserWindow {
  const theme = resolveTheme();
  const dark = isDarkTheme(theme);
  const w = new BrowserWindow({
    width: 340,
    height: 400,
    minWidth: 220,
    minHeight: 220,
    frame: false,
    resizable: true,
    // HOLOGRAM_SMOKE=1: この実行が作るすべてのウィンドウを隠す——検証実行が
    // 開発者の画面を乗っ取ってはいけない（open-image-window や createWindow
    // 自身が既に適用しているのと同じ番人）。
    show: process.env.HOLOGRAM_SMOKE !== '1',
    backgroundColor: dark ? '#0c0e12' : '#f6f7f9',
    title: 'Hologram',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // 'floating'（既定のレベルではない）: 「他のアプリ」のウィンドウより上に
  // い続ける。それこそがこの機能の要点（#79 の「他アプリを前面化しても
  // 最前面を維持する」）——素の always-on-top レベルは「このアプリ」の中の
  // 他のウィンドウにしか勝てない。
  w.setAlwaysOnTop(true, 'floating');
  w.removeMenu();
  pinWindows.push(w);
  pendingInitial.set(w.webContents.id, initialItems);
  lastActiveId = w.webContents.id;
  w.on('focus', () => {
    lastActiveId = w.webContents.id;
  });
  w.on('closed', () => {
    const i = pinWindows.indexOf(w);
    if (i >= 0) pinWindows.splice(i, 1);
    pendingInitial.delete(w.webContents.id);
    if (lastActiveId === w.webContents.id) {
      const remain = livePinWindows();
      lastActiveId = remain.length ? remain[remain.length - 1].webContents.id : null;
    }
  });
  const query = { theme };
  if (DEV_SERVER_URL) {
    // 開発時: electron-vite の Vite 開発サーバーは、rollupOptions.input の
    // 各エントリを同じオリジンの下のそれぞれのパスで公開する——pin.html は
    // ビルド後の out/renderer/ でそうであるのと同じように、そこでも
    // index.html の隣にある。
    const devUrl = new URL(DEV_SERVER_URL);
    devUrl.pathname = '/pin.html';
    devUrl.search = new URLSearchParams(query).toString();
    w.loadURL(devUrl.href);
  } else {
    w.loadURL(pinIndexUrl(query));
  }
  return w;
}

/**
 * `items` を、最後にフォーカスされたピン留めウィンドウへ中継する。あるいは、
 * `newWindow` が true の時（フォルダの「ピンで開く」の入り口は、今アクティブな
 * ものへ積み増すのではなく、常に自分専用のウィンドウを望む）や、まだ1つも
 * 存在しない時は、新しく1つ開く。
 */
function pinSend(items: PinItem[], newWindow: boolean): void {
  if (!items.length) return;
  const target = newWindow ? null : activePinWindow();
  if (target) {
    target.webContents.send('pin-items-added', items);
    return;
  }
  createPinWindow(items);
}

/** 呼び出したピン留めウィンドウ自身の起動時ペイロード。一度だけ消費される——
 * 同じウィンドウからの2回目の呼び出し（そうなる理由は無い）は空を返す。 */
function takeInitial(webContentsId: number): PinItem[] {
  const items = pendingInitial.get(webContentsId) || [];
  pendingInitial.delete(webContentsId);
  return items;
}

/** 「呼び出した」ピン留めウィンドウの always-on-top を切り替える。新しい状態を
 * 返す。稼働中のピン留めウィンドウでなければ false（IPC ハンドラ経由では
 * 起きない。呼び出し元は自分自身の webContents から解決されるため）。 */
function toggleAlwaysOnTop(webContentsId: number): boolean {
  const w = livePinWindows().find((x) => x.webContents.id === webContentsId);
  if (!w) return false;
  const next = !w.isAlwaysOnTop();
  w.setAlwaysOnTop(next, 'floating');
  return next;
}

export { createPinWindow, pinSend, takeInitial, toggleAlwaysOnTop };
