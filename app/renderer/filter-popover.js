// Filter-popover bridge — the imperative→declarative bridge for the date / engagement /
// poster-date-range flyout FORMS (distinct from the value flyout qf-pop, which stays
// imperative for now — its find-input focus-preservation trick is a separate, riskier
// slice; see BACKLOG "React 化"). viewer.js builds the current field values + already-
// localized labels and owns the apply/remove actions; the filter-popover React island
// subscribes and renders whichever kind ('date' | 'eng' | 'posterDate') is open. Kept
// SEPARATE from window.corpusStore for the same reason as menu.js/kind-menu.js:
// onApply/onRemove carry CALLBACKS, which don't belong in the serializable reactive
// store. Plain IIFE on window (like store.js / menu.js); loaded BEFORE viewer.js.
//
// model shape: { kind, openId, anchorRect:{left,top,right,bottom}, editing, fields,
// labels, typeOptions?, dimOptions?, onApply(fields), onRemove() }. openId is an
// internal monotonic counter (not passed by the caller) so the island can key its form
// on it and remount (reset local input state) on every open() — including re-opening
// the SAME kind to edit a different node.
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

  window.corpusFilterPopover = { open, close, get, subscribe };
})();
