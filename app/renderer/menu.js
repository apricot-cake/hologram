// Context-menu controller — the imperative→declarative bridge for the right-click
// menus. viewer.js calls corpusContextMenu.open({ items, x, y }, onPick) to show a
// glass menu; the context-menu React island subscribes and renders it. Kept SEPARATE
// from window.corpusStore because the menu carries an onPick CALLBACK (a function),
// which doesn't belong in the serializable reactive store. Plain IIFE on window (like
// store.js / search.js); loaded BEFORE viewer.js.
//
// item shape: { label, act, danger?, checked?, sep?, manage?, ...extra }. onPick(item)
// runs the viewer-side action; if it RETURNS a new items array the menu stays open and
// re-renders (toggle rows — e.g. assign-to-folder), otherwise the menu closes.
(function () {
  'use strict';
  let current = null;            // { items, x, y, onPick } | null
  const subs = new Set();
  const notify = () => { for (const cb of [...subs]) { try { cb(); } catch (_e) { /* ignore */ } } };

  function open(model, onPick) {
    current = { items: (model && model.items) || [], x: (model && model.x) || 0, y: (model && model.y) || 0, onPick: onPick || null };
    notify();
  }
  function close() { if (current) { current = null; notify(); } }
  function pick(item) {
    if (!current || !current.onPick) { close(); return; }
    const next = current.onPick(item);
    if (Array.isArray(next)) { current = { ...current, items: next }; notify(); }  // stay open, re-render
    else close();
  }
  function get() { return current; }                       // stable ref between changes (useSyncExternalStore)
  function subscribe(cb) { subs.add(cb); return () => subs.delete(cb); }

  window.corpusContextMenu = { open, close, pick, get, subscribe };
})();
