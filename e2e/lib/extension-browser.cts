'use strict';

// 拡張機能のブラウザテストすべてが共有する Playwright の起動処理。Playwright
// の拡張機能対応には同梱の Chromium と persistent context が必要。このセット
// アップをここに集約することで、オフラインフィクスチャ・
// オーバーレイの回帰テストが別々のブラウザスタックへ散らばっていくことを
// 防いでいる。
//
// #657: Chrome 137以降は `--load-extension` コマンドラインスイッチを廃止した。
// 同梱の Chromium では最初の読み込みでは今も動いているように見える（拡張機能
// は `location=COMMAND_LINE` を得る）が、`chrome.runtime.reload()` が走った
// 瞬間、Chrome はそれを実際にリロードするのではなく
// `DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION` で無効化してしまう —
// 無効化された拡張機能と孤立したタブは、ページから見るとまったく同じに
// 見えるので、`chrome.runtime.reload()` を前提に組んだテスト（孤立の再現）
// は、間違った障害を計測しながらグリーンのままだった。代わりの手段
// （このリポジトリの #650 調査で確認済み、この修正を組む過程でも再検証済み）
// は下の組み合わせ: CDP の `Extensions.loadUnpacked` は拡張機能に
// `location=UNPACKED` を与える（chrome://extensions の「パッケージ化されて
// いない拡張機能を読み込む」が生むのと同じ状態）。これが、`runtime.reload()`
// が無効化ではなく実際にリロードする唯一の location である。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../..');
const SOURCE_EXTENSION = path.join(ROOT, 'extension', '.output', 'chrome-mv3-test');
const PRODUCTION_NATIVE_HOST = 'com.hologram.host';

interface StageExtensionOptions {
  allUrls?: boolean;
  nativeHostName?: string;
  tempPrefix?: string;
}

function copyDirectory(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

function replaceNativeHostName(directory: string, nativeHostName: string): void {
  let replacements = 0;
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(target);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const source = fs.readFileSync(target, 'utf8');
      if (!source.includes(PRODUCTION_NATIVE_HOST)) continue;
      const next = source.replaceAll(PRODUCTION_NATIVE_HOST, nativeHostName);
      replacements += (source.match(new RegExp(PRODUCTION_NATIVE_HOST.replaceAll('.', '\\.'), 'g')) || []).length;
      fs.writeFileSync(target, next, 'utf8');
    }
  };
  visit(directory);
  if (!replacements) throw new Error(`ビルド済み拡張機能に native host ${PRODUCTION_NATIVE_HOST} が含まれていない`);
}

function stageExtension(options: StageExtensionOptions = {}): string {
  if (!fs.existsSync(path.join(SOURCE_EXTENSION, 'manifest.json'))) {
    throw new Error(`${SOURCE_EXTENSION} に拡張機能のビルドが無い — 先に \`npm run ext:build:test\` を実行すること`);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), options.tempPrefix || 'hologram-extension-e2e-'));
  copyDirectory(SOURCE_EXTENSION, directory);

  if (options.allUrls) {
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    manifest.host_permissions = Array.from(new Set([...(manifest.host_permissions || []), '<all_urls>']));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }
  if (options.nativeHostName && options.nativeHostName !== PRODUCTION_NATIVE_HOST) {
    replaceNativeHostName(directory, options.nativeHostName);
  }
  return directory;
}

// chrome://extensions は Polymer/Lit のページ: 意味のあるコントロールはどれも
// 入れ子の shadow root の奥にあるので、可視 DOM のセレクタではなくスクリプト
// で辿るしかない。Preferences へ直接 "devMode" を書き込むだけでは足りない —
// Chrome は本物の UI トグルしか尊重しない（この修正を組む過程で確認済み:
// トグルを OFF のままで unpacked を読み込むと、`runtime.reload()` が走った
// 瞬間に拡張機能は結局無効化されてしまう）。
const DEV_MODE_TOGGLE_JS = `
  document.querySelector('extensions-manager')?.shadowRoot
    ?.querySelector('extensions-toolbar')?.shadowRoot
    ?.querySelector('#devMode') ?? null
`;

async function ensureDeveloperModeOn(context: any): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto('chrome://extensions');
    await page.waitForFunction(`!!(${DEV_MODE_TOGGLE_JS})`, { timeout: 10_000 });
    const alreadyOn = await page.evaluate(`(${DEV_MODE_TOGGLE_JS}).checked`);
    if (!alreadyOn) {
      await page.evaluate(`(${DEV_MODE_TOGGLE_JS}).click()`);
      await page.waitForFunction(`(${DEV_MODE_TOGGLE_JS}).checked === true`, { timeout: 5_000 });
    }
  } finally {
    await page.close();
  }
}

// これに必要なブラウザレベルの CDP セッション（`Extensions` はページドメイン
// ではなくブラウザドメイン）は、呼び出しが返ったらすぐに detach してよい —
// 拡張機能は読み込まれたままで、後で `chrome.runtime.reload()` が走っても
// 有効なままである（この修正を組む過程で確認済み）。セッションをブラウザの
// 生存期間ずっと保持しておく必要は無い。
async function loadUnpacked(context: any, extensionDir: string): Promise<string> {
  const cdp = await context.browser().newBrowserCDPSession();
  try {
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionDir });
    return id;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

interface LaunchExtensionOptions {
  extensionDir: string;
  userDataDir?: string | null;
  headless?: boolean;
  viewport?: { width: number; height: number } | null;
  locale?: string;
  args?: string[];
  // どのバイナリを駆動するか。テストは実行を再現可能にするため、デフォルトの
  // 同梱 Chromium を保つ。目的が「人間がサインインしたプロファイル」（サイン
  // イン済みの本物の Chrome プロファイル）であるときだけ 'chrome' を渡す:
  // プロファイルディレクトリは1つの Chromium ビルドに属すので、それを別の
  // ビルドから借りると、セッションとプロファイル自体の両方を危険にさらす。
  channel?: string;
}

interface ExtensionBrowser {
  context: any;
  serviceWorker: any;
  extensionId: string;
  profileDir: string;
  close(): Promise<void>;
}

async function launchExtensionBrowser(options: LaunchExtensionOptions): Promise<ExtensionBrowser> {
  const ownsProfile = !options.userDataDir;
  const profileDir = options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-extension-e2e-profile-'));
  let context: any;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: options.channel || 'chromium',
      headless: options.headless ?? true,
      viewport: options.viewport === undefined ? { width: 1280, height: 960 } : options.viewport,
      locale: options.locale,
      // `--enable-unsafe-extension-debugging` があってはじめて `Extensions`
      // の CDP ドメインがそもそも使えるようになる。Playwright 自身のデフォルト
      // 引数には `--disable-extensions` が含まれており、これがあると unpacked
      // の読み込みが何もしなくなってしまうので、上書きではなく
      // ignoreDefaultArgs 経由で落とさなければならない。
      args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', ...(options.args || [])],
      ignoreDefaultArgs: ['--disable-extensions'],
    });
    await ensureDeveloperModeOn(context);
    const extensionId = await loadUnpacked(context, options.extensionDir);
    let serviceWorker = context.serviceWorkers().find((worker: any) => worker.url().startsWith(`chrome-extension://${extensionId}/`));
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', {
        predicate: (worker: any) => worker.url().startsWith(`chrome-extension://${extensionId}/`),
        timeout: 20_000,
      });
    }
    return {
      context,
      serviceWorker,
      extensionId,
      profileDir,
      async close() {
        await context.close();
        if (ownsProfile) fs.rmSync(profileDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (context) await context.close().catch(() => {});
    if (ownsProfile) fs.rmSync(profileDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  PRODUCTION_NATIVE_HOST,
  SOURCE_EXTENSION,
  launchExtensionBrowser,
  stageExtension,
};
