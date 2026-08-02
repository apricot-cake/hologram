'use strict';

// #21: rename/merge/orphan-cleanup all change or remove a tagId — and #5's
// 2026-07-18 comment put tag LEAVES in saved searches/tabs behind a tagId
// reference specifically so a rename never orphans a saved query. This module
// is the other half of that promise: the sweep that keeps every such leaf in
// sync when a tagId is remapped (merge) or removed (delete), across the two
// places a query tree can be sitting at rest — folders.tree (dynamic folders)
// and tabs.state (the per-tab view snapshot + its per-tab nav history, #144).
//
// Deliberately duck-typed (`AnyNode`) rather than importing the renderer's
// query.ts shape: this runs in the main process against whatever JSON a tab
// blob happens to hold (including retired leaf-type shapes normalizeLeaf would
// otherwise heal on the renderer side) — a node this walker doesn't recognize
// (missing kind/children) is left untouched rather than thrown on, since a
// malformed tree here is a pre-existing data problem, not this sweep's job to
// fix.

interface AnyNode {
  kind?: string;
  type?: string;
  tagId?: number;
  children?: AnyNode[];
  [key: string]: unknown;
}

/** `remap(id)` returns the new id to keep, or 'delete' to drop the leaf entirely. */
export type TagIdRemap = (id: number) => number | 'delete';

// Walks one query tree in place. Returns true if anything changed (the caller
// only re-persists rows that actually changed). A leaf is `{kind:'cond', type:
// 'tag', tagId}` (query.ts); everything else recurses through `children`.
export function sweepQueryTree(node: AnyNode | null | undefined, remap: TagIdRemap): boolean {
  if (!node || typeof node !== 'object' || !Array.isArray(node.children)) return false;
  let changed = false;
  const kept: AnyNode[] = [];
  for (const child of node.children) {
    if (child && child.kind === 'cond' && child.type === 'tag' && typeof child.tagId === 'number') {
      const r = remap(child.tagId);
      if (r === 'delete') {
        changed = true;
        continue; // drop the leaf
      }
      if (r !== child.tagId) {
        child.tagId = r;
        changed = true;
      }
      kept.push(child);
      continue;
    }
    if (child && child.kind === 'group') {
      if (sweepQueryTree(child, remap)) changed = true;
    }
    kept.push(child);
  }
  if (changed) node.children = kept;
  return changed;
}

// One tab's persisted blob (tab-state.ts's HologramTabPersist, read back as
// parsed JSON from the DB-backed `tabs` table — #298 moved tabs.json here).
// Sweeps state.view.tree (the live grid snapshot) plus every 'posts'/'posters'
// nav-history entry's own .tree (#144 put those on the per-tab back/forward
// stack too); 'image' entries carry no tree and are left alone.
function sweepTabBlob(blob: unknown, remap: TagIdRemap): boolean {
  if (!blob || typeof blob !== 'object') return false;
  let changed = false;
  const view = (blob as { view?: { tree?: AnyNode } }).view;
  if (view && view.tree && sweepQueryTree(view.tree, remap)) changed = true;
  const hist = (blob as { nav?: { hist?: Array<{ kind?: string; state?: { tree?: AnyNode } }> } }).nav?.hist;
  if (Array.isArray(hist)) {
    for (const entry of hist) {
      if (!entry || (entry.kind !== 'posts' && entry.kind !== 'posters')) continue;
      const tree = entry.state?.tree;
      if (tree && sweepQueryTree(tree, remap)) changed = true;
    }
  }
  return changed;
}

// Applies `remap` to every folders.tree and tabs.state tag leaf, writing back
// only the rows that actually changed. Call inside the caller's own
// transaction (merge/delete already wrap their whole operation in one).
export function sweepFoldersAndTabs(sqlite: import('better-sqlite3').Database, remap: TagIdRemap): void {
  const folderRows = sqlite.prepare("SELECT id, tree FROM folders WHERE kind = 'dynamic' AND tree IS NOT NULL").all() as Array<{ id: string; tree: string }>;
  const updateFolder = sqlite.prepare('UPDATE folders SET tree = ? WHERE id = ?');
  for (const row of folderRows) {
    let tree: AnyNode;
    try {
      tree = JSON.parse(row.tree);
    } catch {
      continue; // not this sweep's job to repair unparsable rows
    }
    if (sweepQueryTree(tree, remap)) updateFolder.run(JSON.stringify(tree), row.id);
  }

  const tabRows = sqlite.prepare('SELECT id, state FROM tabs').all() as Array<{ id: string; state: string }>;
  const updateTab = sqlite.prepare('UPDATE tabs SET state = ? WHERE id = ?');
  for (const row of tabRows) {
    let blob: unknown;
    try {
      blob = JSON.parse(row.state);
    } catch {
      continue;
    }
    if (sweepTabBlob(blob, remap)) updateTab.run(JSON.stringify(blob), row.id);
  }
}
