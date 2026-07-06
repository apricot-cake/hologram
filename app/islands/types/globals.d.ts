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

  // ---- viewer.js — window.corpusViewer is assembled via Object.assign in
  // several places, so every method is optional. Only what islands call. ----
  interface CorpusViewer {
    setTileOverlay?(v: boolean): void;
    reloadPosts?(): void | Promise<void>;
    confirmClearAll?(): void;
    setSkipDeleteConfirm?(v: boolean): void;
    refreshMirrorStatus?(): void;
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

  // ---- renderer/grid.js — one bridge per virtualized grid ----
  // viewer.js builds the model; the islands consume it. `paint` is internal
  // (bumped by the bridge on every render/repaint/patch so visible cells
  // re-render and modelOf re-reads live viewer state).
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
  interface CorpusGridBridge {
    render(model: Omit<CorpusGridModel, 'paint'> | null): void;
    repaint(): void;
    patch(partial: Partial<CorpusGridModel>): void;
    isActive(): boolean;
    get(): CorpusGridModel | null;
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
    mount(rootEl?: HTMLElement | null): void;
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

  interface Window {
    corpus: CorpusPreload;
    corpusStore: CorpusStore;
    corpusI18n: Promise<CorpusI18nApi>;
    corpusSearch: CorpusSearch;
    corpusUI: CorpusUI;
    corpusTheme?: CorpusTheme;
    corpusViewer?: CorpusViewer;
    corpusGrid: CorpusGridBridge;
    corpusPosterGrid: CorpusGridBridge;
    corpusQfPop: CorpusQfPop;
    corpusContextMenu: CorpusContextMenu;
    corpusKindMenu: CorpusKindMenu;
    corpusFilterPopover: CorpusFilterPopover;
    corpusInspector: CorpusInspector;
    corpusEditOverlay: CorpusEditOverlay;
    corpusSidebar: CorpusSidebar;
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
    // Pre-island stashes: viewer.js may push before an island bundle loads.
    __corpusTabsModel?: any;
    __corpusQueryChips?: Record<string, any>;
    __corpusLbLabels?: Record<string, string>;
    __corpusImageTabModel?: any;
    JSZip?: any;
  }
}
