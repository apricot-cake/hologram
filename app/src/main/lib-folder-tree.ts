'use strict';

// The on-disk shape of the folder store (folders.json), and the repair pass that
// makes a file safe to hand to the rest of the app. Pure data — no Electron, no
// fs — so ipc-organize.ts can register the IPC around it and the unit tests can
// call it directly.
//
// Nesting (#41) is a FLAT array plus `parentId`; the tree exists only as a derived
// view. That is how Eagle and Lightroom hold it internally, and it keeps every
// CRUD / merge / normalize path in this codebase flat. The cost is that a file can
// describe something that is not a tree — so the reader repairs instead of trusts.

/**
 * Force the parent edges into an actual tree, in place:
 *   - a parentId nobody owns (or one pointing at itself) → root
 *   - a cycle → cut at the node where the walk closes
 * Both repairs are silent and land on the ROOT side: a library that opens with one
 * folder in an unexpected place beats a library that does not open.
 */
function repairParents(list) {
  const byId = new Map(list.map((f) => [f.id, f]));
  for (const f of list) if (f.parentId != null && (f.parentId === f.id || !byId.has(f.parentId))) f.parentId = null;
  for (const f of list) {
    const seen = new Set([f.id]);
    let cur = f;
    while (cur.parentId != null) {
      if (seen.has(cur.parentId)) {
        cur.parentId = null;
        break;
      }
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId); // every parentId is a live id after the pass above
    }
  }
  return list;
}

/**
 * Normalize the `folders` array read from (or about to be written to) folders.json.
 * Unknown fields are dropped: this whitelist is the schema. A field that is not
 * listed here survives in the file but never reaches the app — which is why adding
 * one means touching this function, the renderer store's setAll, and the type
 * together.
 *
 * Saved searches (kind:'dynamic') never nest — they are their own sidebar group, so
 * a parent on one would be data nothing reads.
 */
function normFolders(arr) {
  const list = Array.isArray(arr)
    ? arr
        .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
        .map((c) => {
          const dynamic = c.kind === 'dynamic';
          const out = {
            id: c.id,
            name: c.name,
            kind: dynamic ? 'dynamic' : 'static',
            created: typeof c.created === 'number' ? c.created : null,
            parentId: !dynamic && typeof c.parentId === 'string' ? c.parentId : null,
            items: Array.isArray(c.items) ? [...new Set(c.items.map(String))] : [],
          };
          if (dynamic && c.tree && typeof c.tree === 'object') (out as any).tree = c.tree; // the saved search
          return out;
        })
    : [];
  return repairParents(list);
}

export { normFolders, repairParents };
