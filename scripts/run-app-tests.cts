'use strict';
// App-tests aggregator: runs every test script that boots a real app or a real
// browser, and exits non-zero if ANY fails. Three families live here —
//
//   test-app-*.cts        a real Electron main process plus the renderer it brings up
//   e2e-extension-*.cts   a real Chromium with the built extension loaded, talking to a
//                         throwaway Native Messaging host
//   e2e-overlay-*.cts     the same browser rig, driving the timeline hover control
//
// — and all of them are HEAVY (a real process each), which is why none of this is
// part of npm test (Vitest = pure units). Run it at milestones
// (feedback-verify-batch-at-milestones), e.g. after a renderer restructure, to catch
// the silent rot npm test can't see (the 2026-07-02 React-island migration had left 5
// of these red unnoticed).
//
// The scripts run CONCURRENTLY, a few at a time, through the shared pool in
// lib-test-pool.cts (#933 for the harnesses, #968 for the browser layers).
// Nothing is shared between them — every one of them makes its own mkdtemp
// sandbox (HOLOGRAM_CONFIG_DIR for the harnesses, a throwaway Chrome profile plus
// a per-process Native Messaging host name for the browser tests), asks the OS
// for a free port when it needs one, and boots hidden or headless — so the only
// contended resource is the machine.
//
// Run all:       node scripts/run-app-tests.cts
// Run a subset:  node scripts/run-app-tests.cts tabs search extension-orphan
// Run a shard:   node scripts/run-app-tests.cts --shard=1/2      (what CI does)
// Override the concurrency: APP_TESTS_JOBS=1 node scripts/run-app-tests.cts

const fs = require('node:fs');
const path = require('node:path');
const { runPool } = require('./lib-test-pool.cts');

// Measured on the CI runner (4 vCPU / 17GB windows-latest) over 37 full runs of the
// harness family — see #933 for the numbers. 4 was both the fastest of 1..4 (78s
// median against 257s sequential) and the steadiest (70-82s, against 85-115s at 3),
// and it does not move the slowest single script (24.0s at 4, 24.3s at 3) — which is
// what matters, because each harness carries the app's own 60s in-renderer backstop
// (app/src/main/index.ts) that a loaded machine eats into (#818, and #514 for the same
// failure mode in the unit suite). 6 and 8 were measured too and buy ~15s more, but on
// three runs each: not enough to spend the margin on. #968 re-measured the same number
// against the mixed set (Electron and Chromium together) before adding the browser
// families here.
const DEFAULT_JOBS = 4;
// Guards against a hung child. Two values because what counts as hung differs:
// a harness's in-app smoke backstop is 60s, while a browser test waits on real
// save timeouts of up to 45s and does so several times in one script — so the
// same 120s would be inside a healthy run's budget there rather than outside it.
const HARNESS_TIMEOUT_MS = 120000;
const BROWSER_TIMEOUT_MS = 240000;

const files = fs.readdirSync(__dirname).sort();
// Discovered rather than listed, so a new script joins CI by existing — with no
// exception list, since #972 closed the last one (hostile-css and banner-layout had
// never been in app-tests.yml, but only because the workflow enumerated its e2e
// steps by hand back when they were written; nothing had decided to keep them out).
// The browser families come first because they are the long ones, and dispatching
// longest-first keeps the tail of a pooled run short. `e2e-capture-test.cts` matches
// neither pattern on purpose: it reads the real platforms and can only report a login
// wall on a runner (docs/testing.md).
const all = [
  ...files.filter((f: string) => /^e2e-(extension|overlay)-.*\.cts$/.test(f)).map((f: string) => ({ file: path.join(__dirname, f), name: f, timeoutMs: BROWSER_TIMEOUT_MS })),
  ...files.filter((f: string) => /^test-app-.*\.cts$/.test(f)).map((f: string) => ({ file: path.join(__dirname, f), name: f, timeoutMs: HARNESS_TIMEOUT_MS })),
];

const tokens: string[] = [];
let shard: { index: number; total: number } | null = null;
for (const arg of process.argv.slice(2)) {
  const match = /^--shard=(\d+)\/(\d+)$/.exec(arg);
  if (match) {
    shard = { index: Number(match[1]), total: Number(match[2]) };
    if (shard.index < 1 || shard.index > shard.total) {
      console.error(`--shard=i/n needs 1 <= i <= n (got ${arg})`);
      process.exit(2);
    }
    continue;
  }
  if (arg.startsWith('-')) {
    console.error(`unknown option ${arg}`);
    process.exit(2);
  }
  tokens.push(arg);
}

// A token is either a whole file name or the distinctive middle of one.
const matches = (name: string, token: string) => name === token || name === `test-app-${token}.cts` || name === `e2e-${token}.cts`;
let picked = tokens.length ? all.filter((s) => tokens.some((t) => matches(s.name, t))) : all;
if (!picked.length) {
  console.error(`no matching script (have: ${all.map((s) => s.name).join(', ')})`);
  process.exit(2);
}
const total = picked.length;
// Round-robin, not a contiguous slice: the families are ordered, so slicing would
// hand one shard every browser test. Taking every n-th entry spreads the long ones
// evenly without anyone maintaining a table of durations, and the pool's own
// work-stealing smooths whatever is left inside a shard.
if (shard) {
  const s = shard;
  picked = picked.filter((_, i) => i % s.total === s.index - 1);
  if (!picked.length) {
    console.error(`shard ${s.index}/${s.total} is empty — there are only ${total} script(s)`);
    process.exit(2);
  }
}

const jobsEnv = process.env.APP_TESTS_JOBS;
const jobs = jobsEnv === undefined ? DEFAULT_JOBS : Number(jobsEnv);
if (!Number.isInteger(jobs) || jobs < 1) {
  console.error(`APP_TESTS_JOBS must be a positive integer (got ${JSON.stringify(jobsEnv)})`);
  process.exit(2);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const scope = shard ? `${picked.length} of ${total} script(s), shard ${shard.index}/${shard.total}` : `${picked.length} script(s)`;
  console.log(`run-app-tests: ${scope}, ${jobs} at a time`);
  const failed = await runPool(picked, jobs);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (failed.length) {
    // Name them again on the last line: on a shard of 25 the per-script lines are
    // far above the end of the log, and this is what a reader sees first (#829).
    console.error(`FAIL run-app-tests: ${failed.length}/${picked.length} script(s) red (${elapsed}s): ${failed.map((s) => s.name).join(', ')}`);
    process.exit(1);
  }
  console.log(`PASS run-app-tests: all ${picked.length} script(s) green (${elapsed}s)`);
}

main();
