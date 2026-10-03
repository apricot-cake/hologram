'use strict';

// `npm run ext:deploy` — リリースビルドを一時フォルダで生成・検証してから、開発用と
// 日常用のChromeプロファイルが共有するフォルダへ安全に配置し、読み込み直す合図を送る。
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

// 共有フォルダをWXTの出力先にすると、WXTが最初にその中身を消してからビルドする間に
// 遅れていたreloadが走り、Chromeが不完全な拡張機能を読んで無効化してしまう。一時
// フォルダで検証を済ませ、各ファイルを同じディレクトリ内のrenameで置き換える。
// manifestは最後に置くため、配置中も共有フォルダのmanifestが参照するファイルは常に
// 揃っている。古いビルドだけが使うファイルは、新manifestを置いた後で削除する。
function installVerifiedOutput(source: string, destination: string): string {
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  fs.mkdirSync(destinationRoot, { recursive: true });

  const files = fs
    .readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath.slice(sourceRoot.length + 1), entry.name));
  const manifest = 'manifest.json';
  if (!files.includes(manifest)) throw new Error('検証済みビルドにmanifest.jsonがありません');

  for (const relative of [...files.filter((file) => file !== manifest), manifest]) {
    const target = path.join(destinationRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.deploy-${process.pid}`;
    fs.copyFileSync(path.join(sourceRoot, relative), temp);
    fs.renameSync(temp, target);
  }

  const wanted = new Set(files);
  const installed = fs.readdirSync(destinationRoot, { recursive: true, withFileTypes: true });
  for (const entry of installed) {
    if (!entry.isFile()) continue;
    const relative = path.join(entry.parentPath.slice(destinationRoot.length + 1), entry.name);
    if (!wanted.has(relative)) fs.rmSync(path.join(destinationRoot, relative), { force: true });
  }
  return destinationRoot;
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
  const staging = `${SHARED_OUTPUT}.deploy-${process.pid}-${Date.now()}`;
  let buildId: string;
  try {
    ({ buildId } = buildExtension('chrome', staging));
    installVerifiedOutput(staging, SHARED_OUTPUT);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const output = SHARED_OUTPUT;
  console.log(`[hologram] 共有リリースビルドを1回生成しました: ${output}`);

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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
