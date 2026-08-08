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

import { store } from './store.ts';

// A copy, not the stored set: the store holds it as ReadonlySet because nothing
// may mutate a published selection in place (the identity IS the change signal —
// see the store push below), and every caller here builds a new set anyway.
function current(): Set<string> {
  return new Set(store.getState().selectedSet);
}

let anchor: number | null = null;
// Marquee drag (#484). The snapshot is taken for EVERY drag, additive or not —
// it is what Esc restores. Whether the band adds to it or replaces it is the
// separate flag: conflating the two made Esc on a plain drag restore an empty
// selection instead of the one the drag started from.
let marqueeBase: ReadonlySet<string> | null = null;
let marqueeAdditive = false;
let marqueeAnchor: number | null = null;
let marqueeActive = false;

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
  store.setState({ selectedSet: next });
}

// Plain click (#143): collapse the selection to just this one card and make it
// the range anchor — Eagle/Explorer-style "click = single selection". Ctrl/Shift keep
// using toggle() above (add-remove / range).
export function selectOnly(idx: number, key: string) {
  anchor = idx;
  store.setState({ selectedSet: new Set<string>([key]) });
}

export function clear() {
  anchor = null;
  store.setState({ selectedSet: new Set<string>() });
}

// --- Marquee (drag range selection, #484) ---------------------------------
// The band is live-previewed: updateMarquee() runs on every frame the hit set
// changes, so it has to be idempotent for a given set of indices — it always
// rebuilds from the snapshot below rather than accumulating.

// `additive` = Ctrl/Cmd or Shift was held when the drag began (Explorer/Finder
// style: the band extends the existing selection instead of replacing it).
export function beginMarquee(additive: boolean) {
  marqueeBase = current();
  marqueeAdditive = additive;
  marqueeAnchor = anchor;
  marqueeActive = true;
}

export function updateMarquee(indices: number[], groups: HologramPostGroup[], postIdKey: PostIdKey) {
  if (!marqueeActive) return;
  const next = new Set<string>(marqueeAdditive ? (marqueeBase ?? []) : []);
  for (const i of indices) {
    const g = groups[i];
    if (g) next.add(postIdKey(g.rep));
  }
  // Arrow navigation moves from the anchor, so park it on the LOWEST index the
  // band touched — the start of the run, which is where continuing with the
  // keyboard reads right. (`indices` arrives ascending from marquee.hitIndices.)
  anchor = indices.length ? indices[0] : marqueeAnchor;
  store.setState({ selectedSet: next });
}

export function endMarquee() {
  marqueeBase = null;
  marqueeAdditive = false;
  marqueeAnchor = null;
  marqueeActive = false;
}

// Esc during the drag: put back exactly what was selected before it started.
export function cancelMarquee() {
  if (!marqueeActive) return;
  const base = marqueeBase;
  anchor = marqueeAnchor;
  endMarquee();
  store.setState({ selectedSet: new Set<string>(base ?? []) });
}

// Unconditional select-all (Ctrl/Cmd+A): every group in, regardless of the
// current selection.
export function selectAll(groups: HologramPostGroup[], postIdKey: PostIdKey) {
  const next = new Set(current());
  groups.forEach((g) => next.add(postIdKey(g.rep)));
  anchor = null;
  store.setState({ selectedSet: next });
}

// Select-all/deselect-all button + toolbar shortcut: flips between everything selected
// and nothing selected in one step.
export function toggleAll(groups: HologramPostGroup[], postIdKey: PostIdKey) {
  if (isAllSelected(groups, postIdKey)) clear();
  else selectAll(groups, postIdKey);
}
