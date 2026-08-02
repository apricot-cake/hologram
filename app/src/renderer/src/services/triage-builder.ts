// Triage mode's business logic (#46) — the deps-requiring half of triage.ts's pure
// state. Mirrors undo-builder.ts / inspector-builder.ts: leaf modules with no
// cross-cutting state of their own (folders.ts, posts.ts, tags.ts) are imported
// directly; only orchestrator-owned closures (pushUndo, getAllPosts, groupRecords,
// markPostsMutated, renderPosts) arrive as injected deps.
//
// === Queue ===
// A group qualifies exactly when its rep record is untagged AND not a member of any
// static folder (folders.staticFolders() — the only folders that can hold posts;
// saved searches never do). Built with postGrid's OWN grouping (groupRecords), so a
// multi-image post triages as the one card it is everywhere else — tagging or
// foldering it here writes every record of the group, the same unit
// inspector-builder.ts's applyInspectorTagChange uses.
//
// === Undo (#46 x #235) ===
// #235's diff-based undo/redo stack (undo-builder.ts) is reused as-is for the DATA
// half of a tag/folder action: applyTag/applyFolder call the injected pushUndo and
// keep the returned closure. Backspace here is NOT the same thing as Ctrl+Z though —
// it is scoped to exactly the one action triage.ts's lastAction remembers, and it
// also has to move the on-screen cursor back a step, which #235's stack knows
// nothing about (a skip has no data to undo at all). So triage keeps its own
// single-slot "last action" (previousIndex + the #235 undo closure when there is
// one) rather than asking the stack "what's on top" — the two mechanisms compose
// instead of one subsuming the other, per the Issue's decision to confirm this at
// implementation time. Ctrl+Z still works while triage is open (GlobalShortcuts
// never stops listening) and reaches the SAME stack entry, since applyTag/
// applyFolder push through the one shared pushUndo.
import { applyFolderItems, notifyChanged as notifyFolderChanged, onChange as foldersOnChange, staticFolders } from './folders.ts';
import { subscribe as subscribePostsData } from './posts-data.ts';
import { updateTags as postsUpdateTags } from './posts.ts';
import * as triage from './triage.ts';
import type { UndoChange } from './undo.ts';

export interface TriageMedia {
  src: string;
  video?: boolean;
  alt?: string;
  poster?: string;
}

export interface TriageBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  /** The SAME gallery instance image-tab/lightbox read (records.ts's makeGallery) —
   * triage shows its first page (no paging/zoom in v1; see TriageMode.tsx). */
  buildGroupGalleryItems(g: HologramPostGroup): TriageMedia[];
  getAllPosts(): HologramPost[];
  /** postGrid's groupRecords — the SAME grouping the library grid uses. */
  groupRecords(list: HologramPost[]): HologramPostGroup[];
  pushUndo(changes: readonly UndoChange[]): (() => void) | null;
  getPostById(id: string): HologramPost | undefined;
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
}

function isInAnyFolder(captureId: string | null | undefined): boolean {
  if (!captureId) return false;
  return staticFolders().some((f) => f.items.includes(captureId));
}

/** The toolbar badge's re-render trigger — either a library edit or a folder
 * membership change can move a post in or out of the queue. No deps needed (both
 * sources are leaf modules), so components import this directly rather than
 * through an orchestrator.ts binding, same as they'd import lightbox.ts's own
 * subscribe(). foldersOnChange has no unsubscribe (folders.ts never offered one —
 * every other caller lives with that too, since nothing here ever unmounts). */
export function subscribeQueueCount(cb: () => void): () => void {
  const unsub = subscribePostsData(cb);
  foldersOnChange(cb);
  return unsub;
}

export function makeTriage(deps: TriageBuilderDeps) {
  function qualifies(p: HologramPost): boolean {
    return !(p.tags || []).length && !isInAnyFolder(p.captureId);
  }

  /** Every untagged, no-folder post, grouped — the queue a fresh openTriage() snapshots. */
  function buildQueue(): HologramPostGroup[] {
    return deps.groupRecords(deps.getAllPosts()).filter((g) => qualifies(g.rep));
  }

  /** The toolbar badge / empty-state gate: how many items triage would open with right now. */
  function queueCount(): number {
    return buildQueue().length;
  }

  function openTriage(): void {
    triage.openWith(buildQueue());
  }

  function closeTriage(): void {
    triage.close();
  }

  function advance(action: Omit<TriageLastActionInput, 'previousIndex'>): void {
    const st = triage.get();
    triage.setLastAction({ ...action, previousIndex: st.idx });
    triage.setIdx(st.idx + 1);
  }

  /** Add ONE tag to every record of the current group, persist, record undo, advance. */
  async function applyTag(tag: string): Promise<void> {
    const g = triage.current();
    const clean = (tag || '').trim();
    if (!g || !clean) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    const changes: UndoChange[] = [];
    for (const r of recs) {
      const prev: string[] = (r.tags || []).slice();
      if (prev.includes(clean)) continue; // already carries it somehow — nothing to add
      const next = [...prev, clean];
      try {
        await postsUpdateTags(r.image || r.video || r.file, next);
      } catch {
        /* keep going — one failed write must not strand the rest of the group */
      }
      const rec = deps.getPostById(r.captureId);
      if (rec) rec.tags = next;
      changes.push({ kind: 'post-tags', target: r.captureId, image: r.image || r.video || r.file, added: [clean], removed: [] });
    }
    if (!changes.length) return;
    const undo = deps.pushUndo(changes);
    deps.markPostsMutated();
    deps.renderPosts(true);
    advance({ kind: 'tag', label: deps.t('triageLastTag', [clean]), undo: undo || undefined });
  }

  /** Add the current group's rep to folder `folderId`, persist, record undo, advance. */
  function applyFolder(folderId: string): void {
    const g = triage.current();
    const cid = g && g.rep && g.rep.captureId;
    if (!g || !cid) return;
    const f = staticFolders().find((x) => x.id === folderId);
    if (!f) return;
    const res = applyFolderItems(folderId, [cid], null);
    if (!res.added.length) return; // already a member — nothing moved, nothing to advance past silently
    const undo = deps.pushUndo([{ kind: 'folder-items', target: folderId, added: res.added, removed: res.removed }]);
    notifyFolderChanged('membership');
    deps.renderPosts(true);
    advance({ kind: 'folder', label: deps.t('triageLastFolder', [f.name]), undo: undo || undefined });
  }

  /** Leave the current item untouched and move on — it stays untagged/unfoldered for next time. */
  function skip(): void {
    const g = triage.current();
    if (!g) return;
    advance({ kind: 'skip', label: deps.t('triageLastSkip') });
  }

  /** Backspace: take back exactly the last action (data + cursor), see the file header. */
  function undoLast(): void {
    const last = triage.get().lastAction;
    if (!last) return;
    last.undo?.();
    triage.setIdx(last.previousIndex);
    triage.setLastAction(null);
  }

  /** The current item's first gallery page, or null when there's nothing to show. */
  function currentMedia(): TriageMedia | null {
    const g = triage.current();
    if (!g) return null;
    return deps.buildGroupGalleryItems(g)[0] || null;
  }

  // Registration lives in triage/index.tsx's own effect (scoped to while triage is
  // open), mirroring image-tab/index.tsx's own ←/→ listener rather than
  // GlobalShortcuts — triage owns a keyset (1-9/Space/Backspace) that has no
  // business firing while the grid is what's on screen.
  function handleTriageKey(e: KeyboardEvent): void {
    if (!triage.isOpen()) return;
    const t = e.target as HTMLElement | null;
    const typing = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
    if (e.key === 'Backspace' && !typing) {
      e.preventDefault();
      undoLast();
      return;
    }
    if (typing) return; // the tag field owns its own Enter/typing — see TriageMode.tsx
    if (e.key === ' ') {
      e.preventDefault();
      skip();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const tag = triage.get().pinnedTags[Number(e.key) - 1];
      if (tag) void applyTag(tag);
    }
  }

  return { queueCount, openTriage, closeTriage, applyTag, applyFolder, skip, undoLast, handleTriageKey, currentMedia, listFolders: () => staticFolders() };
}

type TriageLastActionInput = { kind: 'tag' | 'folder' | 'skip'; label: string; previousIndex: number; undo?: () => void };
