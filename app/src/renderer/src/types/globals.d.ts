// Window-global contracts for the renderer's React components. Two kinds of
// declaration live here: (1) genuine cross-boundary ambients — the preload
// contextBridge surface (window.hologram) and the CSS side-effect import, which
// no `import` statement can express — and (2) data-shape interfaces shared
// between a producing service module and its consuming component(s), kept
// ambient (no import needed) rather than exported+imported per call site. Most
// producing modules used to be plain-JS push bridges with no ambient/tsc
// coverage at all (TypeScript stage 1, BACKLOG 採用#1); that migration finished
// module-by-module, and by 2026-07 every one of them was a real ES module. The
// per-module "already converted, ambient no longer needed" tombstone comments
// that migration left behind were removed 2026-07-30 (#231) along with the
// interfaces they used to introduce; only the contracts still read below
// survive. `HologramI18nApi` (a pure data shape) moved beside its owning module,
// services/i18n.ts, in the same pass — see that file.

export {};

// Vite turns CSS imports into injected stylesheets; for tsc they are side-effect
// only modules (settings imports './styles.css').
declare module '*.css' {}

declare global {
  type HologramUnsubscribe = () => void;

  // ---- app/src/preload/index.ts — the full contextBridge IPC surface (window.hologram). The
  // type is exported by the implementation itself (typeof the exposed api object,
  // Issue #17), so this alias can never drift from what the bridge actually
  // exposes — the old hand-maintained interface mirror is gone. In THIS program
  // 'electron' resolves to types/electron-shim.d.ts (tsconfig paths; see
  // the shim's comment); tsconfig.node.json checks the same file against the real
  // electron types. ----
  type HologramPreload = import('../../../preload/index').HologramPreload;

  // ---- services/grid.ts — a PULLED model source per virtualized grid (post and
  // poster were both converted off the old push bridge; nothing instantiates a
  // push bridge anymore). viewer.js still builds items/layout
  // inputs, but writes them to hologramStore instead of calling a render()/patch()
  // method — the source derives the model itself. `paint` is internal (bumped on
  // every get() so a fresh object ref reaches React even when field VALUES repeat).
  // Selection/inspected are NOT part of this model — Cell derives both from
  // hologramStore subscriptions directly (see Grid.tsx / PosterGrid.tsx).
  interface HologramGridModel {
    items: any[];
    itemsKey: string | number;
    modelOf(item: any, i: number): any;
    keyOf?(item: any, i: number): string | number | null | undefined;
    columnCount?: number;
    columnWidth?: number;
    rowGutter?: number;
    itemHeightEstimate?: number;
    square?: boolean;
    // #282: the item Ctrl+wheel zoom wants held still, and where on screen to hold
    // it. Rides on the model rather than hologramStore for the same reason the live
    // column width does — it is a side channel between one gesture and one grid, and
    // the grid island (not the zoom) is what turns it back into a scroll position.
    zoomAnchor?: import('../services/zoom-anchor').ZoomAnchor | null;
    labels?: any;
    onAspect?(cap: string, aspectRatio: string): void;
    paint: number;
    [extra: string]: any;
  }
  // The shape GridMount (_shared/VirtualGrid.tsx) actually consumes — it only
  // ever calls get()/subscribe(), so this is the minimal contract both sources
  // (services/grid.ts's hologramPostGridSource/hologramPosterGridSource, real ES
  // module exports now) satisfy, plus their own configure()/etc., which GridMount
  // never touches.
  interface HologramGridSource {
    get(): HologramGridModel | null;
    subscribe(cb: () => void): HologramUnsubscribe;
  }
  // Drag range selection (#484). The virtualized grid host owns the gesture and the
  // hit test — it is the only place cell rectangles exist (masonic's positioner) —
  // and drives selection through this sink. `additive` = Ctrl/Cmd or Shift was held
  // when the band started; `update` receives the touched indices (ascending) on
  // every frame the hit set changes, so it must be idempotent.
  interface HologramMarqueeSink {
    begin(additive: boolean): void;
    update(indices: number[]): void;
    end(): void;
    cancel(): void;
  }

  // ---- services/image-tab.ts — converts the image-tab detail view
  // (#imageTabView) off the old push (viewer.js built a full model and called
  // render(model) on it from ~8 call sites) to a PULLED source, same shape as
  // the two grid sources. viewer.js writes only the tab identity (hologramStore's
  // 'activeImageTab' — id/recs/idx, the one piece of tab state migrated ahead of
  // the full tabs→store move) + still owns 'inspectedKey' (state→store
  // phase); get() crosses both with posts-data.ts (library changes — a deleted
  // post degrades to the missing state live with no viewer push, exactly what
  // posts-data.ts's own comment anticipated). Commands (index step /
  // inspector toggle / close tab) dispatch back to viewer.ts via configure()
  // callbacks (DI'd off its old shared bridge when image-tab-builder.ts was
  // extracted) — this file only computes, it never mutates tab state. A real ES module
  // (named export `hologramImageTabSource`) now — no ambient Window-shaped
  // interface needed for it (HologramImageTabModel stays: the shared data shape
  // between image-tab.ts and this component).
  interface HologramImageTabModel {
    items: { src: string; alt?: string; video?: boolean }[];
    idx: number;
    missing?: boolean;
    inspectorOpen?: boolean;
    labels: Record<string, string>;
    onIndexChange?(i: number): void;
    onToggleInspector?(): void;
    onCloseTab?(): void;
  }

  // ---- services/tabs.ts — converts the tab strip (#tabBarInner) off
  // the old push (viewer.js built a TabsModel via renderTabs() and pushed it to a
  // shared render bridge from ~15 call sites) to a PULLED source, same
  // shape as the grid/image-tab sources. viewer.js no longer owns tabs/
  // activeTabId/tabEditingId as closure state — hologramStore's keys of the same
  // names ARE the state; it keeps only the mutation functions (switchTab/addTab/…)
  // and all #tabBarInner event delegation (TabBarEvents, App.tsx, unchanged).
  // tabTitleOf/tabIcons/pinSvg are viewer-built invariants handed over once
  // (configure), the same "configure once" shape as the grid sources.
  interface HologramTabModel {
    id: string;
    title: string;
    icon: string;
    active?: boolean;
    pinned?: boolean;
    showClose?: boolean;
  }
  interface HologramTabsModel {
    tabs: HologramTabModel[];
    editingId?: string | null;
    closeTitle?: string;
    newTitle?: string;
  }

  // ---- viewer-anchored popup models share this anchor shape (a DOMRect works) ----
  interface HologramAnchorRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  // ---- services/qf-pop-builder.ts (headless pickValue router) ----
  interface HologramQfPopItem {
    [key: string]: any;
  }

  // ---- renderer/menu.js — shared right-click context menu ----
  interface HologramMenuItem {
    label?: string;
    act?: string;
    danger?: boolean;
    checked?: boolean;
    sep?: boolean;
    manage?: boolean;
    icon?: string;
    [extra: string]: any;
  }
  interface HologramContextMenuModel {
    items: HologramMenuItem[];
    x: number;
    y: number;
    // Returning a new items array keeps the menu open (toggle rows); returning
    // nothing closes it. The `| void` arm is that "close" signal — it also lets
    // void-returning pick handlers (the common case) assign cleanly.
    // biome-ignore lint/suspicious/noConfusingVoidType: void is the intentional "close the menu" return
    onPick: ((item: HologramMenuItem) => HologramMenuItem[] | void) | null;
  }

  // ---- renderer/kind-menu.js — tag-kind (work/character/…) menu ----
  interface HologramKindMenuRow {
    kind?: string;
    label?: string;
    dot?: boolean;
    renameable?: boolean;
    checked?: boolean;
    sep?: boolean;
  }
  interface HologramKindMenuModel {
    x: number;
    y: number;
    header?: string;
    renameTitle?: string;
    rows: HologramKindMenuRow[];
    onPick(kind: string): void;
    onRename(kind: string): void;
  }

  // ---- renderer/filter-popover.js — date / engagement / poster-date forms ----
  interface HologramFilterPopoverModel {
    kind: 'date' | 'eng' | 'posterDate';
    openId: number;
    anchorRect: HologramAnchorRect;
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

  // ---- renderer/inspector.js — model mechanics; the deep field lists live in
  // viewer.js's model builders. ----
  // The inspector's tag field edits in place (P2⑦), so the model carries the tag
  // mutations themselves; onTagContextMenu is the kind-menu (a read).
  interface HologramInspectorModel {
    kind: 'post' | 'poster';
    openId: number;
    onClose(): void;
    onTagAdd(tag: string): void;
    onTagRemove(tag: string): void;
    onTagContextMenu(tag: string, x: number, y: number): void;
    /** Open with the caret already in the tag field — the context menu's タグを編集. */
    focusTags?: boolean;
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
  // ---- services/sidebar.ts — the two filter-row columns (converted
  // from a PUSHED bridge — viewer built a full model incl. labels and called
  // render()/renderPoster() — to a PULLED source, same shape as the grid/image-tab/
  // tabs sources. Labels are NOT in the model: the components resolve their own static
  // row names via t() and the 作品/キャラ custom label via hologramTags.getTagLabels(),
  // the same "component resolves its own i18n" pattern every other component uses.
  // Everything else (badges/visible/multi/openCat) is derived from hologramStore
  // keys (postQueryTree/posterQueryTree/multiOnly/qfCat) + hologramTags/hologramFolders/
  // posts-data.ts/hologramListing — no viewer push needed, so viewer's mutation call
  // sites (addFilter/removeFilter/setTagKind/markPostsMutated/…) no longer need a
  // matching re-push; the source's own subscriptions cover it. Two independent
  // sources (post / poster) so a change in one column never re-renders the other. ----
  interface HologramSidebarModel {
    openCat: string | null; // the flyout cat with .qf-open (null = none)
    multi: { active: boolean };
    badges: Record<string, number>; // per-row active-filter count
    visible: { work: boolean; character: boolean }; // 種別 progressive disclosure
  }
  // Poster column (#posterFilterRows): a leaner twin — no multi toggle, and the
  // rows are keyed by their full poster-* cat (data-qfrow === data-badge). work / character
  // / tag / instance are progressively disclosed once posters actually carry such values.
  interface HologramPosterSidebarModel {
    openCat: string | null; // the poster-* flyout cat with .qf-open (null = none)
    badges: Record<string, number>; // per-row active leaf count (poster query shadow)
    visible: { work: boolean; character: boolean; tag: boolean; instance: boolean };
  }

  // ---- #emptyState placeholder — viewer keeps the container's show/hide + the
  // delegated CTA click handler; EmptyState.tsx derives the
  // variant itself from hologramStore instead of a pushed bridge (the old
  // renderer/empty.js bridge was deleted — no callers left). ----
  type HologramEmptyVariant = 'firstRun' | 'filtered' | 'posterFirstRun';

  // ---- services/confirm.ts — shared confirm modal (shadcn AlertDialog). Callers open it
  // with a message + optional skip/keyword gate + callbacks; the component renders it. ----
  interface HologramConfirmConfig {
    message: string;
    description?: string; // present → secondary line under the title (AlertDialogDescription)
    okLabel: string;
    cancelLabel: string;
    skipLabel?: string; // present → show the "don't ask again" checkbox
    keywordPlaceholder?: string; // present → keyword-gated OK (destructive wipe)
    keywordRequired?: string;
    // A THIRD answer beside OK and Cancel (#34's duplicate import: copy /
    // replace / skip). Present → an extra action button, styled as the
    // non-destructive alternative so the destructive OK stays the one that
    // reads as destructive. Absent → the dialog is the two-button one it has
    // always been.
    altLabel?: string;
    onAlt?(result: { skip: boolean }): void;
    // OK is destructive by default (every caller before #34 was a delete or a
    // wipe). false → a plain action button, for a question whose OK is not.
    okDestructive?: boolean;
    onOk(result: { skip: boolean }): void;
    onCancel?(): void;
  }
  interface HologramConfirmModel extends HologramConfirmConfig {
    openId: number;
  }
  // Naming prompt (prompt.ts + PromptHost) — the replacement for window.prompt,
  // which Electron's renderer refuses ("prompt() is not supported.").
  interface HologramPromptConfig {
    title: string;
    value?: string; // initial input value (rename passes the current name)
    placeholder?: string;
    okLabel: string;
    cancelLabel: string;
    /** Called with the trimmed value; never called with an empty one. */
    onOk(value: string): void;
    onCancel?(): void;
  }
  interface HologramPromptModel extends HologramPromptConfig {
    openId: number;
  }
  // Bulk tag dialog (bulk-tag.ts + BulkTagDialog) — "タグを追加" on the selection
  // bar (P2⑦), the replacement for the retired tag-pop's bulk mode. The staged tags
  // are the dialog's own React state, so nothing here carries them: the renderer
  // supplies only what it alone knows (the vocabulary, the kind menu, the write),
  // and gets the finished list back once, on apply.
  interface HologramBulkTagConfig {
    count: number; // selected posts — the apply button and the toast count them
    tagLabels: Record<string, string>; // TagField's labels bundle
    labels: { title: string; additiveHint: string; apply: string; cancel: string };
    /** Vocabulary/co-occurrence/source-tag groups for the picker, given the tags staged so far. */
    pickerData(tags: string[]): { vocabGroups?: any; coocGroups?: any; srcTagsForPicker?: any };
    /** Right-click a tag → kind menu. onChange re-derives pickerData (a kind change re-sections the vocabulary). */
    onKindMenu(tag: string, x: number, y: number, onChange: () => void): void;
    /** Persist the staged tags onto the selection. The host closes the dialog first. */
    onApply(tags: string[]): void;
  }
  interface HologramBulkTagModel extends HologramBulkTagConfig {
    openId: number;
  }

  // ---- services/searchbox.ts — a real ES module (named exports: init/handlers/
  // registerFocus/focusSearchBox) now. Only the handlers payload contract stays here
  // as a cross-module data shape (viewer produces it, the searchbox component pulls it). ----
  // getSuggestions left with #28: the suggestion ROWS come from the command registry
  // (services/command-registry.ts) now, which the component imports directly. What
  // stays on the bridge is what a pick/confirm DOES — the registry's jump entries call
  // onPick too, so both faces mean the same thing by "picked".
  interface HologramSearchBoxHandlers {
    onPick(item: any): void;
    onConfirmText(): void;
  }

  interface Window {
    hologram: HologramPreload;
  }
}
