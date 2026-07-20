// Shared renderer state store — a tiny external store both viewer.js (vanilla) and
// the React islands read/write, so the in-progress React migration has ONE source
// of truth while ownership of a region moves from viewer.js to React. Generalizes
// the settings island's makeStore to be key-addressed. A real ES module now
// (Wave12) — every consumer imports get/set/subscribe directly.
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
  if (state[key] === val) return; // idempotent: same value => no notify (the loop guard)
  state[key] = val;
  const s = keySubs.get(key);
  if (s)
    for (const cb of [...s]) {
      try {
        cb();
      } catch (_e) {
        /* ignore */
      }
    }
  for (const cb of [...allSubs]) {
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
