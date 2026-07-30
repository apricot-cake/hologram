import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// テストが読むのは「今のソースをビルドした拡張」であることを、走り出す前に保証する（#130）。
//
// jsdom のスイート（overlay / drag-zone / capture-overlay / capture-mode-select /
// bulk-capture）と ext-consistency は extension/.output/chrome-mv3 のビルド出力を
// 直接読む＝ソースではない。手で `npm run build:ext` を忘れると「直したはずが直って
// いない」を静かに再生産し、真っさらな worktree では ENOENT で落ちる。鮮度を検査して
// 落とすのではなく、必要なときだけビルドを走らせて問題そのものを消す。
//
// globalSetup はワーカーではなく Vitest 本体で1回だけ走る＝ファイルごとの再ビルドも、
// 同じ出力先への同時ビルドも起きない（setupFiles はファイルごと＝ここには使えない）。
//
// ビルドを回すのは「出力が欠けている」か「ソースのほうが新しい」ときだけ。実測 0.7 秒
// なので常に回してもよいが、条件を付ける理由は速さではなく **`wxt dev` の出力を潰さない
// こと**＝日常の Chrome は本体ツリーの .output/chrome-mv3 を dev/production 共用で読む
// （docs/build.md）。dev サーバーが生きている間は出力がソースより新しく保たれるので、
// ここは何もしない。dev サーバーを止めたあとに編集した場合は production ビルドで上書き
// する＝それが docs/build.md の言う「戻すべき状態」でもある。
const ROOT = path.join(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(EXT, '.output', 'chrome-mv3');

// スイートが実際に読むファイル。1つでも欠けていればビルドが要る。
const REQUIRED = ['manifest.json', 'capture.js', path.join('content-scripts', 'resident.js')];

// ビルド出力・依存・WXT の生成物はソースではない。
const NOT_SOURCE = new Set(['node_modules', '.output', '.wxt']);

function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (NOT_SOURCE.has(entry.name)) continue;
      newest = Math.max(newest, newestSourceMtime(path.join(dir, entry.name)));
    } else {
      newest = Math.max(newest, fs.statSync(path.join(dir, entry.name)).mtimeMs);
    }
  }
  return newest;
}

// 出力の世代は「最も古い必須ファイル」で測る＝一部だけ書き換わった中途半端な出力を
// 新しいと読まないため。
function builtMtime(): number {
  let oldest = Number.POSITIVE_INFINITY;
  for (const name of REQUIRED) {
    const file = path.join(OUT, name);
    if (!fs.existsSync(file)) return 0;
    oldest = Math.min(oldest, fs.statSync(file).mtimeMs);
  }
  return oldest;
}

export function setup(): void {
  if (builtMtime() >= newestSourceMtime(EXT)) return;
  console.log('[hologram] extension/.output が古い（または無い）ので build:ext を走らせます');
  // Windows では npm.cmd を shell 無しで spawn すると EINVAL（skill windows-scripting）。
  execFileSync('npm run build:ext', { cwd: ROOT, shell: true, stdio: 'inherit' });
  const missing = REQUIRED.filter((name) => !fs.existsSync(path.join(OUT, name)));
  if (missing.length) throw new Error(`build:ext は成功したのに出力が揃っていない: ${missing.join(', ')}（WXT の出力ファイル名が変わった？）`);
}
