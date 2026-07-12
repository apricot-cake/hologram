// Card selection + selection-bar bulk actions — extracted from viewer.ts as the
// viewer.ts decomposition's V8 slice (see memory corpus-react-purity-execution-map,
// Wave22/V8 "選択・選択バー一括操作"). Mirrors inspector-builder.ts (V7) /
// post-grid-builder.ts (V5): the pure logic moves here, DOM event registration
// (addEventListener calls on #postGrid/#selectionBar) stays in viewer.ts, which
// just wires the returned functions in. selection.ts (Wave10, the corpusStore-backed
// selectedSet/anchor bridge) stays untouched — this module is one of its consumers
// (the selection-bar island's own model derivation is the other, unaffected here).
// タグを追加 (openTagPopForSelection) is bulk-edit-builder.ts territory (V9/Wave23,
// re-targeted at tag-pop for Issue #22). It's constructed right after this module
// in viewer.ts (needs this module's own selectedRecords), so this module only
// calls it via a deferred dep, same shape as jumpToPoster/showToast forward-
// references in inspector-builder.ts.
import * as selection from './selection.ts';
import * as folders from './folders.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { postIdKey } from './records.ts';
import { deletePost } from './posts.ts';
import { open as confirmOpen } from './confirm.ts';
import { isOpen as settingsIsOpen } from './settings.ts';

export interface SelectionBarDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  showToast(msg: unknown): void;
  getViewGroups(): CorpusPostGroup[];
  getManualGroups(): string[][];
  setManualGroups(groups: string[][]): void;
  markPostsMutated(): void;
  renderPosts(inPlace?: boolean): void;
  loadPosts(keepLimit?: boolean): Promise<void>;
  persistManual(): void;
  showFoldMenu(g: CorpusPostGroup, x: number, y: number): void;
  // openTagPopForSelection lives in bulk-edit-builder.ts (V9/Wave23) — a
  // deferred dep, same shape as jumpToPoster/showToast in inspector-builder.ts.
  openTagPopForSelection(anchorRect: CorpusAnchorRect): void;
  // browseMode is a viewer.ts `let` (read/written outside this cluster too) — a
  // getter since its value changes over the module's lifetime.
  getBrowseMode(): string;
}

export function makeSelectionBar(deps: SelectionBarDeps) {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const closestOf = (e: Event, sel: string) => {
    const t = e.target as HTMLElement | null;
    return t instanceof Element ? (t.closest(sel) as HTMLElement | null) : null;
  };

  // Toggle a card in/out of the selection; Shift additionally selects the range
  // from the last-selected card (anchor), Google-Photos style.
  function toggleCardSelection(card: HTMLElement, shiftKey: boolean) {
    const idx = Number.parseInt(card.dataset.index ?? '', 10);
    const key = card.dataset.key as string;
    selection.toggle(idx, key, shiftKey, deps.getViewGroups(), postIdKey);
    syncSelectionClasses(); // class-only: don't rebuild the grid (was reloading every visible image)
    updateSelectionBar();
  }
  // Toggle .selecting on the grid container (viewer-owned, static). Per-card
  // .selected is no longer pushed through here — the grid island's Cell reads
  // corpusStore's 'selectedSet' directly (selection.toggle already
  // wrote the fresh snapshot), so it re-renders on its own the moment the store changes.
  function syncSelectionClasses() {
    byId('postGrid').classList.toggle('selecting', selection.size() > 0);
  }

  // Every record of every selected group (bulk actions operate on records).
  function selectedRecords() {
    return selection.selectedRecords(deps.getViewGroups(), postIdKey);
  }

  function clearSelection() {
    selection.clear();
    syncSelectionClasses(); // class-only (callers that change content re-render themselves)
    updateSelectionBar();
  }

  // #selectionBar's container show/hide — the ONE thing that stays viewer's (container
  // chrome). The buttons/count/labels are self-derived by the selection-bar island
  // straight from corpusStore's 'selectedSet' + 'postGroups' (P4-B slice⑱) — every
  // selection.ts mutation site still calls this to keep the container's
  // visibility in sync (the island re-renders on its own via the store subscription).
  function updateSelectionBar() {
    byId('selectionBar').style.display = selection.size() > 0 ? '' : 'none';
  }

  // Manual grouping: merge every record of the selected cards into one persisted
  // group (manual-groups.json). Members are first removed from any existing
  // manual group so a record never belongs to two groups.
  function groupSelected() {
    const members = selection.selectedGroups(deps.getViewGroups(), postIdKey).flatMap((g: CorpusPostGroup) => g.records.map((r) => r.captureId).filter(Boolean));
    if (members.length < 2) return;
    const nextGroups = deps
      .getManualGroups()
      .map((grp) => grp.filter((c) => !members.includes(c)))
      .filter((grp) => grp.length > 1);
    nextGroups.push(members);
    deps.setManualGroups(nextGroups);
    deps.persistManual();
    deps.markPostsMutated(); // grouping changed viewGroups: bump the generation so the load-more group cache + fast-path both rebuild
    // Grouping changed viewGroups → a real re-render is needed (clearSelection is now
    // class-only). Clear first so the rebuild shows no stale selection.
    selection.clear();
    deps.renderPosts(true);
    updateSelectionBar();
    deps.showToast(deps.t('grouped'));
  }

  function toggleSelectAll() {
    selection.toggleAll(deps.getViewGroups(), postIdKey);
    syncSelectionClasses();
    updateSelectionBar();
  }

  // Ctrl/Cmd+A selects every visible (filtered) card. Left to the browser when
  // typing in a field or when a modal/overlay is open (native select-all there).
  // Registration lives in the GlobalShortcuts component (app/islands/app/App.tsx).
  function handleShortcutSelectAllKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || (e.key || '').toLowerCase() !== 'a') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('.confirm-overlay.show') || lightboxIsOpen()) return;
    if (settingsIsOpen()) return;
    if (!byId('ivFolderModal').hidden) return;
    if (deps.getBrowseMode() !== 'posts') return; // select-all is post-grid only (posters/collections excluded)
    if (deps.getViewGroups().length === 0) return;
    e.preventDefault();
    selection.selectAll(deps.getViewGroups(), postIdKey);
    deps.renderPosts(true);
    updateSelectionBar();
  }

  function requestDeleteSelected() {
    if (selection.size() === 0) return;
    confirmOpen({
      message: deps.t('confirmDeleteSelected', [selection.size()]),
      okLabel: deps.t('confirmOk'),
      cancelLabel: deps.t('confirmCancel'),
      onOk: async () => {
        // Bulk delete selected groups — every record of each selected group.
        const toDelete = selection.selectedRecords(deps.getViewGroups(), postIdKey);
        const count = toDelete.length;
        for (const p of toDelete) await deletePost(p.image || p.video);
        selection.clear();
        updateSelectionBar();
        await deps.loadPosts(true);
        deps.showToast(deps.t('deletedN', [count]));
      },
    });
  }

  // #selectionBar buttons + count are React-owned now — the selection-bar island derives
  // its own model straight from corpusStore's 'selectedSet' (P4-B slice⑱, reusing
  // corpusSelection's isAllSelected/selectedGroups; no more viewer-pushed model). viewer
  // keeps the container (show/hide) and this ONE delegated click handler that dispatches
  // by data-act — the island reproduces the button IDs so scripts/_verify-select.js's
  // getElementById(...).click() still bubbles here.
  function handleSelectionBarClick(e: MouseEvent) {
    const btn = closestOf(e, '[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'selectAll':
        toggleSelectAll();
        break;
      case 'tag':
        deps.openTagPopForSelection(btn.getBoundingClientRect());
        break;
      case 'folder': {
        // フォルダに追加: open the folder picker for the whole selection (no default
        // folder anymore — you choose the destination, same as a card's 📁).
        if (!folders) return;
        e.stopPropagation(); // don't let the document outside-click handler close the menu we're opening
        const recs = selectedRecords();
        const ids = recs.map((r) => r.captureId).filter(Boolean);
        if (!ids.length) return;
        const r = btn.getBoundingClientRect();
        // Synthetic stand-in group (no real key/files — showFoldMenu's callees only
        // read .rep.captureId and .records for this bulk "add selection to folder" path).
        deps.showFoldMenu({ rep: { captureId: ids[0] }, records: recs } as unknown as CorpusPostGroup, r.left, r.bottom + 4);
        break;
      }
      case 'group':
        groupSelected();
        break;
      case 'delete':
        requestDeleteSelected();
        break;
      case 'cancel':
        clearSelection();
        break;
    }
  }

  return {
    toggleCardSelection,
    selectedRecords,
    clearSelection,
    handleShortcutSelectAllKey,
    handleSelectionBarClick,
  };
}
