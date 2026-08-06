'use strict';

// The one place waits are defined (#986).
//
// Before this module the same `waitFor` had been copied into 22 harnesses, each
// with its own default timeout (4000 / 5000 / 6000 / 8000 / 10000) and none of
// them saying what it had been waiting for when it gave up. That last part is
// what made a timeout misleading rather than merely red: #982 reported "the
// layout broke" while the wait that actually expired was for a face swap, because
// the helper returned a bare `false` and every call site had to invent its own
// wording for it.
//
// Two consumers, one contract:
//
//   - Node side  — `sleep` / `waitFor`, used by the e2e drivers that poll the
//     filesystem or a child process.
//   - Renderer side — `rendererWaits()`, which returns SOURCE TEXT. Harness evals
//     are strings handed to executeJavaScript, so the renderer cannot `require`
//     anything; embedding the source is the only way it can share this code.
//     (test-app-tab-restart.cts already did exactly this with a local `PRELUDE`.)
//
// Both sides name what they waited for. The renderer prints it with
// `console.error`, which the smoke build forwards to the harness's stdout as
// `[renderer:error] …` (app/src/main/index.ts), so the name lands next to the
// PASS/FAIL lines instead of being reconstructed by the reader.

// One default for every wait, replacing the five that were in use. It is the
// longest of them on purpose: a bound only costs time on a run that is already
// broken, while a healthy run leaves the moment its condition holds — so the
// cheap failure mode (a slow machine waiting a little longer) is preferred over
// the expensive one (a correct app declared broken because the runner was busy).
const DEFAULT_TIMEOUT_MS = 10_000;

// How often a condition is re-checked. The loop counts wall clock rather than
// iterations: under load a 50ms sleep lands much later than 50ms, and an
// iteration-counted loop silently gives up early.
const POLL_MS = 50;

// One budget for a whole renderer eval. Every wait inside it is capped by this,
// so a regression that stalls several steps in a row still returns its per-check
// report instead of running into main's 60s SMOKE_TIMEOUT — which reports "no
// eval result" and names nothing (#952). Sized to leave that backstop room to
// stay a backstop.
const RENDERER_BUDGET_MS = 45_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WaitOptions {
  timeoutMs?: number;
  pollMs?: number;
}

// Polls until `fn` is truthy. Throws naming `label` when it never is — the same
// shape as Vitest's `vi.waitFor` and Testing Library's `waitFor`, both of which
// fail rather than return a boolean nobody checks.
async function waitFor(label: string, fn: () => unknown, options: WaitOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() >= until) throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label}`);
    await sleep(pollMs);
  }
}

// Source text for the renderer half. Interpolate it at the top of a harness eval:
//
//   const evalJs = `(async () => {
//     ${rendererWaits()}
//     await waitFor('the grid to fill', () => cards().length >= 12);
//   })()`;
//
// The helpers it defines:
//
//   sleep(ms)                     — a fixed delay. Only legitimate when the delay
//                                   itself is the specification (a banner's dwell
//                                   time, a debounce) or when the test is proving
//                                   something does NOT happen; both cases carry a
//                                   one-line reason at the call site (#986).
//   waitFor(label, fn, ms)        — poll until `fn` is truthy. Returns a boolean so
//                                   a harness can report the failed check itself,
//                                   and names `label` on stderr when it expires.
//                                   `fn` may be sync or async.
//   waitStable(label, read, ms)   — poll until `read()` returns the same value
//                                   three times running. For layouts that have no
//                                   "done" event: masonic measures, commits, and
//                                   can move things again on the next commit, so
//                                   the observable post-condition is that a
//                                   measurement REPEATS.
//   neverHappens(label, fn, ms)   — the inverse assertion. Returns true when `fn`
//                                   stayed falsy for the whole window, and names
//                                   `label` when it did not. This one is SUPPOSED
//                                   to spend its full timeout; keep the window
//                                   short.
function rendererWaits(options: { budgetMs?: number } = {}): string {
  const budgetMs = options.budgetMs ?? RENDERER_BUDGET_MS;
  return `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const WAIT_DEADLINE = Date.now() + ${budgetMs};
  const __waitExpired = (label, ms) => {
    console.error('[wait] timed out after ' + ms + 'ms waiting for: ' + label);
    (globalThis.__waitTimeouts || (globalThis.__waitTimeouts = [])).push({ label: label, ms: ms });
  };
  const waitFor = async (label, fn, ms = ${DEFAULT_TIMEOUT_MS}) => {
    const until = Math.min(Date.now() + ms, WAIT_DEADLINE);
    for (;;) {
      if (await fn()) return true;
      if (Date.now() >= until) { __waitExpired(label, ms); return false; }
      await sleep(${POLL_MS});
    }
  };
  const waitStable = async (label, read, ms = ${DEFAULT_TIMEOUT_MS}) => {
    const until = Math.min(Date.now() + ms, WAIT_DEADLINE);
    let prev = null;
    let repeats = 0;
    for (;;) {
      const cur = JSON.stringify(await read());
      repeats = cur === prev ? repeats + 1 : 0;
      if (repeats >= 2) return true;
      prev = cur;
      if (Date.now() >= until) { __waitExpired(label, ms); return false; }
      await sleep(${POLL_MS});
    }
  };
  const neverHappens = async (label, fn, ms) => {
    const until = Date.now() + ms;
    for (;;) {
      if (await fn()) { console.error('[wait] happened but should not have: ' + label); return false; }
      if (Date.now() >= until) return true;
      await sleep(${POLL_MS});
    }
  };
`;
}

module.exports = { sleep, waitFor, rendererWaits, DEFAULT_TIMEOUT_MS, POLL_MS, RENDERER_BUDGET_MS };
