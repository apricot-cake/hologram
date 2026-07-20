// In-session tag-edit Undo/Redo controller — extracted from viewer.ts as the
// viewer.ts decomposition's V11 slice (see memory
// corpus-react-purity-execution-map, Wave25/V11 "Undo/Redo"). Mirrors
// inspector-builder.ts (V7) / poster-grid-builder.ts (V6): the stack semantics
// (cap / redo discard / prev-next direction) stay in undo.ts (Wave1) untouched
// — this module is its consumer, replacing viewer.ts, and owns the
// viewer-side apply callbacks (re-applying a captured tag list via IPC + grid
// re-render + inspector refresh) plus the Ctrl+Z/Ctrl+Shift+Z shortcut
// handler. Constructed early in viewer.ts (matching the original _undo call
// site, before postGrid/inspector/posterGrid exist) so pushUndo is available
// to those builders' own deps — every dep that reaches into a not-yet-built
// cluster is therefore a deferred forward reference, same shape as
// inspector-builder.ts's jumpToPoster/showToast.
import { makeUndo } from './undo.ts';
import { postIdKey } from './records.ts';
import { updateTags as postsUpdateTags } from './posts.ts';
import { applyPosterTagRecords } from './tags.ts';

export interface UndoBuilderDeps {
  showToast(msg: unknown): void;
  getPostById(id: string): HologramPost | undefined;
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
  getViewGroups(): HologramPostGroup[];
  // inspectedKey is a viewer.ts `let` (read/written outside this cluster too)
  // — this module only gets the accessor, same shape as posterReturn/
  // inspectedKey in poster-grid-builder.ts/inspector-builder.ts.
  getInspectedKey(): string | null;
  showDetail(g: HologramPostGroup): void;
  refreshPosterTagFields(key: string): void;
}

export function makeUndoController(deps: UndoBuilderDeps) {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;

  async function applyTagUndo(records: { captureId?: string; image?: string; tags: string[] }[]) {
    for (const r of records) {
      try {
        await postsUpdateTags(r.image || '', r.tags);
      } catch {}
      const rec = r.captureId ? deps.getPostById(r.captureId) : undefined; // O(1) via the delta-cache map (allPosts holds the same record refs)
      if (rec) rec.tags = r.tags.slice();
    }
    deps.markPostsMutated();
    deps.renderPosts(true);
    // Keep the inspector in sync if it's showing the affected group (undo isn't fired
    // while typing in the add input, so a full re-render here is safe).
    const inspectedKey = deps.getInspectedKey();
    if (!byId('postDetail').hidden && inspectedKey) {
      const fresh = deps.getViewGroups().find((g2) => postIdKey(g2.rep) === inspectedKey);
      if (fresh) deps.showDetail(fresh);
    }
  }

  // Poster-tag variant: posterTags[key] (tags.ts) is the source of truth (NOT a
  // post record), so undo/redo re-applies the captured tag list per poster key
  // and keeps an open poster inspector in sync (mirrors applyTagUndo's inspector
  // refresh). The bulk mutation + persist live in tags.ts.
  async function applyPosterTagUndo(records: { key?: string; tags: string[] }[]) {
    // key is always populated for poster-tags undo entries at runtime (pushUndo's
    // caller always supplies one); the narrow just satisfies applyPosterTagRecords'
    // stricter (key required) signature.
    applyPosterTagRecords(records.filter((r): r is { key: string; tags: string[] } => !!r.key));
    const inspectedKey = deps.getInspectedKey();
    if (!byId('postDetail').hidden && typeof inspectedKey === 'string' && inspectedKey.indexOf('poster:') === 0) {
      deps.refreshPosterTagFields(inspectedKey.slice('poster:'.length));
    }
  }

  const _undo = makeUndo({
    applyTags: (records) => applyTagUndo(records),
    applyPosterTags: (records) => applyPosterTagUndo(records),
  });
  const pushUndo = _undo.push;

  async function doUndo() {
    if (await _undo.undo()) deps.showToast('Undo');
  }

  async function doRedo() {
    if (await _undo.redo()) deps.showToast('Redo');
  }

  // Registration lives in the GlobalShortcuts component (app/islands/app/App.tsx).
  function handleShortcutUndoKey(e: KeyboardEvent) {
    if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) return;
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (e.shiftKey) doRedo();
    else doUndo();
  }

  return { pushUndo, doUndo, doRedo, handleShortcutUndoKey };
}
