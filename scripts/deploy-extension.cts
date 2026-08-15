'use strict';

// `npm run deploy:ext` — 検証済みのリリースビルドを、日常使いのChromeが読み込んで
// いるフォルダへ配置し、拡張機能にそれが起きたと伝える（#732）。
//
// これはextension/.output/chrome-mv3の唯一の書き手。日常使いのブラウザが運ぶのは
// リリースビルドだけ: 開発は別のChromeプロファイルで別の出力（extension/wxt.config.ts）
// に対して行われるので、日常使いの拡張機能はもう開発サーバーが生きていることに
// 依存せず、検証に失敗したビルドはそこには決して届かない。
//
// main を日常の作業ツリーへ取り込んだ後、ローカルの post-merge フックから呼べる。
// 手で実行しても安全。
//
// ブラウザはどう知るか。Chromeはファイルが変わってもunpackedな拡張機能を読み直
// さないので、入れ替えだけではchrome://extensionsでのクリックが結局要る。それが
// 起きないのは#650のおかげ: このスクリプトは配置したビルドのトークンを
// native-host/paths.mtsのextensionBuildStampPathへ発行し、native hostがそのトークンを
// 全ての応答に載せ、保存のたびとバッジ問い合わせのたびに既にホストと話している
// 拡張機能が、自分が来たフォルダが今は別のビルドを保持していると気付いて、
// 自分自身にchrome.runtime.reload()を呼ぶ（保存・一括取り込み・capture UIの終了を
// 先に待ってから＝extension/utils/dev-reload.ts）。
//
// 順序が重要: 先に入れ替え、後で告知。まだディスクに無いビルドを告知することが、
// scripts/build-extension.ctsが防ごうとしているDISABLE_RELOADの失敗。

const fs = require('node:fs');
const path = require('node:path');

const { configDir, extensionBuildStampPath } = require('../native-host/paths.mts');
const { buildId, releaseDir } = require('./build-extension.cts');

const ROOT = path.join(__dirname, '..');
const DAILY = path.join(ROOT, 'extension', '.output', 'chrome-mv3');

// 告知が「真」でありうる場所でだけ発行する。スタンプは「あなたの拡張機能が
// 読み込まれたフォルダは今このビルドを保持している」と言うもので、実際に
// どこかのブラウザが読み込んだフォルダはmainのworking treeの出力だけ＝連結
// されたworktreeは、誰も読まない自分自身の.outputへ配置するので、そこから
// 告知すると、日常使いの拡張機能は決して見ることのないビルドのために
// reloadしてしまう。
//
// `.git`はmainのworking treeではディレクトリで、連結されたものでは「ファイル」
// になる。これはgit自身が同じことを言う方法。
//
// 明示的なHOLOGRAM_CONFIG_DIRはこれを上書きする: 呼び出し側は既にシステム全体を
// サンドボックスへ向けているので、乱す実際のインストールが無く、この経路を
// 試したいテストはそうできる。
function shouldPublish(): boolean {
  if (process.env.HOLOGRAM_CONFIG_DIR) return true;
  try {
    return fs.statSync(path.join(ROOT, '.git')).isDirectory();
  } catch {
    return true; // そもそもgitのcheckoutではない（tarball、CIの特殊事情）＝守るものが無い
  }
}

// ステージ済みのフォルダを名前変更して所定の位置へ動かすのではなく、ファイル
// ごとに「その場で」置き換える。名前変更は入れ替えをアトミックにする通常の
// 方法だが、ここでは使えない: unpackedな拡張機能が読み込まれている間ずっと、
// 日常使いのChromeがこのディレクトリの開いたハンドルを保持しているので、
// Windowsは名前変更をEPERMで失敗させる（2026-08-02に実測）。ハンドルを解放
// するために拡張機能をアンロードすることは、この経路全体が無くそうとしている
// クリックそのもののコストになる。
//
// その場での置き換えが安全なのは、指示されるまで誰もこのフォルダを読まない
// から。Chromeはunpackedな拡張機能の変更を監視せず、chrome.runtime.reload()の
// ときにだけ読み直す。それを求めるのは下の告知だけで、コピーが終わった後に
// 発行される。フォルダが不整合な時間窓には、読み手が誰も存在しない。
//
// 前のビルドにあって今回のビルドには無いファイルは削除する＝改名された
// エントリポイントが居残って、名前で注入されることがないように。
function listFiles(root: string, base = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute, base));
    else files.push(path.relative(base, absolute));
  }
  return files;
}

function swapIn(source: string): void {
  fs.mkdirSync(DAILY, { recursive: true });
  const wanted = new Set(listFiles(source));
  for (const stale of listFiles(DAILY)) {
    if (!wanted.has(stale)) fs.rmSync(path.join(DAILY, stale), { force: true });
  }
  fs.cpSync(source, DAILY, { recursive: true, force: true });
  // 前のレイアウトにあって今回には無いディレクトリ（CRXJSはエントリポイントを
  // 専用のフォルダの下に置いていた）＝残しても害は無いが、残すと紛らわしい。
  for (const entry of fs.readdirSync(DAILY, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const absolute = path.join(DAILY, entry.name);
    if (!listFiles(absolute, DAILY).length) fs.rmSync(absolute, { recursive: true, force: true });
  }
}

// 一時ファイル＋名前変更にして、読み手が書きかけのスタンプを決して見ないように
// する: ブリッジは応答のたびにこれを読み、破損した読み取りは単に何も発行しない
// だけで済むが、切り詰めてから埋めるファイルだと、一瞬だけ間違ったトークンを
// 発行してしまいかねない。
function publish(): string {
  const file = extensionBuildStampPath();
  fs.mkdirSync(configDir(), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ build: buildId, outDir: DAILY, builtAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
  return file;
}

swapIn(releaseDir('chrome'));
console.log(`[hologram] 検証済みのChromeリリースを ${DAILY} へ配置しました`);

if (shouldPublish()) {
  console.log(`[hologram] 拡張機能ビルド ${buildId} を ${publish()} で告知しました`);
} else {
  console.log(`[hologram] 拡張機能ビルド ${buildId} は告知しませんでした＝連結されたworktreeで、どのブラウザもその出力を読み込んでいません`);
}
