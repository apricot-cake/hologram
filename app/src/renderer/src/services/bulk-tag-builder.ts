// Bulk "add tags to selection" — the write side of the selection bar's "Add tags".
// The surface is a Dialog (selection/BulkTagDialog, P2⑦); before that it was
// tag-pop's mode:'bulk', and before that the edit-overlay modal. What moved each
// time is only where the tags are staged — this module has always owned the
// commit: persistence, undo capture, re-render, toast.
//
// The staging list is not in the renderer at all any more: the dialog holds it in
// React state and hands it over once, on apply, so there is no module-level copy to
// keep in step and no refresh() push after every add/remove. That module (and the
// whole "tagging session" surface it served) is retired — P2⑬ — and this file
// dropped the bulk-edit name with it. Tagging many posts is a composition now:
// filter to "No tags", arrow through the results, edit tags in the inspector. This
// Dialog is only the shortcut for "same tags, all of these at once".
import { open as bulkTagOpen } from './bulk-tag.ts';
import { updateTags as postsUpdateTags } from './posts.ts';
import type { UndoChange } from './undo.ts';
import type { NotifyAction } from './ui.ts';

export interface BulkTagBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  showToast(msg: unknown, action?: NotifyAction | null): void;
  showKindMenu(tag: string, x: number, y: number, onChange: () => void): void;
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  pushUndo(changes: readonly UndoChange[]): (() => void) | null;
  undoAction(undoFn: (() => void) | null): NotifyAction | null;
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
  keepCurrentVisible(): void;
  getPostById(id: string): HologramPost | undefined;
  selectedRecords(): HologramPost[];
}

export function makeBulkTag(deps: BulkTagBuilderDeps) {
  // Merge the staged tags into every selected record. Additive is the only mode
  // (no "replace the tags of N posts" UI exists), so each record keeps its own
  // tags and gains these.
  async function applyTagsToSelection(records: HologramPost[], applyTags: string[]) {
    deps.keepCurrentVisible(); // a tag edit can move a card out of an active filter
    // Only the tags a record did NOT already carry are this record's share of the
    // edit (#235). A selection that partly held a tag already must not lose it when
    // the operation is undone — so the ones that were already there are not recorded.
    const changes: UndoChange[] = [];
    for (const r of records) {
      const prev = r.tags || [];
      const added = [...new Set(applyTags)].filter((tag) => !prev.includes(tag));
      if (!added.length) continue;
      const next = [...prev, ...added];
      try {
        // #236: r.file is the third leg — a collected item's IPC identifier
        // (main's baseOf() strips whichever extension it carries the same way).
        await postsUpdateTags(r.image || r.video || r.file, next);
      } catch {
        /* keep going */
      }
      const rec = deps.getPostById(r.captureId); // O(1) lookup; allPosts shares the same record refs
      if (rec) rec.tags = next.slice();
      changes.push({ kind: 'post-tags', target: r.captureId, image: r.image || r.video || r.file, added, removed: [] });
    }
    const undoFn = deps.pushUndo(changes);
    deps.markPostsMutated();
    deps.renderPosts(true); // keepLimit: selection stays put, no anim replay
    const n = records.length;
    deps.showToast(n > 1 ? deps.t('tagsSavedN', [n]) : deps.t('tagsSaved'), deps.undoAction(undoFn));
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
      // selection it names in "Apply to N" cannot change while it is up.
      onApply: (tags) => void applyTagsToSelection(records, tags),
    });
  }

  return {
    openBulkTagDialog,
  };
}
