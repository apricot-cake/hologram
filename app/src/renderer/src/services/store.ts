// Shared renderer state store — a tiny external store both viewer.js (vanilla) and
// the React components read/write, so the in-progress React migration has ONE source
// of truth while ownership of a region moves from viewer.js to React. Generalizes
// the settings component's makeStore to be key-addressed. A real ES module now —
// every consumer imports get/set/subscribe directly.
//
// subscribe(key, cb) is useSyncExternalStore-compatible: it returns an unsubscribe.
// Pass a function as the first arg to subscribe to ALL changes.
const state: Record<string, any> = Object.create(null);
const keySubs = new Map<string, Set<() => void>>(); // key -> Set<cb>
const allSubs = new Set<() => void>();

export function get(key: string) {
  return state[key];
}

export function set(key: string, val: unknown) {
  setMany({ [key]: val });
}

// Writes several keys under ONE notify pass. Needed whenever two keys describe
// the same thing and a reader would see a torn state between them: writing them
// with two set() calls fires two synchronous notify passes, and a subscriber to
// both is rendered once against key A's new value and key B's OLD one (#871 —
// 'postGroups' + 'postSections' did exactly that, and the grid rendered the new
// items against the previous build's section ranges, corrupting masonic's
// position cache). Callbacks are deduplicated across the batch, so a subscriber
// registered on two of the written keys still runs exactly once.
export function setMany(entries: Record<string, unknown>) {
  const changed: string[] = [];
  for (const [key, val] of Object.entries(entries)) {
    if (state[key] === val) continue; // idempotent: same value => no notify (the loop guard)
    state[key] = val;
    changed.push(key);
  }
  if (changed.length === 0) return;
  // Snapshot into a Set before calling anything: dedupes, and (like the copies
  // the per-key loop used to make) keeps an unsubscribe DURING the pass safe.
  const cbs = new Set<() => void>();
  for (const key of changed) {
    const s = keySubs.get(key);
    if (s) for (const cb of s) cbs.add(cb);
  }
  for (const cb of allSubs) cbs.add(cb);
  for (const cb of cbs) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
}

export function subscribe(key: string | (() => void), cb?: () => void): HologramUnsubscribe {
  if (typeof key === 'function') {
    cb = key;
    allSubs.add(cb);
    return () => allSubs.delete(cb as () => void);
  }
  let s = keySubs.get(key);
  if (!s) keySubs.set(key, (s = new Set()));
  s.add(cb as () => void);
  return () => s.delete(cb as () => void);
}
