'use strict';

// 設定／環境設定／タブの IPC ハンドラ。main.js から抽出した（機械的な移動＝
// ロジックは変えていない）。これらは config.json（get-config/get-prefs/
// set-pref）、tabs.json の整理情報ファイル（get/set-tabs）、ウィンドウの
// タイトルバーオーバーレイ、静的なビルド情報（app-info）に触れる。中核の
// ヘルパーは ctx 経由で届く。環境設定キーの許可リストはここにある
// （これらのハンドラだけが使う）。
//
// get-extension-contact（#71）は ctx を経由せず、config.json の「外」にある
// マーカー（native-host/paths.mts の extensionContactPath。ブリッジが触れる
// ——そのモジュールのヘッダー参照）を読む: これは可変なメインプロセス状態に
// 何も依存しない、ただの存在チェックなので、lib-config.ts / lib-thumbnails.ts
// と同じやり方でパスのヘルパーを直接 import する。
import { app, BrowserWindow } from 'electron';
import { ipcMain } from './activity-ipc.ts';
import fs from 'node:fs';
import { extensionContactPath } from './native-host.ts';
import type { HologramConfig, IpcContext } from './ipc-context.ts';
import type { AppInfo, AppPrefs, ConfigSummary, ExtensionContactStatus, LibraryStatus, OkResult, TabsState } from './ipc-payloads.ts';

// --- 環境設定（language / layoutMode / skipDeleteConfirm / ……） ---
// 投稿の並び順はここには「無い」: それはタブごとの状態（tabs-builder.ts の
// snapshotState）に住み、そこで永続化・復元される。旧来の 'sortBy' 環境設定は
// その二重の保管の負けた側だった——2つは読み込み時に競合していた——タブの
// 状態が引き継いでから、レンダラーはこれを読まなくなった。
const PREF_KEYS = ['language', 'layoutMode', 'squareThumbs', 'showInfo', 'showAvatar', 'skipDeleteConfirm', 'gridSize', 'listThumb', 'theme', 'uiFontFamily', 'browseMode', 'posterLayoutMode', 'posterShowInfo', 'posterGridSize', 'inspectorOpen', 'inspectorWidth', 'panelsHidden', 'webSearchChecked', 'shortcutOverrides'];

// --- 引退した3値の表示密度を一度だけ読む処理（#618 投稿 / #630 投稿者） ---
// `viewMode` / `posterViewMode`（card/tile/list）と、密度ごとのサイズキーは、もう
// どこからも書かれない。これらは、以前のビルドが残した config.json を読み、
// アプリが利用者が最後に選んだ表示で開くようにする。リリース前の足場: この4つと、
// get-prefs 内のその呼び出し箇所は 1.0 より前に削除する（docs/プロダクト方針.md
// 「採否の物差しに使わないもの」: リリース前は「他人のライブラリ」というものが
// 存在しない）。
const legacyDensity = (cfg: HologramConfig): string => (['card', 'tile', 'list'].includes(cfg.viewMode) ? cfg.viewMode : 'card');
const legacyGridSize = (cfg: HologramConfig): number | null => {
  const px = legacyDensity(cfg) === 'tile' ? cfg.imageTileSize : cfg.cardSize;
  return Number.isFinite(px) ? px : null;
};
const legacyPosterDensity = (cfg: HologramConfig): string => (['card', 'tile', 'list'].includes(cfg.posterViewMode) ? cfg.posterViewMode : 'card');
const legacyPosterGridSize = (cfg: HologramConfig): number | null => {
  const px = legacyPosterDensity(cfg) === 'tile' ? cfg.posterTileSize : cfg.posterCardSize;
  return Number.isFinite(px) ? px : null;
};

function register(ctx: IpcContext) {
  const { readConfig, writeConfig, getSaveFolder, getDbWriter, getLibraryStatus, isPrimarySender } = ctx;

  ipcMain.handle('get-config', (): ConfigSummary => {
    const cfg = readConfig();
    return { saveFolder: getSaveFolder(), extensionId: cfg.extensionId || null };
  });

  // #37: レンダラーは起動時（そしてリトライ／repoint の後にもう一度）これを
  // 呼び、通常のライブラリを見せるか libraryMissing 画面を見せるかを決める
  // ——empty/LibraryMissingState.tsx 参照。常にその場のチェックで、キャッシュ
  // した push ではない。
  ipcMain.handle('get-library-status', (): LibraryStatus => getLibraryStatus());

  // #71: ブリッジが接触マーカーに一度でも触れたか——このファイルのヘッダーと
  // paths.mts の extensionContactPath 参照。呼ぶたびにその場で存在チェックする、
  // 上の get-library-status と同じ形。アプリ側からこのファイルを書くことは
  // 無いので、無効化すべきキャッシュも無い。
  ipcMain.handle('get-extension-contact', (): ExtensionContactStatus => ({ contacted: fs.existsSync(extensionContactPath()) }));

  // ウィンドウコントロール。最小化／最大化／閉じるのボタンは OS のオーバーレイ
  // ではなくアプリ（レンダラーの DOM）が描くので、以前はネイティブに持っていた
  // ウィンドウコマンドは今は IPC 経由で来る。なぜアプリ側で描くのかは AppShell の
  // WindowControls コンポーネント参照。
  //
  // #32 St1: 「呼び出した」ウィンドウから解決する
  // （BrowserWindow.fromWebContents(e.sender)）。ctx.getWin()（主ウィンドウ）
  // ではない——副ウィンドウ自身の最小化／最大化／閉じるボタンは、黙って
  // ウィンドウ A へ手を伸ばすのではなく、自分自身に作用しなければならない。
  ipcMain.handle('window-control', (_e, action): boolean | null => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (!win) return null;
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') win.close();
    return win.isMaximized();
  });

  // 最大化ボタンのグリフは、こちらの関与なしに変わる実際のウィンドウ状態に
  // 従う（スナップ、ドラッグ帯のダブルクリック、Win+Up、タスクバー）。レンダラーに
  // ポーリングさせるのではなく push する。上の window-control と同じ、
  // 呼び出し元ごとの解決。
  ipcMain.handle('window-is-maximized', (_e) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    return !!win && win.isMaximized();
  });

  // #32 St1: tabs.json の番人——それを読み書きしてよいのは「主」ウィンドウの
  // 送信元だけ（設計:「他窓は読み書きとも遮断＝タブ喪失防止」）。副ウィンドウの
  // get-tabs は null を返す（レンダラーの initTabs は既に null を「まだ何も
  // 保存されていない」と同じに扱い、空のタブを1つ種蒔きする——tabs-builder.ts
  // 参照）。その set-tabs は静かに何もしない（persistTabs() の呼び出し元は
  // 既に {ok:false} をベストエフォートとして扱う）。将来このチェックを忘れ
  // うる呼び出し箇所すべてにではなく、ここで一度だけ強制する。
  ipcMain.handle('get-tabs', (_e): TabsState | null => {
    if (!isPrimarySender(_e.sender.id)) return null;
    return getSaveFolder() ? getDbWriter().getTabs() : null;
  });
  ipcMain.handle('set-tabs', (_e, data): OkResult => {
    if (!isPrimarySender(_e.sender.id)) return { ok: false };
    if (!getSaveFolder()) return { ok: false };
    try {
      getDbWriter().setTabs(data);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // 設定の「About」パネル向けのビルド／バージョン情報。app.getVersion() は
  // 読み込まれたアプリの package.json（1.1.0）を読むので、開発時もパッケージ済み
  // でも等しく正しい。
  ipcMain.handle(
    'app-info',
    (): AppInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
    }),
  );

  ipcMain.handle('get-prefs', (): AppPrefs => {
    const cfg = readConfig();
    return {
      language: cfg.language || 'auto',
      // #618: レイアウト + 独立した2つのグリッド切り替え。下の `legacy*` は、
      // 引退した3値の密度（card/tile/list）を一度だけ読む。だからこの分割より
      // 前に書かれた設定でも、利用者が最後にしていた表示のまま開く。リリース前の
      // 足場——legacy のフォールバック（とこのコメント）は 1.0 より前に削除する。
      layoutMode: ['grid', 'list'].includes(cfg.layoutMode) ? cfg.layoutMode : legacyDensity(cfg) === 'list' ? 'list' : 'grid',
      squareThumbs: typeof cfg.squareThumbs === 'boolean' ? cfg.squareThumbs : legacyDensity(cfg) === 'tile',
      showInfo: typeof cfg.showInfo === 'boolean' ? cfg.showInfo : legacyDensity(cfg) !== 'tile',
      // #658: legacy の密度はどれもアバターの軸を運んでいなかった——ただの単純な boolean の既定値。
      showAvatar: typeof cfg.showAvatar === 'boolean' ? cfg.showAvatar : true,
      skipDeleteConfirm: !!cfg.skipDeleteConfirm,
      gridSize: Number.isFinite(cfg.gridSize) ? cfg.gridSize : legacyGridSize(cfg), // グリッド: 列幅 px
      listThumb: Number.isFinite(cfg.listThumb) ? cfg.listThumb : null, // 一覧: サムネイル幅 px
      theme: ['auto', 'light', 'dark'].includes(cfg.theme) ? cfg.theme : 'auto', // システムに合わせる / ライト / ダーク
      uiFontFamily: typeof cfg.uiFontFamily === 'string' ? cfg.uiFontFamily : '', // #137: インターフェースフォントの上書き。'' = 既定のスタック
      browseMode: cfg.browseMode === 'posters' ? 'posters' : 'posts', // ライブラリ / 投稿者（起動時に復元される）
      // #630: 投稿者グリッド独自の2つの軸。`legacyPoster*` は、投稿側と同じ
      // 一度限りの処理で、引退した3値の密度（card/tile/list）を読む。
      posterLayoutMode: ['grid', 'list'].includes(cfg.posterLayoutMode) ? cfg.posterLayoutMode : legacyPosterDensity(cfg) === 'list' ? 'list' : 'grid',
      posterShowInfo: typeof cfg.posterShowInfo === 'boolean' ? cfg.posterShowInfo : legacyPosterDensity(cfg) !== 'tile',
      posterGridSize: Number.isFinite(cfg.posterGridSize) ? cfg.posterGridSize : legacyPosterGridSize(cfg), // 投稿者グリッドの列幅 px
      inspectorOpen: typeof cfg.inspectorOpen === 'boolean' ? cfg.inspectorOpen : null, // 詳細パネルの表示／非表示。null = 一度も切り替えていない
      inspectorWidth: Number.isFinite(cfg.inspectorWidth) ? cfg.inspectorWidth : null,
      panelsHidden: typeof cfg.panelsHidden === 'boolean' ? cfg.panelsHidden : null, // #245 サイドバー + 詳細パネルの一括非表示。null = 一度も使っていない
      // #207: ウェブ検索ポップオーバーの環境設定。
      webSearchChecked: Array.isArray(cfg.webSearchChecked) ? cfg.webSearchChecked.filter((v: unknown): v is string => typeof v === 'string') : null,
      // #246: コマンドごとのキー上書き（コマンド id -> "Ctrl+Shift+F" 形式の組み合わせ文字列）。
      // ここに現れるのは上書きされた id だけ。それ以外はすべて登録済みの既定値のまま
      // ——キーのデータ自体の唯一の正本は services/shortcut-registry.ts 参照。
      shortcutOverrides: cfg.shortcutOverrides && typeof cfg.shortcutOverrides === 'object' ? cfg.shortcutOverrides : {},
    };
  });

  ipcMain.handle('set-pref', (_e, key, value): OkResult => {
    if (!PREF_KEYS.includes(key)) {
      // 黙って拒むことが、`inspectorOpen` が何か月も書かれないままになっていた
      // 経緯そのもの（#391）: レンダラーの呼び出し元はどれも `{ok:false}` を
      // 捨てるので、許可リストに無いキーは、誰かが config.json を読むまで
      // 動いている環境設定とまったく同じに見える。呼び出し箇所ではなくここで
      // ログを出すのは、ここがすべてが通る唯一の関所だから——新しい呼び出し元も、
      // 覚えていなくても自動的にカバーされる。
      console.warn(`set-pref refused an unknown key: ${String(key)}`);
      return { ok: false };
    }
    const cfg = readConfig();
    cfg[key] = value;
    writeConfig(cfg);
    return { ok: true };
  });
}

export { register };
