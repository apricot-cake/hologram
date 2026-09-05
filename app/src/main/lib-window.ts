'use strict';

// このアプリのウィンドウ（#32 St1: 単一ウィンドウ → 1プロセス / N ウィンドウ）。アイコン、
// 永続化する位置と大きさ、あらゆる web-contents に掛かるナビゲーションの封鎖、そして生成そのもの
// ＝index.ts の `// --- ウィンドウの位置と大きさの永続化 ---`、ナビゲーションの番人の塊、
// `// --- ウィンドウ ---` の節を丸ごと移したもの。
//
// ウィンドウの集合を持つのはこのモジュール。持たざるを得ない。createWindow がそこへ足すし、
// import する側は import した束縛へ代入できない。ほかは全部 getWin() / getWindows() /
// sendToWin() を通して読む。index.ts の ctx が既に IPC ハンドラへ渡していたのがそれ＝ウィンドウ
// は、メインプロセス全体が触れるファイルスコープの変数であることをやめ、1つのモジュールの状態に
// なった。
//
// getWin() は今も「主ウィンドウ」（この実行で最初に作られたもの）を意味する＝#32 を越えて残る
// 単一ウィンドウの形をした概念（位置と大きさの永続化、tabs.json、常にウィンドウ1つで走る
// SMOKE/SANDBOX のハーネス）は全部これを読む。呼んできたウィンドウそのものに対して働かなければ
// ならないハンドラ（window-control、ファイルダイアログの親）は、代わりに自分の呼び出し箇所で
// BrowserWindow.fromWebContents(event.sender) を読む＝ipc-config.ts / ipc-transfer.ts /
// ipc-backup.ts を参照。
//
// 開発サーバーの URL もここにある（createWindow が読み込むものであり、ナビゲーションの番人の
// 許可リストの導出元でもある）。ただし弾いた値についての警告は index.ts の呼び出し箇所に残す。
// このモジュールの本体は index.ts が electron-log のファイルパスを設定するより先に走るので、
// ここでログを出すと、その行が、説明の対象であるログとは別の場所へ着地してしまう。

import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import log from 'electron-log/main';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { appIndexUrl, isAppRendererUrl } from './renderer-files.ts';
import { SMOKE_WINDOW } from './smoke-window-size.ts';
import { readConfig, writeConfig } from './lib-config.ts';
import { resolveDevServerUrl } from './dev-server-guard.ts';
import { isViewerImageName } from './library-files.ts';

const nodeRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ホログラム調のアプリアイコン（虹色の四角）。実行時のタスクバー・ウィンドウのアイコンに使う。
// インストール済みの exe 向けには、electron-builder が同じ PNG を .ico へ変換する。
// out/main/index.js → out → app/ で、assets/ は out/ と並んでいる（開発でもパッケージ済みでも
// 同じ。electron-builder の `files` が out/** と assets/** をパッケージのルートから同じ相対の
// 深さで配る）。
const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

// ウィンドウの足元でライブラリを入れ替える操作（#176 の switchLibrary、#233 の世代のロール
// バック）が、ウィンドウを読み込み直すまでに待つ時間。読み込み直すこと自体は意図してそうして
// いる＝整理の層のストアが中途半端に同期し直された状態こそ、それが避けている不具合の類。ただし
// ハンドラの中でそれを出すと、その呼び出し自身の返答が届く前に呼び出し元のフレームが壊れる。
// レンダラーの `await` は決着しなくなり（Electron は値も拒否も渡さない）、結果を伝えるトーストは
// 失われ、呼び出し元が次にやることは飛行中に切られる。この遅延は、呼び出し元が答えを受け取る
// ための猶予。そのトーストを読み終える程度には長い。
const RELOAD_AFTER_LIBRARY_SWAP_MS = 2000;

// このプロセスが持つ生きた BrowserWindow の全部、挿入順（主ウィンドウ＝この実行で最初に作られた
// もの＝は常に windows[0]）。Set にすると、大した理由も無くその順序を失う。配列が一番単純だし、
// この集合の要素は数えるほどにしかならない。
const windows: BrowserWindow[] = [];

/** 主ウィンドウ（この実行で最初に作られたもの）。その前後では null。 */
function getWin(): BrowserWindow | null {
  return windows[0] || null;
}

/** 生きているウィンドウの全部、古い順。 */
function getWindows(): BrowserWindow[] {
  return windows.filter((w) => !w.isDestroyed());
}

/** すべてのウィンドウのレンダラーへ送る（#32 St1: 単一ウィンドウ時代の sendToWin を配信に）。 */
function sendToWin(channel: string, ...args: unknown[]) {
  for (const w of getWindows()) w.webContents.send(channel, ...args);
}

/**
 * `exceptWebContentsId` が名指しするウィンドウ以外の全部へ送る（#32 St2: 整理の層の変更は、
 * 今それを書いたウィンドウへ返すのではなく、ほかのすべてのウィンドウへ中継する＝そのウィンドウ
 * 自身のストアは既に最新で、自分の書き込みを外部からの変更として当て直すのは、良くても無駄な
 * 往復、悪ければ、その書き込みが触れていない進行中のローカルな UI の状態のリセットになる）。
 */
function sendToOtherWins(exceptWebContentsId: number, channel: string, ...args: unknown[]) {
  for (const w of getWindows()) {
    if (w.webContents.id === exceptWebContentsId) continue;
    w.webContents.send(channel, ...args);
  }
}

// --- ウィンドウの位置と大きさの永続化 ---
// 主ウィンドウだけが対象（#32 St1 の設計: "新窓の bounds は +24px カスケード"＝副ウィンドウは
// 主ウィンドウの bounds を起点に配置し、自分では永続化しない。config.json の windowBounds の
// キーは #32 より前と同じく1つ）。位置と大きさを config.json（`windowBounds`）へ保存して復元
// する。見えているディスプレイの中に収めるので、切り離されたモニタが画面外でウィンドウを開き
// 直すことはできない。
let _boundsSaveTimer: any = null;
function persistWindowBounds(win: BrowserWindow) {
  clearTimeout(_boundsSaveTimer);
  _boundsSaveTimer = setTimeout(() => saveWindowBoundsNow(win), 400);
}
function saveWindowBoundsNow(win: BrowserWindow) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    const cfg = readConfig();
    cfg.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized: win.isMaximized() };
    writeConfig(cfg);
  } catch {
    /* できる範囲で */
  }
}
function savedWindowBounds() {
  const b = readConfig().windowBounds;
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width < 400 || b.height < 300) return null;
  try {
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
    // 画面の外（モニタが外れたなど）→ 大きさは保ち、x/y は捨てて OS に中央へ置かせる。
    if (!onScreen || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      return { width: b.width, height: b.height, isMaximized: !!b.isMaximized };
    }
  } catch {
    /* ready の前は screen モジュールが使えない＝そのまま使う方へ抜ける */
  }
  return { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized: !!b.isMaximized };
}

// electron-vite の開発サーバー（レンダラー向けの HMR ＋ React Fast Refresh）。
// `electron-vite dev` が自動で設定する。`electron-vite build` の下では無い（`electron-vite dev`
// を一度も走らせない自動ビルド→再起動の検証ループでも無い＝docs/開発ガイド.md を参照）。
// 本番では null で、そこではレンダラーが代わりに app:// から配られる（#7）。
//
// 値は環境変数で、このウィンドウの preload は破壊的な IPC を渡すので、loadURL へ直行させずに
// dev-server-guard を通す。パッケージ済みのビルドはこれを丸ごと無視し、開発では http: の
// ループバックアドレスだけが生き残る。番人が弾いたものは、すべて同梱のレンダラーを読み込む
// （#381）。`devServer.rejected` を報告するのは index.ts＝このモジュールのヘッダを参照。
const devServer = resolveDevServerUrl(process.env.ELECTRON_RENDERER_URL, app.isPackaged);
const DEV_SERVER_URL = devServer.url;
// 導出元は番人の出力であって、生の環境変数ではない。弾かれた値が、ナビゲーションの番人が
// 受け入れる範囲も、開発時だけの CSP の留め先も広げられないように（#381）。本番では null で、
// そこではどちらも何もしない。
const DEV_ORIGIN = DEV_SERVER_URL ? new URL(DEV_SERVER_URL).origin : null;

// アプリが作るすべての web-contents に掛けるナビゲーションの封鎖（すべてのウィンドウ、#32 St1
// ＝これは 'web-contents-created' を聴く。かつて1つのウィンドウに対して発火していたのと同じ形で、
// 新しい BrowserWindow ごとに発火する）。これが無いと、ウィンドウへ落としたファイル（ローカルの
// .html など）で最上位のフレームが file://… へ遷移し、そのフレームは同じ preload を継ぐので
// 破壊的な IPC（clear-all / import-complete / …）を呼べてしまう。やることは次の2つ。
//   - will-navigate は、こちらのレンダラー（app://bundle/index.html）と、asset:// のビューア
//     スキーム上のラスタ画像以外に対しては断る。最初の loadURL は will-navigate を発火しないので、
//     これが起動を止めることはない。実際にここを通るのは画像ウィンドウの読み込み直し。
//     #215: asset:// が最上位の文書になれるのはラスタ形式のときだけ＝
//     isViewerImageName は、ライブラリのファイルを文書に変え得る入口（この番人の asset: の分岐と、
//     ipc-window.ts の open-image-window）が全部で共有する唯一の述語なので、新しいウィンドウが
//     自分だけの、より緩い2つ目の許可リストを持つことはない。
//   - window.open / target=_blank は丸ごと断る。外部リンクは open-external の IPC
//     （shell.openExternal）へ集約してあり、これはそのまま残す。
function installNavigationGuards() {
  const isAllowedNavigation = (rawUrl) => {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return false;
    }
    // 単体の画像ウィンドウは、アプリが制御する asset:// のスキーム上にある＝ただし、それが
    // 見せるつもりのラスタ形式に限る（#215）。asset: を一律に通すと、最上位のナビゲーションを
    // 操れるものは何であれ、スクリプトの入った SVG をライブラリ自身のオリジンへ置けてしまう。
    // 同じ許可リストが open-image-window のゲートにもなるので、どちらの入口も、何が文書になれるかに
    // ついて一致する。
    if (u.protocol === 'asset:') {
      try {
        return isViewerImageName(decodeURIComponent(u.pathname).replace(/^\/+/, ''));
      } catch {
        return false;
      }
    }
    // 開発時だけ。Vite の開発サーバーの中での遷移を許す＝その HMR クライアントは Fast Refresh
    // で扱えない編集に対して location.reload() を丸ごと行い、そうしないとここで塞がれる。
    // DEV_ORIGIN は本番では null なので、そこでは何もしない。
    if (DEV_ORIGIN && u.origin === DEV_ORIGIN) return true;
    // こちらのレンダラー＝その入口の文書だけで、クエリとハッシュは見ない。スキームを丸ごと
    // 通すことはしない。app://bundle/その他 は、preload のブリッジを載せたオリジンの上の
    // 2つ目の文書になる。asset:// を一律に通す誤りと同じ。
    if (u.protocol === 'app:') return isAppRendererUrl(u);
    return false;
  };
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url)) event.preventDefault();
    });
    // レンダラー発の新しいウィンドウ・タブは全部断る。外部への遷移は、こちらの preload を継ぐ
    // ポップアップではなく open-external の IPC を通す決まり。
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

// --- ウィンドウ ---
// show ＝ #32 より前と同じ意味（隠して作り、アクティブにせずに見せる＝SMOKE /
//   HOLOGRAM_START_MINIMIZED / HOLOGRAM_START_INACTIVE。いずれも単一ウィンドウの経路）。
// opts.secondary ＝ #32 St1: Ctrl+Shift+N、2回目起動の入口、「新しいウィンドウを開く」のメニュー
//   操作から開いたウィンドウ。この実行でアプリ自身が最初に開くウィンドウ（index.ts の起動時の
//   呼び出しで、常に主ウィンドウ）と対になる。副ウィンドウは:
//     - 設定の唯一の `windowBounds` キーを読み書きする代わりに、最後のウィンドウの bounds から
//       +24px カスケードする（永続化される位置は1つ、主ウィンドウのもの＝上の位置と大きさの
//       永続化のコメントを参照）。
//     - 自分の位置と大きさを永続化しない（理由は同じ）。
//     - それ以外は同一のウィンドウ。preload も同じ、ナビゲーションの番人も同じ（上でアプリ全体に
//       1回だけ掛けてある）、レンダラーのバンドルも同じ。「副」たらしめているのは、レンダラーが
//       自分の起動時のクエリから読み戻す状態（`secondary=1`。`theme` が既に通っているのと同じ
//       経路）。ipc-config.ts のタブの番人は代わりにメインプロセス側でウィンドウの同一性を読む
//       （その webContents.id を主ウィンドウのものと突き合わせる）ので、レンダラー側の旗は
//       参考でしかなく、安全性の境界では決してない。
// テーマは設定から先に解決する。ウィンドウの最初の描画（とその背景）がそれに合うように＝ちらつき
// が無く、SMOKE のキャプチャにも映る。createWindow と lib-pin-window.ts の createPinWindow
// （#79）で共有する。どちらも設定値（auto/light/dark）を ?theme= のクエリとして自分のページへ
// 渡し、theme.js が <head> の中で同期的に読む。'auto' はそこで prefers-color-scheme
// （nativeTheme に追随する）を通して解決される。BrowserWindow の背景については、ページが何かを
// 描くより前に、ここでも 'auto' を解決する（isDarkTheme）。
function resolveTheme(): 'auto' | 'light' | 'dark' {
  const cfgTheme = readConfig().theme;
  return ['auto', 'light', 'dark'].includes(cfgTheme) ? cfgTheme : 'auto';
}
function isDarkTheme(theme: 'auto' | 'light' | 'dark'): boolean {
  return theme === 'dark' || (theme === 'auto' && nativeTheme.shouldUseDarkColors);
}

function createWindow(show = true, opts?: { secondary?: boolean }) {
  const secondary = !!(opts && opts.secondary);
  const theme = resolveTheme();
  const dark = isDarkTheme(theme);
  const smoke = process.env.HOLOGRAM_SMOKE === '1';
  // 副ウィンドウは、永続化された主ウィンドウの位置と大きさを読まない＝代わりに、それを開いた
  // ウィンドウから（下で）カスケードするので、ここの `sb` は主ウィンドウ専用。
  const sb = smoke || secondary ? null : savedWindowBounds();
  const opener = secondary ? windows[windows.length - 1] : null;
  let cascadeBounds: { x: number; y: number } | null = null;
  if (opener && !opener.isDestroyed()) {
    try {
      const ob = opener.getBounds();
      // 開いた側のディスプレイの中に収めるので、Ctrl+Shift+N を長く連ねてもウィンドウが画面外へ
      // 歩いて行くことはない＝そのディスプレイの中でカスケードし、端まで来たら折り返す。
      const display = screen.getDisplayMatching(ob);
      const area = display.workArea;
      const cascaded = { x: ob.x + 24, y: ob.y + 24 };
      cascadeBounds = {
        x: cascaded.x + 1100 <= area.x + area.width ? cascaded.x : area.x + 24,
        y: cascaded.y + 820 <= area.y + area.height ? cascaded.y : area.y + 24,
      };
    } catch {
      /* この時点では主ディスプレイの API が使えない＝OS 任せの配置を代わりに使う */
    }
  }
  const win = new BrowserWindow({
    // ハーネスの実行では、通常の既定ではなく横に広いウィンドウにする＝この大きさがテストの
    // 取り決めの一部である理由は smoke-window-size.ts を参照。
    width: (sb && sb.width) || (smoke ? SMOKE_WINDOW.width : 1100),
    height: (sb && sb.height) || (smoke ? SMOKE_WINDOW.height : 820),
    ...(sb && Number.isFinite(sb.x) ? { x: sb.x, y: sb.y } : {}),
    ...(cascadeBounds ? cascadeBounds : {}),
    minWidth: 720,
    minHeight: 480,
    show,
    backgroundColor: dark ? '#0c0e12' : '#f6f7f9',
    title: 'Hologram',
    icon: APP_ICON,
    paintWhenInitiallyHidden: true,
    // titleBarOverlay は使わない。最小化・最大化・閉じるのボタンはタブバーの中にアプリが描く。
    // OS のオーバーレイは自分の帯をブラウザプロセス側のコンポジタに描くので、その色を web の層の
    // 変化（モーダルの覆い）と同期させることはできない＝フレームごとに近似するしかなく、それは
    // ちらつきとして見えた。アプリが描くボタンは覆いと同じフレームにいるので、この不一致の類は
    // 丸ごと消える。代償は Windows 11 の Snap Layouts のフライアウトで、あれは本物のキャプション
    // ボタンにしか出ない（OS がウィンドウに「この点は最大化ボタンか」と尋ね、ネイティブの
    // オーバーレイだけが「はい」と答えられる）。Snap 自体はほかの手段では今も働く。Win+矢印、端へのドラッグ、
    // Win+Z。
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  windows.push(win);
  // ハーネスのウィンドウの大きさは、上のコンストラクタではなく生成の後で決める。Electron は
  // コンストラクタの大きさをディスプレイの作業領域に収めてしまい、CI のランナーは 1024x768 だ＝
  // 要求した幅が黙って狭く届き、それはどのハーネスの事例も想定していないレイアウトになる
  // （CI で実測: 1440 を要求して 1024 が返った）。setContentSize はそういう収め方をされない。
  // e2e/lib/harness.ts が既に取っているのと同じ道。
  if (smoke) win.setContentSize(SMOKE_WINDOW.width, SMOKE_WINDOW.height);
  win.on('closed', () => {
    const i = windows.indexOf(win);
    if (i >= 0) windows.splice(i, 1);
  });
  win.removeMenu();
  // アプリが描く最大化ボタンは本物のウィンドウの状態を映す。その状態はボタンを使わなくても
  // 変わる（スナップ、ドラッグ用の帯のダブルクリック、Win+矢印、タスクバー）ので、レンダラーに
  // ポーリングさせず変化のたびに送る。閉じ込めるのはこのウィンドウ（共有された主ウィンドウの
  // 束縛ではない＝#32 St1: 各ウィンドウは自分の最大化状態を自分にだけ送る）。
  const sendMaximized = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('window-maximized-changed', win.isMaximized());
  };
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);
  if (!smoke && !secondary) {
    if (sb && sb.isMaximized) win.maximize();
    // 起動をまたいで位置と大きさを覚える（resize / move ではデバウンスし、close で吐き出す）。
    // 主ウィンドウだけ＝上の位置と大きさの永続化のコメントを参照。
    win.on('resize', () => persistWindowBounds(win));
    win.on('move', () => persistWindowBounds(win));
    win.on('maximize', () => persistWindowBounds(win));
    win.on('unmaximize', () => persistWindowBounds(win));
    win.on('close', () => saveWindowBoundsNow(win));
  }
  // smoke=1 を渡して、隠れたキャプチャ用ウィンドウを白紙のままにする画面外描画の最適化
  // （content-visibility / 画像の遅延読み込み）をレンダラーに切らせる。secondary=1（#32 St1）は
  // theme / smoke と同じ形でレンダラーが読む（起動時のクエリパラメータ＝services/window-role.ts
  // が読む）。tabs.json の番人そのものは、この旗ではなく main 側で効かせている（ipc-config.ts）。
  const query = { theme, ...(smoke ? { smoke: '1' } : {}), ...(secondary ? { secondary: '1' } : {}) };
  if (DEV_SERVER_URL) {
    // 開発時はレンダラーを electron-vite の Vite 開発サーバーから読み込む（HMR ＋ Fast Refresh）。
    // 文字列の連結ではなく URL で組み立てるので、（既に検証済みの）開発 URL がどんな形でも
    // クエリはクエリの枠へ着地する。
    const devUrl = new URL(DEV_SERVER_URL);
    devUrl.search = new URLSearchParams(query).toString();
    win.loadURL(devUrl.href);
  } else {
    win.loadURL(appIndexUrl(query));
  }
  return win;
}

// ウィンドウをアクティブにせずに z 順の一番下へ移す。使うのは下の HOLOGRAM_START_INACTIVE の
// 検証経路だけなので、koffi は devDependency で、require は意図して遅延させてある。パッケージ
// 済みのビルドがこの行に届くことはないし、万一届いても、アプリが死ぬのではなくウィンドウが
// そのままの場所に留まるだけ。HWND は void* ではなく uintptr_t として渡す＝
// getNativeWindowHandle() が返すのはハンドルを保持する Buffer で、void* の引数にすると
// ハンドルそのものではなくその Buffer のアドレスを渡すことになる。
function sendWindowToBack(w: BrowserWindow): void {
  if (process.platform !== 'win32') return;
  const HWND_BOTTOM = 1;
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOACTIVATE = 0x0010;
  try {
    const koffi = nodeRequire('koffi');
    const user32 = koffi.load('user32.dll');
    const SetWindowPos = user32.func('__stdcall', 'SetWindowPos', 'bool', ['uintptr_t', 'uintptr_t', 'int', 'int', 'int', 'int', 'uint']);
    const hwnd = w.getNativeWindowHandle().readBigUInt64LE(0);
    const ok = SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    if (!ok) log.warn('SetWindowPos(HWND_BOTTOM) returned false');
  } catch (err) {
    log.warn('could not send window to back', { error: (err as Error).message });
  }
}

export { APP_ICON, DEV_ORIGIN, DEV_SERVER_URL, RELOAD_AFTER_LIBRARY_SWAP_MS, devServer, createWindow, getWin, getWindows, installNavigationGuards, isDarkTheme, resolveTheme, sendToOtherWins, sendToWin, sendWindowToBack };
