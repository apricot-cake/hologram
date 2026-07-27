'use strict';

// Installs this repo's dependencies, working around an upstream packaging bug
// that makes a plain `npm install` fail on machines without a C++ toolchain.
//
// THE BUG (WiseLibs/better-sqlite3#1503, filed 2026-07-24, open):
//   better-sqlite3 v13 is the first release built on N-API, so it ships ready-made
//   binaries inside the package (prebuilds/<platform>-<arch>.node) and its loader
//   prefers them over anything compiled locally. But the package still carries
//   binding.gyp and declares no install script, and npm's documented default for
//   that combination is to compile the addon with node-gyp:
//     "If there is a binding.gyp file in the root of your package and you haven't
//      defined your own install or preinstall scripts, npm will default the
//      install command to compile using node-gyp via node-gyp rebuild"
//   So npm compiles from source on every install, needs Visual Studio to do it,
//   and aborts the WHOLE install partway when it isn't there — leaving a tree
//   that is missing unrelated packages. The compile was never needed: the bundled
//   binary is what gets loaded either way.
//
// THE WORKAROUND: install with --ignore-scripts. That is a blunt instrument (it
// disables EVERY package's install scripts), and Electron is collateral damage —
// its own install script is what downloads the ~225MB runtime, so skipping it
// leaves node_modules/electron without an executable and nothing can launch.
// This script puts that one piece back.
//
// WHY THIS FILE EXISTS AT ALL: a workaround nobody re-checks becomes permanent.
// So the strategy is not hardcoded — it is decided by reading the installed
// better-sqlite3's own package.json for the condition that triggers npm's
// default. The day upstream sets gypfile:false (or declares an install script),
// this script installs normally and says the workaround can be deleted. No
// network call, no deliberately-failed install, no wall of red output to get
// used to ignoring.
//
//   node scripts/setup.cts

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const UPSTREAM = 'https://github.com/WiseLibs/better-sqlite3/issues/1503';

type Verdict = { needed: boolean; reason: string };

// Reads the condition off disk. Note this is the PUBLISHED package.json, not the
// registry metadata: `npm view better-sqlite3 gypfile` answers true even today,
// because npm injects that field itself when it spots a binding.gyp. The author's
// own opt-out is what we are waiting for, and that only shows up here.
function workaroundNeeded(): Verdict | null {
  const dir = path.join(repoRoot, 'node_modules', 'better-sqlite3');
  if (!fs.existsSync(dir)) return null; // nothing installed yet — nothing to read
  let pkg: { gypfile?: boolean; scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  if (pkg.gypfile === false) return { needed: false, reason: 'better-sqlite3 が gypfile:false を指定するようになりました' };
  if (pkg.scripts?.install) return { needed: false, reason: `better-sqlite3 が install スクリプト（${pkg.scripts.install}）を持つようになりました` };
  if (!fs.existsSync(path.join(dir, 'binding.gyp'))) return { needed: false, reason: 'better-sqlite3 が binding.gyp を同梱しなくなりました' };
  return { needed: true, reason: 'better-sqlite3 は binding.gyp を同梱したまま install スクリプトを持たない＝npm が既定でコンパイルを試みます' };
}

// npm has to go through a shell on Windows (its entry point is npm.cmd, and Node
// refuses to spawn .cmd without one). The whole command is passed as ONE string
// rather than command + args array: the array form under shell:true is what
// triggers DEP0190, which would put a security deprecation notice in the output
// of a script whose whole job is to be quiet enough to read.
function run(command: string, cwd: string) {
  console.log(`\n$ ${command}${cwd === repoRoot ? '' : `   (${path.relative(repoRoot, cwd)})`}`);
  execFileSync(command, { cwd, stdio: 'inherit', shell: true });
}

function main() {
  // The verdict from the PREVIOUS install picks this install's strategy. On a
  // fresh clone there is nothing to read, so assume the workaround is still
  // needed — guessing wrong that way costs an unused flag, guessing wrong the
  // other way costs a half-installed tree.
  const before = workaroundNeeded();
  const useWorkaround = before === null || before.needed;

  run(useWorkaround ? 'npm install --ignore-scripts' : 'npm install', repoRoot);

  // extension/ is a separate npm project with its own lockfile (deliberately —
  // it is a standalone WXT build), so a root install does not cover it. Fresh
  // worktrees need this or the extension build and its type check both fail.
  const extDir = path.join(repoRoot, 'extension');
  run('npm install --ignore-scripts', extDir);

  // The other thing --ignore-scripts skips: WXT's own postinstall, which writes
  // extension/.wxt/tsconfig.json. extension/tsconfig.json extends that file, so
  // without it BOTH the extension type check and every Vitest suite that imports
  // extension code fail — the latter with "Tsconfig not found", because Vite reads
  // the nearest tsconfig when transforming a file.
  run('npx wxt prepare', extDir);

  // Put back the one thing --ignore-scripts broke. Skipped when scripts ran
  // normally, since Electron will have downloaded itself.
  const electronExe = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
  const electronInstaller = path.join(repoRoot, 'node_modules', 'electron', 'install.js');
  if (!fs.existsSync(electronExe) && fs.existsSync(electronInstaller)) {
    // NOT `npm rebuild electron`: that reports "rebuilt dependencies successfully"
    // and downloads nothing, which reads as success while leaving no executable.
    console.log('\n$ node node_modules/electron/install.js   (--ignore-scripts skipped Electron の本体取得)');
    execFileSync(process.execPath, [electronInstaller], { cwd: repoRoot, stdio: 'inherit' });
  }

  const after = workaroundNeeded();
  console.log('');
  if (after && !after.needed) {
    console.log('='.repeat(72));
    console.log('上流が修正されました。この回避策はもう要りません。');
    console.log(`  ${after.reason}`);
    console.log(`  ${UPSTREAM}`);
    console.log('');
    console.log('  scripts/setup.cts と package.json の "setup" を削除し、');
    console.log('  docs/build.md の該当節も消して、素の npm install へ戻してください。');
    console.log('='.repeat(72));
  } else if (after) {
    console.log(`完了。回避策（--ignore-scripts）は今回も必要でした: ${UPSTREAM}`);
  } else {
    console.log('完了。');
  }
}

main();
