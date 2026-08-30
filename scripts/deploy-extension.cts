'use strict';

// `npm run deploy:ext` — 開発用と日常用のChromeプロファイルが共有するフォルダへ
// リリースビルドを1回だけ生成し、両方へ読み込み直す合図を送る。
//
// 開発用プロファイルは CDP Extensions.loadUnpacked で即座に読み直す。日常用
// プロファイルには Native Host の応答へ載るビルドトークンで変更を知らせ、既存の
// 安全待機を通った後に chrome.runtime.reload() してもらう。どちらも読むファイルは
// extension/.output/chrome-mv3 の同一物である。
//
// 順序は、ビルドと検証、CDPによる開発用の再読み込み、日常用への告知の順にする。
// 検証前の不完全な出力を読み直すよう告知すると、Chromeが拡張機能を無効化するためだ。

const fs = require('node:fs');
const path = require('node:path');

const { configDir, extensionBuildStampPath } = require('../native-host/paths.mts');
const { assertWindowsUserContext } = require('../native-host/windows-user-context.mts');
const { buildExtension } = require('./build-extension.cts');
const { DEFAULT_CDP_URL, cdpReady, configureDevelopmentExtension } = require('./lib-extension-profile.cts');

const ROOT = path.join(__dirname, '..');
const SHARED_OUTPUT = path.join(ROOT, 'extension', '.output', 'chrome-mv3');

// 告知が真でありうる場所でだけ発行する。main working tree の出力だけを実際の
// Chromeが読む。連結されたworktreeで発行すると、ブラウザが読んでいないビルドの
// トークンで日常用プロファイルを再読み込みさせてしまう。
function shouldPublish(): boolean {
  if (process.env.HOLOGRAM_CONFIG_DIR) return true;
  try {
    return fs.statSync(path.join(ROOT, '.git')).isDirectory();
  } catch {
    return true;
  }
}

// 一時ファイルから置き換え、Native Hostが書きかけのJSONを読まないようにする。
function publish(buildId: string): string {
  const file = extensionBuildStampPath();
  fs.mkdirSync(configDir(), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ build: buildId, outDir: SHARED_OUTPUT, builtAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
  return file;
}

async function main(): Promise<void> {
  assertWindowsUserContext('npm run deploy:ext');
  const { buildId, output } = buildExtension('chrome', SHARED_OUTPUT);
  console.log(`[hologram] 共有リリースビルドを1回生成しました: ${output}`);

  if (!shouldPublish()) {
    console.log(`[hologram] 拡張機能ビルド ${buildId} は読み込み直しを告知しませんでした＝連結されたworktreeで、どのブラウザもその出力を読んでいません`);
    return;
  }

  if (await cdpReady(DEFAULT_CDP_URL)) {
    const configured = await configureDevelopmentExtension(output, DEFAULT_CDP_URL);
    console.log(`[hologram] 開発用ChromeをCDPで読み込み直しました: ${configured.path}`);
  } else {
    console.log('[hologram] 開発用Chromeは起動していないため、CDPでの読み込み直しを省略しました');
  }

  console.log(`[hologram] 日常用Chromeへ拡張機能ビルド ${buildId} を ${publish(buildId)} で告知しました`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
