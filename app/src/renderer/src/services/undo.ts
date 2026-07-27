// Undo/redo service — the linear tag-edit history stack, extracted 1:1 from
// viewer.js as the eleventh "pure logic → service" slice of the viewer
// decomposition (最終形B). The module owns the stack semantics (push cap,
// redo discard on new edit, prev/next direction mapping, poster vs post
// routing); the side effects of actually re-applying a tag list (IPC write,
// grid re-render, inspector refresh) stay in viewer.js and come in as deps.
// A real ES module (named exports), imported directly by viewer.ts; touches
// no DOM.

const UNDO_MAX = 50;

// deps contract (both async, both viewer-owned side effects):
//   applyTags(records)       — records = [{captureId, image, tags}] (post sidecars)
//   applyPosterTags(records) — records = [{key, tags}] (poster-tags.json)
type HologramUndoEntry = { type: string; records: HologramUndoRecord[] };
export function makeUndo(deps: { applyTags(records: { captureId?: string; image?: string; tags: string[] }[]): Promise<void> | void; applyPosterTags(records: { key?: string; tags: string[] }[]): Promise<void> | void }) {
  const undoStack: HologramUndoEntry[] = []; // [{type, records: [{captureId, image, prevTags, newTags}]}]
  let redoStack: HologramUndoEntry[] = [];

  function push(type: string, records: HologramUndoRecord[]) {
    if (!records || !records.length) return;
    undoStack.push({ type, records });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = []; // discard redo on new edit (linear history)
  }

  // dir = which captured tag list to re-apply: 'prevTags' (undo) / 'newTags' (redo).
  async function apply(entry: HologramUndoEntry, dir: 'prevTags' | 'newTags') {
    if (entry.type === 'poster-tags') await deps.applyPosterTags(entry.records.map((r) => ({ key: r.key, tags: r[dir] })));
    else await deps.applyTags(entry.records.map((r) => ({ captureId: r.captureId, image: r.image, tags: r[dir] })));
  }

  // Both return whether an entry was applied (the caller toasts only then).
  async function undo() {
    const entry = undoStack.pop();
    if (!entry) return false;
    await apply(entry, 'prevTags');
    redoStack.push(entry);
    return true;
  }

  async function redo() {
    const entry = redoStack.pop();
    if (!entry) return false;
    await apply(entry, 'newTags');
    undoStack.push(entry);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    return true;
  }

  return { push, undo, redo };
}
