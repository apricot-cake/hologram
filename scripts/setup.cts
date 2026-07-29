'use strict';

// Installs this repo's dependencies. One upstream problem currently stops a plain
// `npm install` from producing a working tree, worked around with one npm flag.
// The flag is temporary, so it isn't hardcoded: before installing, this script
// reads the condition that makes it necessary straight off disk, and afterwards
// it reports whether it still holds. The day upstream fixes theirs, the flag
// stops being passed and the script says so — a workaround nobody re-checks is a
// workaround that becomes permanent.
//
// --legacy-peer-deps — electron-vite's peer range vs vite 8
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

const WORKAROUNDS: Workaround[] = [{ flag: '--legacy-peer-deps', label: 'electron-vite の peer 範囲と vite 8 の衝突', upstream: 'https://github.com/alex8088/electron-vite/releases', check: peerCheck }];

// Same shape as bridge.cts: installing only happens when this file is RUN (see the
// require.main guard at the bottom), so a test can require() it and exercise the
// probes against fixture trees. `module.exports` rather than `export` because this
// is a .cts run by Node's type stripping, which only erases types — real export
// statements would be a syntax error at runtime (see scripts/tsconfig.json's
// erasableSyntaxOnly).
module.exports = { peerCheck, WORKAROUNDS, decideFlags };

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
  // Its own postinstall runs `wxt prepare`, which writes
  // extension/.wxt/tsconfig.json; extension/tsconfig.json extends that file, so
  // without it BOTH the extension type check and every Vitest suite that imports
  // extension code fail — the latter with "Tsconfig not found", because Vite reads
  // the nearest tsconfig when transforming a file. Its own tree has no peer
  // conflict and no scripts to skip, so it takes no flags.
  const extDir = path.join(repoRoot, 'extension');
  run('npm install', extDir);

  // Three suites read the built extension bundles straight off disk (capture.js,
  // resident.js), so a freshly installed tree fails `npm test` until this runs.
  // Building here rather than teaching those suites to build themselves keeps the
  // cost at one build per setup instead of one per suite.
  run('npm run build:ext', repoRoot);

  // electron's published package.json carries no postinstall script (checked on
  // the exact pinned version, 43.2.0: neither the registry manifest nor the
  // extracted tarball declares one), so nothing above ever downloads its ~225MB
  // runtime — that has nothing to do with --ignore-scripts, which this script no
  // longer passes to the root install. install.js is the same file electron
  // itself would run if it had a postinstall; calling it directly is required
  // every time, not a workaround for anything.
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
