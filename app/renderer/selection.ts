// Selection state — the post-grid multi-select Set + shift-range anchor, extracted
// as the single owner (P4-B スライス⑬). corpusStore's 'selectedSet' key IS the
// state (no separate closure Set to keep in sync): every mutation reads the
// current Set via window.corpusStore.get('selectedSet'), builds a fresh Set (the
// store's set() no-ops on === identity, and the grid island's Cell — see
// Grid.tsx — subscribes to this key directly, so a fresh reference is required
// to notify), and writes it back. The shift-range anchor stays a private module
// variable, same as before (no subscribers — viewer-internal only, per the
// state→store phase's own decision to leave it out of corpusStore).
// viewer.js keeps every side effect around a mutation (the #postGrid 'selecting'
// class, the #selectionBar model push, bulk IPC/confirm/render orchestration)
// and calls only this module's query/mutate API. Plain IIFE on window (like
// store.js); loaded BEFORE viewer.js.
(function () {
  'use strict';

  function current(): Set<string> {
    return window.corpusStore.get('selectedSet') || new Set<string>();
  }

  let anchor: number | null = null;

  function has(key: string) {
    return current().has(key);
  }
  function size() {
    return current().size;
  }
  function anchorIndex() {
    return anchor;
  }

  type PostIdKey = (p: CorpusPost) => string;

  // Every group of `groups` that's currently selected (bulk actions operate on
  // these). `postIdKey` resolves a group's rep to its selection key.
  function selectedGroups(groups: CorpusPostGroup[], postIdKey: PostIdKey): CorpusPostGroup[] {
    const set = current();
    return groups.filter((g) => set.has(postIdKey(g.rep)));
  }
  // Every record of every selected group.
  function selectedRecords(groups: CorpusPostGroup[], postIdKey: PostIdKey): CorpusPost[] {
    const records: CorpusPost[] = [];
    selectedGroups(groups, postIdKey).forEach((g) => records.push(...g.records));
    return records;
  }
  function isAllSelected(groups: CorpusPostGroup[], postIdKey: PostIdKey): boolean {
    const set = current();
    return groups.length > 0 && groups.every((g) => set.has(postIdKey(g.rep)));
  }

  // Toggle a card in/out of the selection; shiftKey additionally range-selects
  // from the last anchor (Google-Photos style). `idx`/`key` identify the
  // clicked card; `groups` (+ `postIdKey`) resolve range members to keys.
  function toggle(idx: number, key: string, shiftKey: boolean, groups: CorpusPostGroup[], postIdKey: PostIdKey) {
    const next = new Set(current());
    if (shiftKey && anchor !== null) {
      const lo = Math.min(anchor, idx);
      const hi = Math.max(anchor, idx);
      for (let i = lo; i <= hi; i++) if (groups[i]) next.add(postIdKey(groups[i].rep));
      anchor = idx;
    } else if (next.has(key)) {
      next.delete(key);
      anchor = null;
    } else {
      next.add(key);
      anchor = idx;
    }
    window.corpusStore.set('selectedSet', next);
  }

  function clear() {
    anchor = null;
    window.corpusStore.set('selectedSet', new Set<string>());
  }

  // Unconditional select-all (Ctrl/Cmd+A): every group in, regardless of the
  // current selection.
  function selectAll(groups: CorpusPostGroup[], postIdKey: PostIdKey) {
    const next = new Set(current());
    groups.forEach((g) => next.add(postIdKey(g.rep)));
    anchor = null;
    window.corpusStore.set('selectedSet', next);
  }

  // 全選択/全解除 button + toolbar shortcut: flips between everything selected
  // and nothing selected in one step.
  function toggleAll(groups: CorpusPostGroup[], postIdKey: PostIdKey) {
    if (isAllSelected(groups, postIdKey)) clear();
    else selectAll(groups, postIdKey);
  }

  const api = { has, size, anchorIndex, toggle, clear, selectAll, toggleAll, isAllSelected, selectedGroups, selectedRecords };
  if (typeof window !== 'undefined') window.corpusSelection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
