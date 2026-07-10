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
// and calls only this module's query/mutate API. A real ES module now — its
// exports are imported directly by viewer.ts and SelectionBar.tsx. corpusStore
// itself is still read/written via window.corpusStore (Wave12 converts it).

function current(): Set<string> {
  return window.corpusStore.get('selectedSet') || new Set<string>();
}

let anchor: number | null = null;

export function has(key: string) {
  return current().has(key);
}
export function size() {
  return current().size;
}
export function anchorIndex() {
  return anchor;
}

type PostIdKey = (p: CorpusPost) => string;

// Every group of `groups` that's currently selected (bulk actions operate on
// these). `postIdKey` resolves a group's rep to its selection key.
export function selectedGroups(groups: CorpusPostGroup[], postIdKey: PostIdKey): CorpusPostGroup[] {
  const set = current();
  return groups.filter((g) => set.has(postIdKey(g.rep)));
}
// Every record of every selected group.
export function selectedRecords(groups: CorpusPostGroup[], postIdKey: PostIdKey): CorpusPost[] {
  const records: CorpusPost[] = [];
  selectedGroups(groups, postIdKey).forEach((g) => records.push(...g.records));
  return records;
}
export function isAllSelected(groups: CorpusPostGroup[], postIdKey: PostIdKey): boolean {
  const set = current();
  return groups.length > 0 && groups.every((g) => set.has(postIdKey(g.rep)));
}

// Toggle a card in/out of the selection; shiftKey additionally range-selects
// from the last anchor (Google-Photos style). `idx`/`key` identify the
// clicked card; `groups` (+ `postIdKey`) resolve range members to keys.
export function toggle(idx: number, key: string, shiftKey: boolean, groups: CorpusPostGroup[], postIdKey: PostIdKey) {
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

export function clear() {
  anchor = null;
  window.corpusStore.set('selectedSet', new Set<string>());
}

// Unconditional select-all (Ctrl/Cmd+A): every group in, regardless of the
// current selection.
export function selectAll(groups: CorpusPostGroup[], postIdKey: PostIdKey) {
  const next = new Set(current());
  groups.forEach((g) => next.add(postIdKey(g.rep)));
  anchor = null;
  window.corpusStore.set('selectedSet', next);
}

// 全選択/全解除 button + toolbar shortcut: flips between everything selected
// and nothing selected in one step.
export function toggleAll(groups: CorpusPostGroup[], postIdKey: PostIdKey) {
  if (isAllSelected(groups, postIdKey)) clear();
  else selectAll(groups, postIdKey);
}
