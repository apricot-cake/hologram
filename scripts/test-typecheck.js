'use strict';
// TypeScript contract checks. Three tsc projects (all --noEmit, run via the
// app's local typescript install — pure-JS binary, no app-control-policy
// issue) so type rot can't accumulate silently between sessions:
//   1. app/tsconfig.json          — React islands + _shared (.tsx, stage 1)
//   2. app/tsconfig.renderer.json — checkJs over the build-less plain-JS
//      renderer service layer (viewer.js extraction slices + store, stage 2;
//      contracts in app/renderer/types/renderer-globals.d.ts)
//   3. app/tsconfig.main.json     — the Electron main-process ESM layer
//      (main.mts + ipc-*.mts + lib-*.mts + backup-guard.mts + preload.js, stage
//      2/3; Node ESM via .mts, no DOM; runs un-built under Electron 43 (type strip))

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const tsc = path.join(appDir, 'node_modules', 'typescript', 'bin', 'tsc');

const PROJECTS = [
  { p: appDir, label: 'islands' },
  { p: path.join(appDir, 'tsconfig.renderer.json'), label: 'renderer services (checkJs)' },
  { p: path.join(appDir, 'tsconfig.main.json'), label: 'main process (checkJs)' },
];

let failed = 0;
for (const { p, label } of PROJECTS) {
  const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', p], { stdio: 'inherit', cwd: appDir });
  if (r.status !== 0) {
    console.error(`FAIL test-typecheck: ${label} reported errors`);
    failed++;
  }
}
if (failed) process.exit(1);
console.log('PASS test-typecheck: islands + renderer services + main process type-check clean');
