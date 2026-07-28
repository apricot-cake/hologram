'use strict';

// The renderer-delta primitive for the DB-backed post list.
//
// The window holds the full post set and main ships only what moved, so a
// refresh after a capture costs one small IPC message instead of re-serializing
// the whole library (~450ms at 9k records). Main owns the "what did I last
// deliver" state; this stays a pure function so it unit-tests directly.
//
// The stamp is posts.updatedAt straight out of the DB. Before #302 it was the
// sidecar file's mtimeMs, because the DB was a derived index and a producer
// could edit a record without bumping updatedAt; now every write goes through
// the DB itself (writePost always sets updatedAt), so the row's own stamp is
// the change signal and no filesystem bookkeeping is involved.

// lastSent / stamps: captureId -> updatedAt. added = records that are new or
// whose stamp moved; removed = ids that are no longer present.
function computeDelta<T extends { captureId: string }>(lastSent: Map<string, unknown>, posts: T[], stamps: Map<string, unknown>) {
  const added: T[] = [];
  for (const p of posts) {
    if (lastSent.get(p.captureId) !== stamps.get(p.captureId)) added.push(p);
  }
  const removed: string[] = [];
  for (const id of lastSent.keys()) if (!stamps.has(id)) removed.push(id);
  return { added, removed };
}

export { computeDelta };
