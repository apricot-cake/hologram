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

// The barrel (app/index.tsx) folds the renderer service layer into this bundle via
// `import 'corpus-svc:NAME'` specifiers, aliased to renderer/NAME.ts by build.mjs /
// vite.config.mjs (Vite-only alias — tsc has no path mapping for the bare specifier
// literal). This ambient declaration lets tsc treat those side-effect imports as
// resolved (empty module) instead of erroring "Cannot find module". The service .ts
// files themselves ARE type-checked in this same program (merged 2026-07-09 into one
// tsconfig.json — formerly a separate tsconfig.renderer.json), via the `renderer/**/*`
// include; this wildcard only covers the import *specifier string*, not the module
// graph it happens to route through outside of tsc's view.
declare module 'corpus-svc:*';

declare global {
  type CorpusUnsubscribe = () => void;

  // ---- renderer/store.js — key-addressed external store (viewer ⇄ islands) ----
  // Values are heterogeneous by design (a string pref here, a number there), so
  // get() is `any`; the per-call-site cast IS the contract until keys get typed.
  interface CorpusStore {
    get(key: string): any;
    set(key: string, val: unknown): void;
    subscribe(key: string, cb: () => void): CorpusUnsubscribe;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }

  // ---- renderer/i18n.ts — corpusI18n resolves after prefs are read. Data-shape
  // type only (the promise's resolved value) — the module itself is a real ES
  // module (named export `corpusI18n`), imported by _shared/i18n.ts. ----
  interface CorpusI18nApi {
    lang: string;
    resolved: 'ja' | 'en';
    getMessage(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  }

  // ---- renderer/search.ts — shared search-mode + fuzzy matching utilities. A real
  // ES module (named exports) now — no ambient Window-shaped interface needed.

  // ---- renderer/ui.ts — notify/escapeHtml. A real ES module (named exports)
  // now — no ambient Window-shaped interface needed.

  // ---- renderer/theme-api.ts — apply/get/set/resolve/applyTitleBar. A real ES module
  // (named exports) now — no ambient Window-shaped interface needed. The pre-paint
  // renderer/theme.js boot publishes no window global.

  // ---- renderer/folders.ts — shared post-folder domain. A real ES module (named
  // exports) now — App.tsx imports onChange directly, so no ambient interface is
  // needed here anymore.

  // ---- renderer/tags.ts — tag vocabulary / 種別 domain. A real ES module now;
  // Sidebar/PosterSidebar import getTagLabels directly, so no ambient partial
  // interface is needed here anymore.

  // ---- viewer.js — window.corpusViewer is assembled via Object.assign in
  // several places, so every method is optional. Only what islands call. ----
  interface CorpusViewer {
    // Resolves once bootApp is defined below (right after the i18n load) — assigned
    // as the module's very first synchronous statement so it exists before React can
    // possibly read it. AppBoot (App.tsx) awaits it, then calls bootApp() once.
    ready?: Promise<void>;
    // The app's initial data load + first render (folders/tags/tabs/posts, browse-mode
    // restore, tab-scroll restore). React triggers it once on mount via AppBoot
    // (App.tsx) instead of viewer self-invoking — same "React owns WHEN, viewer.ts
    // keeps WHAT" shape as the other control→hooks handlers below.
    bootApp?(): Promise<void>;
    setTileOverlay?(v: boolean): void;
    reloadPosts?(): void | Promise<void>;
    confirmClearAll?(): void;
    setSkipDeleteConfirm?(v: boolean): void;
    // Global keyboard/mouse shortcut handlers, wired by useGlobalShortcuts (App.tsx).
    // Each is a full guard+action handler (viewer keeps the logic); the hook just
    // registers the raw DOM listener and forwards the event.
    handleShortcutNavKey?(e: KeyboardEvent): void;
    handleShortcutMouseNav?(e: MouseEvent): void;
    handleShortcutUndoKey?(e: KeyboardEvent): void;
    handleShortcutSelectAllKey?(e: KeyboardEvent): void;
    handleShortcutSearchFocusKey?(e: KeyboardEvent): void;
    handleShortcutSizeKey?(e: KeyboardEvent): void;
    // Capture-phase inspector dismiss handlers, wired by DetailDismiss (App.tsx).
    handleEscDismissDetail?(e: KeyboardEvent): void;
    handleOutsideClickDismissDetail?(e: MouseEvent): void;
    // Tab bar event handlers, wired by TabBarEvents (App.tsx).
    handleTabBarKeydown?(e: KeyboardEvent): void;
    handleTabBarFocusout?(e: FocusEvent): void;
    handleTabBarClick?(e: MouseEvent): void;
    handleTabBarAuxclick?(e: MouseEvent): void;
    handleTabBarMousedown?(e: MouseEvent): void;
    handleTabBarContextmenu?(e: MouseEvent): void;
    handleTabBarDblclick?(e: MouseEvent): void;
    handleGlobalTabShortcut?(e: KeyboardEvent): void;
    // External-store / IPC subscription handlers, wired by StoreSubscriptions (App.tsx).
    handleQfPopChange?(): void;
    handleViewStoreChange?(): void;
    handleBrowseModeStoreChange?(): void;
    handlePosterViewStoreChange?(): void;
    handleSearchQueryStoreChange?(): void;
    handleSearchModeChange?(): void;
    handleFolderChange?(kind?: string): void;
    handlePostsChanged?(names: string[] | null): void | Promise<void>;
    // Image-tab commands (renderer/image-tab.ts dispatches these — P4-B slice⑮).
    setImageTabIndex?(i: number): void;
    toggleImageTabInspector?(): void;
    closeImageTab?(): void;
    // Activebar commands — the activebar island calls these directly (P4-B slice⑱; no
    // more pushed model callbacks).
    navBack?(): void;
    navForward?(): void;
    resetAllFilters?(): void;
    resetPosterFilters?(): void;
  }

  // ---- renderer/records.ts — a real ES module now; SelectionBar imports postIdKey
  // directly, so no ambient partial interface is needed here anymore.

  // ---- renderer/selection.ts — a real ES module now (named exports); SelectionBar
  // (P4-B slice⑱) imports isAllSelected/selectedGroups directly instead of
  // re-deriving allSelected/groupDisabled itself.

  // ---- preload.js — the full contextBridge IPC surface (window.corpus) ----
  interface CorpusPreload {
    getConfig(): Promise<any>;
    setExtensionId(id: string): Promise<any>;
    listPosts(): Promise<any[]>;
    listPostsDelta(haveBaseline: boolean, changedNames?: string[] | null): Promise<any>;
    getTagGroups(): Promise<any>;
    setTagGroups(groups: unknown): Promise<any>;
    getTagTypes(): Promise<any>;
    setTagTypes(types: unknown, labels?: unknown): Promise<any>;
    getUngrouped(): Promise<any>;
    setUngrouped(keys: unknown): Promise<any>;
    getPosterFolders(): Promise<any>;
    setPosterFolders(data: unknown): Promise<any>;
    getPosterTags(): Promise<any>;
    setPosterTags(data: unknown): Promise<any>;
    getManualGroups(): Promise<any>;
    setManualGroups(groups: unknown): Promise<any>;
    getFolders(): Promise<any>;
    setFolders(data: unknown): Promise<any>;
    getCollections(): Promise<any>;
    setCollections(data: unknown): Promise<any>;
    getTabs(): Promise<any>;
    setTabs(data: unknown): Promise<any>;
    openExternal(url: string): Promise<any>;
    openImageWindow(image: string): Promise<any>;
    showInFolder(file: string): Promise<any>;
    getAppInfo(): Promise<any>;
    getPrefs(): Promise<any>;
    setPref(key: string, value: unknown): Promise<any>;
    imageDataUrl(image: string): Promise<string | null>;
    deletePost(image: string): Promise<any>;
    updateTags(image: string, tags: unknown, patch?: unknown): Promise<any>;
    importPosts(posts: unknown): Promise<any>;
    clearAll(): Promise<any>;
    exportSave(filename: string, bytes: Uint8Array | ArrayBuffer): Promise<any>;
    exportComplete(mode?: string): Promise<any>;
    importComplete(bytes: Uint8Array | ArrayBuffer): Promise<any>;
    pickSaveFolder(): Promise<any>;
    onSaveFolderProgress(cb: (p: any) => void): void;
    getBackup(): Promise<any>;
    setBackup(patch: unknown): Promise<any>;
    pickBackupDir(): Promise<any>;
    runBackup(): Promise<any>;
    importImages(): Promise<any>;
    onBackupStart(cb: (...args: any[]) => void): void;
    onBackupDone(cb: (...args: any[]) => void): void;
    listTrash(): Promise<any[]>;
    restorePost(image: string): Promise<any>;
    emptyTrash(): Promise<any>;
    deleteFromTrash(image: string): Promise<any>;
    onPostsChanged(cb: (names: string[] | null) => void): void;
    setTitleBarOverlay(opts: unknown): Promise<any>;
  }

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
  // needed (see backlog memory 「window.corpusXxx → export/import」).

  // ---- renderer/image-tab.ts — P4-B slice⑮: converts the image-tab detail view
  // (#imageTabView) off the old push (viewer.js built a full model and called
  // window.corpusImageTab.render(model) from ~8 call sites) to a PULLED source,
  // same shape as the grid sources (⑩/⑫). viewer.js writes only the tab identity
  // (corpusStore's 'activeImageTab' — id/recs/idx, the one slice of tab state
  // migrated ahead of the full tabs→store move in ⑯) + still owns 'inspectedKey'
  // (state→store phase); get() crosses both with posts-data.ts (library
  // changes — a deleted post degrades to the missing state live with no viewer
  // push, exactly what the posts-data.ts comment above anticipated). Commands
  // (index step / inspector toggle / close tab) dispatch back through
  // window.corpusViewer — this file only computes, it never mutates tab state.
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
  interface CorpusImageTabSource {
    configure(cfg: { gallery: { buildGroupGalleryItems(g: any): { src: string; alt: string; video: boolean }[] }; labels: Record<string, string> }): void;
    get(): CorpusImageTabModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }

  // ---- renderer/tabs.ts — P4-B slice⑯: converts the tab strip (#tabBarInner) off
  // the old push (viewer.js built a TabsModel via renderTabs() and called
  // window.corpusTabs.render(model) from ~15 call sites) to a PULLED source, same
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

  // ---- renderer/qf-pop.js — sidebar value flyout ----
  interface CorpusQfPopItem {
    [key: string]: any;
  }
  interface CorpusQfPopModel {
    openId: number;
    /** Bumped only on a fresh open (not on a pick) — the island keys its root on this
        so picks re-render in place (group/find preserved). */
    sessionId?: number;
    anchorRect: CorpusAnchorRect;
    items: CorpusQfPopItem[];
    showFind?: boolean;
    /** Left-pane "all" label for the two-pane (grouped tag) layout. */
    allGroupLabel?: string;
    findPlaceholder?: string;
    searchModeTitle?: string;
    exactLabel?: string;
    fuzzyLabel?: string;
    exactHint?: string;
    fuzzyHint?: string;
    footerLabel?: string;
    onManage?(): void;
    onPick(item: CorpusQfPopItem): void;
    [extra: string]: any;
  }
  // CorpusQfPop (the open/close/get/subscribe API) removed — qf-pop.ts is a real
  // ES module now, imported directly by its consumers.

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

  // ---- renderer/inspector.js / renderer/edit-overlay.js — model mechanics
  // shared; the deep field lists live in viewer.js's model builders. ----
  // Tag-editing callbacks the post/poster inspector wires to TagEditor.tsx
  // (_shared) — its onAdd/onRemove/onToggle/onContextMenu props are all
  // required, so these mirror that exactly (Inspector.tsx invokes
  // onAdoptSourceTag/onFolderToggle directly too, same "always provided"
  // shape). Kept OFF CorpusEditOverlayModel below: EditOverlay.tsx wires the
  // very same TagEditor props from that model, but renderer/edit-overlay.ts's
  // open() spreads Omit<CorpusEditOverlayModel,'openId'> without the narrowing
  // cast renderer/inspector.ts's open() already has, so required members there
  // would need a cast this pass doesn't add (out of scope: viewer.ts /
  // globals.d.ts only) — it keeps falling through the index signature instead,
  // same as before this pass.
  interface CorpusTagEditorCallbacks {
    onTagAdd(tag: string): void;
    onTagRemove(tag: string): void;
    onTagToggle(tag: string): void;
    onTagContextMenu(tag: string, x: number, y: number): void;
  }
  interface CorpusInspectorModel extends CorpusTagEditorCallbacks {
    kind: 'post' | 'poster';
    openId: number;
    onClose(): void;
    // Post-only (Inspector.tsx renders these when present).
    onOpenExternal?(): void;
    onSauce?(): void;
    onAscii?(): void;
    onPosterJump?(): void;
    onAdoptSourceTag(tag: string): void;
    // Poster-only.
    onPosterPosts?(): void;
    onFolderToggle(id: string): void;
    onFolderCreate?(): void;
    [extra: string]: any;
  }
  // CorpusInspector (the open/refresh/close/get/subscribe API) removed —
  // inspector.ts is a real ES module now, imported directly by its consumers.
  // NOT extending CorpusTagEditorCallbacks — see the comment above that
  // interface for why (renderer/edit-overlay.ts's open() needs a narrowing
  // cast this pass doesn't add; onTagAdd/onTagRemove/onTagToggle/
  // onTagContextMenu keep falling through the index signature below, same as
  // before this pass). viewer.ts's own onTagAdd/etc. literals stay directly
  // annotated at their call sites regardless.
  interface CorpusEditOverlayModel {
    openId: number;
    onCancel?(): void;
    onSave?(): void;
    [extra: string]: any;
  }

  // ---- renderer/sidebar.ts — the two filter-row columns (P4-B slice⑰: converted
  // from a PUSHED bridge — viewer built a full model incl. labels and called
  // render()/renderPoster() — to a PULLED source, same shape as the grid/image-tab/
  // tabs sources. Labels are NOT in the model: the islands resolve their own static
  // row names via t() and the 作品/キャラ custom label via corpusTags.getTagLabels(),
  // the same "island resolves its own i18n" pattern GlassSelect/SectionTitle use.
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

  // ---- #selectionBar bulk-action bar. viewer keeps the container's show/hide + the
  // delegated #selectionBar click handler (data-act); SelectionBar.tsx (P4-B slice⑱)
  // derives count/allSelected/groupDisabled itself from corpusStore's 'selectedSet' +
  // 'postGroups' (the old renderer/selection-bar.ts push bridge was deleted — no callers
  // left, same as renderer/empty.ts below). ----

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
  // 'navCanForward') + t(), and calls window.corpusViewer.navBack/navForward/
  // resetAllFilters/resetPosterFilters directly for the actions (the old
  // renderer/activebar.ts push bridge was deleted — no callers left). Portaled into
  // sub-mounts BESIDE the chips containers, which stay their own island. ----

  // ---- renderer/confirm.js — shared confirm modal (#confirmOverlay). viewer opens it with
  // a message + optional skip/keyword gate + callbacks; the island renders it. ----
  interface CorpusConfirmConfig {
    message: string;
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

  // ---- renderer/searchbox.ts — a real ES module (named exports: init/handlers) now.
  // Only the handlers payload contract stays here as a cross-module data shape (viewer
  // produces it, the searchbox island pulls it). ----
  interface CorpusSearchBoxHandlers {
    getSuggestions(q: string): any[];
    onPick(item: any): void;
    onConfirmText(): void;
  }

  // ---- island-registered globals (the islands themselves assign these) ----
  interface CorpusSettings {
    open(): void;
    close(): void;
    isOpen(): boolean;
  }
  // renderer/query-chips.ts — a real ES module (named exports: createQueryBuilder/
  // getModel/subscribe/dispatch) now, imported directly by query-chips/index.tsx.
  interface CorpusLightbox {
    open(items: any[], start?: number): void;
    close(): void;
    isOpen(): boolean;
    setLabels(l: Record<string, string> | null | undefined): void;
  }

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

  interface Window {
    corpus: CorpusPreload;
    // renderer/ipc.ts — the P4 IPC→service seam. Same shape as the raw bridge; viewer.ts
    // calls this instead of window.corpus directly (see renderer/ipc.ts for why).
    corpusIpc: CorpusPreload;
    corpusStore: CorpusStore;
    corpusViewer?: CorpusViewer;
    corpusSettings: CorpusSettings;
    corpusLightbox: CorpusLightbox;
    corpusImageTabSource: CorpusImageTabSource;
    // vendor-react/index.ts assigns these; every island reaches React through
    // them at runtime (build.mjs REACT_GLOBALS) — imports are type-only.
    React: typeof import('react');
    ReactDOM: typeof import('react-dom');
    ReactDOMClient: typeof import('react-dom/client');
    ReactJsxRuntime: typeof import('react/jsx-runtime');
    // Pre-island stash (only the lightbox still replays one — the others load in the
    // single bundle before viewer runs, so render() always reaches a live subscriber).
    __corpusLbLabels?: Record<string, string>;
    JSZip?: any;
  }
}
