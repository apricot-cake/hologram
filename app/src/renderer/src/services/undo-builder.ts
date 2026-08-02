// In-session Undo/Redo controller (#235) — extracted from the old viewer.ts
// monolith. Mirrors inspector-builder.ts / poster-grid-builder.ts: the stack
// semantics (cap / redo discard / direction mapping / top-of-stack guard) stay in
// undo.ts — this module is its consumer and owns the side effects of actually
// re-applying a change (IPC write, grid re-render, inspector refresh) plus the
// Ctrl+Z/Ctrl+Shift+Z shortcut handler. Constructed early in orchestrator.ts
// (matching the original _undo call site, before postGrid/inspector/posterGrid
// exist) so pushUndo is available to those builders' own deps — every dep that
// reaches into a not-yet-built cluster is therefore a deferred forward reference,
// same shape as inspector-builder.ts's jumpToPoster/showToast.
//
// Appliers all share one rule: take the target's CURRENT list, drop `remove`, then
// append the members of `add` it does not already hold. Never write back a captured
// list — that is the difference between this and the snapshot model #235 rejected.
import { makeUndo, type DirectedChange, type UndoChange } from './undo.ts';
import { isVisible as panelIsVisible } from './inspector-panel.ts';
import { postIdKey } from './records.ts';
import { updateTags as postsUpdateTags } from './posts.ts';
import { applyPosterTagRecords, getPosterTags } from './tags.ts';
import { applyFolderItems as applyLibraryFolderItems } from './folders.ts';
import { restore as restorePosterAliases, type PosterAliasGroup } from './aliases.ts';

export interface UndoBuilderDeps {
  showToast(msg: unknown): void;
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  getPostById(id: string): HologramPost | undefined;
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
  getViewGroups(): HologramPostGroup[];
  // inspectedKey is an orchestrator.ts `let` (read/written outside this cluster too)
  // — this module only gets the accessor, same shape as posterReturn/
  // inspectedKey in poster-grid-builder.ts/inspector-builder.ts.
  getInspectedKey(): string | null;
  showDetail(g: HologramPostGroup): void;
  refreshPosterTagFields(key: string): void;
  // The poster-folder store is posterGrid's (pfStore) and is built after this
  // controller — a deferred forward reference like the accessors above.
  getPosterFolderStore(): HologramFolderStore | null;
  // A membership undo can add or drop cards under an active folder filter, so the
  // views that draw from it have to be told, exactly as the toggle itself does.
  onFolderMembershipChanged(): void;
  onPosterFolderMembershipChanged(): void;
  // #23 St1: a name-merge undo/redo can change which poster the currently
  // inspected one folds onto (or dissolve/grow its group), so the poster grid
  // + an open poster inspector both need telling, same shape as the two
  // membership callbacks above.
  onPosterAliasChanged(): void;
}

/** current − remove + (add it does not already hold), order-preserving. */
function nextList(current: readonly string[] | null | undefined, change: DirectedChange): string[] {
  const remove = new Set(change.remove);
  const kept = (current || []).filter((v) => !remove.has(v));
  const have = new Set(kept);
  return [...kept, ...change.add.filter((v) => !have.has(v))];
}

export function makeUndoController(deps: UndoBuilderDeps) {
  async function applyPostTags(changes: DirectedChange[]) {
    for (const c of changes) {
      const rec = deps.getPostById(c.target); // O(1) via the delta-cache map (allPosts holds the same record refs)
      // The record is the only place the CURRENT tag list lives; without it there
      // is nothing to diff against, so skip rather than write a guess.
      if (!rec) continue;
      const next = nextList(rec.tags, c);
      try {
        await postsUpdateTags(c.image || rec.image || rec.video || '', next);
      } catch {
        /* keep going — one failed write must not strand the rest of the entry */
      }
      rec.tags = next;
    }
    deps.markPostsMutated();
    deps.renderPosts(true);
    // Keep the inspector in sync if it's showing the affected group (undo isn't fired
    // while typing in the add input, so a full re-render here is safe).
    const inspectedKey = deps.getInspectedKey();
    if (panelIsVisible() && inspectedKey) {
      const fresh = deps.getViewGroups().find((g2) => postIdKey(g2.rep) === inspectedKey);
      if (fresh) deps.showDetail(fresh);
    }
  }

  // Poster-tag variant: posterTags[key] (tags.ts) is the source of truth (NOT a
  // post record), so the diff is applied against that map and an open poster
  // inspector is refreshed (mirrors applyPostTags's inspector refresh). The bulk
  // mutation + single persist live in tags.ts.
  function applyPosterTags(changes: DirectedChange[]) {
    const current = getPosterTags();
    applyPosterTagRecords(changes.map((c) => ({ key: c.target, tags: nextList(current[c.target], c) })));
    const inspectedKey = deps.getInspectedKey();
    if (panelIsVisible() && typeof inspectedKey === 'string' && inspectedKey.indexOf('poster:') === 0) {
      deps.refreshPosterTagFields(inspectedKey.slice('poster:'.length));
    }
  }

  function applyFolderItems(changes: DirectedChange[]) {
    for (const c of changes) applyLibraryFolderItems(c.target, c.add, c.remove);
    deps.onFolderMembershipChanged();
  }

  function applyPosterFolderItems(changes: DirectedChange[]) {
    const store = deps.getPosterFolderStore();
    if (!store) return;
    for (const c of changes) store.applyItems(c.target, c.add, c.remove);
    deps.onPosterFolderMembershipChanged();
  }

  // #23 St1: a poster-alias change is a full before/after GROUP SNAPSHOT, not a
  // value diff (see undo.ts's UndoChange comment for why) — `c.add` always
  // holds the snapshot to restore TO for whichever direction (undo/redo)
  // undo.ts is currently applying, so this applier only ever reads that one
  // field. A malformed payload (should not happen — this module is the only
  // writer) is skipped rather than thrown, matching every other applier's
  // "missing target -> skip" tolerance.
  function applyPosterAlias(changes: DirectedChange[]) {
    for (const c of changes) {
      const raw = c.add[0];
      if (!raw) continue;
      try {
        const payload = JSON.parse(raw) as { keys: string[]; groups: PosterAliasGroup[] };
        restorePosterAliases(payload.keys, payload.groups);
      } catch {
        /* malformed payload — nothing to restore */
      }
    }
    deps.markPostsMutated(); // invalidates buildUsers' generation-cached fold
    deps.onPosterAliasChanged();
  }

  const _undo = makeUndo({
    appliers: {
      'post-tags': applyPostTags,
      'poster-tags': applyPosterTags,
      'folder-items': applyFolderItems,
      'poster-folder-items': applyPosterFolderItems,
      'poster-alias': applyPosterAlias,
    },
  });

  /**
   * Record an edit and hand back the way to take it back, or null when the edit
   * turned out to be a no-op for every target. Callers put the returned function
   * behind a toast's "Undo"; it only fires while this entry is still the newest
   * one (undo.ts's undoIfTop), so a stale toast cannot revert someone else's edit.
   */
  function pushUndo(changes: readonly UndoChange[] | null | undefined): (() => void) | null {
    const entry = _undo.push(changes);
    if (!entry) return null;
    return () => {
      void _undo.undoIfTop(entry.id);
    };
  }

  /** The "Undo" button a toast should carry for `undoFn`, or nothing when there is none. */
  function undoAction(undoFn: (() => void) | null) {
    return undoFn ? { label: deps.t('undoAction'), onClick: undoFn } : null;
  }

  async function doUndo() {
    if (await _undo.undo()) deps.showToast(deps.t('undoDone'));
  }

  async function doRedo() {
    if (await _undo.redo()) deps.showToast(deps.t('redoDone'));
  }

  // Registration lives in the GlobalShortcuts component (app/App.tsx).
  function handleShortcutUndoKey(e: KeyboardEvent) {
    if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) return;
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (e.shiftKey) doRedo();
    else doUndo();
  }

  return { pushUndo, undoAction, doUndo, doRedo, handleShortcutUndoKey };
}
