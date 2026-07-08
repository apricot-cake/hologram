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
// vite.config.mjs. This ambient declaration lets the STRICT islands tsc treat those
// side-effect imports as resolved (empty module) so it never pulls the plain-JS-style
// service .ts files into this program — they are type-checked by tsconfig.renderer.json
// (the same isolation the @ts-ignore'd corpus-viewer-bundle import relies on).
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

  // ---- renderer/i18n.js — window.corpusI18n resolves after prefs are read ----
  interface CorpusI18nApi {
    lang: string;
    resolved: 'ja' | 'en';
    getMessage(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  }

  // ---- renderer/search.js — shared search-mode + fuzzy matching utilities ----
  interface CorpusSearch {
    getMode(): 'normal' | 'fuzzy';
    isFuzzy(): boolean;
    setMode(m: 'normal' | 'fuzzy'): void;
    toggle(): void;
    applyMode(m: string): void;
    subscribe(cb: (mode?: string) => void): CorpusUnsubscribe;
    onChange(cb: (mode?: string) => void): CorpusUnsubscribe;
    normalize(s: unknown): string;
    isSubsequence(hay: string, needle: string): boolean;
    approxSubstring(hay: string, needle: string, maxErr: number): boolean;
    compile(query: string): (hay: string) => boolean;
    fuzzy(hay: string, query: string): boolean;
  }

  // ---- renderer/ui.js ----
  interface CorpusUI {
    notify(msg: unknown): void;
    escapeHtml(s: unknown): string;
  }

  // ---- renderer/theme.js ----
  interface CorpusTheme {
    apply(pref: string): void;
    get(): string;
    set(pref: string, persist?: boolean): void;
    resolve(): string;
    applyTitleBar(open?: boolean): void;
  }

  // ---- renderer/folders.js — shared post-folder domain. The full CorpusFoldersApi
  // shape (18 methods) lives in renderer/types/renderer-globals.d.ts; only onChange
  // is needed from the islands side (StoreSubscriptions, App.tsx), declared here as
  // a partial merge (TS unions same-named interface members across files sharing a
  // tsconfig — both declarations of onChange must stay identical).
  interface CorpusFoldersApi {
    onChange(cb: (kind?: string) => void): void;
  }

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
  }

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
  // below satisfy (plus their own configure()/etc., which GridMount never touches).
  interface CorpusGridSource {
    get(): CorpusGridModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }
  // items (postGroups) + layout inputs (view/cardSize/tileSize/listThumb) live in
  // corpusStore already (slice④); configure() sets the invariant callbacks ONCE
  // (modelOf/keyOf/labels/onAspect never change identity meaningfully across
  // renders — only items+layout do). setLiveColumnWidth is the one exception: a
  // size-slider drag reflow that deliberately stays OUT of the store (mid-drag
  // store writes would be wasteful — slice④'s reasoning) — a thin ephemeral
  // override read by get(), cleared on commit.
  interface CorpusPostGridSource extends CorpusGridSource {
    configure(cfg: { modelOf(item: any, i: number): any; keyOf(item: any, i: number): string | number | null | undefined; labels: any; onAspect(cap: string, ar: string): void }): void;
    setLiveColumnWidth(px: number | null): void;
  }
  // Poster grid (P4-B slice⑫): same shape, minus onAspect (poster avatars don't
  // report a learned aspect ratio) and minus setLiveColumnWidth — the poster size
  // slider already commits corpusIpc.setPref on every 'input' tick (no separate
  // mid-drag/commit split like the post slider), so writing corpusStore on every
  // tick too is no NEW cost, and a live-override side channel isn't needed.
  interface CorpusPosterGridSource extends CorpusGridSource {
    configure(cfg: { modelOf(item: any, i: number): any; keyOf(item: any, i: number): string | number | null | undefined; tagTitle: string; infoTitle: string }): void;
  }

  // ---- renderer/posts-data.ts — P4-B slice⑪: the "allPosts changed" choke point.
  // allPosts itself stays a viewer.js `let` (its real shape, CorpusPost, is a
  // renderer-only type — this project doesn't need it; `any[]` is the deliberate
  // pass-through, same reasoning as CorpusGridModel's items). Nobody subscribes
  // from an island yet — this exists so a later slice (⑫/⑮/⑯/⑰, all of which read
  // allPosts today only via a viewer push) has something to pull from.
  interface CorpusPostsDataService {
    get(): any[];
    sync(next: any[]): void;
    generation(): number;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }

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
  interface CorpusQfPop {
    open(model: Omit<CorpusQfPopModel, 'openId'>): void;
    close(): void;
    get(): CorpusQfPopModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }

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
  interface CorpusContextMenu {
    // biome-ignore lint/suspicious/noConfusingVoidType: void is the intentional "close the menu" return
    open(model: { items: CorpusMenuItem[]; x: number; y: number }, onPick?: (item: CorpusMenuItem) => CorpusMenuItem[] | void): void;
    close(): void;
    pick(item: CorpusMenuItem): void;
    get(): CorpusContextMenuModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }

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
  interface CorpusKindMenu {
    open(model: CorpusKindMenuModel): void;
    close(): void;
    get(): CorpusKindMenuModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }

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
    onApply(fields: any): void;
    onRemove(): void;
    [extra: string]: any;
  }
  interface CorpusFilterPopover {
    open(model: Omit<CorpusFilterPopoverModel, 'openId'>): void;
    close(): void;
    get(): CorpusFilterPopoverModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }

  // ---- renderer/inspector.js / renderer/edit-overlay.js — model mechanics
  // shared; the deep field lists live in viewer.js's model builders. ----
  interface CorpusInspectorModel {
    kind: 'post' | 'poster';
    openId: number;
    [extra: string]: any;
  }
  interface CorpusInspector {
    open(model: Omit<CorpusInspectorModel, 'openId'>): void;
    refresh(partial: Record<string, unknown>): void;
    close(): void;
    get(): CorpusInspectorModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }
  interface CorpusEditOverlayModel {
    openId: number;
    [extra: string]: any;
  }

  // ---- renderer/sidebar.js — the two filter-row columns. viewer builds each model
  // (buildSidebarModel / buildPosterSidebarModel); the islands render them. Clicks route
  // through viewer's own delegated #filterRows / #posterFilterRows handlers, so no
  // callbacks here. Two channels (post / poster) so one column never re-renders the other. ----
  interface CorpusSidebarModel {
    title: string;
    openCat: string | null; // the flyout cat with .qf-open (null = none)
    clip: { label: string; active: boolean; count: number; clearVisible: boolean; emptyTip: string; emptyAria: string };
    multi: { label: string; active: boolean };
    labels: Record<string, string>; // per-row name, keyed by row key
    badges: Record<string, number>; // per-row active-filter count
    visible: { work: boolean; character: boolean }; // 種別 progressive disclosure
  }
  // Poster column (#posterFilterRows): a leaner twin — no clip/multi toggles, and the
  // rows are keyed by their full poster-* cat (data-qfrow === data-badge). work / character
  // / tag / instance are progressively disclosed once posters carry such values.
  interface CorpusPosterSidebarModel {
    title: string;
    openCat: string | null; // the poster-* flyout cat with .qf-open (null = none)
    labels: Record<string, string>; // per-row name, keyed by poster-* row key
    badges: Record<string, number>; // per-row active leaf count (poster query shadow)
    visible: { work: boolean; character: boolean; tag: boolean; instance: boolean };
  }
  interface CorpusSidebar {
    render(model: CorpusSidebarModel | null): void;
    get(): CorpusSidebarModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
    renderPoster(model: CorpusPosterSidebarModel | null): void;
    getPoster(): CorpusPosterSidebarModel | null;
    subscribePoster(cb: () => void): CorpusUnsubscribe;
  }

  // ---- renderer/selection-bar.js — #selectionBar bulk-action bar. viewer builds the
  // model in updateSelectionBar(); the island renders the buttons + count. Clicks route
  // through viewer's delegated #selectionBar handler (data-act), so no callbacks here. ----
  interface CorpusSelectionBarModel {
    count: number;
    countLabel: string;
    selectAllLabel: string; // toggles 全選択 ⇄ 選択解除
    groupDisabled: boolean;
    deleteDisabled: boolean;
    labels: { tag: string; folder: string; group: string; delete: string; cancel: string };
  }
  interface CorpusSelectionBar {
    render(model: CorpusSelectionBarModel | null): void;
    get(): CorpusSelectionBarModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }

  // ---- #emptyState placeholder — viewer keeps the container's show/hide + the
  // delegated CTA click handler; EmptyState.tsx (P4-B slice⑩/⑫) derives the
  // variant itself from corpusStore instead of a pushed bridge (the old
  // renderer/empty.js bridge was deleted — no callers left). ----
  type CorpusEmptyVariant = 'firstRun' | 'filtered' | 'posterFirstRun';

  // ---- renderer/format.ts — the MirrorStatus island derives the
  // backup rail's relative/absolute time itself now, so it needs these two formatters
  // (partial: only what the island calls; viewer.ts sees the full CorpusFormatApi via its
  // own renderer-globals.d.ts).
  interface CorpusFormat {
    fmtBackupTime(iso: string | null, labels: { today: string; yesterday: string }): string;
    fmtTime(iso: string | null): string;
  }

  // ---- renderer/activebar.js — the query-builder FRAME (#postActiveBar / #posterActiveBar):
  // nav 戻る/進む, フィルター title, empty hint, result count, リセット, and the ⓘ help
  // popover. viewer builds the model in buildActivebarModel(); the island renders the frame
  // (portaled into sub-mounts BESIDE the chips containers, which stay their own island). The
  // count/reset/empty/nav are data; nav/reset/help must call back, so the model carries
  // callbacks (like confirm.js). Post + poster in one model (one bar shown at a time). ----
  interface CorpusActivebarSide {
    emptyHint: string;
    emptyVisible: boolean; // the empty-bar hint shows while nothing is filtered
    countLabel: string;
    resetLabel: string;
    resetVisible: boolean; // リセット shows only once something is filtered/searched
  }
  interface CorpusActivebarModel {
    post: CorpusActivebarSide & {
      label: string; // the フィルター section title (post bar only)
      navBackDisabled: boolean;
      navFwdDisabled: boolean;
    };
    poster: CorpusActivebarSide; // no nav / no title on the poster bar
    help: { title: string; rows: string[] };
    onNavBack(): void;
    onNavFwd(): void;
    onReset(): void;
    onPosterReset(): void;
  }
  interface CorpusActivebar {
    render(model: CorpusActivebarModel | null): void;
    get(): CorpusActivebarModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }

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
  interface CorpusConfirm {
    open(config: CorpusConfirmConfig): void;
    close(): void;
    get(): CorpusConfirmModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }
  interface CorpusEditOverlay {
    open(model: Omit<CorpusEditOverlayModel, 'openId'>): void;
    refresh(partial: Record<string, unknown>): void;
    close(): void;
    get(): CorpusEditOverlayModel | null;
    subscribe(cb: () => void): CorpusUnsubscribe;
  }

  // ---- renderer/searchbox.js — viewer registers handlers; island pulls lazily ----
  interface CorpusSearchBoxHandlers {
    getSuggestions(q: string): any[];
    onPick(item: any): void;
    onConfirmText(): void;
  }
  interface CorpusSearchBox {
    init(h: CorpusSearchBoxHandlers): void;
    handlers(): CorpusSearchBoxHandlers | null;
  }

  // ---- island-registered globals (the islands themselves assign these) ----
  interface CorpusSettings {
    open(): void;
    close(): void;
    isOpen(): boolean;
  }
  interface CorpusTabsIsland {
    render(model?: any): void;
  }
  interface CorpusQueryChipsIsland {
    render(id: string, model: any): void;
  }
  interface CorpusImageTabIsland {
    render(model?: any): void;
  }
  interface CorpusLightbox {
    open(items: any[], start?: number): void;
    close(): void;
    isOpen(): boolean;
    setLabels(l: Record<string, string> | null | undefined): void;
  }
  interface CorpusAboutIcon {
    mount(el: HTMLCanvasElement | null): { destroy(): void };
  }

  // ---- renderer/trash.ts — trash domain, read by both viewer.ts's project (via
  // tsconfig.renderer.json's shared "files") and this strict islands project (the
  // Settings > Trash island calls it directly) ----
  interface CorpusTrashApi {
    listTrash(): Promise<any[]>;
    restorePost(image: string): Promise<any>;
    deleteFromTrash(image: string): Promise<any>;
    emptyTrash(): Promise<any>;
  }

  // ---- renderer/backup.ts — auto-backup domain, read by both viewer.ts's project
  // (the #mirrorStatus rail) and this strict islands project (the Settings > データ
  // island calls it directly) ----
  interface CorpusBackupApi {
    getBackup(): Promise<any>;
    setBackup(patch: unknown): Promise<any>;
    pickBackupDir(): Promise<any>;
    runBackup(): Promise<any>;
    onBackupStart(cb: (...args: any[]) => void): void;
    onBackupDone(cb: (...args: any[]) => void): void;
  }

  // ---- renderer/posts.ts — post-record CRUD/import/export + save-folder move
  // domain, read by both viewer.ts's project (list/delete/tags/import/clearAll/
  // change-watch) and this strict islands project (the Settings > データ island
  // calls the save-folder/export/import/import-media methods directly) ----
  interface CorpusPostsApi {
    listPosts(): Promise<any[]>;
    listPostsDelta(haveBaseline: boolean, changedNames?: string[] | null): Promise<any>;
    imageDataUrl(image: string): Promise<string | null>;
    deletePost(image: string): Promise<any>;
    updateTags(image: string, tags: unknown, patch?: unknown): Promise<any>;
    importPosts(posts: unknown): Promise<any>;
    importImages(): Promise<any>;
    clearAll(): Promise<any>;
    exportSave(filename: string, bytes: Uint8Array | ArrayBuffer): Promise<any>;
    exportComplete(mode?: string): Promise<any>;
    importComplete(bytes: Uint8Array | ArrayBuffer): Promise<any>;
    pickSaveFolder(): Promise<any>;
    onSaveFolderProgress(cb: (p: any) => void): void;
    onPostsChanged(cb: (names: string[] | null) => void): void;
  }

  interface Window {
    corpus: CorpusPreload;
    // renderer/ipc.ts — the P4 IPC→service seam. Same shape as the raw bridge; viewer.ts
    // calls this instead of window.corpus directly (see renderer/ipc.ts for why).
    corpusIpc: CorpusPreload;
    corpusTrash: CorpusTrashApi;
    corpusBackup: CorpusBackupApi;
    corpusPosts: CorpusPostsApi;
    corpusFolders: CorpusFoldersApi;
    corpusStore: CorpusStore;
    corpusI18n: Promise<CorpusI18nApi>;
    corpusSearch: CorpusSearch;
    corpusUI: CorpusUI;
    corpusTheme?: CorpusTheme;
    corpusViewer?: CorpusViewer;
    corpusPostGridSource: CorpusPostGridSource;
    corpusPosterGridSource: CorpusPosterGridSource;
    corpusPostsData: CorpusPostsDataService;
    corpusQfPop: CorpusQfPop;
    corpusContextMenu: CorpusContextMenu;
    corpusKindMenu: CorpusKindMenu;
    corpusFilterPopover: CorpusFilterPopover;
    corpusInspector: CorpusInspector;
    corpusEditOverlay: CorpusEditOverlay;
    corpusSidebar: CorpusSidebar;
    corpusSelectionBar: CorpusSelectionBar;
    corpusFormat: CorpusFormat;
    corpusActivebar: CorpusActivebar;
    corpusConfirm: CorpusConfirm;
    corpusSearchBox?: CorpusSearchBox;
    corpusSettings: CorpusSettings;
    corpusTabs: CorpusTabsIsland;
    corpusQueryChips: CorpusQueryChipsIsland;
    corpusLightbox: CorpusLightbox;
    corpusImageTab: CorpusImageTabIsland;
    corpusAboutIcon?: CorpusAboutIcon;
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
