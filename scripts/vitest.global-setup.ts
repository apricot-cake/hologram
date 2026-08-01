import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Guarantee, before the run starts, that what the tests read is "the extension built from
// the current source" (#130).
//
// The jsdom suites (overlay / drag-zone / capture-overlay / capture-mode-select /
// bulk-capture) and ext-consistency read the build output at extension/.output/chrome-mv3
// directly — not the source. Forgetting to run `npm run build:ext` by hand silently
// reproduces "should be fixed but isn't fixed", and on a fresh worktree it fails with ENOENT.
// Rather than checking freshness and failing, run the build only when needed and make the
// problem itself disappear.
//
// globalSetup runs once in the Vitest main process, not per worker, so there's no rebuild
// per file and no concurrent build to the same output path (setupFiles is per-file, so it
// can't be used here).
//
// Only run the build when "the output is missing" or "the source is newer". Measured at
// 0.7s, so running it every time would be fine too, but the reason for the condition isn't
// speed — it's **not stepping on `wxt dev`'s output**: day-to-day Chrome reads
// .output/chrome-mv3 in the main tree, shared between dev and production (docs/build.md).
// While the dev server is alive, its output stays newer than the source, so this does
// nothing in that case. If you edit after stopping the dev server, a production build
// overwrites it — which is also the "state it should be restored to" per docs/build.md.
const ROOT = path.join(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(EXT, '.output', 'chrome-mv3');

// Files the suites actually read. If even one is missing, a build is needed.
const REQUIRED = ['manifest.json', 'capture.js', path.join('content-scripts', 'resident.js')];

// Build output, dependencies, and WXT-generated artifacts are not source.
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

// Measure the output's generation by its "oldest required file", so a half-written output
// where only some files were rewritten isn't read as being up to date.
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
  // On Windows, spawning npm.cmd without a shell throws EINVAL (skill windows-scripting).
  execFileSync('npm run build:ext', { cwd: ROOT, shell: true, stdio: 'inherit' });
  const missing = REQUIRED.filter((name) => !fs.existsSync(path.join(OUT, name)));
  if (missing.length) throw new Error(`build:ext は成功したのに出力が揃っていない: ${missing.join(', ')}（WXT の出力ファイル名が変わった？）`);
}
