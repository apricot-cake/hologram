'use strict';
// App-harness aggregator: runs every scripts/test-app-*.cts and exits non-zero if ANY
// fails. Each harness boots its own sandboxed Electron (HOLOGRAM_SMOKE + a mkdtemp
// config dir), so this is HEAVY (~7s per harness) — it is deliberately NOT part of
// npm test (Vitest = pure units). Run it at milestones
// (feedback-verify-batch-at-milestones), e.g. after a renderer restructure, to catch
// the silent rot npm test can't see (the 2026-07-02 React-island migration had left 5
// of these red unnoticed).
//
// The harnesses run CONCURRENTLY, a few at a time (#933: as one sequential step this
// was 49% of the app-tests workflow). Nothing is shared between them — every harness
// makes its own mkdtemp sandbox, points HOLOGRAM_CONFIG_DIR (and so userData) at it,
// asks the OS for a free port when it needs one, and boots hidden with the single
// instance lock skipped under SMOKE — so the only contended resource is the machine.
//
// Run all:      node scripts/run-app-tests.cts
// Run a subset: node scripts/run-app-tests.cts tabs search   (suffix match)
// Override the concurrency: APP_TESTS_JOBS=1 node scripts/run-app-tests.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Measured on the CI runner (4 vCPU / 17GB windows-latest) over 37 full runs — see
// #933 for the numbers. 4 was both the fastest of 1..4 (78s median against 257s
// sequential) and the steadiest (70-82s, against 85-115s at 3), and it does not move
// the slowest single harness (24.0s at 4, 24.3s at 3) — which is what matters, because
// each harness carries the app's own 60s in-renderer backstop
// (app/src/main/index.ts) that a loaded machine eats into (#818, and #514 for the same
// failure mode in the unit suite). 6 and 8 were measured too and buy ~15s more, but on
// three runs each: not enough to spend the margin on.
const DEFAULT_JOBS = 4;
// Guards against a hung Electron. Left where it was when this ran sequentially: the
// in-app smoke backstop is 60s, so this never bites a healthy run however slow.
const HARNESS_TIMEOUT_MS = 120000;

const all = fs
  .readdirSync(__dirname)
  .filter((f) => /^test-app-.*\.cts$/.test(f))
  .sort();
const args = process.argv.slice(2);
const picked = args.length ? all.filter((f) => args.some((a) => f === a || f === `test-app-${a}.cts`)) : all;
if (!picked.length) {
  console.error(`no matching test-app-*.cts (have: ${all.join(', ')})`);
  process.exit(2);
}

const jobsEnv = process.env.APP_TESTS_JOBS;
const jobs = jobsEnv === undefined ? DEFAULT_JOBS : Number(jobsEnv);
if (!Number.isInteger(jobs) || jobs < 1) {
  console.error(`APP_TESTS_JOBS must be a positive integer (got ${JSON.stringify(jobsEnv)})`);
  process.exit(2);
}

type Result = { ok: boolean; ms: number; output: string; note: string };
const results: (Result | null)[] = new Array(picked.length).fill(null);

function runOne(i: number): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // stdin is /dev/null rather than a pipe: a harness that inherits it into its own
    // Electron would otherwise sit on an open stream nobody ever writes to.
    const child = spawn(process.execPath, [path.join(__dirname, picked[i])], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: HARNESS_TIMEOUT_MS,
    });
    // Buffered per child, printed later in the original order: interleaved output from
    // several Electrons makes a red run unreadable, and reading the red is the point
    // (#829).
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      output += d;
    });
    child.stderr.on('data', (d: string) => {
      output += d;
    });
    child.on('error', (err: Error) => {
      results[i] = { ok: false, ms: Date.now() - t0, output, note: `could not run the harness: ${err.message}` };
      resolve();
    });
    child.on('close', (code: number | null, signal: string | null) => {
      if (results[i]) return; // 'error' already answered for this one
      results[i] = {
        ok: code === 0,
        ms: Date.now() - t0,
        output,
        note: signal ? `killed after ${HARNESS_TIMEOUT_MS / 1000}s (${signal})` : '',
      };
      resolve();
    });
  });
}

function report(i: number): void {
  const r = results[i] as Result;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${picked[i]} (${(r.ms / 1000).toFixed(1)}s)`);
  if (r.ok) return;
  if (r.note) console.log(`     ${r.note}`);
  // Tail alone truncates FAIL lines on multi-check harnesses (#829): keep every
  // `FAIL <check>` line plus the last 15 lines, in original order, no duplicates.
  const lines = r.output.trim().split(/\r?\n/);
  const tailStart = Math.max(0, lines.length - 15);
  const kept = lines.filter((line, n) => /^\s*FAIL/.test(line) || n >= tailStart);
  console.log(kept.join('\n').replace(/^/gm, '     '));
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log(`run-app-tests: ${picked.length} harness(es), ${jobs} at a time`);
  let next = 0;
  let printed = 0;
  // A worker takes the next index off the list, and after each finish everything that
  // is now contiguous from the front gets printed — so a fast harness never jumps
  // ahead of a slow one it was queued behind, and output still appears as the run goes.
  const worker = async () => {
    while (next < picked.length) {
      await runOne(next++);
      while (printed < picked.length && results[printed]) report(printed++);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, picked.length) }, worker));

  const failed = results.filter((r) => !(r as Result).ok).length;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (failed) {
    console.error(`FAIL run-app-tests: ${failed}/${picked.length} harness(es) red (${elapsed}s)`);
    process.exit(1);
  }
  console.log(`PASS run-app-tests: all ${picked.length} app harnesses green (${elapsed}s)`);
}

main();
