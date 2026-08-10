'use strict';

// `npm run build:ext` — Chrome/Firefox向けのリリース版拡張機能をビルドし、
// 何かがそれを使えるようになる前に両方の出力を検証する。
//
// これは日常使いのChromeが読み込んでいるフォルダには絶対に書き込まない。
// リリースはextension/.output/<browser>-mv3-releaseへ着地する。検証済みの
// ものをextension/.output/chrome-mv3へ置くのは別の意図的なステップ
// （scripts/deploy-extension.cts）。開発ビルドは完全に3つ目の出力で、tree の
// 外にあり、専用の開発プロファイル（#732＝extension/wxt.config.ts）だけが読む。
//
// このスクリプトが存在する理由となる失敗は、#650で実測されたもの: 拡張機能が
// 読み込まれたフォルダが不完全な状態（書きかけのmanifest、あるいはmanifestが
// まだ存在しないファイルを名指ししている状態）でreloadすると、Chromeは
// DISABLE_RELOADで拡張機能を無効化し、ファイルが揃っても戻ってこない。復旧には
// chrome://extensionsでのクリックが必要で、それこそが自己reloadが無くそうと
// しているもの。だから出力はまず自分自身のmanifestに対して検査する: パースが
// 通ること、manifestが名指しする全ファイルが存在し空でないこと、コードが
// 「名前で」注入するエントリポイントがそこにあること、署名鍵が依然として
// 同じ拡張機能idを生むこと、開発用の目印が一切紛れ込んでいないこと。

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EXTENSION = path.join(ROOT, 'extension');
const EXPECTED_ID = 'keggmjkemfcekcffohnpaojacdakpejh';

// リリースに紛れ込んではいけないテキスト。最初の3つは開発サーバーの指紋。
// 4つ目は開発用のnative messagingホスト名（#732）: それを求めるリリースは、
// 実ライブラリではなく開発用サンドボックスへ書き込んでしまう＝そしてビルド済み
// バンドル内のリリースホスト名を書き換えることで自身を隔離している拡張機能
// E2Eハーネスが、黙って間違った方を書き換えてしまう。
const FORBIDDEN_TEXT = ['127.0.0.1:51731', 'localhost:51731', '/@vite/client', 'com.hologram.host.dev', 'sourceMappingURL='];

// manifestではなくコード内で「文字列」として名指しされるエントリポイント。
// これらが消えても他の誰も気付かない: background.tsは有効化のたびに
// capture.jsを注入し（`files: ['capture.js']`）、診断ページは失敗時に
// 利用者が送られる先。
const NAMED_BY_CODE = ['capture.js', 'content-scripts/resident.js', 'diag.html'];

// このworkerは、ビルドのトークンを「値」として持たなければならない唯一の
// バンドル: 応答のたびにホストが報告するものと比較する（#650）。
const CARRIES_TOKEN = 'background.js';

function mintBuildId(): string {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function extensionId(key: string): string {
  return [...crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16)].map((byte) => `${'abcdefghijklmnop'[byte >> 4]}${'abcdefghijklmnop'[byte & 15]}`).join('');
}

function releaseDir(browser: string): string {
  return path.join(EXTENSION, '.output', `${browser}-mv3-release`);
}

function listedFiles(manifest): Set<string> {
  const files = new Set<string>();
  const add = (value) => typeof value === 'string' && value && files.add(value);
  add(manifest.background?.service_worker);
  for (const value of manifest.background?.scripts || []) add(value);
  add(manifest.options_ui?.page);
  // #124: ツールバーのポップアップ。optionsページと同じくmanifestで名指しされ、
  // ポップアップが存在するまでこの集計から漏れていた＝出力に無いファイルを
  // manifestが名指ししている状態は、まさにこのスクリプトが捕まえようとしている
  // DISABLE_RELOADの状態そのもの（ヘッダー参照）なので、この検査はmanifestの
  // 成長に合わせて育たなければならない。
  add(manifest.action?.default_popup);
  for (const script of manifest.content_scripts || []) {
    for (const value of script.js || []) add(value);
    for (const value of script.css || []) add(value);
  }
  for (const value of Object.values(manifest.icons || {})) add(value as string);
  for (const value of Object.values(manifest.action?.default_icon || {})) add(value as string);
  for (const group of manifest.web_accessible_resources || []) for (const value of group.resources || []) add(value);
  if (manifest.default_locale) files.add(path.join('_locales', manifest.default_locale, 'messages.json'));
  for (const value of NAMED_BY_CODE) files.add(value);
  return files;
}

function verifyOutput(browser: string, buildId?: string): string {
  const out = releaseDir(browser);
  const manifestFile = path.join(out, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
  if (manifest.manifest_version !== 3) throw new Error(`${browser}: manifestがMV3ではありません`);
  if (extensionId(manifest.key || '') !== EXPECTED_ID) throw new Error(`${browser}: 署名鍵がもう ${EXPECTED_ID} を生成しません`);
  if (!manifest.permissions?.includes('nativeMessaging')) throw new Error(`${browser}: nativeMessaging権限がありません`);

  const files = listedFiles(manifest);
  for (const relative of files) {
    const file = path.join(out, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).size) throw new Error(`${browser}: manifestのリソースが無いか空です: ${relative}`);
  }

  const all = fs.readdirSync(out, { recursive: true, withFileTypes: true });
  for (const entry of all) {
    if (!entry.isFile()) continue;
    const relative = path.join(entry.parentPath.slice(out.length + 1), entry.name);
    if (relative.endsWith('.map')) throw new Error(`${browser}: source mapが同梱されています: ${relative}`);
    if (!/\.(?:html|js|json|css)$/.test(relative)) continue;
    const body = fs.readFileSync(path.join(out, relative), 'utf8');
    const forbidden = FORBIDDEN_TEXT.find((value) => body.includes(value));
    if (forbidden) throw new Error(`${browser}: リリースに開発用の目印 ${forbidden} が ${relative} に含まれています`);
  }

  // トークンはworkerに届いていなければならない。さもないと配置したビルドが、
  // 決して満たせないreloadを求めてしまう: 戻ってきてもホストが報告するトークン
  // をまだ運んでいない。（コストはreload1回だけで済む＝DevReloadState.attempted
  // 参照＝しかし「ビルドごとに無駄なreloadが1回」は、まさにこの機能が出しては
  // いけないノイズそのもの。）
  if (buildId && !fs.readFileSync(path.join(out, CARRIES_TOKEN), 'utf8').includes(buildId)) {
    throw new Error(`${browser}: ${CARRIES_TOKEN} がこのビルドのトークン（${buildId}）を運んでいません＝extension/wxt.config.tsのdefineが届いていません`);
  }

  console.log(`[hologram] ${browser} リリースを検証しました: ${out}`);
  return out;
}

function run(script: string, buildId: string) {
  // Windows: シェル無しでnpm.cmdをspawnするとEINVAL（skill windows-scripting）。
  execFileSync(`npm --prefix extension run ${script}`, {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { HOLOGRAM_EXT_BUILD_ID: buildId }),
  });
}

// 拡張機能のビルドの中ではなくここで発行する: この値は1回だけ決まらなければ
// ならず、それを決めるのは出力を検証し（昇格時に）公開もする側であるべき。
const buildId = mintBuildId();
run('build:chrome', buildId);
run('build:firefox', buildId);
verifyOutput('chrome', buildId);
verifyOutput('firefox', buildId);

module.exports = { verifyOutput, releaseDir, buildId };
