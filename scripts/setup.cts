'use strict';

// Installs this repo's dependencies. Two upstream problems currently stop a plain
// `npm install` from producing a working tree, and each is worked around with one
// npm flag. Both flags are temporary, so neither is hardcoded: before installing,
// this script reads the condition that makes each necessary straight off disk, and
// afterwards it reports which ones still hold. The day an upstream fixes theirs,
// the flag stops being passed and the script says so — a workaround nobody
// re-checks is a workaround that becomes permanent.
//
// (1) --ignore-scripts — better-sqlite3's gypfile:false never reaches a
//   lockfile-driven install (#510, reverts #493)
//   better-sqlite3 v13 ships ready-made binaries inside the package
//   (prebuilds/<platform>-<arch>.node) and declares `gypfile: false` in its
//   package.json specifically to stop npm from compiling from source. That
//   declaration only reaches npm on a lockfile-LESS resolve, though: npm's
//   arborist keeps a fixed allowlist of package.json fields it persists into
//   package-lock.json (@npmcli/arborist/lib/shrinkwrap.js's `pkgMetaKeys`), and
//   `gypfile` is not on it. This repo commits package-lock.json, so every
//   `npm install` on a fresh checkout is lockfile-driven — the resolved
//   descriptor for better-sqlite3 never carries `gypfile`, and npm falls back to
//   its documented default for a package that ships binding.gyp with no
//   install/preinstall script: compile with node-gyp. That needs Visual Studio,
//   which a fresh dev machine may not have, and aborts the WHOLE install partway
//   when it isn't there.
//
//   Confirmed by direct reproduction on a fresh worktree (#510): a plain
//   `npm install` fails on `node-gyp rebuild` for better-sqlite3 even though the
//   extracted node_modules/better-sqlite3/package.json has gypfile:false — and
//   manually adding a stale-looking `hasInstallScript: true` back to the
//   lockfile entry does NOT fix it, because the one code path that flag unlocks
//   (@npmcli/arborist/lib/arborist/rebuild.js's `#addToBuildSet`, re-reading the
//   installed package's package.json) only copies `scripts` from that re-read
//   onto the in-memory node, never `gypfile` — so the node-gyp fallback still
//   fires. This is why #493's fix (which checked the EXTRACTED package.json,
//   correctly showing gypfile:false, and concluded the workaround was no longer
//   needed) didn't hold: that copy was itself extracted by an install that
//   already used --ignore-scripts, so it could never prove a plain install would
//   succeed. The compile was never needed either way — better-sqlite3's binary
//   loader prefers the bundled prebuild regardless of whether build/Release/
//   exists.
//
//   The flag is blunt: it disables EVERY root package install script. Electron's
//   runtime is therefore restored explicitly below; the extension is installed
//   separately and its `wxt prepare` runs through its own postinstall.
//
// (2) --legacy-peer-deps — electron-vite's peer range vs vite 8
//   electron-vite@5 declares `peer vite: ^5 || ^6 || ^7` while app/ builds on
//   vite 8, so npm's resolver refuses the tree outright. No stable electron-vite
//   accepts vite 8 yet (6.0.0 is beta-only), and `overrides` cannot widen a peer
//   range, so npm's documented escape hatch is the only lever. The violation is
//   not new — a lockfile-less install has failed since vite 8 landed; the
//   committed lockfile was carrying the tree, and stops the moment anything makes
//   npm re-resolve.
//
//   node scripts/setup.cts

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

type Verdict = {
  needed: boolean;
  // Why it is (or is no longer) needed, in the words the final report prints.
  reason: string;
};

type Workaround = {
  flag: string;
  label: string;
  upstream: string;
  // null = cannot tell yet (nothing installed to read). Callers treat that as
  // "assume still needed": guessing wrong that way costs an unused flag, guessing
  // wrong the other way costs a failed or half-installed tree.
  check: () => Verdict | null;
};

function readJson(file: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Reads the LOCKFILE's own entry for better-sqlite3, not the package's installed
// package.json. As explained above, npm's arborist never persists `gypfile` into
// package-lock.json — so the lockfile's entry is exactly what a plain, unpatched
// `npm install` sees, which is the thing this check needs to answer. Reading the
// installed copy instead (what this check did before #493, and the mistake that
// caused it) proves only that the PACKAGE still opts out, not that npm's
// lockfile-driven install would honor it — those extracted files were themselves
// put there by an install that already used --ignore-scripts.
//
// This can't tell if upstream ever fixes the real bug (npm choosing to persist
// `gypfile`, or reworking the rebuild-detection path some other way): that is a
// change in npm's own code, not in anything a package.json can declare. So this
// check only ever flips to "no longer needed" if package-lock.json itself starts
// carrying `gypfile:false` for better-sqlite3 — which is the one observable sign
// that npm has changed. Until then it stays "needed"; that is the same safe
// default `check() → null` already falls back to elsewhere in this file.
function sqliteCheck(root: string = repoRoot): Verdict | null {
  const lock = readJson(path.join(root, 'package-lock.json'));
  const entry = lock?.packages?.['node_modules/better-sqlite3'];
  if (!entry) return null;
  if (entry.gypfile === false) {
    return { needed: false, reason: 'package-lock.json の better-sqlite3 エントリが gypfile:false を保持するようになりました＝npm がロックファイル駆動のインストールでもこの項を読むようになったということです' };
  }
  return {
    needed: true,
    reason: 'package-lock.json は better-sqlite3 の gypfile を保持しません＝ロックファイル駆動のインストールでは npm が node-gyp rebuild を既定にします（binding.gyp を同梱・install スクリプト無しのため）',
  };
}

// Compares electron-vite's declared peer range against the vite actually installed.
// Only the major numbers matter here: the range is a list of caret terms, and the
// conflict is strictly "vite 8 is not among the allowed majors". An unrecognised
// range shape is reported as undecidable rather than guessed at — a wrong "no
// longer needed" here would break the next install.
function peerCheck(root: string = repoRoot): Verdict | null {
  const ev = readJson(path.join(root, 'node_modules', 'electron-vite', 'package.json'));
  const vite = readJson(path.join(root, 'node_modules', 'vite', 'package.json'));
  if (!ev || !vite) return null;
  const range: string | undefined = ev.peerDependencies?.vite;
  const installedMajor = Number(String(vite.version).split('.')[0]);
  if (!range || !Number.isFinite(installedMajor)) return null;
  const allowed = [...range.matchAll(/\^(\d+)/g)].map((m) => Number(m[1]));
  if (!allowed.length) return { needed: true, reason: `electron-vite の peer 範囲（${range}）を判定できません＝安全側に倒して回避策を維持します` };
  if (allowed.includes(installedMajor)) {
    return { needed: false, reason: `electron-vite@${ev.version} の peer（${range}）が、使用中の vite ${vite.version} を受け入れます` };
  }
  return { needed: true, reason: `electron-vite@${ev.version} の peer は ${range}＝使用中の vite ${vite.version} を受け入れません` };
}

const WORKAROUNDS: Workaround[] = [
  { flag: '--ignore-scripts', label: 'better-sqlite3 の不要な node-gyp ビルド（ロックファイル駆動のインストールでは gypfile:false が届かない）', upstream: 'https://github.com/WiseLibs/better-sqlite3/issues/1503', check: sqliteCheck },
  { flag: '--legacy-peer-deps', label: 'electron-vite の peer 範囲と vite 8 の衝突', upstream: 'https://github.com/alex8088/electron-vite/releases', check: peerCheck },
];

// Same shape as bridge.cts: installing only happens when this file is RUN (see the
// require.main guard at the bottom), so a test can require() it and exercise the
// probes against fixture trees. `module.exports` rather than `export` because this
// is a .cts run by Node's type stripping, which only erases types — real export
// statements would be a syntax error at runtime (see scripts/tsconfig.json's
// erasableSyntaxOnly).
module.exports = { sqliteCheck, peerCheck, WORKAROUNDS, decideFlags };

// Split out so a test can check the FLAGS a set of verdicts produces, not just the
// verdicts themselves — "cannot tell" has to behave like "still needed" here.
function decideFlags(verdicts: (Verdict | null)[]): string[] {
  return WORKAROUNDS.filter((_w, i) => verdicts[i] === null || verdicts[i]?.needed).map((w) => w.flag);
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
  // The verdicts from the PREVIOUS install pick this install's flags.
  const flags = decideFlags(WORKAROUNDS.map((w) => w.check()));

  run(['npm install', ...flags].join(' '), repoRoot);

  // extension/ is a separate npm project with its own lockfile (deliberately —
  // it is a standalone WXT build), so a root install does not cover it. Fresh
  // worktrees need this or the extension build and its type check both fail.
  // Its own postinstall runs `wxt prepare`, which generates the .wxt/ types its
  // tsconfig extends. Its own tree has no peer conflict and takes no install flags.
  const extDir = path.join(repoRoot, 'extension');
  run('npm install', extDir);

  // Three suites read the built extension bundles straight off disk (capture.js,
  // resident.js), so a freshly installed tree fails `npm test` until this runs.
  // Building here rather than teaching those suites to build themselves keeps the
  // cost at one build per setup instead of one per suite.
  run('npm run build:ext', repoRoot);

  // Where the repository keeps its git hooks (#732). One of them promotes a
  // merged extension into the daily Chrome, which is the only thing that keeps
  // the browser the author uses on the code that actually landed — a hook nobody
  // enabled would look like it was working and quietly do nothing.
  console.log('\n$ git config core.hooksPath .githooks');
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repoRoot, stdio: 'inherit' });
  } catch {
    console.log('  (not a git checkout — skipped)');
  }

  // electron's published package.json carries no postinstall script (checked on
  // the exact pinned version, 43.2.0: neither the registry manifest nor the
  // extracted tarball declares one), so nothing above ever downloads its ~225MB
  // runtime regardless of whether --ignore-scripts was passed to the root
  // install — this call is a standing requirement, not collateral repair for
  // that flag. install.js is the same file electron itself would run if it had
  // a postinstall; calling it directly is required every time.
  const electronExe = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
  const electronInstaller = path.join(repoRoot, 'node_modules', 'electron', 'install.js');
  if (!fs.existsSync(electronExe) && fs.existsSync(electronInstaller)) {
    // NOT `npm rebuild electron`: that reports "rebuilt dependencies successfully"
    // and downloads nothing, which reads as success while leaving no executable.
    console.log('\n$ node node_modules/electron/install.js');
    execFileSync(process.execPath, [electronInstaller], { cwd: repoRoot, stdio: 'inherit' });
  }

  // Re-read after installing, so the report describes the tree that now exists.
  console.log('');
  const resolved: Workaround[] = [];
  const remaining: string[] = [];
  for (const w of WORKAROUNDS) {
    const v = w.check();
    if (v && !v.needed) {
      resolved.push(w);
      console.log('='.repeat(72));
      console.log(`上流が修正されました。${w.flag} はもう要りません。`);
      console.log(`  ${v.reason}`);
      console.log(`  ${w.upstream}`);
      console.log('='.repeat(72));
    } else if (v) {
      remaining.push(`${w.flag}（${w.label}）`);
    } else {
      remaining.push(`${w.flag}（${w.label}・判定不能のため維持）`);
    }
  }
  if (resolved.length === WORKAROUNDS.length) {
    console.log('');
    console.log('回避策は全て不要になりました。scripts/setup.cts と package.json の "setup"、');
    console.log('docs/build.md の該当節を削除し、素の npm install へ戻してください。');
  } else if (resolved.length) {
    console.log('');
    console.log(`該当のフラグを scripts/setup.cts と docs/build.md から外してください。残りは ${remaining.join(' / ')}。`);
  } else {
    console.log(`完了。今回も必要だった回避策: ${remaining.join(' / ')}`);
  }
}

if (require.main === module) main();
