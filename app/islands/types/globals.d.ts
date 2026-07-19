// Window-global contracts between the build-less renderer (viewer.js and the
// plain-IIFE bridge files in app/renderer/) and the React islands — TypeScript
// stage 1 (BACKLOG 採用#1). The bridges are IMPLEMENTED in plain JS that tsc
// does not check yet; this file is where those cross-boundary contracts become
// visible to the islands. Model payloads built by viewer.js are typed to the
// fields the islands actually consume; an index signature keeps pass-through
// fields legal until the plain-JS side converts (単一バンドル化 or later).

export {};

// Vite turns CSS imports into injected stylesheets; for tsc they are side-effect
// only modules (settings imports './styles.css').
declare module '*.css' {}

// The former `declare module 'corpus-svc:*'` ambient is gone: the barrel
// (app/index.tsx) imports the renderer service layer by plain relative path now
// (V18 item 7 removed the last bare-specifier alias), so tsc resolves the real
// modules directly. The service .ts files are type-checked in this same program
// (merged 2026-07-09 into one tsconfig.json), via the `renderer/**/*` include.

declare global {
  type CorpusUnsubscribe = () => void;

  // ---- renderer/store.ts — key-addressed external store (viewer ⇄ islands). A
  // real ES module now (Wave12) — get/set/subscribe are imported directly by
  // every consumer; no ambient Window-shaped interface needed here. ----

  // ---- renderer/i18n.ts — corpusI18n resolves after prefs are read. Data-shape
  // type only (the promise's resolved value) — the module itself is a real ES
  // module (named export `corpusI18n`), imported by _shared/i18n.ts. ----
  interface CorpusI18nApi {
    lang: string;
    resolved: 'ja' | 'en';
    getMessage(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  }

  // ---- renderer/search.ts — the single smart-search matcher (normalize/compile).
  // A real ES module (named exports) now — no ambient Window-shaped interface needed.

  // ---- renderer/ui.ts — notify/escapeHtml. A real ES module (named exports)
  // now — no ambient Window-shaped interface needed.

  // ---- renderer/theme-api.ts — apply/get/set/resolve. A real ES module
  // (named exports) now — no ambient Window-shaped interface needed. The pre-paint
  // renderer/theme.js boot publishes no window global.

  // ---- renderer/folders.ts — shared post-folder domain. A real ES module (named
  // exports) now — App.tsx imports onChange directly, so no ambient interface is
  // needed here anymore.

  // ---- renderer/tags.ts — tag vocabulary / 種別 domain. A real ES module now;
  // Sidebar/PosterSidebar import getTagLabels directly, so no ambient partial
  // interface is needed here anymore.

  // ---- orchestrator.ts — its old shared bridge is gone (Wave31/Wave32, V17). Every
  // method it used to carry (global shortcuts, inspector-dismiss, tab-bar events,
  // store/IPC subscription handlers, boot, nav/reset) is now a real ES export that
  // App.tsx/Activebar.tsx import directly — no ambient Window-shaped interface
  // needed here.

  // ---- renderer/records.ts — a real ES module now; SelectionBar imports postIdKey
  // directly, so no ambient partial interface is needed here anymore.

  // ---- renderer/selection.ts — a real ES module now (named exports); SelectionBar
  // (P4-B slice⑱) imports isAllSelected/selectedGroups directly instead of
  // re-deriving allSelected/groupDisabled itself.

  // ---- preload.cts — the full contextBridge IPC surface (window.corpus). The
  // type is exported by the implementation itself (typeof the exposed api object,
  // Issue #17), so this alias can never drift from what the bridge actually
  // exposes — the old hand-maintained interface mirror is gone. In THIS program
  // 'electron' resolves to islands/types/electron-shim.d.ts (tsconfig paths; see
  // the shim's comment); tsconfig.main.json checks the same file against the real
  // electron types. ----
  type CorpusPreload = import('../../preload.cts').CorpusPreload;

  // ---- renderer/grid.ts — a PULLED model source per virtualized grid (P4-B
  // slice⑩ post, slice⑫ poster — both converted off the old push bridge; nothing
  // instantiates a push bridge anymore). viewer.js still builds items/layout
  // inputs, but writes them to corpusStore instead of calling a render()/patch()
  // method — the source derives the model itself. `paint` is internal (bumped on
  // every get() so a fresh object ref reaches React even when field VALUES repeat).
  // Selection/inspected are NOT part of this model — Cell derives both from
  // corpusStore subscriptions directly (see Grid.tsx / PosterGrid.tsx).
  interface CorpusGridModel {
    items: any[];
    itemsKey: string | number;
    modelOf(item: any, i: number): any;
    keyOf?(item: any, i: number): string | number | null | undefined;
    columnCount?: number;
    columnWidth?: number;
    rowGutter?: number;
    itemHeightEstimate?: number;
    square?: boolean;
    labels?: any;
    onAspect?(cap: string, aspectRatio: string): void;
    paint: number;
    [extra: string]: any;
  }
  // The shape GridMount (_shared/VirtualGrid.tsx) actually consumes — it only
  // ever calls get()/subscribe(), so this is the minimal contract both sources
  // (renderer/grid.ts's corpusPostGridSource/corpusPosterGridSource, real ES
  // module exports now) satisfy, plus their own configure()/etc., which GridMount
  // never touches.
  interface CorpusGridSource {
    get(): CorpusGridModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }

  // ---- renderer/posts-data.ts — P4-B slice⑪: the "allPosts changed" choke point.
  // A real ES module (named exports) now — no ambient Window-shaped interface
  // needed (see the corpus-react-purity-execution-map memory for the conversion).

  // ---- renderer/image-tab.ts — P4-B slice⑮: converts the image-tab detail view
  // (#imageTabView) off the old push (viewer.js built a full model and called
  // render(model) on it from ~8 call sites) to a PULLED source, same shape as
  // the grid sources (⑩/⑫). viewer.js writes only the tab identity (corpusStore's
  // 'activeImageTab' — id/recs/idx, the one slice of tab state migrated ahead of
  // the full tabs→store move in ⑯) + still owns 'inspectedKey' (state→store
  // phase); get() crosses both with posts-data.ts (library changes — a deleted
  // post degrades to the missing state live with no viewer push, exactly what
  // the posts-data.ts comment above anticipated). Commands (index step /
  // inspector toggle / close tab) dispatch back to viewer.ts via configure()
  // callbacks (DI'd off its old shared bridge in V13/Wave27) —
  // this file only computes, it never mutates tab state. A real ES module
  // (named export `corpusImageTabSource`) now — no ambient Window-shaped
  // interface needed for it (CorpusImageTabModel stays: the shared data shape
  // between image-tab.ts and this island).
  interface CorpusImageTabModel {
    items: { src: string; alt?: string; video?: boolean }[];
    idx: number;
    missing?: boolean;
    inspectorOpen?: boolean;
    labels: Record<string, string>;
    onIndexChange?(i: number): void;
    onToggleInspector?(): void;
    onCloseTab?(): void;
  }

  // ---- renderer/tabs.ts — P4-B slice⑯: converts the tab strip (#tabBarInner) off
  // the old push (viewer.js built a TabsModel via renderTabs() and pushed it to a
  // shared render bridge from ~15 call sites) to a PULLED source, same
  // shape as the grid/image-tab sources. viewer.js no longer owns tabs/
  // activeTabId/tabEditingId as closure state — corpusStore's keys of the same
  // names ARE the state; it keeps only the mutation functions (switchTab/addTab/…)
  // and all #tabBarInner event delegation (TabBarEvents, App.tsx, unchanged).
  // tabTitleOf/tabIcons/pinSvg are viewer-built invariants handed over once
  // (configure), the same "configure once" shape as the grid sources.
  interface CorpusTabModel {
    id: string;
    title: string;
    icon: string;
    active?: boolean;
    pinned?: boolean;
    showClose?: boolean;
  }
  interface CorpusTabsModel {
    tabs: CorpusTabModel[];
    editingId?: string | null;
    closeTitle?: string;
    newTitle?: string;
  }
  // renderer/tabs.ts — a real ES module (named export: corpusTabsSource) now,
  // imported directly by tabs/index.tsx.

  // ---- viewer-anchored popup models share this anchor shape (a DOMRect works) ----
  interface CorpusAnchorRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  // ---- renderer/qf-pop-builder.ts (headless pickValue router) ----
  interface CorpusQfPopItem {
    [key: string]: any;
  }
  // CorpusQfPopModel (the retired qf-pop flyout's view model) removed with the
  // flyout UI (P2③) and the search-mode hint fields (P2④).

  // ---- renderer/menu.js — shared right-click context menu ----
  interface CorpusMenuItem {
    label?: string;
    act?: string;
    danger?: boolean;
    checked?: boolean;
    sep?: boolean;
    manage?: boolean;
    icon?: string;
    [extra: string]: any;
  }
  interface CorpusContextMenuModel {
    items: CorpusMenuItem[];
    x: number;
    y: number;
    // Returning a new items array keeps the menu open (toggle rows); returning
    // nothing closes it. The `| void` arm is that "close" signal — it also lets
    // void-returning pick handlers (the common case) assign cleanly.
    // biome-ignore lint/suspicious/noConfusingVoidType: void is the intentional "close the menu" return
    onPick: ((item: CorpusMenuItem) => CorpusMenuItem[] | void) | null;
  }
  // CorpusContextMenu (the open/close/pick/get/subscribe API) removed — menu.ts
  // is a real ES module now, imported directly by its consumers.

  // ---- renderer/kind-menu.js — tag-kind (work/character/…) menu ----
  interface CorpusKindMenuRow {
    kind?: string;
    label?: string;
    dot?: boolean;
    renameable?: boolean;
    checked?: boolean;
    sep?: boolean;
  }
  interface CorpusKindMenuModel {
    x: number;
    y: number;
    header?: string;
    renameTitle?: string;
    rows: CorpusKindMenuRow[];
    onPick(kind: string): void;
    onRename(kind: string): void;
  }
  // CorpusKindMenu (the open/close/get/subscribe API) removed — kind-menu.ts
  // is a real ES module now, imported directly by its consumers.

  // ---- renderer/filter-popover.js — date / engagement / poster-date forms ----
  interface CorpusFilterPopoverModel {
    kind: 'date' | 'eng' | 'posterDate';
    openId: number;
    anchorRect: CorpusAnchorRect;
    editing?: boolean;
    fields: any;
    labels: any;
    typeOptions?: any[];
    dimOptions?: any[];
    // Union of the three popovers' field shapes ('date'/'posterDate' pass
    // dateField/from/to, 'eng' passes engType/min/op) — kept as one loose object
    // (rather than 3 overloads) so viewer.ts's inline destructuring parameter
    // types without a discriminated-union cast at each call site.
    // min arrives as a parsed number (FilterPopover.tsx's EngForm calls
    // Number.parseInt on it before invoking onApply) — the rest stay strings.
    onApply(fields: { dateField?: string; from?: string; to?: string; engType?: string; min?: string | number; op?: string }): void;
    onRemove(): void;
    [extra: string]: any;
  }
  // CorpusFilterPopover (the open/close/get/subscribe API) removed — filter-popover.ts
  // is a real ES module now, imported directly by its consumers.

  // ---- renderer/inspector.js — model mechanics; the deep field lists live in
  // viewer.js's model builders. ----
  // Tag-editing callbacks TagEditor.tsx (_shared) requires — its onAdd/onRemove/
  // onToggle/onContextMenu props are all required. TagEditor.tsx now renders in
  // exactly ONE place: CorpusTagPopModel below (Issue #22 retired both the
  // inspector's always-live editor and the bulk edit-overlay modal in favor of
  // one shared pop).
  interface CorpusTagEditorCallbacks {
    onTagAdd(tag: string): void;
    onTagRemove(tag: string): void;
    onTagToggle(tag: string): void;
    onTagContextMenu(tag: string, x: number, y: number): void;
  }
  // NOT extending CorpusTagEditorCallbacks: the inspector (post AND poster,
  // Inspector.tsx) is read-only (Issue #22) and only needs onTagContextMenu
  // (right-click still opens the kind-menu — a read operation) + onEditTags
  // (opens tag-pop for this card/poster).
  interface CorpusInspectorModel {
    kind: 'post' | 'poster';
    openId: number;
    onClose(): void;
    onTagContextMenu(tag: string, x: number, y: number): void;
    onEditTags(anchorRect: CorpusAnchorRect): void;
    // Post-only (Inspector.tsx renders these when present).
    onThumbClick?(): void; // preview thumbnail → quick-view peek (#143)
    onOpenExternal?(): void;
    onSauce?(): void;
    onAscii?(): void;
    onPosterJump?(): void;
    // Poster-only.
    onPosterPosts?(): void;
    onFolderToggle(id: string): void;
    onFolderCreate?(): void;
    [extra: string]: any;
  }
  // CorpusInspector (the open/refresh/close/get/subscribe API) removed —
  // inspector.ts is a real ES module now, imported directly by its consumers.
  // CorpusEditOverlayModel removed with edit-overlay.ts/EditOverlay.tsx (Issue #22
  // retired the bulk modal — see CorpusTagPopModel's mode:'bulk' below).

  // ---- renderer/tag-pop.ts — tag picker pop (Issue #22): the single popup that
  // replaced both the inspector's always-live TagEditor and the bulk edit-overlay
  // modal. 'single' mode wires straight to the SAME onTagAdd/onTagRemove/onTagToggle
  // persistence orchestrator.ts's inspector builder already had (immediate save +
  // undo); 'bulk' mode wires to bulk-edit.ts's staging list instead and adds
  // applyLabel/additiveHint/onApply (the staged "N件に適用" commit). Extends
  // CorpusTagEditorCallbacks (unlike CorpusInspectorModel above) because
  // TagEditor.tsx is tag-pop's ONLY content now — every caller must supply all four.
  interface CorpusTagPopModel extends CorpusTagEditorCallbacks {
    openId: number;
    anchorRect: CorpusAnchorRect;
    mode: 'single' | 'bulk';
    // Which target this pop is currently showing (inspectedKey's format for single —
    // postIdKey(g.rep) / 'poster:'+key — a fixed sentinel for bulk). The SOLE source
    // of truth for "is the pop open for X": inspector-builder.ts and
    // poster-grid-builder.ts each track their own group/poster but must agree on
    // ONE answer to "is tag-pop open for MY card" even though tag-pop.ts is a
    // singleton bridge shared by both — reading it back off the live model (via
    // tag-pop.ts's get()) instead of two independent local booleans is what keeps
    // them from going stale against each other (post opens → poster opens →
    // post's own tracking would otherwise still think it owns the pop).
    forKey: string;
    tags: string[];
    tagLabels: Record<string, string>;
    // bulk-only.
    applyLabel?: string;
    additiveHint?: string;
    onApply?(): void;
    // Outside-click / Esc — the caller decides what "closing" means (single: just
    // close the pop; bulk: also discard the staging list).
    onDismiss(): void;
    [extra: string]: any;
  }

  // ---- renderer/sidebar.ts — the two filter-row columns (P4-B slice⑰: converted
  // from a PUSHED bridge — viewer built a full model incl. labels and called
  // render()/renderPoster() — to a PULLED source, same shape as the grid/image-tab/
  // tabs sources. Labels are NOT in the model: the islands resolve their own static
  // row names via t() and the 作品/キャラ custom label via corpusTags.getTagLabels(),
  // the same "island resolves its own i18n" pattern SortSelect/SectionTitle use.
  // Everything else (badges/visible/clip/multi/openCat) is derived from corpusStore
  // keys (postQueryTree/posterQueryTree/multiOnly/qfCat) + corpusTags/corpusFolders/
  // posts-data.ts/corpusListing — no viewer push needed, so viewer's mutation call
  // sites (addFilter/removeFilter/setTagKind/markPostsMutated/…) no longer need a
  // matching re-push; the source's own subscriptions cover it. Two independent
  // sources (post / poster) so a change in one column never re-renders the other. ----
  interface CorpusSidebarModel {
    openCat: string | null; // the flyout cat with .qf-open (null = none)
    clip: { active: boolean; count: number; clearVisible: boolean };
    multi: { active: boolean };
    badges: Record<string, number>; // per-row active-filter count
    visible: { work: boolean; character: boolean }; // 種別 progressive disclosure
  }
  // Poster column (#posterFilterRows): a leaner twin — no clip/multi toggles, and the
  // rows are keyed by their full poster-* cat (data-qfrow === data-badge). work / character
  // / tag / instance are progressively disclosed once posters actually carry such values.
  interface CorpusPosterSidebarModel {
    openCat: string | null; // the poster-* flyout cat with .qf-open (null = none)
    badges: Record<string, number>; // per-row active leaf count (poster query shadow)
    visible: { work: boolean; character: boolean; tag: boolean; instance: boolean };
  }
  // renderer/sidebar.ts — a real ES module (named exports: corpusPostSidebarSource/
  // corpusPosterSidebarSource) now, imported directly by Sidebar.tsx/PosterSidebar.tsx.

  // ---- Bulk-action selection bar. Now the bottom floating FloatingBar island
  // (islands/selection, redesign P2⑥): no #selectionBar container and no delegated
  // data-act handler — each button calls an orchestrator-exported selection action
  // directly. It derives count/allSelected/groupDisabled itself from corpusStore's
  // 'selectedSet' + 'postGroups' (the old renderer/selection-bar.ts push bridge was
  // deleted — no callers left, same as renderer/empty.ts below). ----

  // ---- #emptyState placeholder — viewer keeps the container's show/hide + the
  // delegated CTA click handler; EmptyState.tsx (P4-B slice⑩/⑫) derives the
  // variant itself from corpusStore instead of a pushed bridge (the old
  // renderer/empty.js bridge was deleted — no callers left). ----
  type CorpusEmptyVariant = 'firstRun' | 'filtered' | 'posterFirstRun';

  // ---- the query-builder FRAME (#postActiveBar / #posterActiveBar): nav 戻る/進む,
  // フィルター title, empty hint, result count, リセット, and the ⓘ help popover. viewer
  // keeps only the container reveal + --activebar-h measurement; ActivebarHost (P4-B
  // slice⑱) derives everything else itself from corpusStore ('postQueryTree'/
  // 'posterQueryTree'/'searchQuery'/'postGroups'/'posterGroups'/'navCanBack'/
  // 'navCanForward') + t(), and imports navBack/navForward/resetAllFilters/
  // resetPosterFilters directly for the actions (the old renderer/activebar.ts push
  // bridge was deleted — no callers left). Portaled into sub-mounts BESIDE the chips
  // containers, which stay their own island. ----

  // ---- renderer/confirm.ts — shared confirm modal (shadcn AlertDialog). Callers open it
  // with a message + optional skip/keyword gate + callbacks; the island renders it. ----
  interface CorpusConfirmConfig {
    message: string;
    description?: string; // present → secondary line under the title (AlertDialogDescription)
    okLabel: string;
    cancelLabel: string;
    skipLabel?: string; // present → show the "don't ask again" checkbox
    keywordPlaceholder?: string; // present → keyword-gated OK (destructive wipe)
    keywordRequired?: string;
    onOk(result: { skip: boolean }): void;
    onCancel?(): void;
  }
  interface CorpusConfirmModel extends CorpusConfirmConfig {
    openId: number;
  }
  // CorpusConfirm / CorpusEditOverlay (the open/close/get/subscribe APIs)
  // removed — confirm.ts / edit-overlay.ts are real ES modules now, imported
  // directly by their consumers.

  // ---- renderer/searchbox.ts — a real ES module (named exports: init/handlers/
  // registerFocus/focusSearchBox) now. Only the handlers payload contract stays here
  // as a cross-module data shape (viewer produces it, the searchbox island pulls it). ----
  interface CorpusSearchBoxHandlers {
    getSuggestions(q: string): any[];
    onPick(item: any): void;
    onConfirmText(): void;
  }

  // ---- renderer/settings.ts / renderer/lightbox.ts — real ES modules now (V18 §4),
  // imported directly by their islands and by orchestrator.ts / the *-builder.ts
  // modules — no ambient Window-shaped interface needed.

  // renderer/query-chips.ts — a real ES module (named exports: createQueryBuilder/
  // getModel/subscribe/dispatch) now, imported directly by query-chips/index.tsx.

  // ---- renderer/trash.ts — trash domain. A real ES module now; the Settings > Trash
  // island imports its commands directly, so no ambient interface is needed here. ----

  // ---- renderer/backup.ts — auto-backup domain, read by both viewer.ts's project
  // (the #mirrorStatus rail) and this strict islands project (the Settings > データ
  // island calls it directly). A real ES module (named exports) now — no ambient
  // Window-shaped interface needed.

  // ---- renderer/posts.ts — post-record CRUD/import/export + save-folder move
  // domain, read by both viewer.ts's project (list/delete/tags/import/clearAll/
  // change-watch) and this strict islands project (the Settings > データ island
  // calls the save-folder/export/import/import-media methods directly). A real ES
  // module (named exports) now — no ambient Window-shaped interface needed.

  // renderer/ipc.ts — the P4 IPC→service seam over the raw bridge below. A real ES
  // module now (named export `corpusIpc`), imported directly by every caller.

  interface Window {
    corpus: CorpusPreload;
  }
}
