// Value-flyout bridge — the imperative→declarative bridge for the sidebar filter
// "value flyout" (qf-pop): clicking a category row (platform / tag / user / …) opens a
// scrollable list of that category's values, optionally with a find box + ぴったり/
// おおまか segment for long lists. viewer.js owns the bespoke facet logic (qfValues —
// per-category counting/sorting rules) and the pick routing (add/remove filter, poster
// query-builder ops, multi-image toggle); this bridge only carries the CURRENT
// rendered model. Kept SEPARATE from window.corpusStore for the same reason as
// menu.js/kind-menu.js/filter-popover.js: onPick/onManage carry CALLBACKS. Plain IIFE
// on window (like store.js); loaded BEFORE viewer.js.
//
// model shape: { openId, anchorRect:{left,top,right,bottom}, items, showFind,
// findPlaceholder, searchModeTitle, exactLabel, fuzzyLabel, exactHint, fuzzyHint,
// footerLabel?, onManage?(), onPick(item) }. openId is an internal monotonic counter
// (not passed by the caller): every open() bumps it, so the island can key its root on
// it and remount (reset + refocus the find input) on every open() call — including the
// refresh after a pick, matching the old renderQfPop() rebuild-on-every-change behavior.
(function () {
  'use strict';
  let current = null;
  let seq = 0;
  const subs = new Set();
  const notify = () => { for (const cb of [...subs]) { try { cb(); } catch (_e) { /* ignore */ } } };

  function open(model) { current = { ...model, openId: ++seq }; notify(); }
  function close() { if (current) { current = null; notify(); } }
  function get() { return current; }                       // stable ref between changes (useSyncExternalStore)
  function subscribe(cb) { subs.add(cb); return () => subs.delete(cb); }

  window.corpusQfPop = { open, close, get, subscribe };
})();
