// Bulk "add tags to selection" overlay — extracted from viewer.ts as the
// viewer.ts decomposition's V9 slice (see memory
// corpus-react-purity-execution-map, Wave23/V9 "一括編集オーバーレイ"). Mirrors
// inspector-builder.ts (V7) / selection-builder.ts (V8): open/close chrome +
// the onSave persistence/undo flow move here. bulk-edit.ts (Wave2, the staging
// list of records/tags/additive) and edit-overlay.ts (Wave3, the
// open/refresh/close/get/subscribe bridge to the EditOverlay React island)
// stay untouched — this module is their consumer, replacing viewer.ts.
// selectedRecords (selection-builder.ts, V8) is a dep, same shape as the
// deferred forward-reference selection-builder.ts itself takes for
// openTagSelectedOverlay.
import { open, close, getRecords, getTags, isAdditive, add, remove, toggle } from './bulk-edit.ts';
import { open as editOverlayOpen, refresh as editOverlayRefresh, close as editOverlayClose } from './edit-overlay.ts';
import { updateTags as postsUpdateTags } from './posts.ts';

export interface BulkEditBuilderDeps {
  MSG: { [k: string]: any };
  showToast(msg: unknown): void;
  showKindMenu(tag: string, x: number, y: number, onChange: () => void): void;
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  pushUndo(kind: string, records: CorpusUndoRecord[]): void;
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
  keepCurrentVisible(): void;
  getPostById(id: string): CorpusPost | undefined;
  selectedRecords(): CorpusPost[];
}

export function makeBulkEdit(deps: BulkEditBuilderDeps) {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;

  // Recompute the bulk edit modal's tag fields (chips + picker vocab/cooc) after a
  // staging-list mutation. Not persisted yet — Save (see openTagSelectedOverlay
  // below) is the only thing that writes the staged tags out to the records.
  function refreshEditOverlayFields() {
    const tags = getTags();
    editOverlayRefresh({ tags, ...deps.inspectorTagPickerData(tags, getRecords(), 'post') });
  }

  function closeEditOverlay() {
    close();
    byId('editOverlay').classList.remove('show');
    editOverlayClose();
  }

  // タグを追加: reuse the edit overlay in ADDITIVE mode — entered tags are
  // merged into each selected record's existing tags (nothing is replaced).
  function openTagSelectedOverlay() {
    const records = deps.selectedRecords();
    if (!records.length) return;
    open(records);
    const tags = getTags();
    editOverlayOpen({
      titleLabel: deps.MSG.tagSelectedTitle,
      tags,
      ...deps.inspectorTagPickerData(tags, records, 'post'),
      tagLabels: {
        tagsLabel: deps.MSG.detailTags,
        newTagPlaceholder: deps.MSG.tagNewName,
        addBtn: deps.MSG.tagAddBtn,
        noTags: deps.MSG.editNoTags,
        noMatch: deps.MSG.tagPalNoMatch,
        noVocab: deps.MSG.tagNoTags,
        adoptSource: deps.MSG.editAdoptSource,
      },
      cancelLabel: deps.MSG.confirmCancel,
      saveLabel: deps.MSG.save,
      onCancel: closeEditOverlay,
      onTagAdd: (tag: string) => {
        add(tag);
        refreshEditOverlayFields();
      },
      onTagRemove: (tag: string) => {
        remove(tag);
        refreshEditOverlayFields();
      },
      onTagToggle: (tag: string) => {
        toggle(tag);
        refreshEditOverlayFields();
      },
      onTagContextMenu: (tag: string, x: number, y: number) => {
        deps.showKindMenu(tag, x, y, refreshEditOverlayFields);
      },
      onSave: async () => {
        const editingRecords = getRecords();
        if (!editingRecords.length) {
          closeEditOverlay();
          return;
        }
        deps.keepCurrentVisible(); // removing a tag can un-match an active tag filter
        const tags = [...getTags()];
        const editAdditive = isAdditive();
        // Capture before-state for undo, then persist.
        const undoRecords = editingRecords.map((r) => {
          const newTags = editAdditive ? [...new Set([...(r.tags || []), ...tags])] : tags.slice();
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
        closeEditOverlay();
        deps.showToast(n > 1 ? deps.MSG.tagsSavedN(n) : deps.MSG.tagsSaved);
      },
    });
    byId('editOverlay').classList.add('show');
  }

  return {
    closeEditOverlay,
    openTagSelectedOverlay,
  };
}
