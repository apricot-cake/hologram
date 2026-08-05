'use strict';

// The bounded worker pool the app-tests suite runs its scripts through.
//
// #933 wrote it for the 42 Electron harnesses (as one sequential step they were
// 49% of the workflow); #968 moved the extension and overlay browser tests onto
// the same pool rather than writing a second one, so the concurrency is decided
// in exactly one place and cannot drift between layers.
//
// Every entry is a stand-alone node script that boots its own real Electron or
// Chromium into its own sandbox, so the pool's whole job is to keep N of them in
// the air and to keep a red run readable (#829): output is buffered per child
// and printed in the original order, never interleaved.

const { spawn } = require('node:child_process');

interface PoolScript {
  // Absolute path to the script to run.
  file: string;
  // What the report calls it — the file name, which is what a reader greps for.
  name: string;
  // Guard against a hung child. Per script rather than per pool because what
  // counts as hung differs by family; see the catalogue in run-app-tests.cts.
  timeoutMs: number;
}

interface PoolResult {
  ok: boolean;
  ms: number;
  output: string;
  note: string;
}

function runOne(script: PoolScript, results: (PoolResult | null)[], i: number): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // stdin is /dev/null rather than a pipe: a script that inherits it into its
    // own browser would otherwise sit on an open stream nobody ever writes to.
    const child = spawn(process.execPath, [script.file], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: script.timeoutMs,
    });
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
      results[i] = { ok: false, ms: Date.now() - t0, output, note: `could not run the script: ${err.message}` };
      resolve();
    });
    child.on('close', (code: number | null, signal: string | null) => {
      if (results[i]) return; // 'error' already answered for this one
      results[i] = {
        ok: code === 0,
        ms: Date.now() - t0,
        output,
        note: signal ? `killed after ${script.timeoutMs / 1000}s (${signal})` : '',
      };
      resolve();
    });
  });
}

function report(script: PoolScript, result: PoolResult): void {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${script.name} (${(result.ms / 1000).toFixed(1)}s)`);
  if (result.ok) return;
  if (result.note) console.log(`     ${result.note}`);
  // Tail alone truncates FAIL lines on multi-check scripts (#829): keep every
  // `FAIL <check>` line plus the last 15 lines, in original order, no duplicates.
  const lines = result.output.trim().split(/\r?\n/);
  const tailStart = Math.max(0, lines.length - 15);
  const kept = lines.filter((line, n) => /^\s*FAIL/.test(line) || n >= tailStart);
  console.log(kept.join('\n').replace(/^/gm, '     '));
}

// Runs every script, at most `jobs` at a time, and returns the ones that failed.
// Scripts are dispatched in the order given, so a caller that puts its longest
// ones first keeps the tail of the run short.
async function runPool(scripts: PoolScript[], jobs: number): Promise<PoolScript[]> {
  const results: (PoolResult | null)[] = new Array(scripts.length).fill(null);
  let next = 0;
  let printed = 0;
  // A worker takes the next index off the list, and after each finish everything
  // that is now contiguous from the front gets printed — so a fast script never
  // jumps ahead of a slow one it was queued behind, and output still appears as
  // the run goes.
  const worker = async () => {
    while (next < scripts.length) {
      const i = next++;
      await runOne(scripts[i], results, i);
      while (printed < scripts.length && results[printed]) {
        report(scripts[printed], results[printed] as PoolResult);
        printed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, scripts.length) }, worker));
  return scripts.filter((_, i) => !(results[i] as PoolResult).ok);
}

module.exports = { runPool };
