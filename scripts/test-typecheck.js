'use strict';
// TypeScript contract check for the React islands (app/tsconfig.json — islands +
// _shared only; the build-less plain-JS renderer layer is not included yet, see
// BACKLOG「技術スタック候補」採用#1). Runs tsc --noEmit via the app's local
// typescript install (pure-JS binary — no app-control-policy issue) so type rot
// can't accumulate silently between sessions.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const tsc = path.join(appDir, 'node_modules', 'typescript', 'bin', 'tsc');

const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', appDir], { stdio: 'inherit', cwd: appDir });
if (r.status !== 0) {
  console.error('FAIL test-typecheck: tsc --noEmit reported errors');
  process.exit(1);
}
console.log('PASS test-typecheck: islands type-check clean');
