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
import type { IpcContext } from './ipc-context.ts';
import type { AppInfo, AppPrefs, ConfigSummary, ExtensionContactStatus, LibraryStatus, OkResult, TabsState } from './ipc-payloads.ts';

// --- 環境設定（language / squareThumbs / skipDeleteConfirm / ……） ---
// 投稿の並び順はここには「無い」: それはタブごとの状態（tabs-builder.ts の
// snapshotState）に住み、そこで永続化・復元される。旧来の 'sortBy' 環境設定は
// その二重の保管の負けた側だった——2つは読み込み時に競合していた——タブの
// 状態が引き継いでから、レンダラーはこれを読まなくなった。

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
    return AppPrefsSchema.parse(readConfig());
  });

  ipcMain.handle('set-pref', (_e, key, value): OkResult => {
    const cfg = readConfig();
    cfg[key] = value;
    writeConfig(cfg);
    return { ok: true };
  });
}

export { register };
import { AppPrefsSchema } from '../shared/data-schemas.ts';
