// Inspector bridge — the imperative→declarative bridge for the persistent right-column
// inspector panel (#postDetail/#postDetailBox: post detail + poster detail, including the
// always-live inline tag editor). viewer.js keeps every business rule (persistence, undo,
// homonym detection, grouping, poster folders) and the panel's own hidden/insp-open/
// refreshTileSlider chrome; the React island owns rendering #postDetailBox's content.
// Kept SEPARATE from window.corpusStore for the same reason as menu.js/kind-menu.js/
// filter-popover.js/qf-pop.js: the model carries CALLBACKS. Plain IIFE on window (like
// store.js); loaded BEFORE viewer.js.
//
// model shape (kind: 'post' | 'poster'): see viewer.js's inspectorPostModel /
// inspectorPosterModel builders for the full field list. openId is an internal
// monotonic counter bumped only by open() (a fresh post/poster, or a full rebuild) —
// refresh() keeps the current openId so the mounted component re-renders in place
// (local state like the tag-input text and its filter query survive), matching the old
// behavior where only #ivTagChips/#ivTagPicker were touched by a tag mutation while a
// full showDetail()/showPosterDetail() rebuild (e.g. adopting a source tag) reset them.
(function () {
  'use strict';
  let current = null;
  let seq = 0;
  const subs = new Set();
  const notify = () => { for (const cb of [...subs]) { try { cb(); } catch (_e) { /* ignore */ } } };

  function open(model) { current = { ...model, openId: ++seq }; notify(); }
  function refresh(partial) { if (!current) return; current = { ...current, ...partial }; notify(); }
  function close() { if (current) { current = null; notify(); } }
  function get() { return current; }                       // stable ref between changes (useSyncExternalStore)
  function subscribe(cb) { subs.add(cb); return () => subs.delete(cb); }

  window.corpusInspector = { open, refresh, close, get, subscribe };
})();
