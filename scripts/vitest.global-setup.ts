import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 実行が始まる前に、テストが読むものが「現在のソースからビルドした拡張機能」（#130）であることを
// 保証する。
//
// jsdomのテスト一式（overlay / drag-zone / capture-overlay / capture-mode-select /
// bulk-capture）とext-consistencyは、extension/.output/chrome-mv3-releaseにある検証済みの
// リリース出力を直接読む＝ソースは読まない。`npm run build:ext`を手で走らせ忘れると
// 「直したはずなのに直っていない」が黙って再現し、新しいworktreeではENOENTで落ちる。
// 鮮度を確認して失敗させるのではなく、必要なときだけビルドを走らせて問題そのものを消す。
//
// globalSetupはワーカーごとではなくVitestのメインプロセスで1回だけ走るので、ファイルごとの
// 再ビルドも、同じ出力先への並行ビルドも起きない（setupFilesはファイルごとなので、ここでは使えない）。
//
// ビルドを走らせるのは「出力が無い」か「ソースの方が新しい」ときだけ。実測で0.7秒なので毎回
// 走らせても問題はないが、この条件がある理由は速度ではない＝テスト専用のリリース出力を
// 日常の開発用パスから切り離しておくためだ。
const ROOT = path.join(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(EXT, '.output', 'chrome-mv3-release');

// テスト一式が実際に読むファイル。1つでも無ければビルドが必要。
const REQUIRED = ['manifest.json', path.join('capture.js'), path.join('content-scripts', 'resident.js')];

// ビルド出力と依存パッケージはソースではない。
const NOT_SOURCE = new Set(['node_modules', '.output']);

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

// 出力の世代は「必須ファイルのうち最も古いもの」で測る。一部だけ書き換わった書きかけの
// 出力を、最新だと誤読しないようにするため。
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
  // Windowsでnpm.cmdをシェルなしでspawnするとEINVALが出る。
  execFileSync('npm run build:ext', { cwd: ROOT, shell: true, stdio: 'inherit' });
  const missing = REQUIRED.filter((name) => !fs.existsSync(path.join(OUT, name)));
  if (missing.length) throw new Error(`build:ext は成功したのに release 出力が揃っていない: ${missing.join(', ')}`);
}
