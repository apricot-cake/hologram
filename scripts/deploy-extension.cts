'use strict';

// `npm run ext:deploy` — 開発用と日常用のChromeプロファイルが共有するフォルダへ
// リリースビルドを1回だけ生成し、両方へ読み込み直す合図を送る。
//
// 開発用プロファイルは CDP Extensions.loadUnpacked で即座に読み直す。日常用
// プロファイルには Native Host の応答へ載るビルドトークンで変更を知らせ、既存の
// 安全待機を通った後に chrome.runtime.reload() してもらう。どちらも読むファイルは
// extension/.output/chrome-mv3 の同一物である。
//
// 順序は、ビルドと検証、開発用拡張機能の再読み込み、更新告知、開発用サイトの再読み込み。
// 検証前の不完全な出力を読み直すよう告知すると、Chromeが拡張機能を無効化するためだ。

const fs = require('node:fs');
const path = require('node:path');

const { configDir, extensionBuildStampPath } = require('../native-host/paths.mts');
const { assertWindowsUserContext } = require('../native-host/windows-user-context.mts');
const { buildExtension } = require('./build-extension.cts');
const { DEFAULT_CDP_URL, cdpReady, configureDevelopmentExtension, reloadDevelopmentPages } = require('./lib-extension-profile.cts');

const ROOT = path.join(__dirname, '..');
const SHARED_OUTPUT = path.join(ROOT, 'extension', '.output', 'chrome-mv3');

function emptyDirectory(directory: string): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory)) fs.rmSync(path.join(directory, entry), { force: true, recursive: true });
}

// Chrome が読み込んでいるフォルダそのものは Windows では rename できない。
// 代わりに、変更前の内容を退避してから中身だけを置き換え、コピーに失敗したら
// 必ず以前の検証済みビルドへ戻す。退避に失敗した場合はまだ共有出力に触れない。
function replaceInPlace(source: string, destination: string): void {
  const backup = `${destination}.backup-${process.pid}-${Date.now()}`;
  const existed = fs.existsSync(destination);
  if (existed) {
    try {
      fs.cpSync(destination, backup, { recursive: true, force: true });
    } catch (backupError) {
      fs.rmSync(backup, { force: true, recursive: true });
      throw backupError;
    }
  }

  let preserveBackup = false;
  try {
    fs.mkdirSync(destination, { recursive: true });
    emptyDirectory(destination);
    fs.cpSync(source, destination, { recursive: true, force: true });
  } catch (deployError) {
    try {
      emptyDirectory(destination);
      if (existed) fs.cpSync(backup, destination, { recursive: true, force: true });
      else fs.rmSync(destination, { force: true, recursive: true });
    } catch (rollbackError) {
      preserveBackup = true;
      throw new AggregateError([deployError, rollbackError], '拡張機能の配備と以前のビルドへの復元に失敗しました');
    }
    throw deployError;
  } finally {
    if (!preserveBackup) fs.rmSync(backup, { force: true, recursive: true });
  }
}

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
  assertWindowsUserContext('npm run ext:deploy');
  const stagedOutput = `${SHARED_OUTPUT}.stage-${process.pid}-${Date.now()}`;
  let buildId: string;
  try {
    ({ buildId } = buildExtension('chrome', stagedOutput));
    replaceInPlace(stagedOutput, SHARED_OUTPUT);
  } finally {
    fs.rmSync(stagedOutput, { force: true, recursive: true });
  }
  const output = SHARED_OUTPUT;
  console.log(`[hologram] 検証済み共有リリースビルドを配備しました: ${output}`);

  if (!shouldPublish()) {
    console.log(`[hologram] 拡張機能ビルド ${buildId} は読み込み直しを告知しませんでした＝連結されたworktreeで、どのブラウザもその出力を読んでいません`);
    return;
  }

  const developmentOpen = await cdpReady(DEFAULT_CDP_URL);
  if (developmentOpen) {
    const configured = await configureDevelopmentExtension(output, DEFAULT_CDP_URL);
    console.log(`[hologram] 開発用Chromeの拡張機能をCDPで読み込み直しました: ${configured.path}`);
  } else {
    console.log('[hologram] 開発用Chromeは起動していないため、CDPでの読み込み直しを省略しました');
  }

  console.log(`[hologram] 日常用Chromeへ拡張機能ビルド ${buildId} を ${publish(buildId)} で告知しました`);
  if (developmentOpen) {
    const reloaded = await reloadDevelopmentPages(output, DEFAULT_CDP_URL);
    console.log(`[hologram] 開発用Chromeの対応サイトを ${reloaded} タブ再読み込みしました`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

module.exports = { replaceInPlace };
