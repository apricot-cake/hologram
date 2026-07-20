// Bulk "add tags to selection" — extracted from viewer.ts as the viewer.ts
// decomposition's V9 slice (see memory corpus-react-purity-execution-map,
// Wave23/V9 "一括編集オーバーレイ"). Mirrors inspector-builder.ts's tag-pop
// wiring (Issue #22): openTagPopForSelection opens the SAME tag-pop singleton in
// mode:'bulk' instead of the retired edit-overlay.ts modal — records/tags/
// additive-flag staging (bulk-edit.ts, Wave2) and the onApply persistence/undo
// flow are unchanged, only the surface they render into moved.
import { open, close, getRecords, getTags, isAdditive, add, remove, toggle } from './bulk-edit.ts';
import { open as tagPopOpen, refresh as tagPopRefresh, close as tagPopClose, get as tagPopGet } from './tag-pop.ts';
import { updateTags as postsUpdateTags } from './posts.ts';

// Sentinel forKey for the bulk pop — distinct from any real post/poster key
// (postIdKey values and 'poster:'+key never start with this), so the toggle/
// dismiss-guard checks shared with inspector-builder.ts/poster-grid-builder.ts
// (tagPopGet()?.forKey === ...) can't collide with a single-card pop.
const BULK_FOR_KEY = '__bulk-selection__';

export interface BulkEditBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  showToast(msg: unknown): void;
  showKindMenu(tag: string, x: number, y: number, onChange: () => void): void;
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  pushUndo(kind: string, records: HologramUndoRecord[]): void;
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
  keepCurrentVisible(): void;
  getPostById(id: string): HologramPost | undefined;
  selectedRecords(): HologramPost[];
}

export function makeBulkEdit(deps: BulkEditBuilderDeps) {
  // Recompute the bulk pop's tag fields (chips + picker vocab/cooc) after a
  // staging-list mutation. Not persisted yet — onApply (below) is the only thing
  // that writes the staged tags out to the records.
  function refreshTagPopFields() {
    const tags = getTags();
    tagPopRefresh({ tags, ...deps.inspectorTagPickerData(tags, getRecords(), 'post') });
  }

  // Guarded by forKey — same "stale close" pattern as inspector-builder.ts's
  // dismissTagPopFor: a card's single-mode pop may have already superseded this
  // one via the same singleton bridge.
  function dismissBulkTagPop() {
    if (tagPopGet()?.forKey !== BULK_FOR_KEY) return;
    close(); // discard the staging list — Cancel/outside-click never wrote anything
    tagPopClose();
  }

  function openTagPopForSelection(anchorRect: HologramAnchorRect) {
    if (tagPopGet()?.forKey === BULK_FOR_KEY) {
      dismissBulkTagPop(); // re-click "タグを追加" while already open → close
      return;
    }
    const records = deps.selectedRecords();
    if (!records.length) return;
    open(records);
    const tags = getTags();
    tagPopOpen({
      anchorRect,
      mode: 'bulk',
      forKey: BULK_FOR_KEY,
      tags,
      ...deps.inspectorTagPickerData(tags, records, 'post'),
      tagLabels: {
        tagsLabel: deps.t('detailTags'),
        newTagPlaceholder: deps.t('tagNewName'),
        addBtn: deps.t('tagAddBtn'),
        noTags: deps.t('editNoTags'),
        noMatch: deps.t('tagPalNoMatch'),
        noVocab: deps.t('tagNoTags'),
        adoptSource: deps.t('editAdoptSource'),
      },
      applyLabel: deps.t('tagApplyN', [records.length]),
      additiveHint: deps.t('additiveHint'),
      onTagAdd: (tag: string) => {
        add(tag);
        refreshTagPopFields();
      },
      onTagRemove: (tag: string) => {
        remove(tag);
        refreshTagPopFields();
      },
      onTagToggle: (tag: string) => {
        toggle(tag);
        refreshTagPopFields();
      },
      onTagContextMenu: (tag: string, x: number, y: number) => {
        deps.showKindMenu(tag, x, y, refreshTagPopFields);
      },
      onDismiss: dismissBulkTagPop,
      onApply: async () => {
        const editingRecords = getRecords();
        if (!editingRecords.length) {
          dismissBulkTagPop();
          return;
        }
        deps.keepCurrentVisible(); // removing a tag can un-match an active tag filter
        const applyTags = [...getTags()];
        const editAdditive = isAdditive();
        // Capture before-state for undo, then persist.
        const undoRecords = editingRecords.map((r) => {
          const newTags = editAdditive ? [...new Set([...(r.tags || []), ...applyTags])] : applyTags.slice();
          return { captureId: r.captureId, image: r.image || r.video, prevTags: (r.tags || []).slice(), newTags };
        });
        for (const u of undoRecords) {
          try {
            await postsUpdateTags(u.image, u.newTags);
          } catch {
            /* keep going */
          }
          const rec = deps.getPostById(u.captureId); // O(1) lookup; allPosts shares the same record refs
          if (rec) rec.tags = u.newTags.slice();
        }
        deps.pushUndo('tags', undoRecords);
        deps.markPostsMutated();
        deps.renderPosts(true); // keepLimit: selection (if any) stays put, no anim replay
        const n = editingRecords.length;
        close();
        tagPopClose();
        deps.showToast(n > 1 ? deps.t('tagsSavedN', [n]) : deps.t('tagsSaved'));
      },
    });
  }

  return {
    openTagPopForSelection,
  };
}
