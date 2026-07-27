// Bulk "add tags to selection" — the write side of the selection bar's タグを追加.
// The surface is a Dialog now (islands/selection/BulkTagDialog, P2⑦); before that
// it was tag-pop's mode:'bulk', and before that the edit-overlay modal. What moved
// each time is only where the tags are staged — this module has always owned the
// commit: persistence, undo capture, re-render, toast.
//
// The staging list itself is gone from the renderer (bulk-edit.ts deleted with the
// tag-pop path): the dialog holds it in React state and hands it over once, on
// apply, so there is no module-level copy to keep in step and no refresh() push
// after every add/remove.
import { open as bulkTagOpen } from './bulk-tag.ts';
import { updateTags as postsUpdateTags } from './posts.ts';

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
  // Merge the staged tags into every selected record. Additive is the only mode
  // (no "replace the tags of N posts" UI exists), so each record keeps its own
  // tags and gains these.
  async function applyTagsToSelection(records: HologramPost[], applyTags: string[]) {
    deps.keepCurrentVisible(); // a tag edit can move a card out of an active filter
    const undoRecords = records.map((r) => ({
      captureId: r.captureId,
      image: r.image || r.video,
      prevTags: (r.tags || []).slice(),
      newTags: [...new Set([...(r.tags || []), ...applyTags])],
    }));
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
    deps.renderPosts(true); // keepLimit: selection stays put, no anim replay
    const n = records.length;
    deps.showToast(n > 1 ? deps.t('tagsSavedN', [n]) : deps.t('tagsSaved'));
  }

  function openBulkTagDialog() {
    const records = deps.selectedRecords();
    if (!records.length) return;
    bulkTagOpen({
      count: records.length,
      // Derived per keystroke from the tags staged in the dialog — the vocabulary
      // and the co-occurrence suggestions both depend on what is staged so far.
      pickerData: (tags: string[]) => deps.inspectorTagPickerData(tags, records, 'post'),
      tagLabels: {
        tagsLabel: deps.t('detailTags'),
        newTagPlaceholder: deps.t('tagNewName'),
        addBtn: deps.t('tagAddBtn'),
        noTags: deps.t('editNoTags'),
        noMatch: deps.t('tagPalNoMatch'),
        noVocab: deps.t('tagNoTags'),
        adoptSource: deps.t('editAdoptSource'),
        removeTag: deps.t('tagRemove'),
      },
      labels: {
        title: deps.t('tagSelected'),
        additiveHint: deps.t('additiveHint'),
        apply: deps.t('tagApplyN', [records.length]),
        cancel: deps.t('confirmCancel'),
      },
      onKindMenu: (tag, x, y, onChange) => deps.showKindMenu(tag, x, y, onChange),
      // `records` is captured at open time on purpose: the dialog is modal, so the
      // selection it names in "N 件に適用" cannot change while it is up.
      onApply: (tags) => void applyTagsToSelection(records, tags),
    });
  }

  return {
    openBulkTagDialog,
  };
}
