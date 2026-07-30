// How much of the native host one page may spend (#323, the half that is not
// about trust).
//
// `chrome.runtime.connectNative` starts a host PROCESS per connection — that is
// the design (the host is short-lived on purpose, so saving works with the
// desktop app closed), and it is also why "how many requests can a page cause"
// is really "how many processes can a page start". #323 reached that through
// synthetic clicks, which utils/user-gesture.ts now stops; this module is the
// answer to the same question asked from anywhere else, including a route nobody
// has written yet and a bug on our own side.
//
// TWO BOUNDS, deliberately not a rate limit. A cap on requests per minute would
// have to be set above the fastest legitimate route — the bookmark intake (#362)
// saves as quickly as the host answers — and anything above that is high enough
// to be worth nothing. What no legitimate route does is run MANY SAVES AT ONCE:
// the Alt+S capture is single-shot, the intake is strictly serial, the drop zone
// holds one drop, and the hover button refuses a second press on the same
// picture. So the bound is on CONCURRENCY, where the honest ceiling is small.
//
//   1. Identical requests join instead of doubling. Two in-flight saves of the
//      same picture from the same tab are not something a user can ask for, and
//      answering the second from the first's own result is better than the
//      duplicate record the pair would otherwise write.
//   2. A tab, and the browser, can hold only so many saves in flight. Over the
//      cap the request is refused immediately, before any connection is opened,
//      so the refusal costs nothing and the count cannot creep past it.
//
// Failures are included by construction: a slot is held until the save SETTLES,
// and every leg of a save has a deadline (utils/deadline.ts), so a failing route
// releases its slot no later than a working one. Nothing here needs to know what
// went wrong.

// Per tab: above anything a person can press at once (the hover save button is
// per picture, so a fast user can start a handful), far below what a loop wants.
export const SAVES_IN_FLIGHT_PER_TAB = 8;
// Across the browser, for the case of many tabs each under their own cap.
export const SAVES_IN_FLIGHT_TOTAL = 16;

export interface SaveGateLimits {
  perTab?: number;
  total?: number;
}

export interface SaveGate<T> {
  // The save to await: a new one, the identical one already running, or null
  // when the caller must refuse this request. Never opens anything itself —
  // `start` is what does, and it is not called for a refusal or a join.
  admit(key: string, tabId: number | null, start: () => Promise<T>): Promise<T> | null;
  // In flight for one tab, or for the browser when no tab is named. Reported for
  // the diagnostics line a refusal writes, and read by the tests.
  inFlight(tabId?: number | null): number;
}

// What makes two requests "the same save". The image URLs are part of it because
// the pictures are what a save of one post differs by: two pictures of the same
// post are two saves, which is the whole point of the per-picture hover button
// (#334), while the same picture twice is one.
export function saveRequestKey(tabId: number | null, type: string, postUrl: string | null | undefined, imageUrls: readonly string[] = []): string {
  return JSON.stringify([tabId ?? null, type, postUrl || null, [...imageUrls].sort()]);
}

export function createSaveGate<T>({ perTab = SAVES_IN_FLIGHT_PER_TAB, total = SAVES_IN_FLIGHT_TOTAL }: SaveGateLimits = {}): SaveGate<T> {
  // Every admitted save, by key: the dedup index and the total count in one
  // structure, so the two can never disagree.
  const running = new Map<string, { promise: Promise<T>; tab: number }>();
  const perTabCount = new Map<number, number>();
  // A request with no tab (there is none for the extension's own pages) still
  // has to be counted against something, and counting them together is right:
  // they are all the same origin.
  const slot = (tabId: number | null | undefined) => (tabId == null ? -1 : tabId);

  return {
    admit(key, tabId, start) {
      const joined = running.get(key);
      if (joined) return joined.promise;

      const tab = slot(tabId);
      const held = perTabCount.get(tab) || 0;
      if (running.size >= total || held >= perTab) return null;

      perTabCount.set(tab, held + 1);
      const release = () => {
        running.delete(key);
        const left = (perTabCount.get(tab) || 1) - 1;
        if (left > 0) perTabCount.set(tab, left);
        else perTabCount.delete(tab);
      };

      let promise: Promise<T>;
      try {
        promise = start();
      } catch (error) {
        release(); // a route that threw before returning a promise still let go
        throw error;
      }
      running.set(key, { promise, tab });
      // Both outcomes release, and neither turns this into an unhandled
      // rejection: the caller keeps the promise this returns and handles it.
      promise.then(release, release);
      return promise;
    },

    inFlight(tabId) {
      if (tabId === undefined) return running.size;
      return perTabCount.get(slot(tabId)) || 0;
    },
  };
}
