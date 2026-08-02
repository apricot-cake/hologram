// The extension reloading ITSELF when a new local build lands (#650).
//
// THE PROBLEM. This extension is developed in the browser the author uses all
// day: the daily Chrome loads extension/.output/chrome-mv3 directly, and the
// same folder holds the production build (docs/build.md). Every code change
// therefore ended in a human pressing the reload button in chrome://extensions
// — a page this project's tooling deliberately never drives.
//
// THE SHAPE, and why it is not an invention. WXT's own dev mode and CRXJS both
// solve this the same way: the build tells the extension a new bundle is on
// disk, and the extension calls chrome.runtime.reload() on itself, which reads
// the manifest back off disk (measured on #650: version, added permissions and
// added content_scripts all take effect; chrome.storage.local, the keyboard
// shortcuts and the extension id all survive). What differs here is only the
// CARRIER: instead of a WebSocket to a dev server, the news rides on the native
// messaging round trips this extension already makes — every save, every badge
// query, every relayed log line comes back stamped with the token of whatever
// build is sitting in the output folder (native-host/protocol.mts's
// DevBuildStamp). No new process, no new port, no new host registration, and
// nothing in the daily browser except the production build it already had.
//
// WHEN IT IS INERT, which is nearly always. Two independent gates have to be
// open: this bundle must have been given a build id (EXT_BUILD_ID, minted by
// scripts/build-extension.cts), and the host must find a stamp file that the
// same script wrote (native-host/paths.cts's extensionBuildStampPath). A
// released, store-installed extension talking to a released host has neither, so
// the comparison below never has two values to compare.
//
// WHAT THIS FILE HOLDS is the part with no chrome.* in it: when a reload is
// allowed to happen. The wiring — reading the stamp off replies and reloading
// the extension — is in background.ts, because only the worker can see the
// events that count as work.

// Set by scripts/build-extension.cts through Vite's `define`, and by nothing
// else: an ordinary `wxt build` (what `npm run zip:ext` runs to produce the
// store artifact) leaves it undefined, and so does a Vitest run importing this
// module directly. `typeof` rather than a plain read because an undeclared
// identifier is a ReferenceError, while `typeof` on one is legal and yields
// 'undefined' — which is exactly the "there is no local build" answer.
declare const __EXT_BUILD_ID__: string | undefined;
export const EXT_BUILD_ID: string = typeof __EXT_BUILD_ID__ === 'undefined' ? '' : __EXT_BUILD_ID__ || '';

// Where the worker leaves a note for the instance that replaces it. In
// chrome.storage.local because that is what survives chrome.runtime.reload()
// (measured on #650); storage.session does not outlive the extension being
// reloaded, which is the one moment this note has to cross.
export const DEV_RELOAD_STATE_KEY = 'devReload.v1';

export interface DevReloadState {
  // The token a reload has ALREADY been spent on. The loop-breaker: if the new
  // bundle does not actually carry that token — the classic cause being a build
  // in a different working tree, whose output no browser has loaded — the next
  // reply would ask for the same reload again, forever. One attempt per token,
  // and a genuinely new build is the only thing that unlocks another.
  attempted?: string | null;
}

// How long after the last evidence of work a hold survives on its own. Nothing
// in this design has an unbounded state: an activity that stops reporting is
// released after this, whatever it was.
//
// 60s is one full worst-case save (crop 10s + metadata 20s + host 30s —
// deadline.ts) with no room to spare, which is the honest floor for "a save that
// started could still be running". Above that, a capture UI nobody has touched
// for a minute is not work in progress, and a bulk intake that has not saved
// anything for a minute has run out of rows.
export const DEV_RELOAD_WORK_MS = 60_000;

// Quiet demanded after the last thing happened, before a reload may fire. Long
// enough to cover the bulk intake's own pacing (MIN_SAVE_PERIOD_MS = 1s), so a
// running intake is not cut in half between two of its posts; short enough that
// an ordinary save is followed by the new build almost at once.
export const DEV_RELOAD_QUIET_MS = 3_000;

// One thing that is happening and would be destroyed by a reload. Keyed by what
// it is and where, so a bulk intake and a capture UI on the SAME tab are two
// holds and neither can end the other.
export type DevReloadActivity = string;

export function captureActivity(tabId: number): DevReloadActivity {
  return `capture:${tabId}`;
}

export function bulkActivity(tabId: number): DevReloadActivity {
  return `bulk:${tabId}`;
}

export interface DevReloadGate {
  // Something that can be interrupted has started, or is still going. Re-arms
  // the hold's expiry, so an activity that keeps reporting keeps its protection
  // and one that goes silent loses it after DEV_RELOAD_WORK_MS.
  begin(activity: DevReloadActivity): void;
  // Evidence that an activity ALREADY open is still going, without starting one
  // that is not. A bulk intake saves a post a second and each save is the proof
  // its run is alive; the same save on an ordinary tab is proof of nothing about
  // a run that was never started, and must not invent a hold for one.
  refresh(activity: DevReloadActivity): void;
  // …and has finished. Falls back to the ordinary quiet window rather than to
  // "now": the thing that just ended is usually followed immediately by the next
  // one (the intake's next post, the banner the page is still drawing).
  end(activity: DevReloadActivity): void;
  // The tab went away — navigated or closed. Whatever was open on it is gone
  // with it, and nothing is owed a quiet window for work that no longer exists.
  dropTab(tabId: number): void;
  // Something happened that is not an activity but still means "not now" (a
  // save admitted, a diagnostics line written).
  touch(): void;
  // 0 when a reload may happen right now, otherwise the timestamp to ask again
  // at. Never returns a value further out than now + DEV_RELOAD_WORK_MS.
  blockedUntil(): number;
}

export interface DevReloadGateDeps {
  now(): number;
  // Saves the worker itself is holding (host-budget.ts). Counted separately from
  // the activities above because the worker already tracks it exactly, and
  // because every leg of a save has a deadline — so this number drains on its
  // own even when the page it belongs to has stopped talking.
  savesInFlight(): number;
}

export function createDevReloadGate({ now, savesInFlight }: DevReloadGateDeps): DevReloadGate {
  const open = new Map<DevReloadActivity, number>();
  let quietUntil = 0;

  const forget = (t: number) => {
    for (const [activity, until] of open) {
      if (until <= t) open.delete(activity);
    }
  };

  return {
    begin(activity) {
      open.set(activity, now() + DEV_RELOAD_WORK_MS);
    },
    refresh(activity) {
      const t = now();
      if ((open.get(activity) ?? 0) > t) open.set(activity, t + DEV_RELOAD_WORK_MS);
    },
    end(activity) {
      open.delete(activity);
      quietUntil = Math.max(quietUntil, now() + DEV_RELOAD_QUIET_MS);
    },
    dropTab(tabId) {
      open.delete(captureActivity(tabId));
      open.delete(bulkActivity(tabId));
    },
    touch() {
      quietUntil = Math.max(quietUntil, now() + DEV_RELOAD_QUIET_MS);
    },
    blockedUntil() {
      const t = now();
      forget(t);
      let until = quietUntil > t ? quietUntil : 0;
      for (const [, deadline] of open) until = Math.max(until, deadline);
      // A save the worker is holding blocks on its own, whatever the page it
      // came from has or has not announced — the hover save button and the drop
      // zone open no activity at all. Asked again a quiet window later rather
      // than held for a fixed time, because this number drains by itself: every
      // leg of a save has a deadline (deadline.ts), so the slot is released no
      // later than ~60s after it was taken, working or not.
      if (savesInFlight() > 0) until = Math.max(until, t + DEV_RELOAD_QUIET_MS);
      return until;
    },
  };
}

// Should this reply's stamp start a reload? Kept apart from the wiring because
// it is the whole of the rule, and the rule is easy to get subtly wrong:
//
//   - no local build id  → this bundle was not built by the dev script; nothing
//                          to compare, and a released extension must never take
//                          this path.
//   - no stamp on the reply → the host found no stamp file. Same answer.
//   - the two match      → the browser is already running what is on disk.
//   - already attempted  → one reload has been spent on this exact token and it
//                          did not take. See DevReloadState.attempted.
export function shouldReloadFor(hostBuild: string | null, ownBuild: string, attempted: string | null | undefined): boolean {
  if (!ownBuild || !hostBuild) return false;
  if (hostBuild === ownBuild) return false;
  return hostBuild !== attempted;
}
