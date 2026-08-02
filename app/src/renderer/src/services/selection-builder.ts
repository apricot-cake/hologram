// Card selection + selection-bar bulk actions — extracted from the old viewer.ts
// monolith. Mirrors inspector-builder.ts / post-grid-builder.ts: the pure logic
// moves here; the gestures that reach it are the cells' own props now
// (services/grid.ts's cardActions, wired in orchestrator.ts). selection.ts (the hologramStore-backed selectedSet/anchor
// bridge) stays untouched — this module is one of its consumers (the
// FloatingBar component's own model derivation is the other, unaffected here).
// "Add tags" (openBulkTagDialog) is bulk-tag-builder.ts territory
// (re-targeted at a Dialog in P2⑦). It's constructed right after this module
// in viewer.ts (needs this module's own selectedRecords), so this module only
// calls it via a deferred dep, same shape as jumpToPoster/showToast forward-
// references in inspector-builder.ts.
import * as selection from './selection.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { isActive as imageViewIsActive } from './image-tab.ts';
import { gridColumnCount, scrollGridIndexIntoView } from './grid-nav.ts';
import { postIdKey } from './records.ts';
import { deletePost } from './posts.ts';
import { refresh as trashRefresh } from './trash-view.ts';
import { get as confirmGet, open as confirmOpen } from './confirm.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { isTypingTarget, registerShortcut, tryRun } from './shortcut-registry.ts';

export interface SelectionBarDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  showToast(msg: unknown): void;
  getViewGroups(): HologramPostGroup[];
  getManualGroups(): string[][];
  setManualGroups(groups: string[][]): void;
  markPostsMutated(): void;
  renderPosts(inPlace?: boolean): void;
  loadPosts(keepLimit?: boolean): Promise<void>;
  persistManual(): void;
  showFoldMenu(g: HologramPostGroup, at: HologramMenuAnchor): void;
  // openBulkTagDialog lives in bulk-tag-builder.ts — a deferred dep, same shape
  // as jumpToPoster/showToast in inspector-builder.ts.
  openBulkTagDialog(): void;
  // browseMode is a viewer.ts `let` (read/written outside this cluster too) — a
  // getter since its value changes over the module's lifetime.
  getBrowseMode(): string;
  // Copying an image is post-grid-builder.ts's (it owns the density → file
  // choice and the IPC); this module only owns the Ctrl+C gesture and its guards.
  copyGroupImage(g: HologramPostGroup): void;
  // Open the quick-view lightbox (peek) for a group — the Space-key entry (#143
  // pending decision 3). Same wiring as the inspector thumbnail's onThumbClick;
  // orchestrator supplies the gallery items.
  openQuickView(g: HologramPostGroup): void;
  // Swap the inspector to a group — inspector-builder.ts's showDetail, so arrow
  // movement lands the same way a plain click does. A deferred dep for the same
  // reason as openBulkTagDialog: it is constructed after this module.
  showDetail(g: HologramPostGroup): void;
  // Put the inspector back into its "nothing is selected" state — inspector-builder.ts's
  // dismissDetail. NOT closeDetail: the panel's open/closed state is the user's (#243),
  // and emptying the selection may only empty the panel's CONTENT.
  dismissDetail(): void;
}

export function makeSelectionBar(deps: SelectionBarDeps) {
  // The card's own click, given the GROUP it drew (the cell hands it over — nothing
  // reads an index back off the DOM any more). Returns whether the inspector should
  // follow: a plain click is "select this one and show it", Ctrl/Shift only build the
  // selection and leave the panel alone (#143 the now-resolved pending decision 2).
  function clickSelect(g: HologramPostGroup, e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
    const idx = deps.getViewGroups().indexOf(g);
    const key = postIdKey(g.rep);
    if (e.shiftKey) {
      selection.toggle(idx, key, true, deps.getViewGroups(), postIdKey);
      return false;
    }
    if (e.ctrlKey || e.metaKey) {
      selection.toggle(idx, key, false, deps.getViewGroups(), postIdKey);
      return false;
    }
    selection.selectOnly(idx, key);
    return true;
  }

  // Drag range selection (#484) — the geometry and the rubber band itself live in
  // the virtualized grid host (it owns masonic's positioner, the only place cell
  // rectangles exist); this is the selection half it calls into. Four calls so the
  // "what was selected before the drag" snapshot has exactly one owner
  // (selection.ts), the same as the shift-range anchor.
  const marquee = {
    begin(additive: boolean) {
      selection.beginMarquee(additive);
    },
    update(indices: number[]) {
      selection.updateMarquee(indices, deps.getViewGroups(), postIdKey);
    },
    end() {
      selection.endMarquee();
    },
    cancel() {
      selection.cancelMarquee();
    },
  };

  // The click half of that same press (#242): background click = nothing is
  // selected any more, and the inspector — which is a view OF the selection
  // (#143) — goes back to its placeholder. The grid host has already ruled out
  // cards, card buttons, the scrollbar gutter, a held Ctrl/Shift and anything
  // that turned into a drag, so there is no guard left to repeat here.
  //
  // The selection is only rebuilt when there IS one: every visible cell
  // subscribes to 'selectedSet', and a fresh empty Set is a new identity that
  // would re-render all of them for no change.
  function clickBackground() {
    if (selection.size()) {
      selection.clear();
    }
    deps.dismissDetail();
  }

  // There is nothing left to sync by hand: every visible cell subscribes to
  // hologramStore's 'selectedSet' (which selection.ts already wrote), so it re-renders
  // itself the moment the selection changes. The `.selecting` class this used to toggle
  // on the grid container existed to hide the cards' hover controls, and those are gone
  // (#618 decision A confirmed).

  // Every record of every selected group (bulk actions operate on records).
  function selectedRecords() {
    return selection.selectedRecords(deps.getViewGroups(), postIdKey);
  }

  function clearSelection() {
    selection.clear();
  }

  // updateSelectionBar() lived here: it drove #selectionBar's container show/hide
  // while the component owned only the children. Both are gone — the redesign removed
  // the container from the shell AND unmounted the component (its replacement is the
  // bottom floating bar), so every call was `null.style` = a thrown TypeError on
  // EVERY selection change. It read as harmless (the store write happens first, so
  // the rings still updated), until it took out drag-out: the throw escaped
  // selectOnly() and skipped the hologramIpc.dragOut() after it, so dragging an
  // UNSELECTED card never started the OS drag (2026-07-17, reported from the real
  // app — #132/#185). If a selection bar returns, it derives its own visibility
  // from hologramStore like SelectionBar.tsx already does (count === 0 → null); it
  // does not come back through here.

  // Manual grouping: merge every record of the selected cards into one persisted
  // group (manual-groups.json). Members are first removed from any existing
  // manual group so a record never belongs to two groups.
  function groupSelected() {
    const members = selection.selectedGroups(deps.getViewGroups(), postIdKey).flatMap((g: HologramPostGroup) => g.records.map((r) => r.captureId).filter(Boolean));
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
    deps.showToast(deps.t('grouped'));
  }

  function toggleSelectAll() {
    selection.toggleAll(deps.getViewGroups(), postIdKey);
  }

  // Ctrl/Cmd+A selects every visible (filtered) card. Left to the browser when
  // typing in a field or when a modal/overlay is open (native select-all there).
  // Registration lives in the GlobalShortcuts component (app/App.tsx).
  //
  // #246: the chord (Ctrl+A, Shift ignored — see shortcut-registry.ts's ignoreShift doc)
  // now lives in the registry; this keeps the guard chain and the action.
  function canExecuteSelectAll() {
    if (confirmGet() || lightboxIsOpen()) return false;
    if (settingsIsOpen()) return false;
    if (imageViewIsActive()) return false; // the grid's selection is not on screen (#656) — same guard as Ctrl+C/Space/arrow nav below
    if (deps.getBrowseMode() !== 'posts') return false; // select-all is post-grid only (posters/collections excluded)
    if (deps.getViewGroups().length === 0) return false;
    return true;
  }
  function doSelectAll() {
    selection.selectAll(deps.getViewGroups(), postIdKey);
    deps.renderPosts(true);
  }
  registerShortcut({
    id: 'selection.selectAll',
    titleKey: 'shortcutSelectAll',
    defaultCombo: 'Ctrl+a',
    ignoreShift: true,
    canExecute: (e) => !isTypingTarget(e) && canExecuteSelectAll(),
    perform: doSelectAll,
  });

  function handleShortcutSelectAllKey(e: KeyboardEvent) {
    tryRun('selection.selectAll', e);
  }

  // Ctrl/Cmd+C copies the selected image (#132). Single selection only: the
  // clipboard holds ONE bitmap, and dragging out is the path for several files.
  // Same guard shape as select-all above, plus two of its own: a real text
  // selection stays the browser's to copy, and the image tab / quick view own
  // their copy gesture (v1 = the grid only). Registration lives in the
  // GlobalShortcuts component (app/App.tsx).
  //
  // #246: the chord (Ctrl+C, Shift ignored) now lives in the registry; this keeps the
  // guard chain and the action.
  function canExecuteCopy(e: KeyboardEvent) {
    if (isTypingTarget(e)) return false;
    if (confirmGet() || lightboxIsOpen()) return false;
    if (settingsIsOpen()) return false;
    if (imageViewIsActive()) return false;
    if (deps.getBrowseMode() !== 'posts') return false;
    if (String(window.getSelection() || '')) return false; // the user highlighted post text — that's what they mean to copy
    return selection.selectedGroups(deps.getViewGroups(), postIdKey).length === 1;
  }
  function doCopy() {
    const groups = selection.selectedGroups(deps.getViewGroups(), postIdKey);
    if (groups.length === 1) deps.copyGroupImage(groups[0]);
  }
  registerShortcut({ id: 'selection.copyImage', titleKey: 'shortcutCopyImage', defaultCombo: 'Ctrl+c', ignoreShift: true, canExecute: canExecuteCopy, perform: doCopy });

  function handleShortcutCopyKey(e: KeyboardEvent) {
    tryRun('selection.copyImage', e);
  }

  // Space peeks the selected card in the quick-view lightbox (#143 pending decision 3 —
  // the same style as Quick Look / Eagle). Single selection only (peek is one card); same
  // guard shape as the copy key above, plus: a lightbox already open owns Space
  // (its own paging), and a text field / the image view keep the key. Registration
  // lives in the GlobalShortcuts component (app/App.tsx).
  //
  // #246: the chord (Space, no modifiers) now lives in the registry; this keeps the guard
  // chain and the action. The original also checked e.code === 'Space' as a fallback
  // alongside e.key === ' ' — dropped here (combo matching is e.key-only, matching every
  // other entry in the registry); a documented, narrow simplification (#246 PR).
  function canExecuteQuickView(e: KeyboardEvent) {
    if (isTypingTarget(e)) return false;
    if (confirmGet() || lightboxIsOpen()) return false;
    if (settingsIsOpen()) return false;
    if (imageViewIsActive()) return false;
    if (deps.getBrowseMode() !== 'posts') return false;
    return selection.selectedGroups(deps.getViewGroups(), postIdKey).length === 1;
  }
  function doQuickView() {
    const groups = selection.selectedGroups(deps.getViewGroups(), postIdKey);
    if (groups.length === 1) deps.openQuickView(groups[0]);
  }
  registerShortcut({ id: 'selection.quickView', titleKey: 'shortcutQuickView', defaultCombo: 'Space', canExecute: canExecuteQuickView, perform: doQuickView });

  function handleShortcutQuickView(e: KeyboardEvent) {
    tryRun('selection.quickView', e);
  }

  // Arrow keys move the selection through the grid (redesign P2⑥, the last piece of
  // it). This is what makes continuous tagging a composition instead of a dedicated mode:
  // filter to "No tags", then arrow to the next card and type into the inspector's
  // tag field — the same loop Lightroom and Eagle give you without a tagging screen.
  //
  // Left/Right step one card; Up/Down step one ROW, which is why the column count has
  // to come from the live layout (services/grid-nav.ts) rather than the model — masonic
  // derives it from the container width. Movement clamps at both ends (no wrap): in a
  // grid, wrapping from the last card to the first is disorienting and no file manager
  // or photo library does it.
  //
  // Home/End jump straight to the first/last card (#672 — the two ends arrow movement
  // never reached). They are wired into this SAME function rather than a parallel one so
  // the guard block below (input/textarea/contentEditable, confirm/lightbox/settings/image
  // view, posts-only browse mode) and the post-move steps (select, scroll into view, show
  // detail) are literally shared code, not a copy that could drift — #672's own decision
  // record leans on this. They move the SELECTION, matching arrow's vocabulary (Left/Right/
  // Up/Down move the selected card, not just the scroll position) rather than being a bare
  // scrollTo: mixing "arrows move selection" with "Home/End only scroll" inside one key
  // group is the two-meanings problem #672 rejected, and Explorer's own Home/End move the
  // focused row, not just the viewport. Posters and trash stay out of reach here for the
  // same reason arrows never reached them — neither has a selection model; #606's visible
  // button already covers getting back to the top there.
  //
  // Plain arrows/Home/End only. Shift+Arrow (extend the range) is deliberately NOT wired:
  // the range primitive here moves the anchor to the new index on every call, so repeated
  // extends would only ever grow the selection and could never shrink it back — the
  // opposite of what Shift+Arrow means. Doing it properly needs a fixed anchor plus a
  // separate cursor, which is its own change. Shift+Home/End (extend to an end) is out for
  // the same reason. Ctrl/Alt+Home/End are left alone too — Ctrl+Home is a bare-document
  // shortcut some browsers still reserve, and nothing here needs it.
  //
  // Same guard shape as the Space peek below it, plus one of its own: with no anchor
  // and no single selection there is nothing to move FROM, so the first press selects
  // the first card rather than guessing. Registration lives in the GlobalShortcuts
  // component (app/App.tsx).
  function handleShortcutArrowNav(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const isHome = e.key === 'Home';
    const isEnd = e.key === 'End';
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -gridColumnCount() : e.key === 'ArrowDown' ? gridColumnCount() : 0;
    if (!step && !isHome && !isEnd) return;
    const t = e.target as HTMLElement | null;
    // Home/End inside a text field or contentEditable is the field's own caret-to-line-
    // start/end motion — the same reason this guard already keeps arrow nav off the search
    // box and tag input (#672 accept criteria: input focus must not lose Home/End).
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (confirmGet() || lightboxIsOpen()) return;
    if (settingsIsOpen()) return;
    if (imageViewIsActive()) return;
    if (deps.getBrowseMode() !== 'posts') return;
    const groups = deps.getViewGroups();
    if (groups.length === 0) return;
    e.preventDefault(); // the grid scrolls on arrows/Home/End otherwise, and the selection would slide out of view

    // Where we are: the anchor is authoritative (selectOnly/toggle keep it current).
    // It's null after select-all / clear / a deselecting toggle, so fall back to a lone
    // selected card, then to "nothing yet" — where the first press lands on card 0.
    const selected = selection.selectedGroups(groups, postIdKey);
    const from = selection.anchorIndex() ?? (selected.length === 1 ? groups.indexOf(selected[0]) : -1);
    const next = isHome ? 0 : isEnd ? groups.length - 1 : from < 0 ? 0 : Math.min(groups.length - 1, Math.max(0, from + step));
    // Selection unchanged (already at that edge) — skip selectOnly/showDetail so the
    // inspector doesn't churn for nothing, same as before. But the SCROLL is re-asserted
    // unconditionally below regardless of whether the selection moved: #606's own "back to
    // top" button (and a plain wheel/drag scroll) moves the viewport WITHOUT touching the
    // selection or the anchor, so without this, End → #606's button → End again would
    // silently do nothing the second time (the selection was already sitting on the last
    // card the whole time, so next === from, and the user is left staring at the top with
    // no keyboard way back down — found verifying #672 against #606's button). Re-running
    // scrollGridIndexIntoView is safe to call unconditionally: it is itself a no-op once the
    // target card is actually in view (services/grid-nav.ts / VirtualGrid.tsx), so this costs
    // nothing on the ordinary path where the viewport never drifted.
    if (next !== from) {
      const g = groups[next];
      if (!g) return;
      selection.selectOnly(next, postIdKey(g.rep));
      deps.showDetail(g); // the inspector follows, exactly as it does for a plain click
    }
    scrollGridIndexIntoView(next);
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
        for (const p of toDelete) await deletePost(p.image || p.video || p.file); // #236: p.file is a collected item's IPC identifier
        selection.clear();
        await deps.loadPosts(true);
        trashRefresh(); // the nav's Trash badge counts what just landed there (#268)
        deps.showToast(deps.t('deletedN', [count]));
      },
    });
  }

  // The bulk-action buttons are the bottom floating bar's now (selection/
  // FloatingBar.tsx) — it calls these named actions straight through orchestrator's
  // exports (onClick → function), so there's no #selectionBar container, no data-act
  // DOM contract, and no delegated dispatcher anymore (redesign §8-1 zero tolerance). The
  // The one menu-anchored action left (folder) takes the clicked BUTTON so its menu
  // opens against it (Base UI measures it and collision-flips above the bottom bar).

  // "Add tags": stage tags for the whole selection in a Dialog (P2⑦). Centered and
  // modal, so unlike the folder menu below it takes no anchor rect.
  function tagSelection() {
    deps.openBulkTagDialog();
  }

  // "Add to folder": open the folder picker for the whole selection (you choose the
  // destination, same as a card's 📁 — no default folder).
  function folderSelection(anchorEl: HTMLElement) {
    const recs = selectedRecords();
    const ids = recs.map((r) => r.captureId).filter(Boolean);
    if (!ids.length) return;
    // Synthetic stand-in group (no real key/files — showFoldMenu's callees only read
    // .rep.captureId and .records for this bulk "add selection to folder" path).
    // The picker hangs off the "Add to folder" button itself, above it: the bar is
    // pinned to the bottom, so `side: 'top'` is where it fits (and Base UI flips it
    // back down if it ever doesn't).
    deps.showFoldMenu({ rep: { captureId: ids[0] }, records: recs } as unknown as HologramPostGroup, { anchorEl, side: 'top', align: 'center' });
  }

  return {
    clickSelect,
    marquee,
    clickBackground,
    selectedRecords,
    clearSelection,
    handleShortcutSelectAllKey,
    handleShortcutCopyKey,
    handleShortcutQuickView,
    handleShortcutArrowNav,
    toggleSelectAll,
    groupSelected,
    requestDeleteSelected,
    tagSelection,
    folderSelection,
  };
}
