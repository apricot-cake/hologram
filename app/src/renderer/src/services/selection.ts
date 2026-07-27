// Selection state — the post-grid multi-select Set + shift-range anchor, extracted
// as the single owner. hologramStore's 'selectedSet' key IS the
// state (no separate closure Set to keep in sync): every mutation reads the
// current Set via store.get('selectedSet'), builds a fresh Set (the
// store's set() no-ops on === identity, and the grid component's Cell — see
// Grid.tsx — subscribes to this key directly, so a fresh reference is required
// to notify), and writes it back. The shift-range anchor stays a private module
// variable, same as before (no subscribers — viewer-internal only, per the
// state→store phase's own decision to leave it out of hologramStore).
// viewer.js keeps every side effect around a mutation (the #postGrid 'selecting'
// class, bulk IPC/confirm/render orchestration) and calls only this module's
// query/mutate API. A real ES module now — its exports are imported directly by
// the orchestrator and the bottom FloatingBar component (selection/).

import { get as storeGet, set as storeSet } from './store.ts';

function current(): Set<string> {
  return storeGet('selectedSet') || new Set<string>();
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

type PostIdKey = (p: HologramPost) => string;

// Every group of `groups` that's currently selected (bulk actions operate on
// these). `postIdKey` resolves a group's rep to its selection key.
export function selectedGroups(groups: HologramPostGroup[], postIdKey: PostIdKey): HologramPostGroup[] {
  const set = current();
  return groups.filter((g) => set.has(postIdKey(g.rep)));
}
// Every record of every selected group.
export function selectedRecords(groups: HologramPostGroup[], postIdKey: PostIdKey): HologramPost[] {
  const records: HologramPost[] = [];
  selectedGroups(groups, postIdKey).forEach((g) => records.push(...g.records));
  return records;
}
export function isAllSelected(groups: HologramPostGroup[], postIdKey: PostIdKey): boolean {
  const set = current();
  return groups.length > 0 && groups.every((g) => set.has(postIdKey(g.rep)));
}

// Toggle a card in/out of the selection; shiftKey additionally range-selects
// from the last anchor (Google-Photos style). `idx`/`key` identify the
// clicked card; `groups` (+ `postIdKey`) resolve range members to keys.
export function toggle(idx: number, key: string, shiftKey: boolean, groups: HologramPostGroup[], postIdKey: PostIdKey) {
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
  storeSet('selectedSet', next);
}

// Plain click (#143): collapse the selection to just this one card and make it
// the range anchor — Eagle/Explorer 型「クリック＝単一選択」. Ctrl/Shift keep
// using toggle() above (add-remove / range).
export function selectOnly(idx: number, key: string) {
  anchor = idx;
  storeSet('selectedSet', new Set<string>([key]));
}

export function clear() {
  anchor = null;
  storeSet('selectedSet', new Set<string>());
}

// Unconditional select-all (Ctrl/Cmd+A): every group in, regardless of the
// current selection.
export function selectAll(groups: HologramPostGroup[], postIdKey: PostIdKey) {
  const next = new Set(current());
  groups.forEach((g) => next.add(postIdKey(g.rep)));
  anchor = null;
  storeSet('selectedSet', next);
}

// 全選択/全解除 button + toolbar shortcut: flips between everything selected
// and nothing selected in one step.
export function toggleAll(groups: HologramPostGroup[], postIdKey: PostIdKey) {
  if (isAllSelected(groups, postIdKey)) clear();
  else selectAll(groups, postIdKey);
}
