// Every wait in the save path has an end (#507).
//
// A limit on the native-host leg existed already, and the save still hung: the
// leg that stalled was a different one. A save crosses three processes — the
// page's content script, the MV3 service worker, and the host — and only the
// worker→host hop was bounded. Whichever of the others stalled, the banner sat
// on "saving…" forever and capture.log recorded neither success nor failure,
// because the code that writes those lines is downstream of the stall.
//
// The budgets are layered so the INNERMOST leg always reports first. That
// matters for what the user is told: the service worker can name the stage that
// actually stalled (the platform API, the crop round trip, the host), while the
// content script's watchdog knows only "nothing came back". The watchdog is
// therefore a backstop for the one case the worker cannot report on — its own
// disappearance, which MV3 may do at any idle moment, taking the pending save
// with it.
//
//   crop round trip     10s ┐
//   metadata fetch      20s ├─ the service worker's own budget: 60s
//   native host         30s ┘
//   content watchdog    90s  ─ only reached when the worker never answers
//
// Chosen against measured saves, not guesses. From the author's capture.log
// (2026-07-26 – 2026-07-29, 20 consecutive bookmark-intake saves, each timed
// from the previous ack): median 1.05s, a one-picture post 0.8–2.2s, a video
// post 4.0s, and the heaviest post observed — four pictures — 12.4s. Those
// figures cover metadata AND the host's download of every original, so the
// worst real save measured is a fifth of the service worker's budget alone.
// The point of the margin is that a slow save must never be called a failure;
// a hung one just has to end.

export const CROP_TIMEOUT_MS = 10_000;
export const METADATA_TIMEOUT_MS = 20_000;
export const NATIVE_HOST_TIMEOUT_MS = 30_000;
export const SAVE_WATCHDOG_MS = 90_000;

// The read-only "is this saved?" lookups. Far tighter than a save because
// nothing is written and the answer is optional: the timeline badge simply
// stays unmarked, and the duplicate warning falls through to saving unasked
// (its documented fail-open behaviour — a missed warning costs one extra
// record, a blocked save costs the post).
export const SAVED_QUERY_TIMEOUT_MS = 8_000;
export const DUPLICATE_ASK_TIMEOUT_MS = 12_000;

// Marks a wait that was abandoned rather than answered. Carried through as an
// ordinary Error so every existing catch keeps working; the type is what lets
// the failure be told apart from a real error when it matters.
export class DeadlineError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms}ms`);
    this.name = 'DeadlineError';
  }
}

// Settle with whatever `work` produces, or reject once `ms` has passed.
//
// The abandoned work is NOT cancelled: `fetch` is only abortable if every call
// site threads a signal through, and this has to bound the WHOLE step — an
// extractor that makes two sequential requests would still stall for the sum of
// two per-request limits. One boundary covers every platform, present and
// future, which is the property worth having here. In a service worker the
// orphan is short-lived by construction: the worker is torn down long before it
// could matter.
export function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError(what, ms)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
