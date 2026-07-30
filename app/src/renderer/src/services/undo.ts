// In-session undo/redo stack (#235). Volatile by design: it lives for as long as
// the window does, and there is no persistent per-post change history (the reasons
// are in #235's re-proposal guard).
//
// The stack records the DIFF an edit actually produced — per target, the values it
// added and the values it removed — and undo re-applies that diff inverted against
// whatever the target holds NOW. Two consequences that are the whole point:
//
//   - an edit that changed nothing for a target is never recorded (bulk-tagging a
//     selection where some items already carry the tag), so undo cannot strip a
//     value the operation did not put there;
//   - a later, unrelated edit to the same target survives being undone past,
//     because nothing here writes back a whole captured field.
//
// Both are why the rejected alternatives (whole-snapshot restore / naive inverse
// operation) are not used — see #235.
//
// A re-added value lands at the end of the target's list rather than its old
// index: position is not part of the diff, and reconstructing it would mean
// carrying the snapshot this model exists to avoid.
//
// The module owns the stack semantics only (cap, redo discard on a new edit,
// direction mapping, top-of-stack guard). Actually writing a change is the
// caller's job and arrives as the `appliers` dep, one per kind — undo.ts touches
// no DOM and no IPC.

const UNDO_MAX = 50;

/** What a recorded change is about: which set of values, on which kind of target. */
export type UndoKind = 'post-tags' | 'poster-tags' | 'folder-items' | 'poster-folder-items';

/**
 * One target's share of an edit. `target` is a captureId (post-tags), a poster key
 * (poster-tags) or a folder id (…-items); `image` rides along for post-tags only,
 * because update-tags is keyed by file name rather than captureId. `added`/`removed`
 * are the values the edit REALLY moved — an empty pair is not a change.
 */
export type UndoChange = {
  kind: UndoKind;
  target: string;
  image?: string;
  added: string[];
  removed: string[];
};

/** A change already pointed at a direction: add these, remove those, right now. */
export type DirectedChange = { target: string; image?: string; add: string[]; remove: string[] };

export type UndoEntry = { id: number; changes: UndoChange[] };

export type UndoAppliers = { [K in UndoKind]: (changes: DirectedChange[]) => Promise<void> | void };

const uniq = (list: readonly string[] | null | undefined) => [...new Set((list || []).filter((v): v is string => typeof v === 'string'))];

/**
 * Drop the no-ops and anything self-cancelling. A value listed as both added and
 * removed cannot be inverted coherently, so it leaves both sides rather than being
 * guessed at.
 */
function normalize(changes: readonly UndoChange[] | null | undefined): UndoChange[] {
  const out: UndoChange[] = [];
  for (const c of changes || []) {
    if (!c || !c.target) continue;
    const added = uniq(c.added);
    const removed = uniq(c.removed);
    const both = new Set(added.filter((v) => removed.includes(v)));
    const a = added.filter((v) => !both.has(v));
    const r = removed.filter((v) => !both.has(v));
    if (!a.length && !r.length) continue;
    out.push({ kind: c.kind, target: c.target, ...(c.image ? { image: c.image } : {}), added: a, removed: r });
  }
  return out;
}

export function makeUndo(deps: { appliers: UndoAppliers }) {
  const undoStack: UndoEntry[] = [];
  let redoStack: UndoEntry[] = [];
  let seq = 0;

  /**
   * Record an edit. Returns the entry (so a toast can hold on to its id), or null
   * when nothing survived normalization — null is the caller's signal that there is
   * nothing to offer 「元に戻す」 for.
   */
  function push(changes: readonly UndoChange[] | null | undefined): UndoEntry | null {
    const normalized = normalize(changes);
    if (!normalized.length) return null;
    const entry: UndoEntry = { id: ++seq, changes: normalized };
    undoStack.push(entry);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = []; // linear history: a new edit discards the redo branch
    return entry;
  }

  async function apply(entry: UndoEntry, dir: 'undo' | 'redo') {
    // One applier call per kind, not per change: every applier persists a whole
    // blob (the folders array, the poster-tags map), so batching keeps an N-target
    // undo to a single write instead of N.
    const byKind = new Map<UndoKind, DirectedChange[]>();
    for (const c of entry.changes) {
      const image = c.image ? { image: c.image } : {};
      const directed: DirectedChange = dir === 'undo' ? { target: c.target, ...image, add: c.removed, remove: c.added } : { target: c.target, ...image, add: c.added, remove: c.removed };
      const list = byKind.get(c.kind);
      if (list) list.push(directed);
      else byKind.set(c.kind, [directed]);
    }
    for (const [kind, changes] of byKind) {
      const applier = deps.appliers[kind];
      if (applier) await applier(changes);
    }
  }

  /** The entry Ctrl+Z would take next — the toast's 「元に戻す」 checks this to stay honest. */
  function peek(): UndoEntry | null {
    return undoStack.length ? undoStack[undoStack.length - 1] : null;
  }

  // Both return the entry that was applied, or null when there was nothing to do
  // (the caller toasts only on an entry).
  async function undo(): Promise<UndoEntry | null> {
    const entry = undoStack.pop();
    if (!entry) return null;
    await apply(entry, 'undo');
    redoStack.push(entry);
    return entry;
  }

  async function redo(): Promise<UndoEntry | null> {
    const entry = redoStack.pop();
    if (!entry) return null;
    await apply(entry, 'redo');
    undoStack.push(entry);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    return entry;
  }

  /**
   * The toast's 「元に戻す」: undo the entry that toast was raised for, and only while
   * it is still the newest one. A toast outlives its operation by a few seconds, so
   * without this guard a click landing after one more edit would revert that other
   * edit instead — the exact "undo destroyed something else" failure the diff model
   * exists to prevent. Once it is no longer on top the button is a no-op, and Ctrl+Z
   * stays the way back.
   */
  async function undoIfTop(id: number): Promise<UndoEntry | null> {
    const top = peek();
    if (!top || top.id !== id) return null;
    return undo();
  }

  return { push, undo, redo, undoIfTop, peek };
}
