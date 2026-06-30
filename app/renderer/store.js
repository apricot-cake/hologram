// Shared renderer state store — a tiny external store both viewer.js (vanilla) and
// the React islands read/write, so the in-progress React migration has ONE source
// of truth while ownership of a region moves from viewer.js to React. Generalizes
// the settings island's makeStore to be key-addressed. Plain IIFE on window (like
// search.js / folders.js); loaded BEFORE viewer.js.
//
// subscribe(key, cb) is useSyncExternalStore-compatible: it returns an unsubscribe.
// Pass a function as the first arg to subscribe to ALL changes.
(function () {
  'use strict';
  const state = Object.create(null);
  const keySubs = new Map();   // key -> Set<cb>
  const allSubs = new Set();

  function get(key) { return state[key]; }

  function set(key, val) {
    if (state[key] === val) return;   // idempotent: same value => no notify (the loop guard)
    state[key] = val;
    const s = keySubs.get(key);
    if (s) for (const cb of [...s]) { try { cb(); } catch (_e) { /* ignore */ } }
    for (const cb of [...allSubs]) { try { cb(); } catch (_e) { /* ignore */ } }
  }

  function subscribe(key, cb) {
    if (typeof key === 'function') { cb = key; allSubs.add(cb); return () => allSubs.delete(cb); }
    let s = keySubs.get(key);
    if (!s) keySubs.set(key, (s = new Set()));
    s.add(cb);
    return () => s.delete(cb);
  }

  window.corpusStore = { get, set, subscribe };
})();
