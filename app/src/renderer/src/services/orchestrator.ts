// Renamed from viewer.ts (2026-07-11): this file is the app's boot orchestrator
// — construction + deps-wiring for every controller/builder cluster extracted
// out of the old monolith. Kept as its own module by deliberate choice rather
// than folded into an App.tsx effect (a dedicated bootstrap module is the norm
// in real React apps). Comments below that say "viewer.ts decomposition" name
// the historical migration project, not this file's current name — left as-is.
// Renderer services are migrating off a shared global bridge to real ES modules
// one wave at a time; the ones imported below are converted, the rest are still
// read via that bridge at call time.
import { treeLeaves, evalNode, hostOf, userKey, facetViewOf, facetSetOp, facetSetNeg, facetDefaultOp, removeCondsMatching as removeCondsMatchingIn } from './query.ts';
import { makeListing, bindNamedPosters } from './listing.ts';
import { newShuffleSeed } from './shuffle.ts';
import { formatCount, formatShortDate } from './format.ts';
import { makeUndoController } from './undo-builder.ts';
import { makeUsers } from './users.ts';
import { notify } from './ui.ts';
import { makeQfPop } from './qf-pop-builder.ts';
import { makeFacets } from './facets.ts';
import { makeCooc } from './cooc.ts';
import { mediaFilesOf, densityImage, percentileFn, makeGallery, loadUngrouped, loadManualGroups } from './records.ts';
import { makeTags, bindTagKindOf, bindPosterFilterVocab, getTagTypes, getTagLabels, getPosterTags, load as loadTags } from './tags.ts';
import { makeTabLabels } from './tab-state.ts';
import { importComplete, importPosts } from './posts.ts';
import { readLegacyZipPosts } from './legacy-zip-import.ts';
import { open as confirmOpen } from './confirm.ts';
import { hologramI18n } from './i18n.ts';
import * as folders from './folders.ts';
import { open as lightboxOpen } from './lightbox.ts';
import { shellReady } from './shell-ready.ts';
import { hologramPostGridSource } from './grid.ts';
import { makePostQueryBuilder, makePosterQueryBuilder, POST_FACET_OPTS, POSTER_FACET_OPTS } from './query-builder.ts';
import { makeKindMenu } from './kind-menu-builder.ts';
import { makeSearchBox } from './search-box-builder.ts';
import { makeCommands } from './command-builder.ts';
import { makePostGridBuilder, bindLoadPosts, bindConfirmClearAll, bindGetSkipDeleteConfirm, bindSetSkipDeleteConfirm } from './post-grid-builder.ts';
import { makePosterGridBuilder } from './poster-grid-builder.ts';
import { makeGridDensity, bindApplyTileOverlay, type HologramSizeTrack } from './grid-density-builder.ts';
import { makeInspector } from './inspector-builder.ts';
import { makeSelectionBar } from './selection-builder.ts';
import { makeBulkEdit } from './bulk-edit-builder.ts';
import { makeTabsController } from './tabs-builder.ts';
import { makeImageTabController } from './image-tab-builder.ts';
import { hologramImageTabSource } from './image-tab.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from './store.ts';
import { hologramIpc } from './ipc.ts';

// Boot readiness signal + the boot/subscription handlers below: real ES exports now,
// instead of the old shared bridge — App.tsx's AppBoot/
// StoreSubscriptions import these directly. Declared here, at true module scope, so
// `export` is legal; each is assigned once by the async IIFE below (viewerReady as
// its very first synchronous statement, the handlers once everything they close
// over is defined) — an ESM import always finishes evaluating this module before
// the importer's own code can read these bindings, so by the time React acts on
// them the real functions are already in place.
export let viewerReady: Promise<void>;
export let bootApp: () => Promise<void>;
export let handleFolderChange: (kind?: string) => void;
export let handlePostsChanged: () => Promise<void>;

// Global keyboard/mouse shortcuts, tab-bar events, inspector-dismiss, and store/IPC
// subscription handlers: the rest of the old shared bridge, converted to real
// ES exports the same way. Each is assigned once, below, at the same
// construction site the old Object.assign registration used to sit at.
export let handleShortcutNavKey: (e: KeyboardEvent) => void;
export let handleShortcutMouseNav: (e: MouseEvent) => void;
export let handleShortcutUndoKey: (e: KeyboardEvent) => void;
export let handleShortcutSelectAllKey: (e: KeyboardEvent) => void;
export let handleShortcutCopyKey: (e: KeyboardEvent) => void;
export let handleShortcutQuickView: (e: KeyboardEvent) => void;
export let handleShortcutArrowNav: (e: KeyboardEvent) => void;
export let handleShortcutSearchFocusKey: (e: KeyboardEvent) => void;
export let handleShortcutSizeKey: (e: KeyboardEvent) => void;
export let handleZoomWheel: (e: WheelEvent) => void;
export let handleEscDismissDetail: (e: KeyboardEvent) => void;
// Outside-click dismissal for the narrow overlay (#259). Back after #243 removed it —
// this time the width test lives in layout-mode.ts, not in the handler's own media query.
export let handleOutsideClickDismissDetail: (e: MouseEvent) => void;
export let handleTabBarKeydown: (e: KeyboardEvent) => void;
export let handleTabBarFocusout: (e: FocusEvent) => void;
export let handleTabBarClick: (e: MouseEvent) => void;
export let handleTabBarAuxclick: (e: MouseEvent) => void;
export let handleTabBarMousedown: (e: MouseEvent) => void;
export let handleTabBarContextmenu: (e: MouseEvent) => void;
export let handleTabBarDblclick: (e: MouseEvent) => void;
export let handleGlobalTabShortcut: (e: KeyboardEvent) => void;
export let handleViewStoreChange: () => void;
export let handleBrowseModeStoreChange: () => void;
export let handlePosterViewStoreChange: () => void;
export let handleSearchQueryStoreChange: () => void;
export let navBack: () => void;
export let navForward: () => void;
export let resetAllFilters: () => void;
export let resetPosterFilters: () => void;
// Bulk-selection actions for the bottom floating bar (redesign §3-4 / P2⑥). The
// FloatingBar component calls these directly (onClick → function), so the old data-act
// #selectionBar delegation is gone. folder takes the clicked button's rect to anchor its
// menu against the bar; tag opens a centered Dialog and needs none.
export let selectionSelectAll: () => void;
export let selectionTag: () => void;
export let selectionFolder: (anchorRect: HologramAnchorRect) => void;
export let selectionGroup: () => void;
export let selectionDelete: () => void;
export let selectionClear: () => void;
// Drag range selection (#484): the virtualized grid host owns the rubber band and the
// hit test (it holds masonic's positioner); these are the selection half it drives.
export let selectionMarquee: HologramMarqueeSink;
// The click half of that same press, one binding per grid (#242). The post grid empties
// the selection and the inspector with it; the poster grid has no selection, so it only
// sends the inspector — the panel both grids share — back to its placeholder.
export let selectionClickBackground: () => void;
export let posterClickBackground: () => void;
// Size-slider bindings for the display popover (P2②): read the current view's size track
// (column-count or px) and apply a slider value. gridDensity owns the geometry math; the
// popover imports these live bindings and calls them on open / drag / commit.
export let getPostSizeTrack: () => HologramSizeTrack | null;
export let applyPostSize: (value: number, min: number, max: number, commit: boolean) => void;
export let getPosterSizeTrack: () => HologramSizeTrack | null;
export let applyPosterSize: (value: number, min: number, max: number) => void;
// Re-roll the shuffle order (#118). The 'random' sort is a pure function of a seed,
// so a new order means a new seed — this replaces it and re-renders. The display
// popover's re-roll button calls it; picking 'random' seeds itself (see the
// sortSelect change listener).
export let rerollShuffle: () => void;
// Go to a browse destination (投稿グリッド / 投稿者グリッド) from the left sidebar.
// The sidebar is the "go to another place" axis (browser address bar / bookmarks),
// so choosing a destination while the image view is up LEAVES it and lands on that
// grid — even when the mode is unchanged (#312). Off the image view it is the plain
// mode switch, so the active destination stays a no-op. Called by LeftSidebar's two
// mode buttons; the folder / saved-search rows leave via applyFolderFilter /
// applySavedSearch below, which do the same before mutating the query.
export let browseTo: (mode: string) => void;
// Apply a library folder as a place filter (redesign §3-1): replace the post query's
// folder facet with the clicked folder, then re-render. The new left sidebar's
// folder rows call this directly (no qf-pop flyout).
export let applyFolderFilter: (id: string) => void;
// Saved searches (#40) are APPLIED, not toggled: clicking one replaces the current
// tab's whole query with the saved condition, so every condition lands in the chip
// bar and stays editable. A folder, by contrast, is one leaf among others. Applying
// rather than nesting is also what keeps a saved search from ever containing another
// one — there is no query-inside-a-query to guard against a cycle.
export let applySavedSearch: (id: string) => void;
// Save the current post query as a new saved search. Returns the new folder, or null
// when the name is blank (the store's own rule).
export let saveCurrentSearch: (name: string) => HologramFolder | null;

// --- Filter bar (redesign §3-2 / P2③) -------------------------------------
// One value-flyout row (from facets.ts's qfValues) — the structural shape the
// filterbar component renders. Kept loose ([k]:any) like HologramQfPopItem: qfValues
// tacks on per-category extras (type/kind/sub/sn/facetDim/ghead/dotTitle).
export interface FilterRow {
  v?: string;
  l?: string;
  on?: boolean;
  count?: number;
  ghead?: string;
  [k: string]: unknown;
}
interface FilterCatBase {
  cat: string;
  label: string;
}
// The operator/exclusion mode of one facet (redesign §4-2 B, Linear「is any of /
// is all of / is not」). 'and'/'or' = positive すべて/どれか; 'exclude' = 「〜以外」
// (every value of the facet negated). 'and' is only offered for multi-value types.
export type FacetMode = 'and' | 'or' | 'exclude';
// A category whose editor is a value list (checklist / grouped-tag two-pane).
export interface FilterCatValues extends FilterCatBase {
  editor: 'values';
  showFind: boolean;
  // multi = a すべて/どれか-capable type (multiValueTypes): the editor offers the
  // 3-way どれか/すべて/〜以外; other value types offer the 2-way 含む/〜以外.
  multi: boolean;
  values(): FilterRow[];
  pick(it: FilterRow): void;
  // Read/write the facet's current mode (drives the editor's mode segment). mode()
  // reflects the live tree; setMode() rewrites it (op toggle / negate-all) + refreshes.
  mode(): FacetMode;
  setMode(m: FacetMode): void;
  manage?: () => void;
  // Folder facet only (#41): 「このフォルダのみ」. A folder condition covers the
  // subtree by default, and this narrows it to the folder's own posts. It is a
  // property of the condition, not a mode — hence its own switch rather than a
  // fourth segment next to どれか/すべて/〜以外.
  only?: { get(): boolean; set(v: boolean): void };
}
// A category whose editor is the date-range form (post date or the 3-dim poster date).
export interface FilterCatDate extends FilterCatBase {
  editor: 'date';
  dimOptions: Array<{ value: string; label: string }>;
  apply(f: { dateField?: string; from?: string; to?: string }): void;
}
// A category whose editor is the engagement form (type + 以上/以下 + min).
export interface FilterCatEng extends FilterCatBase {
  editor: 'eng';
  typeOptions: Array<{ value: string; label: string }>;
  opGte: string;
  opLte: string;
  apply(f: { engType?: string; min?: string; op?: string }): void;
}
export type FilterCat = FilterCatValues | FilterCatDate | FilterCatEng;
// The "+ フィルタ" menu: the facet categories the current browse mode offers,
// each carrying its own live value/apply closures (the component only renders +
// routes). Recomputed per open so counts/labels/vocab are fresh.
export let filterCategories: () => FilterCat[];

// One active-filter chip (redesign §3-2 / P2③ タスク2) — a facet currently in the
// query tree, rendered Linear-style (1 facet = 1 chip). `cat` matches a
// filterCategories() entry so a chip click reopens that facet's editor; `remove`
// clears the whole facet. Recomputed from the active QB tree on every tree change.
export interface ActiveFilter {
  cat: string; // matches a filterCategories() entry (editor to reopen on click)
  type: string; // leaf type (icon cue)
  label: string; // category label
  editor: 'values' | 'date' | 'eng';
  mode: FacetMode; // positive すべて/どれか, or 「〜以外」
  values: string[]; // per-value labels shown inside the chip
  remove(): void; // clear the whole facet (all its leaves)
}
export let activeFilters: () => ActiveFilter[];

// One open facet-editor popup = one nav-history entry (#144 確定未決2: エディタ
// 1セッション1エントリ). The filterbar's ValueEditor/FormEditor bracket their
// mount with these; while a session token is live, tabs-builder coalesces the
// per-pick records into the entry the first pick pushed.
let _filterEditSession: object | null = null;
export function beginFilterEditSession(): void {
  _filterEditSession = {};
}
export function endFilterEditSession(): void {
  _filterEditSession = null;
}

(async () => {
  // The Promise executor runs synchronously, so this is assigned before any other
  // code executes — the `!` tells tsc what the executor already guarantees.
  let resolveViewerReady!: () => void;
  viewerReady = new Promise<void>((r) => {
    resolveViewerReady = r;
  });

  // --- i18n ---
  // Messages live in i18n.js (loaded before this script via index.html).
  // Manifest-level strings come from _locales/*/messages.json via Chrome.
  const { getMessage } = await hologramI18n;
  // The shell is React-owned now (AppShell.tsx): its DOM (#postGrid / #posterGrid /
  // #emptyState / #searchBox / #sortSelect …) is rendered on mount,
  // not present as static index.html markup. Wait for that mount before any of the
  // shell-DOM setup below runs, so getElementById/byId resolve. (viewerReady still
  // resolves at the end of this IIFE → AppBoot's bootApp fires after, unchanged.)
  await shellReady;
  // Count / date display formatters live in format.ts now (imported above).
  // (The backup-rail time formatters fmtTime/fmtBackupTime are used only by the
  // MirrorStatus component now, which imports format.ts directly.)

  // Nudge an already-shown, cursor-positioned popup back inside the viewport (8px
  // margin). Shared by the cursor-placed context menus (query-builder / folder /
  // card / 種別) so the clamp formula stays in one place instead of drifting between
  // copies. Anchored flyouts (cs/qf/tab) keep their own placement strategy.
  function _clampIntoView(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth - 8) el.style.left = Math.max(8, innerWidth - r.width - 8) + 'px';
    if (r.bottom > innerHeight - 8) el.style.top = Math.max(8, innerHeight - r.height - 8) + 'px';
  }

  // --- Typed DOM accessors (checkJs). getElementById returns HTMLElement|null;
  // these assert the element exists — it is static markup in index.html and the
  // surrounding code already dereferences it directly — and narrow to the concrete
  // element subtype so .value/.options/.min/.disabled type-check. closestOf mirrors
  // folders.js: casts an event target to the nearest matching element (or null). ---
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const _inputById = (id: string) => document.getElementById(id) as HTMLInputElement;
  const selectById = (id: string) => document.getElementById(id) as HTMLSelectElement;
  const closestOf = (e: Event, sel: string) => {
    const t = e.target as HTMLElement | null;
    return t instanceof Element ? (t.closest(sel) as HTMLElement | null) : null;
  };

  // --- Apply i18n to static elements ---
  const setAttr = (id: string, attr: string, val: string) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute(attr, val);
  };

  // #settingsBtn is the sidebar component's gear now (LeftSidebar): it carries the
  // Sidebar tooltip + its own <span> label, so the legacy [data-tip]/aria-label
  // written here stacked a SECOND .ui-tip chip on top of it on hover.
  // #filterRows row labels + the クリップ row / 空にする button (icon, tip, aria) are
  // rendered by the sidebar component, self-deriving from hologramPostSidebarSource
  // (services/sidebar.ts) — no static setText here.
  setAttr('contentTop', 'aria-label', getMessage('sbTopTip'));
  // #postResetBtn label + the activebar frame (nav / title / empty hint / count / reset /
  // ⓘ help) are the activebar component now, self-deriving from hologramStore
  // (renderer/activebar.ts is gone — no bridge left) — no static setText here.
  // Density (post + poster) and the sort labels live in the display popover
  // (shell/DisplayMenu.tsx); browse mode is the left sidebar's. All three
  // render from i18n themselves — no static setText here.
  // #posterFilterRows title + row labels are rendered by the poster sidebar component,
  // self-deriving from hologramPosterSidebarSource (services/sidebar.ts). No
  // static setText here (mirror of the post-side #filterRows note above).
  // posterDateDim options / posterDateDimLabel / posterDateRangeLabel / posterDateApply /
  // posterDateClear are the filterbar React component now (replacing the retired
  // filter-popover) — no static labels here.
  // Settings-modal labels (theme/lang/data/backup/trash/danger/about) live in the React
  // settings component; the confirm modal is the React confirm component (labels come through
  // confirmOpen's config), so no static confirm setText here either.

  // #activebarLabel / #qbEmptyHint / #posterQbEmptyHint are the activebar component now,
  // self-deriving from hologramStore + t() — no static setText here.
  // #filterRows titles/row names (フィルタ / 作品 / キャラ / タグ / ハッシュタグ …) are
  // rendered by the sidebar component, self-deriving from hologramPostSidebarSource — no
  // static setText here.
  setAttr('sbTop', 'data-tip', getMessage('sbTopTip')); // #sbTop back-to-top retired in the shell cutover; setAttr no-ops if absent

  // Post sort's value source is the hidden <select> AppShell renders. The display
  // popover's Select drives it on pick (value + a 'change' event, so the listener far
  // below still fires) and mirrors the value into hologramStore 'sortPost', which is what
  // lets the popover reflect programmatic changes (a tab restore pushes 'sortPost' —
  // see applyState / the tab click handler). Poster sort has no element: the store key
  // IS its single source. Collapsing this stub into the store is #217's follow-up.
  const sortSelect = selectById('sortSelect');

  // --- Query Field ---
  const ENG_TYPE_LABELS: Record<string, string> = {
    likes: getMessage('qfEngLikes'),
    reposts: getMessage('qfEngReposts'),
    replies: getMessage('qfEngReplies'),
    bookmarks: getMessage('qfEngBookmarks'),
    views: getMessage('qfEngViews'),
  };

  // filterLabel (query-chip renderer + tab titles share it) and tabTitleOf moved
  // to tab-state.ts (makeTabLabels, imported) — 6th extraction slice. Consts
  // declared after this point (PF_NAME / CF) are injected as deferred arrows — a
  // direct ref here would hit TDZ at wiring time; the wrappers only run at
  // render time. formatShortDate / formatCount are hoisted function declarations
  // (direct refs are fine).
  const { filterLabel, tabTitleOf, posterFilterLabel } = makeTabLabels({
    t: getMessage,
    engTypeLabels: ENG_TYPE_LABELS,
    platformName: (v: string) => PF_NAME[v] || v,
    formatShortDate,
    formatCount,
    folderName: (id: string) => {
      const fobj = CF() && CF().byId(id);
      return fobj ? fobj.name : null;
    },
    // Deferred arrow (posterFolderById is a const declared far below — same TDZ
    // dance as CF()/folderName; the wrapper only runs at render time).
    posterFolderName: (id: string) => {
      const fo = posterFolderById(id);
      return fo ? fo.name : null;
    },
  });

  // Leading type glyph for a query-builder chip (qcGlyph, imported above) moved
  // to query-builder.ts along with the postQB/posterQB instance wiring.

  const PF_NAME: Record<string, string> = { x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' };

  // 全フィルタを一括リセット（アクティブフィルタバーの「リセット」）。検索・フォルダ・
  // 日付・エンゲージも含めて消す。afterQueryChange() が sidebar の active 状態も同期。
  // Assigned (not a hoisted declaration) so the module-scope `export let` above is what
  // gets set — Activebar.tsx imports it directly now.
  resetAllFilters = function () {
    // No poster bounce anymore (#144 確定未決4: posterReturn 撤去) — a drill-in is a
    // history push now, so "back to the poster grid" is the ← button / Alt+←.
    postQB.resetTree();
    searchEditing.clear(); // the editing text leaf is gone with the tree
    const set = (id: string, v: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = v;
    };
    setSearchBoxValue('');
    set('sbDateFrom', '');
    set('sbDateTo', '');
    set('sbEngMin', '');
    afterQueryChange();
  };
  // #postResetBtn / #navBackBtn / #navFwdBtn clicks are wired by the activebar component,
  // which imports resetAllFilters/navBack/navForward directly (no more pushed model
  // callbacks) — the buttons are React-owned.
  //
  // Back/forward through the per-tab view history (nav's state machine, the Alt+←/→ +
  // mouse-side-button handlers, and the tab bar/CRUD below) moved to tabs-builder.ts
  // during the viewer.ts decomposition; tabsCtl is constructed further below
  // (after postQB/postGrid/browseMode/multiOnly are in scope) and its handlers are
  // assigned to the module-scope exports at that construction site.

  // Empty-state CTAs (innerHTML rebuilds the buttons each render → delegate)
  byId('emptyState').addEventListener('click', (e) => {
    const btn = closestOf(e, 'button');
    if (!btn) return;
    if (btn.id === 'emptyResetBtn') {
      if (browseMode === 'posters') {
        setSearchBoxValue('');
        renderPosters();
      } else resetAllFilters();
    } else if (btn.id === 'emptyImportBtn') void runZipImport();
  });

  // --- カテゴリ値フライアウト: サイドバーの行/タググループボタンの横に開く。
  // State (どのカテゴリが開いているか) + row-model building (qfValues — bespoke facet
  // logic, unchanged) + pick routing moved to qf-pop-builder.ts during the
  // viewer.ts decomposition — the makeQfPop() call lives further down,
  // once postQB/posterQB/pfStore/buildUsers all exist (see near posterQB below).
  // Tag vocabulary / 種別 domain (tagKindOf/kindLabel/groupedTagVocab/
  // inspectorTagPickerData/posterTagsOf/posterFilterVocab) moved to tags.ts
  // (imported) — 8th extraction slice. The tag stores themselves
  // (tagTypes/tagLabels/posterTags) also live in tags.ts now (P4
  // "状態→store" tags slice) — its own getters go in where viewer.js's local
  // `let`s used to. Wired BEFORE the facets/cooc wiring below, which passes
  // tagKindOf/posterTagsOf/posterFilterVocab as direct refs.
  // charCandidatesFor/relatedTagCandidates are consts from the cooc
  // destructure below, so they enter as deferred arrows.
  const { tagKindOf, kindLabel, inspectorTagPickerData, posterTagsOf, posterFilterVocab } = makeTags({
    tagTypes: getTagTypes,
    tagLabels: getTagLabels,
    posterTags: getPosterTags,
    allPosts: () => postGrid.getAllPosts(),
    t: getMessage,
    charCandidatesFor: (w) => charCandidatesFor(w),
    relatedTagCandidates: (sel, opts) => relatedTagCandidates(sel, opts),
  });
  // Bound onto tags.ts's live bindings so services/sidebar.ts's pull sources can read
  // the SAME tagKindOf/posterFilterVocab this orchestrator instance uses —
  // both close over tags.ts's own getTagTypes()/getPosterTags(), so there's no second
  // implementation to drift.
  bindTagKindOf(tagKindOf);
  bindPosterFilterVocab(posterFilterVocab);
  // Shared 種別 (kind) menu (right-click a tag chip in the edit picker /
  // inspector / poster picker) — row model + pick/rename actions moved to
  // kind-menu-builder.ts (a viewer.ts decomposition slice). Wired here (not
  // where it's first used) so tagKindOf/kindLabel/getMessage are all already in
  // scope — no TDZ workaround needed, unlike the old taggingApi indirection.
  const { showKindMenu } = makeKindMenu({ tagKindOf, kindLabel, t: getMessage });
  // Facet aggregation (facetCounts) + value-flyout row models (qfValues) moved to
  // facets.ts — 3rd extraction slice. Runtime couplings are injected: reassigned
  // lets (allPosts/multiOnly) as getters, and
  // consts declared after this point (posterQB / pfStore / the listing.ts
  // products) as deferred arrow wrappers — a direct ref here would hit TDZ at
  // wiring time; the wrappers only run when a flyout opens.
  const { qfValues } = makeFacets({
    getFilteredPosts: () => getFilteredPosts(),
    qHasValue,
    posterQHasValue: (type: string, v: string) => posterQB.qHasValue(type, v),
    allPosts: () => postGrid.getAllPosts(),
    hostOf: (u: string | null | undefined) => hostOf(u),
    userKey: (p: HologramPost) => userKey(p),
    t: getMessage,
    PF_NAME,
    tagKindOf,
    posterTagsOf,
    filteredPosters: () => filteredPosters(),
    posterFilterVocab,
    namedPosters: () => namedPosters(),
    posterFolders: () => pfStore.all(),
    postFolders: () => (CF() ? CF().staticFolders() : []), // library folders (folders.json) for the フォルダ flyout — saved searches are not a place to put posts
    // Deferred wrapper: buildUsers becomes a const (users.js wiring) declared
    // after this point — a direct ref here would hit TDZ at wiring time.
    buildUsers: () => buildUsers(),
  });
  // Tag co-occurrence math (charCandidatesFor / worksCooccurringWith /
  // relatedTagCandidates) moved to cooc.ts — 4th extraction slice. Same deferred-
  // getter wiring as facets above (allPosts is a reassigned let; the getters only
  // run when a picker or homonym check fires).
  const { charCandidatesFor, worksCooccurringWith, relatedTagCandidates } = makeCooc({ allPosts: () => postGrid.getAllPosts(), tagKindOf });
  // onQfPick (value-pick → tree mutation) lives in qf-pop-builder.ts,
  // exposed as qfPop.pickValue for the filter bar — see the makeQfPop() call near
  // posterQB below (the flyout render/anchor half retired with its component, P2③).

  // The ⓘ クエリビルダの使い方 hover popover is the activebar component now (HelpPop) — its
  // content (title + 5 rows) rides the model's `help` field; hover/positioning live there.

  // The date/engagement/poster-date-range popovers (the retired filter-popover flyout)
  // were removed with their component (P2③ タスク3); adding a date/engagement filter is the
  // "+ フィルタ" bar's FormEditor now, and editing a chip re-opens it (P2③).
  // The single 'text' leaf bound to the search box (post mode only) is owned by
  // search-editing.ts, wired together with the rest of the search-box plumbing
  // in search-box-builder.ts now (a viewer.ts decomposition slice) —
  // see the makeSearchBox() call below.

  // --- Sidebar filter controls ---
  // (#filterRows row labels are rendered by the sidebar component, self-deriving from
  // hologramPostSidebarSource. No static setText for プラットフォーム / 投稿 /
  // メディア / 日付 / エンゲージメント here.)

  // Sidebar chip toggle (platform, postType, media)
  // Filter rows: click a row → flyout with that category's values beside it.
  // 日付/エンゲージはパラメータ入力付きの専用ポップオーバーへ委譲。
  document.getElementById('filterRows')?.addEventListener('click', (e) => {
    // 複数画像: a direct 2-state toggle (no data-qfrow, no flyout). Handled via this
    // delegated listener rather than its own — the row can be (re)built after wiring
    // time, so a listener bound at load could miss it. Flips the group-level flag.
    if (closestOf(e, '#multiRow')) {
      multiOnly = !multiOnly;
      storeSet('multiOnly', multiOnly); // mirror into the store — the sidebar/Tabs sources read it directly
      renderPosts();
      return;
    }
    // The [data-qfrow] value/date/engagement flyout rows were removed with the
    // sidebar facet rows (P1) — adding filters is the "+ フィルタ" bar now (P2③).
  });

  // フライアウトはクリックのみで開閉（ホバーで開く実験は撤回＝誤爆・絞り込み入力中に
  // 別行へカーソルが乗って別フライアウトに化ける問題があったため）。

  // Update sidebar state — kept as a thin alias to renderQueryChips (its many call
  // sites keep their name) now that badges/tag-visibility are self-derived by
  // services/sidebar.ts's hologramPostSidebarSource/hologramPosterSidebarSource
  // (see that file for how postQueryTree/tags/folders/posts-data feed it).
  function updateSidebarState() {
    // (#searchBox's has-value accent is owned by the searchbox component)
    renderQueryChips(); // 検索/フォルダ等の変化を下部アクティブバーへ即時反映
  }

  // --- Tag area: the タグ row opens ONE flyout listing every general tag
  // (種別なし). The 作品/キャラ kinded tags get their own rows; general tags stay a
  // flat, count-ordered list inside the scrollable flyout.
  // tagTypes/tagLabels (種別語彙) + tagKindOf/kindLabel moved
  // to tags.js (hologramTags wiring above) — the P4 "状態→store" tags slice.
  // (Possibly custom) 作品/キャラ names + which tags carry a 種別 are read live by
  // services/sidebar.ts's sources now (hologramTags.onChange / posts-data.ts's
  // subscribe), so a 種別 rename or classification no longer needs an explicit
  // re-derive here; the rest (palette section headers, kind menu, dot tooltips) already
  // read kindLabel() live too. Mutation + persistence for the kind menu itself
  // live in kind-menu-builder.ts now; tagsSetTagKind below is only
  // for maybeDistinguishHomonym's own direct write.
  const _ic = (paths: string) => `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  // --- In-session Edit Undo/Redo ---
  // Records tag-edit operations so the user can undo bulk mistakes (Ctrl+Z / Ctrl+Shift+Z).
  // Linear stack, clears on restart. Deletions are NOT included (handled by trash).
  // Stack semantics + the orchestrator-owned apply callbacks/shortcut handler moved to
  // undo-builder.ts — a viewer.ts decomposition slice. Constructed here
  // (its original spot) so pushUndo is ready in time for inspector/postGrid/posterGrid's
  // own deps below; postGrid/inspector/posterGrid are all declared later, so their
  // accessors are deferred forward references (same shape as inspector-builder.ts's
  // jumpToPoster). showToast itself is notify, imported directly at the top —
  // no forward reference needed there.
  const undoCtl = makeUndoController({
    showToast: notify,
    getPostById: (id) => postGrid.getPostById(id), // postGrid is declared below — deferred
    markPostsMutated: () => postGrid.markPostsMutated(),
    renderPosts: (keepLimit) => postGrid.renderPosts(keepLimit),
    getViewGroups: () => postGrid.getViewGroups(),
    getInspectedKey: () => inspectedKey,
    showDetail: (g) => showDetail(g), // showDetail (inspector) is declared far below — deferred
    refreshPosterTagFields: (key) => refreshPosterTagFields(key), // refreshPosterTagFields (posterGrid) is declared far below — deferred
  });
  const { pushUndo } = undoCtl;
  handleShortcutUndoKey = undoCtl.handleShortcutUndoKey;

  // --- State ---
  // allPosts/_postsById/loadPosts/renderPosts and the render-reuse guard moved to
  // post-grid-builder.ts (the "allPosts ownership transfer") — postGrid is
  // constructed below, after buildUsers/postQB are in scope.
  let browseMode = 'posts'; // 'posts' | 'posters' (what the content area browses) — per-tab now: the tab's current history entry decides (#144 確定未決3)
  let multiOnly = false; // show only items with more than one image
  // SMOKE capture: the hidden screenshot instance never has anything "on-screen",
  // so content-visibility:auto skips painting every card and loading=lazy images
  // never fetch → blank grid. Launched via ?smoke=1, we flip both off (CSS class
  // + eager images) so capturePage() sees real cards. Normal app is untouched.
  const SMOKE_CAPTURE = (() => {
    try {
      return new URLSearchParams(location.search).get('smoke') === '1';
    } catch {
      return false;
    }
  })();
  if (SMOKE_CAPTURE) document.documentElement.classList.add('smoke-capture');

  // #mode-post is the scroll container (the page itself never scrolls), so scroll
  // position is read/written there, not on window.
  const contentScrollEl = () => document.getElementById('mode-post');
  const contentScrollTop = () => {
    const el = contentScrollEl();
    return el ? el.scrollTop : 0;
  };
  const scrollContentTo = (y: number) => {
    const el = contentScrollEl();
    if (el) el.scrollTop = y;
  };
  // How long .anim-in stays on a grid after a fresh build (post AND poster grids
  // share this constant). Must outlive the LAST staggered card or its
  // backwards-fill entrance gets cancelled mid-run: 15 (CSS min() cap) × 34ms
  // (--stagger) + 360ms (--dur-entrance) + buffer.
  const _GRID_ANIM_MS = 950;
  // Grouping state (manualGroups/ungrouped/stickyRecs, persisted via main:
  // manual-groups.json / ungrouped.json) moved to post-grid-builder.ts along with
  // viewGroups — see postGrid below.
  // postIdKey of the group shown in the inspector (ring marker). Mirrored into
  // hologramStore so the grid/poster cells derive their own '.inspected' ring via
  // useSyncExternalStore — no more manual repaint()/pushPosterModel() calls to
  // refresh the ring on open/close (the store notify does that reactively).
  let inspectedKey: string | null = null;
  function setInspectedKey(key: string | null) {
    inspectedKey = key;
    storeSet('inspectedKey', key);
  }
  storeSet('inspectedKey', null); // establish the initial value (store.get() is undefined otherwise)
  // Display density (card/tile/list) + tile/card/list size slider, for both the
  // post grid and the poster grid, moved to grid-density-builder.ts during the
  // viewer.ts decomposition. renderPosts/renderPosters are forward
  // references (declared later via postGrid/posterGrid below) — deferred arrows
  // the same TDZ-safe way every other service wiring in this file already works.
  const gridDensity = makeGridDensity({
    hologramIpc,
    hologramPostGridSource,
    renderPosts: (inPlace) => renderPosts(inPlace),
    renderPosters: () => renderPosters(),
    getBrowseMode: () => browseMode,
  });
  const { tileThumbW, cardThumbW, listThumbW } = gridDensity;
  bindApplyTileOverlay(gridDensity.applyTileOverlay);
  // Post-grid selection state (Set + shift-range anchor) lives in
  // services/selection.ts — hologramStore's
  // 'selectedSet' key IS the state; the grid component's cells read it reactively.
  // --- Query builder: a boolean condition tree is the single source of truth ---
  // (改訂③: flat conditions you drag into parenthesised
  // groups; no auto type-grouping). BOTH views (posts / posters) share ONE builder
  // implementation via the createQueryBuilder(ctx) factory below; ctx carries the
  // per-view differences (container, leaf predicate, label, callbacks). The tree is
  // ALWAYS a root group (op 'and' by default). Each instance's `.shadow()` is a
  // derived flat shadow of the leaves (sidebar highlight / row badges / tab
  // title / counts) — postQB.shadow()/posterQB.shadow(), read fresh at each
  // call site rather than mirrored into a separate module-level global (see the
  // syncShadow comment below).
  // The tree machinery + post-side predicates live in query.ts (imported above)
  // — the first "pure logic → service" extraction of the viewer decomposition.
  // Runtime couplings are injected here: collections resolve through CF()
  // lazily (folders.js registers after this closure is built, and predicates only
  // run post-init), fuzzy text matching through search.ts's compile.
  // The shared facet-chip builder (改訂④) lives in
  // query-chips.ts (the event half): tree state, cluster view-model
  // derivation, qbNodeMap, and click/contextmenu dispatch all moved there — the
  // query-chips component reads a cached model + calls dispatch() directly instead
  // of viewer.js pushing a model and delegating raw DOM events. The postQB/
  // posterQB instance construction (predOf/glyph/createQueryBuilder ctx) itself
  // moved to query-builder.ts; orchestrator.ts keeps the orchestration
  // around a change (onChange/openLeafEditor/onClearSearch) since those still
  // reach into state (renderPosts, searchEditing, popovers) not yet extracted.
  // i18n strings the builder needs for labels/menus — query-builder.ts/
  // query-chips.ts have no access to orchestrator.ts's i18n binding, so getMessage
  // itself is passed in via ctx.t.

  // The post-side builder instance. Badge/tab-title/etc. reads used
  // to mirror the tree shadow into a module-level `activeFilters` global via an
  // onShadow callback; that global was a pure duplicate of postQB.shadow() (the
  // instance already exposes the same cached array) — every read site now calls
  // postQB.shadow() directly instead of maintaining a second copy.
  const { qb: postQB, predOf: postPredOf } = makePostQueryBuilder({
    t: getMessage,
    container: document.getElementById('queryChips') as HTMLElement,
    barEl: document.getElementById('postActiveBar'), // reveal + --activebar-h measure (empty/reset are the component's)
    labelOf: filterLabel,
    // A saved tag leaf from before the DB migration (#297) carries only a name;
    // query.ts's tag case resolves and caches its tagId on first evaluation via
    // this. Scans the loaded posts' parallel tags/tagIds arrays rather than a
    // separate vocabulary fetch — only runs once per legacy leaf (the leaf
    // caches its own resolved tagId), not once per post.
    tagIdOf: (name) => {
      for (const p of postGrid.getAllPosts()) {
        const i = (p.tags || []).indexOf(name);
        if (i >= 0 && p.tagIds) return p.tagIds[i];
      }
      return undefined;
    },
    getSearchVal: () => searchQuery(),
    onClearSearch: () => {
      setSearchBoxValue('');
      afterQueryChange();
    },
    onChange: () => {
      renderPosts();
    },
    // Legacy chip-click leaf editing routed through the retired filter-popover flyout;
    // in the redesign a date/engagement chip re-opens the filterbar FormEditor instead
    // (P2③). Inert now (the query-chips dispatch that called this is gone) — kept as a
    // no-op until createQueryBuilder's dispatch is stripped.
    openLeafEditor: () => {},
    // When the editing text leaf is removed or dragged on the bar, detach it from
    // the box. textInTree (query-builder.ts) suppresses the legacy echo chip (the
    // term is a real leaf). Deferred arrows: searchEditing is constructed later in
    // this closure (the makeSearchBox() call below), same forward-reference
    // pattern as postQB/posterQB being referenced from functions defined above
    // their own declarations.
    onLeafMutated: (node: HologramQueryLeaf) => searchEditing.onLeafMutated(node),
    isEditingLeaf: (node: HologramQueryLeaf) => searchEditing.isEditingLeaf(node),
  });
  // Thin module-level wrappers so existing post-side call sites keep their names.
  function currentTree() {
    return postQB.getTree();
  }
  function renderQueryChips() {
    postQB.render();
  }
  function addFilter(filter: { type: string; [k: string]: any }) {
    postQB.addFilter(filter);
  }
  function removeFilter(index: number) {
    postQB.removeFilter(index);
  }
  function _removeNode(node: HologramQueryLeaf) {
    postQB.removeNode(node);
  }
  function removeCondsMatching(pred: (c: HologramQueryLeaf) => boolean) {
    return postQB.removeCondsMatching(pred);
  }
  function qHasValue(type: string, value: string) {
    return postQB.qHasValue(type, value);
  }
  function afterQueryChange() {
    postQB.refresh();
  }
  // A post-side sidebar destination (folder / saved search) is a navigation to
  // another place, not just a query edit (#312). If the image view is up, leave it
  // and make sure we are on the posts grid first — WITHOUT a render of its own: the
  // query mutation that follows renders exactly once and records the single grid
  // entry (activeImageTab is cleared by then, so that render is no longer swallowed
  // as a background refresh). setBrowseModeLite is the render-free mode flip; both
  // calls are no-ops when the view is hidden and we are already browsing posts.
  function enterPostsForSidebar() {
    imageTabCtl.hideImageView();
    setBrowseModeLite('posts');
  }
  // Folder-as-place: clear any existing folder leaves, then add the clicked
  // one. addFilter goes through facetAdd + the qb's re-render, so the grid + chips refresh.
  applyFolderFilter = (id) => {
    enterPostsForSidebar();
    removeCondsMatching((c) => c.type === 'folder');
    addFilter({ type: 'folder', value: id });
  };
  // Replace the query with a saved one. Same sequence resetAllFilters uses (the tree
  // is swapped wholesale, so the bound editing leaf has to be forgotten and the box
  // emptied) — the saved free-text term comes back as a chip, not as box content.
  applySavedSearch = (id) => {
    const f = CF() && CF().byId(id);
    if (!f || f.kind !== 'dynamic') return;
    enterPostsForSidebar();
    postQB.setTree(f.tree || null);
    searchEditing.clear();
    setSearchBoxValue('');
    afterQueryChange();
  };
  saveCurrentSearch = (name) => folders.createFolder(name, { kind: 'dynamic', tree: currentTree() });

  const CF = () => folders; // shared folder module

  // --- Settings: fully component-owned now (settings/ for the modal,
  // LeftSidebar's gear for the open call; Esc / backdrop close live in the component).
  // The old wireSettingsGear() listener on #settingsBtn duplicated that onClick.

  // Hashtag browsing is now covered by the sidebar タグ section + the search box
  // (typing "#tag" matches post text), so the dedicated hashtag tab was removed.
  // Back-to-top: floats in the sidebar corner once the filter column is scrolled.
  (function setupSbTop() {
    const btn = document.getElementById('sbTop');
    const scroller = document.querySelector('#controls-posts .sb-scroll');
    if (!btn || !scroller) return;
    // Threshold must stay BELOW the sidebar's max scroll, which is small now that
    // sections were trimmed (~140px). 300 made the button unreachable (=消えてる).
    scroller.addEventListener(
      'scroll',
      () => {
        btn.style.display = scroller.scrollTop > 80 ? 'flex' : 'none';
      },
      { passive: true },
    );
    btn.addEventListener('click', () => scroller.scrollTo({ top: 0, behavior: 'smooth' }));
  })();

  // Back-to-top for the CONTENT area. #mode-post is the scroll container (the page
  // itself never scrolls), so watch its scrollTop, not the window.
  (function setupContentTop() {
    const btn = document.getElementById('contentTop');
    const scroller = contentScrollEl();
    if (!btn || !scroller) return;
    const onScroll = () => {
      btn.style.display = scroller.scrollTop > 300 ? 'flex' : 'none';
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    btn.addEventListener('click', () => scroller.scrollTo({ top: 0, behavior: 'smooth' }));
    onScroll();
  })();

  // --- Authors (作者 row → flyout; derived from post author fields, no fetching) ---
  // buildUsers (generation-cached poster roll-up) moved to users.ts (imported
  // above) — 5th extraction slice. Reassigned lets (allPosts / _allPostsGeneration)
  // are injected as getters; userKey/hostOf are consts already initialized at this
  // point (the query.ts import above), so they pass through directly.
  // (buildSuggest came out of users.ts with #28 — the command registry's corpus
  // provider owns the search box's suggestion rows now; see makeCommands below.)
  const { buildUsers } = makeUsers({
    allPosts: () => postGrid.getAllPosts(),
    generation: () => postGrid.getGeneration(),
    userKey,
    hostOf,
  });

  // --- Image source (served from the save folder via the asset:// protocol) ---
  // asset URL for a bare filename; w>0 asks main for a downscaled thumbnail (tiles).
  const fileSrc = (file: string, w?: number) => (file ? 'asset://img/' + encodeURIComponent(file) + (w ? '?w=' + w : '') : '');

  // Record-shape helpers (mediaFilesOf/isScreenshot/captureFile/artworkFile/
  // densityImage), normalization (postIdKey/postKeyOf), grouping (groupRecords)
  // and percentileFn moved to records.ts (imported).

  // hostOf / userKey moved to query.ts (imported above).

  // --- Post grid: allPosts/_postsById/loadPosts/renderPosts, the render-reuse
  // guard, manualGroups/ungrouped/viewGroups/stickyRecs, the fold/card context
  // menus, and the delete flow all live in post-grid-builder.ts now (the "allPosts
  // ownership transfer" — the viewer.ts decomposition's biggest slice).
  // Everything still owned by this closure (density/view state, the inspector,
  // selection, tabs, poster view, boot orchestration) is injected below; several
  // are forward references (postQB/buildUsers/showDetail/renderPosters/…
  // declared later in this closure) — deferred arrows the same TDZ-safe way
  // every other service wiring in this file already works.
  const postGrid = makePostGridBuilder({
    t: getMessage,
    smokeCapture: SMOKE_CAPTURE,
    fileSrc,
    currentView: gridDensity.getCurrentView,
    tileOverlay: gridDensity.getTileOverlay,
    multiOnly: () => multiOnly,
    tileThumbW,
    cardThumbW,
    listThumbW,
    sortValue: () => sortSelect.value,
    postShadow: () => postQB.shadow(),
    getFilteredPosts: () => getFilteredPosts(),
    buildUsers: () => buildUsers(),
    snapshotState: () => tabsCtl.snapshotState(), // tabsCtl is constructed below — deferred forward reference
    syncTitleAndPersist: () => tabsCtl.syncTitleAndPersist(),
    updateSidebarState,
    applyTileLayout: () => gridDensity.applyTileLayout(),
    getBrowseMode: () => browseMode,
    renderPosters: (keepLimit) => renderPosters(keepLimit),
    onPostsLoaded: () => {
      // The open image view re-derives live via services/image-tab.ts's
      // posts-data.ts subscription, and the inspector toggle resolves its group
      // fresh from the current history entry — no cached group to refresh (#144).
    },
    getInspectedKey: () => inspectedKey,
    // The grid calls this when the INSPECTED post leaves the view, which is a
    // loss of subject, not the user asking for the panel to go away — so it must
    // not touch the stored preference (see inspector-builder's closeDetail).
    dismissDetail: () => dismissDetail(),
    showDetail: (g, opts) => showDetail(g, opts),
    jumpToPoster: (post) => jumpToPoster(post),
    addImageTab: (g) => imageTabCtl.addImageTab(g),
  });
  const { loadPosts, renderPosts, markPostsMutated, keepCurrentVisible, showFoldMenu, showCardMenu } = postGrid;
  bindLoadPosts(postGrid.loadPosts);
  bindConfirmClearAll(postGrid.confirmClearAll);
  bindGetSkipDeleteConfirm(postGrid.getSkipDeleteConfirm);
  bindSetSkipDeleteConfirm(postGrid.setSkipDeleteConfirm);

  // The listing pipeline — getFilteredPosts (content gate → query tree → sticky
  // merge → sort), namedPosters/filteredPosters, and the collection derivations —
  // moved to listing.ts (imported above), 7th extraction slice. Runtime
  // couplings are injected: reassigned lets (allPosts/_postsById/posterSort/
  // folderSort) as getters; posterQB is a const declared later — arrow
  // wrappers defer the read past TDZ (they only run once posters render).
  // Collection derivations (filteredFolders / dynamicMatches / …) are no longer
  // destructured — collections became a sidebar folder list (2026-07-04), so only the
  // post/poster selection pipeline is used here.
  const { getFilteredPosts, namedPosters, filteredPosters } = makeListing({
    allPosts: () => postGrid.getAllPosts(),
    postsById: () => postGrid.getPostsById(),
    mediaFilesOf,
    densityImage,
    percentileFn,
    evalNode,
    treeLeaves,
    postPredOf,
    currentTree,
    stickyRecs: postGrid.getStickyRecs(),
    sortValue: () => sortSelect.value,
    // Shuffle seed (#118) — hologramStore 'shuffleSeed', snapshotted per tab like the
    // sort key itself. Only the 'random' sort reads it.
    shuffleSeed: () => (storeGet('shuffleSeed') as string) || '',
    searchQuery: () => searchQuery(),
    buildUsers,
    posterQBEval: (u) => posterQB.eval(u),
    posterQBTree: () => posterQB.getTree(),
    // Poster sort's single source is hologramStore 'sortPoster' (the display popover writes it);
    // default 'count' when unset (poster sort isn't persisted, so it resets on reload — same
    // as the old closure default).
    posterSort: () => (storeGet('sortPoster') as string) || 'count',
    // Collections migrated to sidebar folders; the collection-sort UI is gone, so
    // listing.js's filteredFolders() is dormant smart-collection foundation and
    // is never called here. This getter satisfies its contract with the default
    // (alphabetical) sort — never actually invoked in the current build.
    folderSort: () => 'name',
    allFolders: () => (CF() ? CF().allFolders() : []) as HologramFolder[],
    filterLabel,
  });
  // Bound onto listing.ts's namedPosters live binding so services/sidebar.ts's poster
  // source can read the same namedPosters() this orchestrator instance uses
  // (poster-instance row disclosure) — see the hologramTags.tagKindOf note above for why
  // this is a bind, not a reimplementation.
  bindNamedPosters(namedPosters);

  // The render-reuse guard (lastRenderedState/_lastRenderGen/_lastViewGroups/
  // _lastStickySize) lives in post-grid-builder.ts now; tabsCtl.syncTitleAndPersist()
  // below writes lastRenderedState via postGrid.setLastRenderedState.
  //
  // Nav history (browser-style back/forward), the hologramStore-backed tabs/
  // activeTabId/tabEditingId accessors, and the tab bar CRUD/DOM
  // handlers all moved to tabs-builder.ts during the viewer.ts decomposition.
  // Image tabs moved to image-tab-builder.ts below — that module's
  // scope — and receive tabsCtl's tab-state surface as deferred deps/direct
  // references (imageTabCtl is constructed just below, after tabsCtl).
  const tabsCtl = makeTabsController({
    t: getMessage,
    tabTitleOf,
    postQB,
    getSortValue: () => sortSelect.value,
    setSortValue: (v) => {
      sortSelect.value = v;
      storeSet('sortPost', sortSelect.value); // mirror into the store so the display popover reflects it
    },
    // The shuffle seed travels with the sort key in the tab snapshot (#118), so a
    // restored tab reproduces the order it was showing.
    getShuffleSeed: () => (storeGet('shuffleSeed') as string) || '',
    setShuffleSeed: (v) => storeSet('shuffleSeed', v || ''),
    getMultiOnly: () => multiOnly,
    setMultiOnly: (v) => {
      multiOnly = v;
      storeSet('multiOnly', multiOnly); // mirror into the store — the sidebar/Tabs sources read it directly
    },
    searchQuery: () => searchQuery(), // makeSearchBox() is wired far below — deferred
    setSearchBoxValue: (v) => setSearchBoxValue(v),
    rebindEditingTextLeaf: () => rebindEditingTextLeaf(),
    renderQueryChips: () => renderQueryChips(),
    renderPosts: (keepLimit) => renderPosts(keepLimit), // postGrid is declared above — already in scope
    setLastRenderedState: (json) => postGrid.setLastRenderedState(json),
    getAllPostsCount: () => postGrid.getAllPosts().length,
    resetAllFilters: () => resetAllFilters(),
    getBrowseMode: () => browseMode,
    setBrowseModeLite: (m) => setBrowseModeLite(m), // setBrowseModeLite is declared far below — deferred
    contentScrollTop: () => contentScrollTop(),
    scrollContentTo: (y) => scrollContentTo(y),
    getPosterTree: () => posterQB.getTree(), // posterQB is constructed far below — deferred
    setPosterTree: (t) => posterQB.setTree(t),
    getPosterSort: () => (storeGet('sortPoster') as string) || 'count',
    setPosterSort: (v) => storeSet('sortPoster', v),
    renderPosters: () => renderPosters(),
    showImageView: (recs, idx) => imageTabCtl.showImageView(recs, idx), // imageTabCtl is constructed just below — deferred
    hideImageView: () => imageTabCtl.hideImageView(),
    // Coalescing hint (#144 確定未決2): an open facet-editor session, else a live
    // search-typing burst (searchBox is constructed far below — deferred read).
    navCoalesceKey: () => _filterEditSession || searchBox.liveSearchKey(),
  });
  const { getTabs, mutateTabs, getActiveTabId, setActiveTabId, nav, persistTabsDebounced, saveActiveTabState, closeTab } = tabsCtl;
  // The rest of tabsCtl's surface only ever gets read through the module-scope exports
  // above (App.tsx/Activebar.tsx import those directly) — assigned by property, not
  // destructured, so there's no local same-named binding shadowing the `export let`s.
  navBack = tabsCtl.navBack;
  navForward = tabsCtl.navForward;
  handleShortcutNavKey = tabsCtl.handleShortcutNavKey;
  handleShortcutMouseNav = tabsCtl.handleShortcutMouseNav;
  handleTabBarKeydown = tabsCtl.handleTabBarKeydown;
  handleTabBarFocusout = tabsCtl.handleTabBarFocusout;
  handleTabBarClick = tabsCtl.handleTabBarClick;
  handleTabBarAuxclick = tabsCtl.handleTabBarAuxclick;
  handleTabBarMousedown = tabsCtl.handleTabBarMousedown;
  handleTabBarContextmenu = tabsCtl.handleTabBarContextmenu;
  handleTabBarDblclick = tabsCtl.handleTabBarDblclick;
  handleGlobalTabShortcut = tabsCtl.handleGlobalTabShortcut;

  // --- Image view ('image' history entries) — fit-to-screen detail view (Eagle 風) ---
  // The view/state cluster (showImageView/hideImageView/openImageEntry/
  // setImageTabIndex/toggleImageTabInspector/closeImageTab/addImageTab) lives in
  // image-tab-builder.ts (a viewer.ts decomposition slice; #144
  // reworked the type:'image' TAB into an entry on the unified per-tab history).
  // showDetail/closeDetail (inspector-builder.ts) are declared far below —
  // deferred arrows the same TDZ-safe way postGrid's own showDetail/closeDetail
  // deps already work.
  const imageTabCtl = makeImageTabController({
    t: getMessage,
    getPostById: postGrid.getPostById,
    showDetail: (g) => showDetail(g),
    // Same reason as postGrid's: the image view hands the detail back when a tab
    // stops owning it. Losing the subject is not "I don't want this panel".
    dismissDetail: () => dismissDetail(),
    closeTab,
    getActiveTabId,
    setActiveTabId,
    mutateTabs,
    saveActiveTabState,
    nav,
    navBack: () => navBack(),
    persistTabsDebounced,
  });
  const { openImageEntry, setImageTabIndex, toggleImageTabInspector, closeImageTab, addImageTab } = imageTabCtl;

  // initTabs/showTabMenu/tab-rename commit-cancel/tab-bar DOM handlers/the
  // Ctrl+T/W/Tab shortcut all live in tabsCtl now (destructured above); the
  // module-scope export assignment for the tab-bar handlers happened at that
  // construction site too.

  // keepCurrentVisible/imgAspect/cardModel/hologramPostGridSource.configure/
  // renderPosts all moved to post-grid-builder.ts (postGrid above).
  const _prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Text expand/collapse on click
  byId('postGrid').addEventListener('click', (e) => {
    const textEl = closestOf(e, '.text');
    if (textEl) {
      e.stopPropagation();
      textEl.classList.toggle('expanded');
      if (textEl.classList.contains('expanded')) {
        textEl.classList.remove('truncated');
      } else {
        requestAnimationFrame(() => {
          textEl.classList.toggle('truncated', textEl.scrollHeight > textEl.clientHeight);
        });
      }
    }
  });

  // Image lightbox / quick-view peek (a single image — #143). The overlay UI lives
  // in the React component (services/lightbox.ts + lightbox/); orchestrator.ts
  // only resolves a post's gallery items below and hands the FIRST (the thumbnail)
  // to open(). Full paging over every page moved to the image view.

  // Lightbox gallery items — built by records.js (makeGallery); the asset URL
  // scheme stays orchestrator-owned via the injected fileSrc.
  const { buildGroupGalleryItems } = makeGallery({ fileSrc });
  // services/image-tab.ts's pull source reuses the SAME gallery instance —
  // configure() sets it once, same "invariant callbacks set once" shape as the grid sources.
  // onIndexChange/onToggleInspector/onCloseTab are the DI callbacks that replaced
  // image-tab.ts's former dispatch through the old shared bridge.
  hologramImageTabSource.configure({
    gallery: { buildGroupGalleryItems },
    labels: { missing: getMessage('imgTabMissing'), closeTab: getMessage('imgTabCloseBtn'), prev: getMessage('lbPrev'), next: getMessage('lbNext'), info: getMessage('tipInfo'), play: getMessage('ugoiraPlay'), pause: getMessage('ugoiraPause'), ugoira: getMessage('ugoiraLabel') },
    onIndexChange: setImageTabIndex,
    onToggleInspector: toggleImageTabInspector,
    onCloseTab: closeImageTab,
  });

  // Primary card gesture (#143 P2⑥): a plain click single-selects the card and
  // shows it in the inspector (Eagle/Explorer 型「シングル＝選択して詳細」); Ctrl
  // adds/removes, Shift range-selects — neither touches the inspector (確定 未決
  //事項2). Double-click opens the image view as an in-tab history destination
  // (#144). The expandable post text keeps its
  // dedicated handler, so that region is skipped here. selectionCtl/showDetail
  // are declared below — safe closure forward-refs (they run only on a real click).
  byId('postGrid').addEventListener('click', (e) => {
    if (closestOf(e, '.text')) return;
    const card = closestOf(e, '.post-card');
    if (!card) return;
    const g = postGrid.getViewGroups()[Number.parseInt(card.dataset.index ?? '', 10)];
    if (selectionCtl.clickSelect(card, e) && g) showDetail(g);
  });
  byId('postGrid').addEventListener('dblclick', (e) => {
    if (closestOf(e, '.text')) return;
    const card = closestOf(e, '.post-card');
    if (!card) return;
    const g = postGrid.getViewGroups()[Number.parseInt(card.dataset.index ?? '', 10)];
    if (g) openImageEntry(g);
  });

  // Middle-click an image → open the post as a background image tab
  // (browser-like; replaces the old single-image window).
  byId('postGrid').addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const img = closestOf(e, '.card-img');
    if (!img) return;
    e.preventDefault();
    const g = postGrid.getViewGroups()[Number.parseInt((img.closest('.post-card') as HTMLElement | null)?.dataset.index ?? '', 10)];
    if (g) addImageTab(g);
  });
  // suppress the middle-click autoscroll on card images
  byId('postGrid').addEventListener('mousedown', (e) => {
    if (e.button === 1 && closestOf(e, '.card-img')) e.preventDefault();
  });

  // Drag a card's ORIGINAL files out to another app (#132). No interplay with the
  // click/dblclick/auxclick handlers above is needed: the browser only fires
  // dragstart past its own drag threshold, and a completed drag suppresses click.
  byId('postGrid').addEventListener('dragstart', (e) => postGrid.handleCardDragStart(e as DragEvent));

  // foldMenuItems/onFoldMenuPick/showFoldMenu and cardMenuItems/onCardMenuPick/
  // showCardMenu moved to post-grid-builder.ts (postGrid above).
  byId('postGrid').addEventListener('contextmenu', (e) => {
    const card = closestOf(e, '.post-card');
    if (!card) return;
    e.preventDefault();
    if (byId('postGrid').classList.contains('selecting')) return; // selection bar owns bulk actions
    const g = postGrid.getViewGroups()[Number.parseInt(card.dataset.index ?? '', 10)];
    if (g) showCardMenu(g, e.clientX, e.clientY);
  });

  // Sidebar folder chips (shared folders.json): count + ★default. Like tag chips
  // they cycle 解除→いずれか(OR)→＋すべて含む(AND)→解除 and join the same
  // かつ/または expression as the tags.
  // postFolderChips was retired (collections moved to the collections view); the
  // 複数画像 row entry (active state) is self-derived now by
  // services/sidebar.ts's hologramPostSidebarSource — no orchestrator-side
  // re-render call needed after a multi/folder mutation.
  // フォルダ管理の起動口はフライアウト下部の qf-pop フッターボタン（onManage→CF().openManager()）に統一。
  // 旧 #postFolderManage ボタンは HTML から撤去済み（デッドリスナーを削除）。

  // 複数画像 sidebar row: reflects the group-level multiOnly flag as the row's active
  // state (accent icon) via the model. The click that flips it is handled by the
  // delegated #filterRows listener.

  // toggleCardSelection/syncSelectionClasses/selectedRecords/clearSelection/
  // updateSelectionBar/groupSelected/toggleSelectAll/handleShortcutSelectAllKey/
  // requestDeleteSelected/handleSelectionBarClick moved to selection-builder.ts
  // during the viewer.ts decomposition. Constructed below, after the
  // inspector (needs its persistManual) — see selectionCtl.

  // requestDeleteGroup/executeDeleteGroup moved to post-grid-builder.ts (postGrid above).

  // === Inspector (ℹ on a card): persistent right column / slide-over ===
  // Open/close chrome, the inline tag editor (add/toggle/adopt-source-tag +
  // homonym check), the group dissolve/regroup buttons, and the Esc/outside-click
  // dismiss guards moved to inspector-builder.ts during the viewer.ts
  // decomposition. inspectedKey/setInspectedKey stay here — other not-yet-
  // extracted clusters read/write them too (poster card click below, undo,
  // browse-mode switch) — inspector-builder.ts only gets the accessor pair.
  const inspector = makeInspector({
    t: getMessage,
    fileSrc,
    showToast: notify,
    showKindMenu,
    buildUsers,
    tagKindOf,
    worksCooccurringWith,
    jumpToPoster: (post) => jumpToPoster(post), // jumpToPoster (posterGrid) is declared far below — deferred
    openQuickView: (g) => lightboxOpen(buildGroupGalleryItems(g)[0]), // inspector thumb → quick-view peek (single image, #143)
    pushUndo,
    inspectorTagPickerData,
    getViewGroups: postGrid.getViewGroups,
    getAllPosts: postGrid.getAllPosts,
    getPostById: postGrid.getPostById,
    getUngrouped: postGrid.getUngrouped,
    getManualGroups: postGrid.getManualGroups,
    markPostsMutated,
    renderPosts,
    keepCurrentVisible,
    getInspectedKey: () => inspectedKey,
    setInspectedKey,
    getActiveTabId,
    closeTab,
    imageTabShowing: () => imageTabCtl.isShowing(), // primitive read — live, not a snapshot
  });
  // closeDetail (the one that STORES "panel off") is deliberately not pulled in here:
  // outside the panel's own ×, nothing in the orchestrator should be able to disable
  // the inspector as a side effect. The shell toggle owns that, via inspector-panel.
  const { dismissDetail, closeOrDismissDetail, showDetail, persistManual } = inspector;
  handleEscDismissDetail = inspector.handleEscDismissDetail;
  handleOutsideClickDismissDetail = inspector.handleOutsideClickDismissDetail;

  // === Selection (click a card to select; the bar appears when 1+ are selected) ===
  // groupSelected needs inspector's persistManual, so this is constructed here
  // (after inspector above), not at the cluster's original spot.
  const selectionCtl = makeSelectionBar({
    t: getMessage,
    showToast: notify,
    getViewGroups: postGrid.getViewGroups,
    getManualGroups: postGrid.getManualGroups,
    setManualGroups: postGrid.setManualGroups,
    markPostsMutated,
    renderPosts,
    loadPosts,
    persistManual,
    showFoldMenu,
    // bulkEdit is constructed just below — deferred since it needs this
    // selectionCtl's own selectedRecords.
    openBulkTagDialog: () => bulkEdit.openBulkTagDialog(),
    getBrowseMode: () => browseMode, // orchestrator.ts `let`, read live
    copyGroupImage: (g) => postGrid.copyGroupImage(g),
    openQuickView: (g) => lightboxOpen(buildGroupGalleryItems(g)[0]), // Space peek (single image, #143)
    showDetail: (g) => showDetail(g), // arrow movement swaps the inspector, same as a plain click
    dismissDetail: () => dismissDetail(), // background click empties the panel with the selection (#242)
  });
  const { selectedRecords } = selectionCtl;
  // Selection is driven entirely by the unified card gesture above (plain =
  // single-select + inspector, Ctrl = add/remove, Shift = range). The old hover
  // ○ ring (the former only way INTO the selection) and the capture-phase "any
  // click toggles while selecting" handler are gone — Eagle 純型・ホバー部品ゼロ
  // (確定A) と単一クリック選択（確定 未決事項2）に一本化。The ℹ button is likewise
  // retired; the inspector is reached by a plain click (or the card's 詳細
  // context-menu item), not a dedicated hover button.
  handleShortcutSelectAllKey = selectionCtl.handleShortcutSelectAllKey;
  handleShortcutCopyKey = selectionCtl.handleShortcutCopyKey;
  handleShortcutQuickView = selectionCtl.handleShortcutQuickView;
  handleShortcutArrowNav = selectionCtl.handleShortcutArrowNav;
  // Bulk-action bindings for the bottom floating bar (P2⑥) — called straight from the
  // FloatingBar component (no #selectionBar container, no data-act dispatch anymore).
  selectionSelectAll = selectionCtl.toggleSelectAll;
  selectionTag = selectionCtl.tagSelection;
  selectionFolder = selectionCtl.folderSelection;
  selectionGroup = selectionCtl.groupSelected;
  selectionDelete = selectionCtl.requestDeleteSelected;
  selectionClear = selectionCtl.clearSelection;
  selectionMarquee = selectionCtl.marquee;
  selectionClickBackground = selectionCtl.clickBackground;
  // The poster grid's own background click (#242). Same panel, same placeholder, but
  // nothing to deselect — poster cards are inspected, never selected (#143).
  posterClickBackground = () => dismissDetail();

  // --- Bulk "add tags to selection" (Dialog — P2⑦) ---
  // The staged tags live in the dialog's own React state; nothing persists until
  // Apply hands the finished list to bulk-edit-builder.ts. Constructed here (after
  // selectionCtl above) since openBulkTagDialog needs this cluster's own
  // selectedRecords — see the deferred dep on selectionCtl above.
  const bulkEdit = makeBulkEdit({
    t: getMessage,
    showToast: notify,
    showKindMenu,
    inspectorTagPickerData,
    pushUndo,
    markPostsMutated,
    renderPosts,
    keepCurrentVisible,
    getPostById: postGrid.getPostById,
    selectedRecords,
  });

  // --- Selection (click a card to select; the bar appears when 1+ are selected) ---
  // Wiring (selectionCtl, its listeners, toggleCardSelection/selectedRecords/
  // clearSelection/handleShortcutSelectAllKey) moved up next to the inspector —
  // see the selection-builder.ts comment there.

  // handleShortcutSearchFocusKey (`/` or Ctrl/Cmd+K focuses the search box) moved
  // to search-box-builder.ts's makeSearchBox() return during the viewer.ts
  // decomposition, wired alongside the rest of that factory's output below.

  // Deferred-render timers so a view/layout switch paints the segment (thumb + active)
  // FIRST, then runs the heavy grid render past a paint (optimistic UI). clearTimeout
  // collapses rapid clicks to a single render.
  let _browseRenderT: any = null;
  // Density is the display popover's (hologramStore 'view'); the
  // reaction (mirror into currentView, persist, re-render with a view transition)
  // lives in grid-density-builder.ts now — this just bridges React's
  // subscribe registration (StoreSubscriptions, App.tsx) to it.
  handleViewStoreChange = gridDensity.handleViewStoreChange;

  // === Browse-mode toggle: 投稿グリッド ↔ 投稿者グリッド ===
  // The light half: flip the mode state (let + store mirror + stale-detail close)
  // WITHOUT rendering. applyEntry (tabs-builder) uses this so a history restore
  // renders exactly once — its own kind-specific render right after.
  // No pref write anywhere: mode is per-tab state on the history entry now (#144
  // 確定未決3 — the old global browseMode pref is retired; a new tab opens posts).
  function setBrowseModeLite(mode: string) {
    mode = mode === 'posters' ? 'posters' : 'posts'; // collections retired (now a sidebar folder list)
    if (browseMode === mode) return;
    browseMode = mode;
    // Mirror into the store so the React components (LeftSidebar active state, App's
    // ShellClasses body.browse-posters — CSS hides the inactive grid) reflect the
    // mode even when an INTERNAL setter drove us. Safe against recursion: the
    // store's set is value-guarded, and browseMode === mode by now so the
    // subscribe handler's guard skips.
    storeSet('browseMode', mode);
    dismissDetail(); // a stale post/poster detail shouldn't survive the switch — but the panel itself should
  }
  // Switches the content area between the post grid and the poster grid (same tab).
  // A semantic "what am I browsing" switch — distinct from the card/tile/list density.
  // The render lands as a fresh history entry of the new kind (renderPosts /
  // renderPosters record it — that push IS the mode switch on the tab history).
  function setBrowseMode(mode: string) {
    mode = mode === 'posters' ? 'posters' : 'posts';
    setBrowseModeLite(mode);
    // Optimistic UI: the mode state (active state / grid swap via body class) was
    // updated synchronously above; defer the heavy grid render past a paint so the
    // switch shows INSTANTLY instead of blocking on renderPosts/Posters.
    const render = () => {
      if (browseMode !== mode) return;
      if (mode === 'posters') renderPosters();
      else renderPosts();
    };
    clearTimeout(_browseRenderT);
    _browseRenderT = setTimeout(render, 0);
  }
  // Sidebar mode button → browse destination (#312). While the image view is up,
  // the destination is a place to move TO: hide the view, then let setBrowseMode
  // render and record the grid entry — even for the current mode (setBrowseMode
  // still renders, and with activeImageTab cleared that render records the entry
  // the store's same-value guard would otherwise swallow, stranding the view on the
  // image). Off the image view the store stays the interface, so its same-value
  // guard keeps pressing the active destination a genuine no-op (no re-render, no
  // stray history entry).
  browseTo = (mode) => {
    mode = mode === 'posters' ? 'posters' : 'posts';
    if (imageTabCtl.isShowing()) {
      imageTabCtl.hideImageView();
      setBrowseMode(mode);
    } else {
      storeSet('browseMode', mode);
    }
  };
  // Browse mode is the left sidebar's (hologramStore 'browseMode').
  // React owns the active state + glass thumb; orchestrator reacts to a mode change by running
  // the heavy switch. The idempotent guard skips the no-op set from the pref restore
  // below, so the loop stays one-way (component → store → orchestrator, never back). React owns
  // the subscribe() registration (StoreSubscriptions, App.tsx), importing this directly;
  // this stays the guard + action logic. Assigned (not a hoisted declaration) so the
  // module-scope `export let` above is what gets set.
  handleBrowseModeStoreChange = function () {
    const m = storeGet('browseMode');
    if (m === browseMode) return;
    setBrowseMode(m);
  };

  // --- Poster grid (投稿者ビュー) ------------------------------------------
  // Cards derived from post author fields (buildUsers — no fetching). Click =
  // inspector (poster profile), double-click = jump to that poster's posts.
  // posterList itself is now poster-grid-builder.ts-internal state (exposed via
  // getPosterList).
  // posterSort ('count' | 'name' | 'date-desc' | 'date-asc') lives in hologramStore
  // 'sortPoster' (read via the listing dep getter above); a subscription below
  // re-renders on change.
  // Poster grid density + tile/card size slider (kept SEPARATE from the post-side
  // currentView — its masonry/tile/list layouts are bound to poster-card markup)
  // lives in grid-density-builder.ts now, alongside the post-side
  // equivalent above. This just bridges React's subscribe registration
  // (StoreSubscriptions, App.tsx) to it.
  handlePosterViewStoreChange = gridDensity.handlePosterViewStoreChange;
  // Poster browse filters (platform / tag / instance / folder / date範囲) live
  // in the posterQB query tree (createQueryBuilder + posterPredOf), not separate Sets.

  // Poster grid/filter/inspector/folder cluster (posterWorkGroups, the named
  // poster-folder store, renderPosterFilterRows, renderPosters, openPosterPosts/
  // jumpToPoster, the poster inspector, and the poster context menu) moved to
  // poster-grid-builder.ts during the viewer.ts decomposition. Density/
  // tile-size slider state (posterView etc.) moved to grid-density-builder.ts
  // (above). Wired BEFORE posterQB below (posterQB's construction
  // needs pfStore/posterFolderById from here as direct values, not deferred
  // arrows) — posterQB itself is only available to this builder as deferred
  // arrows (posterQBGetTree etc.), the mirror image.
  const posterGrid = makePosterGridBuilder({
    t: getMessage,
    PF_NAME,
    fileSrc,
    showToast: notify,
    pushUndo,
    showKindMenu,
    buildGroupGalleryItems,
    posterTagsOf,
    posterFilterVocab,
    inspectorTagPickerData,
    filteredPosters,
    buildUsers,
    getAllPosts: postGrid.getAllPosts,
    groupRecords: postGrid.groupRecords,
    posterQBGetTree: () => posterQB.getTree(),
    posterQBResetTree: () => posterQB.resetTree(),
    posterQBRender: () => posterQB.render(),
    posterQBRemoveByLeaf: (type, value) => posterQB.removeByLeaf(type, value),
    posterQBRemoveCondsMatching: (pred) => posterQB.removeCondsMatching(pred),
    posterQBSyncShadow: () => posterQB.syncShadow(),
    postQBResetTree: () => postQB.resetTree(),
    addFilter,
    setSearchBoxValue: (v) => setSearchBoxValue(v), // makeSearchBox() is wired far below — deferred
    setBrowseMode,
    // posterGrid uses this for the poster inspector's ×, so it follows the same
    // rule as the post panel's: store the preference only where × is the docked
    // column's one way off the screen.
    closeDetail: closeOrDismissDetail,
    setInspectedKey,
    posterView: gridDensity.getPosterView,
    onPosterRendered: () => tabsCtl.syncPosterTitleAndPersist(),
  });
  const { getPosterList, pfStore, posterFolderById, renderPosterFilterRows, renderPosters, openPosterPosts, jumpToPoster, refreshPosterTagFields, showPosterDetail, showPosterMenu } = posterGrid;
  // --- Poster query builder: the SAME drag builder (createQueryBuilder), evaluated
  // against poster (user) objects instead of posts. Leaf types: platform / instance /
  // tag(作品/キャラ含む) / folder / date(範囲). The bar lives in
  // #posterActiveBar; sidebar rows are the entry points (like #filterRows for posts). ---
  // Poster leaf predicate — query.ts's makePosterPredOf (the mirror of postPredOf)
  // is now called inside query-builder.ts's makePosterQueryBuilder;
  // posterTagsOf (tags.js) and posterFolderById (pfStore) are passed in as deps,
  // both declared above so a direct ref is TDZ-safe. posterFilterLabel lives in
  // tab-state.js's makeTabLabels (destructured near filterLabel).
  // The poster date-range popover (and its editingPosterDateNode state) retired with
  // the filter-popover component (P2③ タスク3); a poster date chip re-opens the filterbar
  // FormEditor now.
  // The poster-side builder instance (predOf/glyph/instance construction moved to
  // query-builder.ts — see that file's makePosterQueryBuilder).
  // transient (no tabs / nav history for posters); onChange → renderPosters
  // (which redraws the rows + bar + grid). This used to also mirror
  // the tree shadow into a module-level `posterShadow` global via onShadow — that
  // global had zero readers (the poster sidebar model read posterQB.shadow()
  // directly, and now services/sidebar.ts's source reads the mirrored
  // 'posterQueryTree' store key via query.ts's buildShadow instead), so it's
  // removed outright rather than converted to a read site.
  const { qb: posterQB } = makePosterQueryBuilder({
    t: getMessage,
    container: document.getElementById('posterQueryChips') as HTMLElement,
    barEl: document.getElementById('posterActiveBar'), // reveal + --activebar-h measure (empty/reset are the component's)
    labelOf: posterFilterLabel,
    getSearchVal: () => searchQuery(),
    onClearSearch: () => {
      setSearchBoxValue('');
      renderPosters();
    },
    onChange: () => {
      renderPosters();
    },
    openLeafEditor: () => {}, // retired filter-popover flyout; inert (see the post-side note above)
    posterTagsOf,
    folderById: posterFolderById,
  });

  // renderPosterFilterRows (the #posterFilterRows model's one orchestrator-side side
  // effect: pruning tag selections whose backing value disappeared) moved to
  // poster-grid-builder.ts along with the rest of the poster cluster —
  // destructured from posterGrid above.

  // qf-pop value-pick routing — a viewer.ts decomposition slice, now just
  // the headless pick router for the filter bar (the value flyout + date/eng popover
  // retired with their components, P2③ タスク3). Wired here (not where first used) so
  // postQB/posterQB/buildUsers are already real consts — no deferred-getter indirection,
  // same reasoning as makeSearchBox() being wired late (search-box-builder.ts).
  const qfPop = makeQfPop({
    postShadow: () => postQB.shadow(),
    posterQHasValue: (type, v) => posterQB.qHasValue(type, v),
    posterAddFilter: (filter) => posterQB.addFilter(filter),
    posterRemoveByLeaf: (type, v) => posterQB.removeByLeaf(type, v),
    addFilter,
    removeFilter,
    buildUsers: () => buildUsers(),
    updateSidebarState,
  });

  // The "+ フィルタ" category menu (redesign §3-2 / P2③): the facet categories the
  // current browse mode offers, each carrying its own live value/apply closures. The
  // routing is REUSED — value picks go through qfPop.pickValue (= onQfPick, run headless
  // with no open flyout), date/engagement writes go straight to the QB (mirroring the
  // retired filter-popover's onApply logic). The filterbar component only renders + routes; it
  // never rebuilds this logic. Recomputed per open so counts/vocab/labels stay fresh.
  filterCategories = function (): FilterCat[] {
    const pick = (cat: string) => (it: FilterRow) => qfPop.pickValue(cat, it as HologramQfPopItem);
    // 種別 dot: a tag row carrying it.kind ('work'/'character') wears the shared category
    // dot — resolve its (possibly custom) label here so the component only draws (this is
    // exactly what renderQfPop did before the flyout was retired).
    const dot = (it: FilterRow) => (it.kind ? { ...it, dotTitle: kindLabel(it.kind as string) } : it);
    // Mode accessors (redesign §4-2 B) bound to one view's QB + facet schema: read /
    // write a facet's すべて/どれか/〜以外 against the live tree. mode() derives from the
    // tree (all-negated → 'exclude', else the cluster op / default op); setMode() negates
    // or un-negates every value of the type and sets the group op, then refreshes.
    const modeFor = (qb: typeof postQB, opts: typeof POST_FACET_OPTS) => (type: string) => ({
      mode: (): FacetMode => {
        const leaves = treeLeaves(qb.getTree()).filter((c) => c.type === type);
        if (leaves.length && leaves.every((c) => c.neg)) return 'exclude';
        const cl = facetViewOf(qb.getTree(), opts)?.clusters.find((c) => c.type === type);
        return cl ? (cl.op === 'and' ? 'and' : 'or') : facetDefaultOp(type, opts);
      },
      setMode: (m: FacetMode) => {
        const tree = qb.getTree();
        const leaves = treeLeaves(tree).filter((c) => c.type === type);
        if (m === 'exclude') {
          for (const l of leaves) if (!l.neg) facetSetNeg(tree, l, true, opts);
        } else {
          for (const l of leaves) if (l.neg) facetSetNeg(tree, l, false, opts);
          facetSetOp(tree, type, m);
        }
        qb.refresh();
      },
    });
    // A value-list category. `type` = the leaf type it writes (drives multi + mode);
    // `valuesFn` overrides the default qfValues(cat) read (the combined タグ merges its
    // 作品/キャラ kin — they share the one 'tag' leaf type and its single op, so one chip).
    const valuesCat =
      (qb: typeof postQB, opts: typeof POST_FACET_OPTS) =>
      (cat: string, label: string, type: string, showFind: boolean, extra?: { manage?: () => void; valuesFn?: () => FilterRow[]; only?: FilterCatValues['only'] }): FilterCatValues => {
        const mo = modeFor(qb, opts)(type);
        return {
          cat,
          label,
          editor: 'values',
          showFind,
          multi: opts.multiValueTypes.includes(type),
          values: extra?.valuesFn ?? (() => (qfValues(cat) as FilterRow[]).map(dot)),
          pick: pick(cat),
          mode: mo.mode,
          setMode: mo.setMode,
          manage: extra?.manage,
          only: extra?.only,
        };
      };
    // The combined タグ editor values: general tags (種別なし, count-ordered)
    // followed by 作品/キャラ groups — all one 'tag' facet, so one chip + one op.
    const combinedTagValues = (tagCat: string, workCat: string, charCat: string) => (): FilterRow[] => {
      const general = (qfValues(tagCat) as FilterRow[]).map(dot);
      const work = (qfValues(workCat) as FilterRow[]).map(dot);
      const char = (qfValues(charCat) as FilterRow[]).map(dot);
      const out: FilterRow[] = [];
      // General tags are flat; when kinded groups follow, wrap the general list under its
      // own head so the two-pane doesn't orphan it (buildGroups drops pre-first-ghead rows).
      if ((work.length || char.length) && general.length && !general.some((it) => it.ghead != null)) out.push({ ghead: getMessage('tagUncategorized') });
      out.push(...general);
      if (work.length) out.push({ ghead: kindLabel('work') }, ...work);
      if (char.length) out.push({ ghead: kindLabel('character') }, ...char);
      return out;
    };
    if (browseMode === 'posters') {
      const vc = valuesCat(posterQB, POSTER_FACET_OPTS);
      const cats: FilterCat[] = [vc('poster-platform', getMessage('sbPosterPlatformTitle'), 'platform', false), vc('poster-tag', getMessage('sbPosterTagsTitle'), 'tag', true, { valuesFn: combinedTagValues('poster-tag', 'poster-work', 'poster-character') })];
      if (qfValues('poster-instance').length) cats.push(vc('poster-instance', getMessage('qfInstance'), 'instance', true));
      cats.push(
        vc('poster-folder', getMessage('sbPosterFoldersTitle'), 'folder', false, {
          manage: () =>
            folders.openManager({
              store: pfStore,
              onChange: () => {
                renderPosterFilterRows();
                renderPosters();
              },
            }),
        }),
      );
      cats.push({
        cat: 'poster-date',
        label: getMessage('qfDate'),
        editor: 'date',
        dimOptions: [
          { value: 'latest', label: getMessage('posterDateLastPost') },
          { value: 'lastCapture', label: getMessage('posterDateLastCapture') },
          { value: 'authorCreatedAt', label: getMessage('posterDateCreated') },
        ],
        apply: ({ dateField, from, to }) => {
          if (!from && !to) return;
          posterQB.addFilter({ type: 'date', dateField, from, to }); // date is single-valued (replaces)
        },
      });
      return cats;
    }
    // Posts mode.
    const vc = valuesCat(postQB, POST_FACET_OPTS);
    const cats: FilterCat[] = [
      vc('kind', getMessage('fbCatKind'), 'kind', false),
      vc('platform', getMessage('qfPlatform'), 'platform', false),
      vc('postType', getMessage('qfPostType'), 'postType', false),
      vc('media', getMessage('qfMediaTitle'), 'media', false),
      vc('tag', getMessage('qfTag'), 'tag', true, { valuesFn: combinedTagValues('tag', 'work', 'character') }),
      vc('hashtag', getMessage('tabTags'), 'hashtag', true),
      vc('user', getMessage('sidebarAuthors'), 'user', true),
      // No 「フォルダを管理…」 here: the sidebar tree IS the manager now (#41 / 確定D).
      // The poster-side row below still opens the modal — poster folders have no tree
      // of their own yet, and taking their only management surface away to keep this
      // one symmetric would just delete the feature.
      vc('folder', getMessage('qfCatFolder'), 'folder', false, {
        // 「このフォルダのみ」 is one switch for the whole facet, not one per value:
        // the chip is per-facet, so a per-value flag could not be read back off it.
        only: {
          get: () => treeLeaves(postQB.getTree()).some((c) => c.type === 'folder' && c.only),
          set: (v) => {
            for (const l of treeLeaves(postQB.getTree()).filter((c) => c.type === 'folder')) {
              if (v) l.only = true;
              else delete l.only;
            }
            postQB.refresh();
          },
        },
      }),
    ];
    cats.push({
      cat: 'date',
      label: getMessage('qfDate'),
      editor: 'date',
      dimOptions: [
        { value: 'date', label: getMessage('qfDatePost') },
        { value: 'capturedAt', label: getMessage('qfDateCaptured') },
      ],
      apply: ({ dateField, from, to }) => {
        if (!from && !to) return;
        addFilter({ type: 'date', dateField, from, to }); // date is single-valued (replaces)
      },
    });
    cats.push({
      cat: 'engagement',
      label: getMessage('qfEngagement'),
      editor: 'eng',
      typeOptions: Object.entries(ENG_TYPE_LABELS).map(([value, label]) => ({ value, label })),
      opGte: getMessage('qfEngGte'),
      opLte: getMessage('qfEngLte'),
      apply: ({ engType, min, op }) => {
        const n = Number(min);
        if (!(n > 0)) return;
        removeCondsMatching((c) => c.type === 'engagement' && c.engType === engType); // no gte+lte on one type
        addFilter({ type: 'engagement', engType, min: n, op }); // numeric — the predicate compares p[engType] >= min
      },
    });
    return cats;
  };

  // Active-filter chips (redesign §3-2 / P2③ タスク2): the query tree's facets, one
  // chip per facet (Linear型), derived from facetViewOf. `cat` matches a
  // filterCategories() entry so a chip click reopens that facet's editor; negated
  // leaves collect per type into a 「〜以外」 chip (要決 A案). Recomputed on every tree
  // change — the component subscribes to the postQueryTree/posterQueryTree store keys.
  activeFilters = function (): ActiveFilter[] {
    const posters = browseMode === 'posters';
    const qb = posters ? posterQB : postQB;
    const opts = posters ? POSTER_FACET_OPTS : POST_FACET_OPTS;
    const labelOf = posters ? posterFilterLabel : filterLabel;
    // leaf type → { editor category, chip label, editor kind }. instance has no
    // standalone category (it lives as sub-rows under プラットフォーム), so its chip
    // reopens the platform editor.
    const map: Record<string, { cat: string; label: string; editor: 'values' | 'date' | 'eng' }> = posters
      ? {
          platform: { cat: 'poster-platform', label: getMessage('sbPosterPlatformTitle'), editor: 'values' },
          tag: { cat: 'poster-tag', label: getMessage('sbPosterTagsTitle'), editor: 'values' },
          instance: { cat: 'poster-instance', label: getMessage('qfInstance'), editor: 'values' },
          folder: { cat: 'poster-folder', label: getMessage('sbPosterFoldersTitle'), editor: 'values' },
          date: { cat: 'poster-date', label: getMessage('qfDate'), editor: 'date' },
        }
      : {
          kind: { cat: 'kind', label: getMessage('fbCatKind'), editor: 'values' },
          platform: { cat: 'platform', label: getMessage('qfPlatform'), editor: 'values' },
          instance: { cat: 'platform', label: getMessage('qfInstance'), editor: 'values' },
          postType: { cat: 'postType', label: getMessage('qfPostType'), editor: 'values' },
          media: { cat: 'media', label: getMessage('qfMediaTitle'), editor: 'values' },
          tag: { cat: 'tag', label: getMessage('qfTag'), editor: 'values' },
          hashtag: { cat: 'hashtag', label: getMessage('tabTags'), editor: 'values' },
          user: { cat: 'user', label: getMessage('sidebarAuthors'), editor: 'values' },
          folder: { cat: 'folder', label: getMessage('qfCatFolder'), editor: 'values' },
          date: { cat: 'date', label: getMessage('qfDate'), editor: 'date' },
          engagement: { cat: 'engagement', label: getMessage('qfEngagement'), editor: 'eng' },
        };
    const view = facetViewOf(qb.getTree(), opts);
    if (!view) return []; // non-facet persisted tree → no chips (read-only fallback dropped for the trial)
    const out: ActiveFilter[] = [];
    const emit = (type: string, mode: FacetMode, leaves: HologramQueryLeaf[]) => {
      const m = map[type];
      if (!m) return; // an unmapped type carries no chip
      out.push({ cat: m.cat, type, label: m.label, editor: m.editor, mode, values: leaves.map((l) => labelOf(l)), remove: () => qb.removeByType(type) });
    };
    for (const cl of view.clusters) emit(cl.type, cl.op === 'and' ? 'and' : 'or', cl.leaves);
    for (const l of view.singles) {
      // Free-text terms (the search box's confirmed leaves, P2④): one chip PER term.
      // There is no 'text' entry in filterCategories (nothing to edit — the term IS
      // the value), so the chip's ✕ removes just that leaf; a chip click is a no-op.
      if (l.type === 'text') {
        out.push({ cat: 'text', type: 'text', label: labelOf(l), editor: 'values', mode: 'or', values: [labelOf(l)], remove: () => qb.removeNode(l) });
        continue;
      }
      emit(l.type, 'or', [l]);
    }
    const excl = new Map<string, HologramQueryLeaf[]>();
    for (const l of view.excl) {
      const arr = excl.get(l.type) ?? [];
      arr.push(l);
      excl.set(l.type, arr);
    }
    for (const [type, leaves] of excl) emit(type, 'exclude', leaves);
    return out;
  };

  // resetPosterFilters/renderPosters/hologramPosterGridSource.configure/
  // openPosterPosts/jumpToPoster/refreshPosterTagFields/refreshPosterFolderFields/
  // applyPosterTagChange/showPosterDetail all moved to poster-grid-builder.ts.
  // resetPosterFilters is read only through the module-scope export
  // (Activebar.tsx imports it directly) — assigned by property, not destructured above,
  // to avoid shadowing it.
  resetPosterFilters = posterGrid.resetPosterFilters;
  // Poster card gesture (#143 P2⑥): a plain click shows the poster in the
  // inspector (シングル＝インスペクタ, matching post cards); double-click drills into
  // their posts (下の dblclick). The ℹ and 🏷 buttons are both retired — the
  // inspector is the single-click destination, and tagging is its inline field,
  // reached from the context menu's タグを編集 (P2⑦).
  byId('posterGrid').addEventListener('click', (e) => {
    const card = closestOf(e, '.poster-card');
    if (!card) return;
    const u = getPosterList()[Number.parseInt(card.dataset.index ?? '', 10)];
    if (u) showPosterDetail(u);
  });
  // Double-click a poster → drill into that poster's posts (posts mode + user
  // filter). ドリルイン＝#143 確定のダブルクリック割当（#24 の旧「シングル＝切替」を上書き）。
  byId('posterGrid').addEventListener('dblclick', (e) => {
    const card = closestOf(e, '.poster-card');
    if (!card) return;
    const u = getPosterList()[Number.parseInt(card.dataset.index ?? '', 10)];
    if (u) openPosterPosts(u);
  });
  // posterMenuItems/onPosterMenuPick/showPosterMenu moved to poster-grid-builder.ts —
  // destructured (showPosterMenu) from posterGrid above.
  byId('posterGrid').addEventListener('contextmenu', (e) => {
    const card = closestOf(e, '.poster-card');
    if (!card) return;
    e.preventDefault();
    const u = getPosterList()[Number.parseInt(card.dataset.index ?? '', 10)];
    if (u) showPosterMenu(u, e.clientX, e.clientY);
  });
  // Poster-mode sort. Single source = hologramStore 'sortPoster' (the display popover's
  // Select writes it on pick); re-render when it changes — one trigger, no dual source.
  storeSubscribe('sortPoster', () => {
    if (tabsCtl.isRestoring()) return; // applyEntry/initTabs wrote the store — they drive their own render
    // A sort change rewrites the current history entry instead of pushing (#144 確定未決2).
    tabsCtl.setNavReplaceNext();
    renderPosters();
  });
  // Poster query reset (bar右の「リセット」): empty the poster tree + the shared search box.
  // Wired to the activebar component's #posterResetBtn via onPosterReset (React-owned button).
  // The poster [data-qfrow] flyout rows were removed with the poster sidebar facet
  // rows (P1); poster filters are added via the "+ フィルタ" bar now (P2③).

  // Collections are a sidebar folder list now (renderCollectionSidebar), not a
  // browse view. The old third-mode grid, its context menu, and dynamic collections
  // (saved searches) were removed 2026-07-04 — see the collection sidebar above.

  // Ctrl+- / Ctrl+= step the content size one notch (post densities or the poster grid).
  // Registration lives in the GlobalShortcuts component (app/App.tsx), which
  // imports this directly.
  handleShortcutSizeKey = gridDensity.handleShortcutSizeKey;
  handleZoomWheel = gridDensity.handleZoomWheel;
  // Size-slider bindings for the display popover (P2②) — see the export decls above.
  getPostSizeTrack = gridDensity.computeSizeTrack;
  applyPostSize = gridDensity.setSizeFromSlider;
  getPosterSizeTrack = gridDensity.computePosterSizeTrack;
  applyPosterSize = gridDensity.setPosterSizeFromSlider;

  // Tile overlay/reloadPosts/setSkipDeleteConfirm/confirmClearAll used to bridge
  // through the old shared bridge for the React settings component (Danger.tsx/Data.tsx/
  // settings/ipc.ts) to reach; those now import the live bindings above directly.

  // Load saved view mode and skipDeleteConfirm
  hologramIpc.getPrefs().then((prefs) => {
    gridDensity.restorePrefs(prefs);
    postGrid.restoreSkipDeleteConfirm(!!prefs.skipDeleteConfirm);
    // Re-render once after applying the saved view mode. Sort is NOT read here anymore
    // — it comes from the tab state (applied by initTabs), so the old prefs/initTabs
    // load race on sortSelect.value is gone.
    renderPosts();
  });

  // --- Search value source -----------------------------------------------------
  // hologramStore 'searchQuery' IS the search value; the searchbox component renders it
  // as a controlled Base UI Autocomplete input. The query-tree text-leaf state
  // machine (search-editing.ts), the suggestion-pick bridge to the
  // searchbox component (searchbox.ts), and the store plumbing/debounced
  // re-render around them are wired together in search-box-builder.ts now
  // (a viewer.ts decomposition slice). searchEditing itself stays a
  // local const here — resetAllFilters (above) and postQB's onLeafMutated/
  // isEditingLeaf deps still reference it directly.
  const searchBox = makeSearchBox({
    storeGet,
    storeSet,
    getTree: () => postQB.getTree(),
    addFilter: (f) => postQB.addFilter(f),
    removeNode: (n) => postQB.removeNode(n),
    treeLeaves,
    getBrowseMode: () => browseMode,
    afterQueryChange: () => afterQueryChange(),
    renderPosts: () => renderPosts(),
    renderPosters: () => renderPosters(),
    updateSidebarState: () => updateSidebarState(),
  });
  const { searchQuery, setSearchBoxValue, rebindEditingTextLeaf, searchEditing } = searchBox;
  // React owns the subscribe() registration (StoreSubscriptions, App.tsx), importing
  // this directly; this stays the guard + action logic. handleShortcutSearchFocusKey's
  // registration lives in GlobalShortcuts (App.tsx) — also imported directly, wired
  // there since both come off the same makeSearchBox() construction site.
  handleSearchQueryStoreChange = searchBox.handleSearchQueryStoreChange;
  handleShortcutSearchFocusKey = searchBox.handleShortcutSearchFocusKey;

  // --- Command palette (#28) -----------------------------------------------------
  // Registers the palette's entries into the command registry. Placed after the
  // searchbox wiring above because the corpus provider's picks ride the same bridge
  // (one pick, both faces) — it pulls the handlers lazily, but registering the
  // supplier after its consumer exists keeps the reading order honest. Everything
  // the entries need is in scope here, so perform() is a closure over the real
  // functions rather than another bridge.
  makeCommands({
    t: (key) => getMessage(key),
    allPosts: () => postGrid.getAllPosts(),
    buildUsers,
    // 置き先になれるのは静的フォルダだけ（保存した検索はクエリの置き換え＝別の動作）。
    listFolders: () => folders.staticFolders(),
    folderPath: (id) => folders.pathOf(id),
    getBrowseMode: () => browseMode,
    addTab: () => tabsCtl.addTab(),
    switchTab: (id) => tabsCtl.switchTab(id),
    resetAllFilters: () => resetAllFilters(),
    resetPosterFilters: () => resetPosterFilters(),
    browseTo: (mode) => browseTo(mode),
    applyFolderFilter: (id) => applyFolderFilter(id),
  });

  sortSelect.addEventListener('change', () => {
    // Sort lives in the tab state (persisted per tab via renderPosts→persist), not a
    // separate global pref — that double-storage raced on load. renderPosts captures it.
    // A sort change rewrites the current history entry instead of pushing (#144 確定未決2).
    // Picking 'random' with no seed yet mints one, so the first pick already shuffles
    // (#118); an existing seed is kept, which is what makes leaving and coming back to
    // random show the same order until the user re-rolls.
    if (sortSelect.value === 'random' && !storeGet('shuffleSeed')) storeSet('shuffleSeed', newShuffleSeed());
    tabsCtl.setNavReplaceNext();
    renderPosts();
  });
  rerollShuffle = () => {
    storeSet('shuffleSeed', newShuffleSeed());
    tabsCtl.setNavReplaceNext();
    renderPosts();
  };

  // --- Import from ZIP ---
  // 完全エクスポート（library/ + hologram-export.json）は main がファイル選択から
  // 展開まで担当する（#485）。旧形式（metadata.json + images/）だけがバイト列付きで
  // 返り、レンダラ側の legacy-zip-import へ回る（その去就は #322）。設定画面の
  // 取り込みボタンと空状態の CTA の両方がここを通る。
  async function runZipImport() {
    try {
      const res = await importComplete();
      if (res && res.canceled) return;
      notify(getMessage('importing'));
      const done = async (imported: number, skipped: number) => {
        await loadPosts();
        if (skipped > 0) notify(getMessage('importSkipped', [imported, skipped]));
        else notify(getMessage('imported', [imported]));
      };
      if (res && res.legacy && res.bytes) {
        const posts = await readLegacyZipPosts(new Uint8Array(res.bytes));
        if (!posts) {
          notify(getMessage('importFailed'));
          return;
        }
        // #34: 取り込む投稿が既にライブラリにあるとき、コピー／置換／スキップを
        // 1回だけ聞く（1件ずつ聞くと数百回になるため、バッチ単位）。重複が無ければ
        // main 側が即座に取り込むので、この確認は出ない。
        const first = await importPosts(posts);
        if (first?.needsChoice) {
          const finish = async (mode: string) => {
            const r = await importPosts(posts, mode);
            await done(r.imported, r.skipped);
          };
          confirmOpen({
            message: getMessage('importDuplicate', [first.duplicates]),
            description: getMessage('importDuplicateDesc'),
            okLabel: getMessage('importDuplicateReplace'),
            altLabel: getMessage('importDuplicateCopy'),
            cancelLabel: getMessage('importDuplicateSkip'),
            onOk: () => void finish('replace'),
            onAlt: () => void finish('copy'),
            // Esc lands here too, and skipping is the answer that changes the
            // least — the library keeps what it has.
            onCancel: () => void finish('skip'),
          });
          return;
        }
        await done(first.imported, first.skipped);
        return;
      }
      if (!res || !res.ok) {
        await loadPosts();
        notify(getMessage('importFailed'));
        return;
      }
      await done(res.imported, res.skipped);
    } catch {
      notify(getMessage('importFailed'));
    }
  }

  // Backup status rail (#mirrorStatus) is fully owned by the MirrorStatus component now — it
  // imports backup.ts (getBackup + onBackupStart/Done) directly and derives the rail model
  // itself. orchestrator no longer holds any of that state (the old setupMirrorStatusRail +
  // shared push bridge are gone).

  // --- Clear data ---
  // Destroying the whole library requires typing the keyword (t('deleteKeyword')) to
  // enable the OK button — moved into post-grid-builder.ts's confirmClearAll during the
  // viewer.ts decomposition, since that's where postGrid.resetAll()/markPostsMutated()
  // already live; the React Danger section imports the confirmClearAll live binding
  // directly now instead of going through the old shared bridge.

  // --- Utility functions ---
  // Count / date formatters (formatCount / formatDate / compactDate / …) live in
  // format.js now. escapeHtml/escapeAttr no longer have any callers here — the
  // remaining HTML construction is JSX (which escapes automatically, see L2013);
  // ui.ts's escapeHtml is still used directly by folders.ts's own modal markup.
  // Toast (notify) calls go straight to ui.ts's export now — no local wrapper.

  // Shared folder changes: refresh chips on any change; re-render cards (📁 states)
  // when the folder list/default changes. Registration lives in React
  // (StoreSubscriptions, App.tsx), imported directly (CF().onChange has no
  // unsubscribe — subs.push — so the effect there has no cleanup, harmless since it
  // mounts once for the app's lifetime like every other App.tsx-level effect); this
  // stays the guard + action logic.
  handleFolderChange = function (kind?: string) {
    // 絞り込み中のフォルダが削除されたらそのフィルタを除去（一覧が原因不明に空になるのを防ぐ）。
    const dangling = (c: HologramQueryLeaf) => c.type === 'folder' && !CF().byId(c.value);
    if (postQB.removeCondsMatching(dangling)) {
      postQB.syncShadow();
      postQB.render();
    }
    // Folder leaves live in three places, and a delete that reaches only some of
    // them is invisible until the day it isn't: the live tree (above), the saved
    // searches (folders.ts sweeps its own on delete) and the OTHER tabs' saved
    // state (here). A tab nobody has switched to yet keeps its tree in memory, so
    // a leaf naming a deleted folder would sit there until the tab is opened and
    // then answer zero — with nothing on screen to say why. Cascade delete (#41)
    // makes that likelier, since one click can retire a whole subtree.
    if (kind === 'list') {
      const activeId = tabsCtl.getActiveTabId();
      let swept = false;
      for (const t of tabsCtl.getTabs()) {
        if (t.id === activeId) continue; // the live tree above IS this tab's state
        const st = t.state as { tree?: HologramQueryGroup; f?: HologramQueryLeaf[] } | undefined;
        if (!st) continue;
        if (st.tree && removeCondsMatchingIn(st.tree, dangling)) swept = true;
        // The title shadow is a separate copy of the leaves — left alone, the tab
        // keeps its name from a folder that is gone.
        if (Array.isArray(st.f) && st.f.some(dangling)) {
          st.f = st.f.filter((c) => !dangling(c));
          swept = true;
        }
      }
      if (swept) tabsCtl.persistTabsNow();
    }
    // The sidebar collection state (counts/active) self-derives from the
    // hologramFolders.onChange subscription in services/sidebar.ts.
    if (kind === 'list') renderPosts(true); // folder created/deleted — refresh without anim
  };
  // Background refresh when the intake queue changes. Registration lives in React
  // (StoreSubscriptions, App.tsx), imported directly (posts.ts's onPostsChanged has
  // no unsubscribe either — same reasoning).
  handlePostsChanged = async function () {
    await loadPosts(true);
  };

  // --- Boot: the app's initial data load + first render. Defined here (needs every
  // function/state above in closure) but NOT self-invoked — React's AppBoot (App.tsx)
  // calls it once on mount, after awaiting viewerReady above. This makes the React
  // root the single trigger for app startup (React owns WHEN, orchestrator.ts keeps the
  // orchestration logic of WHAT), rather than orchestrator.ts self-booting in parallel
  // with React's mount.
  bootApp = async function () {
    renderQueryChips();
    if (CF()) await CF().load(); // load folders before first render so 📁/chips are correct
    // Grouping persistence (shared with the old image-view): manual groups + opt-outs.
    postGrid.setUngrouped(await loadUngrouped());
    await pfStore.load();
    postGrid.setManualGroups(await loadManualGroups());
    await loadTags();
    // No sidebar seeding call needed here — services/sidebar.ts's sources compute their
    // model on first get(), so both columns paint immediately with
    // whatever's already loaded and pick up badges/disclosure as data streams in.
    // initTabs adopts the persisted per-tab history and restores the active tab's
    // view state (mode included — #144: the current entry decides, the old
    // browseMode pref is retired). loadPosts then runs the first render in that
    // mode; both stay UNRECORDED (markBooted comes after) so boot re-renders
    // can't stack onto the adopted history.
    await tabsCtl.initTabs();
    await loadPosts();
    // A restored image entry could only resolve its captureIds now that the
    // library is loaded — enter the detail view here, on top of the grid.
    {
      const cur = nav.current();
      if (cur && cur.kind === 'image') {
        const st = cur.state as { recs: string[]; idx: number };
        imageTabCtl.showImageView(st.recs, st.idx);
      }
      // grid-tab titles deriving live counts (allPostsCount, just set above by the
      // library load) reach the Tabs source automatically — no push needed here.
    }
    tabsCtl.markBooted(); // saved view is applied — records start with the first user action
    // First paint done — restore the active tab's scroll (survives restart).
    tabsCtl.restoreTabView(getTabs().find((t) => t.id === getActiveTabId()));
    // Persist scroll changes too (debounced), not only state/tab-switch changes, so the
    // remembered position is current at restart. persistTabsDebounced captures scrollY.
    let _scrollPersistTimer: any = null;
    const _contentScroller = contentScrollEl();
    if (_contentScroller)
      _contentScroller.addEventListener(
        'scroll',
        () => {
          clearTimeout(_scrollPersistTimer);
          _scrollPersistTimer = setTimeout(persistTabsDebounced, 400);
        },
        { passive: true },
      );
    // Flush the debounced tab state as the window goes away: the 800ms persist
    // debounce (plus the 400ms scroll pre-debounce above) would otherwise drop
    // any change made within ~1.2s of quitting. Registered HERE — after the tabs
    // restore above — so an early close can't overwrite tabs.json with defaults.
    // set-tabs writes synchronously in main, so the payload only has to reach the
    // IPC queue before renderer teardown.
    window.addEventListener('pagehide', tabsCtl.persistTabsNow);
  };
  resolveViewerReady();
})();
