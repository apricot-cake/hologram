// Renderer services are migrating off the window.corpusX bridge to real ES
// modules one wave at a time (see memory corpus-react-purity-execution-map);
// the ones imported below are converted, the rest are still read via
// window.corpusX at call time.
import { treeLeaves, evalNode, hostOf, userKey, textHaystackOf } from './query.ts';
import { makeListing, bindNamedPosters } from './listing.ts';
import { formatCount, formatShortDate, compactDate, formatDate } from './format.ts';
import { sync as syncPostsData } from './posts-data.ts';
import { makeUndoController } from './undo-builder.ts';
import { makeUsers } from './users.ts';
import { notify } from './ui.ts';
import { open as confirmOpen } from './confirm.ts';
import { get as filterPopoverGet } from './filter-popover.ts';
import { makeQfPop } from './qf-pop-builder.ts';
import { makeFilterPopover } from './filter-popover-builder.ts';
import { makeFacets } from './facets.ts';
import { makeCooc } from './cooc.ts';
import { mediaFilesOf, isScreenshot, artworkFile, densityImage, postIdKey, groupFilesOf, stampPost, percentileFn, makeGroupRecords, makeCardModel, makeGallery, loadUngrouped, loadManualGroups } from './records.ts';
import { makeTags, bindTagKindOf, bindPosterFilterVocab, getTagTypes, getTagLabels, getTagGroups, getPosterTags, setPosterTags, load as loadTags } from './tags.ts';
import { makeTabLabels } from './tab-state.ts';
import { getBackup, onBackupStart, onBackupDone } from './backup.ts';
import { listPostsDelta, importComplete, importPosts, clearAll } from './posts.ts';
import { compile as searchCompile, isFuzzy as searchIsFuzzy } from './search.ts';
import { corpusI18n } from './i18n.ts';
import * as folders from './folders.ts';
import * as selection from './selection.ts';
import { corpusPostGridSource, corpusPosterGridSource } from './grid.ts';
import { qcGlyph, makePostQueryBuilder, makePosterQueryBuilder } from './query-builder.ts';
import { makeKindMenu } from './kind-menu-builder.ts';
import { makeSearchBox } from './search-box-builder.ts';
import { makePostGridBuilder } from './post-grid-builder.ts';
import { makePosterGridBuilder } from './poster-grid-builder.ts';
import { makeGridDensity } from './grid-density-builder.ts';
import { makeInspector } from './inspector-builder.ts';
import { makeSelectionBar } from './selection-builder.ts';
import { makeBulkEdit } from './bulk-edit-builder.ts';
import { makeTabsController } from './tabs-builder.ts';
import { makeImageTabController } from './image-tab-builder.ts';
import { corpusImageTabSource } from './image-tab.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from './store.ts';
import { corpusIpc } from './ipc.ts';

(async () => {
  // Boot readiness signal: React (App.tsx's AppBoot) awaits this before calling
  // bootApp() below, instead of viewer self-invoking its own init sequence — the
  // app's single entry point (React mount) now also owns triggering data load,
  // matching how a real app's root component drives its own bootstrap. Assigned as
  // the very first synchronous statement (before the i18n await) so it exists
  // before any microtask — including root.tsx's initI18n().then(mount) — can run;
  // resolved once bootApp is defined at the tail, so by the time React can act on
  // it, the function it calls already exists. See docs at the bootApp definition.
  // The Promise executor runs synchronously, so this is assigned before any other
  // code executes — the `!` tells tsc what the executor already guarantees.
  let resolveViewerReady!: () => void;
  window.corpusViewer = Object.assign(window.corpusViewer || {}, {
    ready: new Promise<void>((r) => {
      resolveViewerReady = r;
    }),
  });

  // --- i18n ---
  // Messages live in i18n.js (loaded before this script via index.html).
  // Manifest-level strings come from _locales/*/messages.json via Chrome.
  const { lang, getMessage } = await corpusI18n;
  const _s = (key: string) => getMessage(key);
  const _f1 = (key: string) => (a: string | number) => getMessage(key, [a]);
  const _f2 = (key: string) => (a: string | number, b: string | number) => getMessage(key, [a, b]);
  // Count / date display formatters live in format.ts now (imported above).
  // (The backup-rail time formatters fmtTime/fmtBackupTime are used only by the
  // MirrorStatus island now, which imports format.ts directly.)
  // Back-compat shim so existing call sites (MSG.key / MSG.key(args)) keep working.
  // Static keys are pre-resolved strings; interpolated keys are bound functions.
  const MSG = {
    // tabs / search / sort
    tabTags: _s('tabTags'),
    tabSettings: _s('tabSettings'),
    aboutVersion: _f1('aboutVersion'),
    searchPlaceholder: _s('searchPlaceholder'),
    sidebarAuthors: _s('sidebarAuthors'),
    kindPost: _s('kindPost'),
    kindImage: _s('kindImage'),
    confirmDeleteGroup: _f1('confirmDeleteGroup'),
    tipInfo: _s('tipInfo'),
    tipTagEdit: _s('tipTagEdit'),
    tipSelect: _s('tipSelect'),
    tagSelected: _s('tagSelected'),
    folderSelected: _s('folderSelected'),
    tagSelectedTitle: _s('tagSelectedTitle'),
    sbViewTitle: _s('sbViewTitle'),
    sbLayoutTitle: _s('sbLayoutTitle'),
    sbSearchTitle: _s('sbSearchTitle'),
    sbSortTitle: _s('sbSortTitle'),
    tipTagCycle: _s('tipTagCycle'),
    sbFilterTitle: _s('sbFilterTitle'),
    activebarLabel: _s('activebarLabel'),
    qbEmptyHint: _s('qbEmptyHint'),
    ctxManage: _s('ctxManage'),
    ctxClipAdd: _s('ctxClipAdd'),
    ctxClipRemove: _s('ctxClipRemove'),
    qcJoinAnd: _s('qcJoinAnd'),
    qcJoinOr: _s('qcJoinOr'),
    qbOptAll: _s('qbOptAll'),
    qbOptAny: _s('qbOptAny'),
    qbOptAllTip: _s('qbOptAllTip'),
    qbOptAnyTip: _s('qbOptAnyTip'),
    qbExclLabel: _s('qbExclLabel'),
    qbMenuExclude: _s('qbMenuExclude'),
    qbMenuInclude: _s('qbMenuInclude'),
    qbSummaryTip: _s('qbSummaryTip'),
    qbHelpTitle: _s('qbHelpTitle'),
    qbHelp1: _s('qbHelp1'),
    qbHelp2: _s('qbHelp2'),
    qbHelp3: _s('qbHelp3'),
    qbHelp4: _s('qbHelp4'),
    qbHelp5: _s('qbHelp5'),
    qfCatFolder: _s('qfCatFolder'),
    sbTopTip: _s('sbTopTip'),
    ungroupDone: _s('ungroupDone'),
    tagGroupOther: _s('tagGroupOther'),
    qfAllTags: _s('qfAllTags'),
    qfFindPh: _s('qfFindPh'),
    deleteKeyword: _s('deleteKeyword'),
    confirmKeywordPh: _s('confirmKeywordPh'),
    detailPlatform: _s('detailPlatform'),
    detailAuthor: _s('detailAuthor'),
    detailUser: _s('detailUser'),
    detailFollowers: _s('detailFollowers'),
    detailJoined: _s('detailJoined'),
    detailEngagement: _s('detailEngagement'),
    detailPosted: _s('detailPosted'),
    detailSaved: _s('detailSaved'),
    detailUpdated: _s('detailUpdated'),
    detailImages: _s('detailImages'),
    detailImageOf: _s('detailImageOf'),
    imageOf: _f2('imageOf'),
    detailTags: _s('detailTags'),
    detailSourceTags: _s('detailSourceTags'),
    tipAdoptTag: _s('tipAdoptTag'),
    ctxViewPoster: _s('ctxViewPoster'),
    ctxShowInFolder: _s('ctxShowInFolder'),
    ctxOpenNewTab: _s('ctxOpenNewTab'),
    imgTabFallback: _s('imgTabFallback'),
    imgTabMissing: _s('imgTabMissing'),
    imgTabCloseBtn: _s('imgTabCloseBtn'),
    tagAdopted: _f1('tagAdopted'),
    editAdoptSource: _s('editAdoptSource'),
    editCoocCharsOf: _f1('editCoocCharsOf'),
    editCoocChars: _s('editCoocChars'),
    editCoocWhy: _f2('editCoocWhy'),
    editCoocRelated: _s('editCoocRelated'),
    detailOpen: _s('detailOpen'),
    detailSauce: _s('detailSauce'),
    detailAscii: _s('detailAscii'),
    tagPalNoMatch: _s('tagPalNoMatch'),
    editNoTags: _s('editNoTags'),
    tagAddBtn: _s('tagAddBtn'),
    tagNewName: _s('tagNewName'),
    tagNoTags: _s('tagNoTags'),
    tagKindHeader: _s('tagKindHeader'),
    kindWork: _s('kindWork'),
    kindCharacter: _s('kindCharacter'),
    kindGeneral: _s('kindGeneral'),
    tagKindSet: _f1('tagKindSet'),
    tagKindCleared: _s('tagKindCleared'),
    tagKindRename: _s('tagKindRename'),
    tagKindRenamePrompt: _s('tagKindRenamePrompt'),
    tagKindRenamed: _s('tagKindRenamed'),
    homonymConfirm: _f2('homonymConfirm'),
    homonymDistinguished: _f1('homonymDistinguished'),
    imagesCount: _f1('imagesCount'),
    tagsSaved: _s('tagsSaved'),
    tagsSavedN: _f1('tagsSavedN'),
    tipClip: _s('tipClip'),
    tipFolder: _s('tipFolder'),
    clipTitle: _s('clipTitle'),
    clipEmpty: _s('clipEmpty'),
    clipEmptyTip: _s('clipEmptyTip'),
    clipEmptyConfirm: _s('clipEmptyConfirm'),
    groupUngroup: _s('groupUngroup'),
    groupRegroup: _s('groupRegroup'),
    groupUngroupManual: _s('groupUngroupManual'),
    groupSelected: _s('groupSelected'),
    grouped: _s('grouped'),
    sortDateDesc: _s('sortDateDesc'),
    sortDateAsc: _s('sortDateAsc'),
    sortLikes: _s('sortLikes'),
    sortReposts: _s('sortReposts'),
    sortReplies: _s('sortReplies'),
    sortCaptured: _s('sortCaptured'),
    sortLikesPct: _s('sortLikesPct'),
    filterAll: _s('filterAll'),
    reset: _s('reset'),
    tileSizeTip: _s('tileSizeTip'),
    postCount: _f1('postCount'),

    // ライブラリ/投稿者 モード切替・投稿者ビュー
    browsePosts: _s('browsePosts'),
    browsePosters: _s('browsePosters'),
    // Smart-collection foundation (保存した検索/動的コレクション再導入用・BACKLOG「スマート
    // コレクション」の土台＝現状未使用だが意図的に保持・dead ではない)。第3ビューのコレクション
    // UI 文字列（browseCollections/collNew/coll*Sort/collEmpty* 等）は撤去済み（2026-07-07）。
    collSavePrompt: _s('collSavePrompt'),
    collSaved: _s('collSaved'),
    collSaveEmpty: _s('collSaveEmpty'),
    collDynamicTitle: _s('collDynamicTitle'),
    collUpdateQuery: _s('collUpdateQuery'),
    collUpdated: _s('collUpdated'),
    posterCount: _f1('posterCount'),
    posterPosts: _f1('posterPosts'),
    posterViewPosts: _s('posterViewPosts'),
    posterEmptyTitle: _s('posterEmptyTitle'),
    posterEmptyDesc: _s('posterEmptyDesc'),
    detailPosts: _s('detailPosts'),
    sbPosterSortTitle: _s('sbPosterSortTitle'),
    sbPosterPlatformTitle: _s('sbPosterPlatformTitle'),
    posterSortCount: _s('posterSortCount'),
    posterSortName: _s('posterSortName'),
    posterSortNewest: _s('posterSortNewest'),
    posterSortOldest: _s('posterSortOldest'),
    posterSortRecent: _s('posterSortRecent'),
    sbPosterFoldersTitle: _s('sbPosterFoldersTitle'),
    posterFolderNewPlaceholder: _s('posterFolderNewPlaceholder'),
    posterFolderCreate: _s('posterFolderCreate'),
    posterFolderDeleteConfirm: _f1('posterFolderDeleteConfirm'),
    posterFolderRenamePrompt: _s('posterFolderRenamePrompt'),
    posterMenuNewFolder: _s('posterMenuNewFolder'),
    ivPosterFolders: _s('ivPosterFolders'),
    ivPosterTags: _s('ivPosterTags'),
    posterFolderAdded: _f1('posterFolderAdded'),
    posterFolderRemoved: _f1('posterFolderRemoved'),
    sbPosterTagsTitle: _s('sbPosterTagsTitle'),
    posterDateLastPost: _s('posterDateLastPost'),
    posterDateLastCapture: _s('posterDateLastCapture'),
    posterDateCreated: _s('posterDateCreated'),
    posterDateClear: _s('posterDateClear'),
    posterDateDimLabel: _s('posterDateDimLabel'),
    posterDateRangeLabel: _s('posterDateRangeLabel'),

    // empty states
    emptyTitle: _s('emptyTitle'),
    emptyDesc: _s('emptyDesc'),
    emptySearchTitle: _s('emptySearchTitle'),
    emptySearchDesc: _s('emptySearchDesc'),
    emptyCaptureHint: _s('emptyCaptureHint'),
    emptyResetBtn: _s('emptyResetBtn'),

    save: _s('save'), // tag editor save button
    // settings > appearance / language / shortcut
    settingsSearch: _s('settingsSearch'),
    settingsNoMatch: _s('settingsNoMatch'),

    // settings > data / danger
    saveFolderMoving: _s('saveFolderMoving'),
    saveFolderMoved: _f1('saveFolderMoved'),
    logCopyStart: _f1('logCopyStart'),
    logSwitch: _s('logSwitch'),
    logCleanup: _s('logCleanup'),
    logMoveDone: _f1('logMoveDone'),
    saveFolderErrSame: _s('saveFolderErrSame'),
    saveFolderErrNested: _s('saveFolderErrNested'),
    saveFolderErrOverlap: _s('saveFolderErrOverlap'),
    saveFolderErrCollision: _s('saveFolderErrCollision'),
    saveFolderErrNotWritable: _s('saveFolderErrNotWritable'),
    saveFolderErrCopyFailed: _s('saveFolderErrCopyFailed'),
    saveFolderErrGeneric: _s('saveFolderErrGeneric'),
    importZip: _s('importZip'),
    confirmClear: _s('confirmClear'),
    confirmOk: _s('confirmOk'),
    confirmCancel: _s('confirmCancel'),
    cleared: _s('cleared'),
    clearBlocked: _s('clearBlocked'),

    // settings > backup（指定フォルダへの増分エクスポート）
    backupDirNone: _s('backupDirNone'),
    backupOverlap: _s('backupOverlap'),
    // (backup-rail strings moved to the MirrorStatus island, which reads them via t())

    // settings > trash
    trashEmpty: _s('trashEmpty'),
    trashCount: _f1('trashCount'),
    trashRestoreBtn: _s('trashRestoreBtn'),
    trashDeleteBtn: _s('trashDeleteBtn'),

    // export/import toasts
    exporting: _s('exporting'),
    exported: _s('exported'),
    importing: _s('importing'),
    imported: _f1('imported'),
    importSkipped: _f2('importSkipped'),
    noData: _s('noData'),
    importFailed: _s('importFailed'),
    exportFailed: _s('exportFailed'),

    // engagement labels

    // view toggle + selection
    viewCard: _s('viewCard'),
    viewTile: _s('viewTile'),
    viewList: _s('viewList'),
    selectAll: _s('selectAll'),
    deselectAll: _s('deselectAll'),
    cancelSelect: _s('cancelSelect'),
    deleteSelected: _s('deleteSelected'),
    selectedCount: _f1('selectedCount'),
    confirmDeleteSelected: _f1('confirmDeleteSelected'),
    deletedN: _f1('deletedN'),
    confirmDeletePost: _s('confirmDeletePost'),
    confirmSkip: _s('confirmSkip'),
    deleted: _s('deleted'),

    // post card
    clickToExpand: _s('clickToExpand'),
    tipOpen: _s('tipOpen'),
    lbPrev: _s('lbPrev'),
    lbNext: _s('lbNext'),
    tipDelete: _s('tipDelete'),
    postedOn: _f1('postedOn'),
    captured: _f1('captured'),

    // stats formatters (pure formatting, no translation)
    likes: (n: number | null | undefined) => (n != null ? `${formatCount(n)}` : ''),

    // query/sidebar filters
    qfPlatform: _s('qfPlatform'),
    qfPlatformNone: _s('qfPlatformNone'),
    qfPostType: _s('qfPostType'),
    qfDate: _s('qfDate'),
    qfEngagement: _s('qfEngagement'),
    qfTag: _s('qfTag'),
    qfMediaTitle: _s('qfMediaTitle'),
    qfInstance: _s('qfInstance'),
    qfPost: _s('qfPost'),
    qfReply: _s('qfReply'),
    qfQuote: _s('qfQuote'),
    qfThread: _s('qfThread'),
    qfImage: _s('qfImage'),
    qfVideo: _s('qfVideo'),
    qfGif: _s('qfGif'),
    qfMultiImage: _s('qfMultiImage'),
    qfApply: _s('qfApply'),
    qfDelete: _s('qfDelete'),
    qfDatePost: _s('qfDatePost'),
    qfDateCaptured: _s('qfDateCaptured'),
    qfEngLikes: _s('qfEngLikes'),
    qfEngReposts: _s('qfEngReposts'),
    qfEngReplies: _s('qfEngReplies'),
    qfEngBookmarks: _s('qfEngBookmarks'),
    qfEngViews: _s('qfEngViews'),
    qfEngGte: _s('qfEngGte'),
    qfEngLte: _s('qfEngLte'),
    searchExact: _s('searchExact'),
    searchFuzzy: _s('searchFuzzy'),
    searchModeTitle: _s('searchModeTitle'),
    searchHintExact: _s('searchHintExact'),
    searchHintLoose: _s('searchHintLoose'),
    // window tabs
    tabNew: _s('tabNew'),
    tabClose: _s('tabClose'),
    tabPin: _s('tabPin'),
    tabUnpin: _s('tabUnpin'),
    tabRename: _s('tabRename'),
    tabDuplicate: _s('tabDuplicate'),
    tabCloseOthers: _s('tabCloseOthers'),
  };

  // Nudge an already-shown, cursor-positioned popup back inside the viewport (8px
  // margin). Shared by the cursor-placed context menus (query-builder / folder /
  // card / 種別) so the clamp formula stays in one place instead of drifting between
  // copies. Anchored flyouts (cs/qf/tab) keep their own placement strategy.
  function clampIntoView(el: HTMLElement) {
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
  const inputById = (id: string) => document.getElementById(id) as HTMLInputElement;
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

  setAttr('settingsBtn', 'data-tip', MSG.tabSettings); // shared glass tooltip (was native title)
  setAttr('settingsBtn', 'aria-label', MSG.tabSettings);
  // #filterRows row labels + the クリップ row / 空にする button (icon, tip, aria) are
  // rendered by the sidebar island, self-deriving from corpusPostSidebarSource (P4-B
  // slice⑰; renderer/sidebar.ts) — no static setText here.
  setAttr('contentTop', 'aria-label', MSG.sbTopTip);
  setAttr('tileSlider', 'data-tip', MSG.tileSizeTip); // shared glass tooltip (was native title)
  // #postResetBtn label + the activebar frame (nav / title / empty hint / count / reset /
  // ⓘ help) are the activebar island now, self-deriving from corpusStore (P4-B slice⑱;
  // renderer/activebar.ts is gone — no bridge left) — no static setText here.
  // segments: icon always, label shown only on the active one (no tooltips —
  // the active label is the affordance). Labels live in their own span so the
  // SVG glyph survives.
  // #densityToggle, #posterDensityToggle and #browseToggle (incl. per-button
  // tooltips) are rendered by the toolbar island now. The browse toggle's old
  // CONTAINER title (「…を切替」) is gone — per-segment .ui-tip hints made it
  // redundant noise on hover (user 2026-07-04).
  // #sbPosterSortTitle is island-owned now too (toolbar SectionTitle) — no static setText.
  // #posterFilterRows title + row labels are rendered by the poster sidebar island,
  // self-deriving from corpusPosterSidebarSource (P4-B slice⑰; renderer/sidebar.ts). No
  // static setText here (mirror of the post-side #filterRows note above).
  // #posterSortSelect option labels are the GlassSelect island now (rendered from i18n
  // keys) — the native <select> stays hidden (.cs-host) as the value source, so writing
  // its option textContent here was dead (never shown). No static setText.
  // posterDateDim options / posterDateDimLabel / posterDateRangeLabel / posterDateApply /
  // posterDateClear are the filter-popover React island now — no static labels here.
  // Settings-modal labels (theme/lang/data/backup/trash/danger/about) live in the React
  // settings island; the confirm modal is the React confirm island (labels come through
  // confirmOpen's config), so no static confirm setText here either.

  // Edit overlay labels are now passed directly in the edit-overlay.ts model (see
  // openTagSelectedOverlay below) — no static DOM to set text on anymore.

  // Toolbar section titles (検索 / 並び順 / 表示). The search-mode segment itself
  // (labels, thumb, on-state) is rendered by the toolbar island; viewer only keeps
  // the hint text + aria-label (see the wiring block below). The view/layout titles
  // (#sbViewTitle / #sbLayoutTitle / #sbPosterLayoutTitle) are island-owned too now —
  // they name the current mode/layout from the store (SectionTitle), so viewer no
  // longer writes them (writing here would race the island after a language reload).
  // #sbSearchTitle / #sbSortTitle are island-owned now too (toolbar SectionTitle) — no
  // static setText (writing here would race the island after a language reload).
  // #activebarLabel / #qbEmptyHint / #posterQbEmptyHint are the activebar island now,
  // self-deriving from corpusStore + t() (P4-B slice⑱) — no static setText here.
  // #filterRows titles/row names (フィルタ / 作品 / キャラ / タグ / ハッシュタグ …) are
  // rendered by the sidebar island, self-deriving from corpusPostSidebarSource — no
  // static setText here.
  byId('sbTop').dataset.tip = MSG.sbTopTip; // shared glass tooltip (was native title)

  // #sortSelect stays the (hidden .cs-host) value source; its option LABELS are rendered
  // by the GlassSelect island from i18n keys, so writing option textContent here was dead.
  const sortSelect = selectById('sortSelect');

  // Custom glass dropdown for the sort selects (#sortSelect / #posterSortSelect /
  // #collectionSortSelect) is React-owned now — the toolbar island's GlassSelect hides
  // the native <select> (.cs-host), renders the glass trigger + popup, and drives the
  // select on pick so the change handlers below still fire. The active value is mirrored
  // into corpusStore ('sortPost' etc.) so the island reflects programmatic changes
  // (tab restore pushes 'sortPost'; see applyState / the tab click handler).

  // --- Query Field ---
  const ENG_TYPE_LABELS: Record<string, string> = {
    likes: MSG.qfEngLikes,
    reposts: MSG.qfEngReposts,
    replies: MSG.qfEngReplies,
    bookmarks: MSG.qfEngBookmarks,
    views: MSG.qfEngViews,
  };

  // filterLabel (query-chip renderer + tab titles share it) and tabTitleOf moved
  // to tab-state.ts (makeTabLabels, imported) — 6th extraction slice. Consts
  // declared after this point (PF_NAME / CF) are injected as deferred arrows — a
  // direct ref here would hit TDZ at wiring time; the wrappers only run at
  // render time. formatShortDate / formatCount are hoisted function declarations
  // (direct refs are fine).
  const { filterLabel, tabTitleOf, posterFilterLabel } = makeTabLabels({
    MSG,
    engTypeLabels: ENG_TYPE_LABELS,
    platformName: (v: string) => PF_NAME[v] || v,
    formatShortDate,
    formatCount,
    collectionName: (id: string) => {
      const fobj = CF() && CF().byId(id);
      return fobj ? fobj.name : null;
    },
    // Deferred arrow (posterFolderById is a const declared far below — same TDZ
    // dance as CF()/collectionName; the wrapper only runs at render time).
    posterFolderName: (id: string) => {
      const fo = posterFolderById(id);
      return fo ? fo.name : null;
    },
  });

  // Leading type glyph for a query-builder chip (qcGlyph, imported above) moved
  // to query-builder.ts along with the postQB/posterQB instance wiring — Wave15/V1.

  const PF_NAME: Record<string, string> = { x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' };

  // 全フィルタを一括リセット（アクティブフィルタバーの「リセット」）。検索・フォルダ・
  // 日付・エンゲージも含めて消す。afterQueryChange() が sidebar の active 状態も同期。
  function resetAllFilters() {
    // Bounce back to the poster grid only if we drilled in from a poster AND that
    // poster's user filter is still active (check before emptying the tree).
    const bounce = posterReturn && qHasValue('user', posterReturn);
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
    posterReturn = null;
    if (bounce) setBrowseMode('posters');
  }
  // #postResetBtn / #navBackBtn / #navFwdBtn clicks are wired by the activebar island,
  // which calls window.corpusViewer.resetAllFilters/navBack/navForward directly (P4-B
  // slice⑱ — no more pushed model callbacks) — the buttons are React-owned.
  //
  // Back/forward through the per-tab view history (nav's state machine, the Alt+←/→ +
  // mouse-side-button handlers, and the tab bar/CRUD below) moved to tabs-builder.ts —
  // viewer.ts decomposition's V12 slice (Wave26); tabsCtl is constructed further below
  // (after postQB/postGrid/browseMode/multiOnly are in scope) and its handlers are
  // registered onto window.corpusViewer at that construction site.

  // Empty-state CTAs (innerHTML rebuilds the buttons each render → delegate)
  byId('emptyState').addEventListener('click', (e) => {
    const btn = closestOf(e, 'button');
    if (!btn) return;
    if (btn.id === 'emptyResetBtn') {
      if (browseMode === 'posters') {
        setSearchBoxValue('');
        renderPosters();
      } else resetAllFilters();
    } else if (btn.id === 'emptyImportBtn') byId('importZipInput').click();
  });

  // --- カテゴリ値フライアウト: サイドバーの行/タググループボタンの横に開く。
  // State (どのカテゴリが開いているか) + row-model building (qfValues — bespoke facet
  // logic, unchanged) + pick routing moved to qf-pop-builder.ts (viewer.ts
  // decomposition's V4 slice, Wave18) — the makeQfPop() call lives further down,
  // once postQB/posterQB/pfStore/buildUsers all exist (see near posterQB below).
  // Tag vocabulary / 種別 domain (tagKindOf/kindLabel/groupedTagVocab/
  // inspectorTagPickerData/posterTagsOf/posterFilterVocab) moved to tags.ts
  // (imported) — 8th extraction slice. The 4 tag stores themselves
  // (tagTypes/tagLabels/tagGroups/posterTags) also live in tags.ts now (P4
  // "状態→store" tags slice) — its own getters go in where viewer.js's local
  // `let`s used to. Wired BEFORE the facets/cooc wiring below, which passes
  // tagKindOf/posterTagsOf/posterFilterVocab as direct refs.
  // charCandidatesFor/relatedTagCandidates are consts from the cooc
  // destructure below, so they enter as deferred arrows.
  const { tagKindOf, kindLabel, groupedTagVocab, inspectorTagPickerData, posterTagsOf, posterFilterVocab } = makeTags({
    tagTypes: getTagTypes,
    tagLabels: getTagLabels,
    tagGroups: getTagGroups,
    posterTags: getPosterTags,
    allPosts: () => postGrid.getAllPosts(),
    MSG,
    charCandidatesFor: (w) => charCandidatesFor(w),
    relatedTagCandidates: (sel, opts) => relatedTagCandidates(sel, opts),
  });
  // Bound onto tags.ts's live bindings so renderer/sidebar.ts's pull sources (P4-B
  // slice⑰) can read the SAME tagKindOf/posterFilterVocab this viewer instance uses —
  // both close over tags.ts's own getTagTypes()/getPosterTags(), so there's no second
  // implementation to drift.
  bindTagKindOf(tagKindOf);
  bindPosterFilterVocab(posterFilterVocab);
  // Shared 種別 (kind) menu (right-click a tag chip in the edit picker /
  // inspector / poster picker) — row model + pick/rename actions moved to
  // kind-menu-builder.ts (V2 viewer.ts decomposition slice). Wired here (not
  // where it's first used) so tagKindOf/kindLabel/MSG are all already in
  // scope — no TDZ workaround needed, unlike the old taggingApi indirection.
  const { showKindMenu } = makeKindMenu({ tagKindOf, kindLabel, MSG });
  // Facet aggregation (facetCounts) + value-flyout row models (qfValues) moved to
  // facets.ts — 3rd extraction slice. Runtime couplings are injected: reassigned
  // lets (allPosts/multiOnly) + tags.ts's own getter (tagGroups) as getters, and
  // consts declared after this point (posterQB / pfStore / the listing.ts
  // products) as deferred arrow wrappers — a direct ref here would hit TDZ at
  // wiring time; the wrappers only run when a flyout opens.
  const { qfValues } = makeFacets({
    getFilteredPosts: () => getFilteredPosts(),
    qHasValue,
    posterQHasValue: (type: string, v: string) => posterQB.qHasValue(type, v),
    allPosts: () => postGrid.getAllPosts(),
    hostOf: (u: string | null | undefined) => hostOf(u),
    userKey: (p: CorpusPost) => userKey(p),
    MSG,
    PF_NAME,
    tagKindOf,
    tagGroups: getTagGroups,
    posterTagsOf,
    filteredPosters: () => filteredPosters(),
    posterFilterVocab,
    namedPosters: () => namedPosters(),
    posterFolders: () => pfStore.all(),
    postFolders: () => (CF() ? CF().all() : []), // library folders (collections.json) for the フォルダ flyout
    // Deferred wrapper: buildUsers becomes a const (users.js wiring) declared
    // after this point — a direct ref here would hit TDZ at wiring time.
    buildUsers: () => buildUsers(),
  });
  // Tag co-occurrence math (charCandidatesFor / worksCooccurringWith /
  // relatedTagCandidates) moved to cooc.ts — 4th extraction slice. Same deferred-
  // getter wiring as facets above (allPosts is a reassigned let; the getters only
  // run when a picker or homonym check fires).
  const { charCandidatesFor, worksCooccurringWith, relatedTagCandidates } = makeCooc({ allPosts: () => postGrid.getAllPosts(), tagKindOf });
  // renderQfPop/onQfPick/showQfPopAt moved to qf-pop-builder.ts (V4/Wave18) — see
  // the makeQfPop() call near posterQB below.

  // The ⓘ クエリビルダの使い方 hover popover is the activebar island now (HelpPop) — its
  // content (title + 5 rows) rides the model's `help` field; hover/positioning live there.

  // closeAllMenus/openDatePopover/openPosterDatePopover/openEngPopover (the date/
  // engagement/poster-date-range popovers — unified with qf-pop's "click row to
  // open/close, no backdrop" behavior) moved to filter-popover-builder.ts
  // (V4/Wave18) — see the makeFilterPopover() call near posterQB below.
  // The single 'text' leaf bound to the search box (post mode only) is owned by
  // search-editing.ts, wired together with the rest of the search-box plumbing
  // in search-box-builder.ts now (viewer.ts decomposition's V3 slice, Wave17) —
  // see the makeSearchBox() call below.

  // --- Sidebar filter controls ---
  // (#filterRows row labels are rendered by the sidebar island, self-deriving from
  // corpusPostSidebarSource (P4-B slice⑰). No static setText for プラットフォーム / 投稿 /
  // メディア / 日付 / エンゲージメント here.)

  // Sidebar chip toggle (platform, postType, media)
  // Filter rows: click a row → flyout with that category's values beside it.
  // 日付/エンゲージはパラメータ入力付きの専用ポップオーバーへ委譲。
  byId('filterRows').addEventListener('click', (e) => {
    // クリップ: 空にする clears every flag (kept before the row check so it doesn't also
    // toggle the filter — was e.stopPropagation() on the old direct listener).
    if (closestOf(e, '#clipClear')) {
      if (!CF()) return;
      if (!window.confirm(MSG.clipEmptyConfirm)) return;
      keepCurrentVisible();
      CF().clearClips();
      renderPosts(true);
      return;
    }
    // クリップ row: toggle the "show only clipped" filter.
    if (closestOf(e, '#clipRow')) {
      const idx = postQB.shadow().findIndex((f: { type: string }) => f.type === 'clip');
      if (idx < 0) addFilter({ type: 'clip', value: '*' });
      else removeFilter(idx);
      return;
    }
    // 複数画像: a direct 2-state toggle (no data-qfrow, no flyout). Handled via this
    // delegated listener rather than its own — the row can be (re)built after wiring
    // time, so a listener bound at load could miss it. Flips the group-level flag.
    if (closestOf(e, '#multiRow')) {
      multiOnly = !multiOnly;
      storeSet('multiOnly', multiOnly); // mirror into the store — the sidebar/Tabs sources read it directly (P4-B slices⑯⑰)
      renderPosts();
      return;
    }
    const row = closestOf(e, '[data-qfrow]');
    if (!row) return;
    const cat = row.dataset.qfrow as string;
    const openKind = filterPopoverGet()?.kind;
    // Re-clicking the row whose popover is already open = toggle it closed.
    if (cat === 'date' && openKind === 'date') {
      filterPopover.closeAll();
      return;
    }
    if (cat === 'engagement' && openKind === 'eng') {
      filterPopover.closeAll();
      return;
    }
    filterPopover.closeAll(); // switching rows closes any open date/eng popover first
    if (cat === 'date') {
      qfPop.hideQfPop();
      filterPopover.openDate(null);
      return;
    }
    if (cat === 'engagement') {
      qfPop.hideQfPop();
      filterPopover.openEng(null);
      return;
    }
    qfPop.showQfPopAt(cat, row);
  });

  // フライアウトはクリックのみで開閉（ホバーで開く実験は撤回＝誤爆・絞り込み入力中に
  // 別行へカーソルが乗って別フライアウトに化ける問題があったため）。

  // Update sidebar state — kept as a thin alias to renderQueryChips (its many call
  // sites keep their name) now that badges/tag-visibility are self-derived by
  // renderer/sidebar.ts's corpusPostSidebarSource/corpusPosterSidebarSource (P4-B
  // slice⑰; see that file for how postQueryTree/tags/folders/posts-data feed it).
  function updateSidebarState() {
    // (#searchBox's has-value accent is owned by the searchbox island)
    renderQueryChips(); // 検索/フォルダ等の変化を下部アクティブバーへ即時反映
  }

  // --- Tag area: the タグ row opens ONE flyout listing every general tag,
  // sectioned by tag group (facets.js emits the ghead rows). Groups are
  // user-created and unbounded, so they live INSIDE the scrollable flyout —
  // permanent sidebar rows for them stretched the column without bound
  // (sub-rows removed 2026-07-03).
  // tagGroups/tagTypes/tagLabels (種別・グループ語彙) + tagKindOf/kindLabel moved
  // to tags.js (corpusTags wiring above) — the P4 "状態→store" tags slice.
  // (Possibly custom) 作品/キャラ names + which tags carry a 種別 are read live by
  // renderer/sidebar.ts's sources now (corpusTags.onChange / posts-data.ts's subscribe
  // — P4-B slice⑰), so a 種別 rename or classification no longer needs an explicit
  // re-derive here; the rest (palette section headers, kind menu, dot tooltips) already
  // read kindLabel() live too. Mutation + persistence for the kind menu itself
  // live in kind-menu-builder.ts now (V2 slice); tagsSetTagKind below is only
  // for maybeDistinguishHomonym's own direct write.
  const _ic = (paths: string) => `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  // --- In-session Edit Undo/Redo ---
  // Records tag-edit operations so the user can undo bulk mistakes (Ctrl+Z / Ctrl+Shift+Z).
  // Linear stack, clears on restart. Deletions are NOT included (handled by trash).
  // Stack semantics + the viewer-owned apply callbacks/shortcut handler moved to
  // undo-builder.ts — viewer.ts decomposition's V11 slice (Wave25). Constructed here
  // (its original spot) so pushUndo is ready in time for inspector/postGrid/posterGrid's
  // own deps below; postGrid/inspector/posterGrid/showToast are all declared later, so
  // their accessors are deferred forward references (same shape as inspector-builder.ts's
  // jumpToPoster/showToast).
  const undoCtl = makeUndoController({
    showToast: (msg) => showToast(msg), // showToast is declared far below — deferred
    getPostById: (id) => postGrid.getPostById(id), // postGrid is declared below — deferred
    markPostsMutated: () => postGrid.markPostsMutated(),
    renderPosts: (keepLimit) => postGrid.renderPosts(keepLimit),
    getViewGroups: () => postGrid.getViewGroups(),
    getInspectedKey: () => inspectedKey,
    showDetail: (g) => showDetail(g), // showDetail (inspector) is declared far below — deferred
    refreshPosterTagFields: (key) => refreshPosterTagFields(key), // refreshPosterTagFields (posterGrid) is declared far below — deferred
  });
  const { pushUndo, doUndo, doRedo, handleShortcutUndoKey } = undoCtl;
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleShortcutUndoKey });

  // --- State ---
  // allPosts/_postsById/loadPosts/renderPosts and the render-reuse guard moved to
  // post-grid-builder.ts (Wave19/V5 "allPosts ownership transfer") — postGrid is
  // constructed below, after buildUsers/postQB are in scope.
  let browseMode = 'posts'; // 'posts' | 'posters' (what the content area browses)
  // Holds the poster KEY a poster-click drilled into (posts mode + that `user` filter).
  // A query reset bounces back to the poster grid AS LONG AS that user filter is still
  // active (you're still looking at this poster's posts, even with extra library filters
  // added). Removing the user filter or switching mode ends it. null = no pending return.
  let posterReturn: any = null;
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
  const GRID_ANIM_MS = 950;
  // Grouping state (manualGroups/ungrouped/stickyRecs, persisted via main:
  // manual-groups.json / ungrouped.json) moved to post-grid-builder.ts along with
  // viewGroups — see postGrid below.
  // postIdKey of the group shown in the inspector (ring marker). Mirrored into
  // corpusStore so the grid/poster cells derive their own '.inspected' ring via
  // useSyncExternalStore — no more manual repaint()/pushPosterModel() calls to
  // refresh the ring on open/close (the store notify does that reactively).
  let inspectedKey: string | null = null;
  function setInspectedKey(key: string | null) {
    inspectedKey = key;
    storeSet('inspectedKey', key);
  }
  storeSet('inspectedKey', null); // establish the initial value (store.get() is undefined otherwise)
  // Display density (card/tile/list) + tile/card/list size slider, for both the
  // post grid and the poster grid, moved to grid-density-builder.ts — viewer.ts
  // decomposition's V10 slice (Wave24). renderPosts/renderPosters are forward
  // references (declared later via postGrid/posterGrid below) — deferred arrows
  // the same TDZ-safe way every other service wiring in this file already works.
  const gridDensity = makeGridDensity({
    corpusIpc,
    corpusPostGridSource,
    renderPosts: () => renderPosts(),
    renderPosters: () => renderPosters(),
    getBrowseMode: () => browseMode,
  });
  const { tileThumbW, cardThumbW, listThumbW } = gridDensity;
  let skipDeleteConfirm = false;
  // Post-grid selection state (Set + shift-range anchor) lives in
  // renderer/selection.ts (P4-B slice⑬) — corpusStore's
  // 'selectedSet' key IS the state; the grid island's cells read it reactively.
  // --- Query builder: a boolean condition tree is the single source of truth ---
  // (改訂③: flat conditions you drag into parenthesised
  // groups; no auto type-grouping). BOTH views (posts / posters) share ONE builder
  // implementation via the createQueryBuilder(ctx) factory below; ctx carries the
  // per-view differences (container, leaf predicate, label, callbacks). The tree is
  // ALWAYS a root group (op 'and' by default). Each instance's `.shadow()` is a
  // derived flat shadow of the leaves (sidebar highlight / row badges / tab
  // title / counts) — postQB.shadow()/posterQB.shadow(), read fresh at each
  // call site rather than mirrored into a separate module-level global (P4-B
  // slice⑧; see the syncShadow comment below).
  // The tree machinery + post-side predicates live in query.ts (imported above)
  // — the first "pure logic → service" extraction of the viewer decomposition.
  // Runtime couplings are injected here: collections/clips resolve through CF()
  // lazily (folders.js registers after this closure is built, and predicates only
  // run post-init), fuzzy text matching through corpusSearch.
  // The shared facet-chip builder (改訂④) lives in
  // query-chips.ts (P4-B スライス⑦ event半分): tree state, cluster view-model
  // derivation, qbNodeMap, and click/contextmenu dispatch all moved there — the
  // query-chips island reads a cached model + calls dispatch() directly instead
  // of viewer.js pushing a model and delegating raw DOM events. The postQB/
  // posterQB instance construction (predOf/glyph/createQueryBuilder ctx) itself
  // moved to query-builder.ts (Wave15/V1); viewer.js keeps the orchestration
  // around a change (onChange/openLeafEditor/onClearSearch) since those still
  // reach into state (renderPosts, searchEditing, popovers) not yet extracted.
  // i18n strings the builder needs for labels/menus — resolved once here (MSG
  // is a viewer.js-local construct) and passed in via ctx.msg since
  // query-builder.ts has no access to viewer.js's i18n binding.
  const qbMsg = {
    qcJoinAnd: MSG.qcJoinAnd,
    qcJoinOr: MSG.qcJoinOr,
    qbExclLabel: MSG.qbExclLabel,
    qbSummaryTip: MSG.qbSummaryTip,
    qfDelete: MSG.qfDelete,
    qbOptAll: MSG.qbOptAll,
    qbOptAny: MSG.qbOptAny,
    qbOptAllTip: MSG.qbOptAllTip,
    qbOptAnyTip: MSG.qbOptAnyTip,
    qbMenuInclude: MSG.qbMenuInclude,
    qbMenuExclude: MSG.qbMenuExclude,
  };

  // The post-side builder instance. P4-B slice⑧: badge/tab-title/etc. reads used
  // to mirror the tree shadow into a module-level `activeFilters` global via an
  // onShadow callback; that global was a pure duplicate of postQB.shadow() (the
  // instance already exposes the same cached array) — every read site now calls
  // postQB.shadow() directly instead of maintaining a second copy.
  const { qb: postQB, predOf: postPredOf } = makePostQueryBuilder({
    msg: qbMsg,
    container: document.getElementById('queryChips')!,
    barEl: document.getElementById('postActiveBar'), // reveal + --activebar-h measure (empty/reset are the island's)
    labelOf: filterLabel,
    getSearchVal: () => searchQuery(),
    onClearSearch: () => {
      setSearchBoxValue('');
      afterQueryChange();
    },
    onChange: () => {
      renderPosts();
    },
    openLeafEditor: (n: CorpusQueryLeaf) => {
      if (n.type === 'date') filterPopover.openDate(n);
      else if (n.type === 'engagement') filterPopover.openEng(n);
    },
    // When the editing text leaf is removed or dragged on the bar, detach it from
    // the box. textInTree (query-builder.ts) suppresses the legacy echo chip (the
    // term is a real leaf). Deferred arrows: searchEditing is constructed later in
    // this closure (the makeSearchBox() call below), same forward-reference
    // pattern as postQB/posterQB being referenced from functions defined above
    // their own declarations.
    onLeafMutated: (node: CorpusQueryLeaf) => searchEditing.onLeafMutated(node),
    isEditingLeaf: (node: CorpusQueryLeaf) => searchEditing.isEditingLeaf(node),
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
  function removeNode(node: CorpusQueryLeaf) {
    postQB.removeNode(node);
  }
  function removeCondsMatching(pred: (c: CorpusQueryLeaf) => boolean) {
    return postQB.removeCondsMatching(pred);
  }
  function qHasValue(type: string, value: string) {
    return postQB.qHasValue(type, value);
  }
  function afterQueryChange() {
    postQB.refresh();
  }

  const CF = () => folders; // shared folder module

  // --- Settings (the React island owns the modal; see app/islands/settings).
  // The brand-bar gear opens it; Esc / backdrop close are handled in the island.
  (function wireSettingsGear() {
    const btn = document.getElementById('settingsBtn');
    if (btn)
      btn.addEventListener('click', () => {
        if (window.corpusSettings) window.corpusSettings.open();
      });
  })();

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
  // buildUsers (generation-cached poster roll-up) + buildSuggest (search-box
  // suggestion items) moved to users.ts (imported above) — 5th extraction
  // slice. Reassigned lets (allPosts / _allPostsGeneration) are injected as
  // getters; userKey/hostOf are consts already initialized at this point (the
  // query.ts import above), so they pass through directly. corpusSearch
  // is a getter because buildSuggest reads its live fuzzy mode per call.
  const { buildUsers, buildSuggest } = makeUsers({
    allPosts: () => postGrid.getAllPosts(),
    generation: () => postGrid.getGeneration(),
    userKey,
    hostOf,
    corpusSearch: () => ({ isFuzzy: searchIsFuzzy, compile: searchCompile }),
  });

  // --- Image source (served from the save folder via the psimg:// protocol) ---
  // psimg URL for a bare filename; w>0 asks main for a downscaled thumbnail (tiles).
  const fileSrc = (file: string, w?: number) => (file ? 'psimg://img/' + encodeURIComponent(file) + (w ? '?w=' + w : '') : '');

  // Record-shape helpers (mediaFilesOf/isScreenshot/captureFile/artworkFile/
  // densityImage), normalization (postIdKey/postKeyOf), grouping (groupRecords)
  // and percentileFn moved to records.ts (imported).

  // hostOf / userKey moved to query.ts (imported above).

  // --- Post grid: allPosts/_postsById/loadPosts/renderPosts, the render-reuse
  // guard, manualGroups/ungrouped/viewGroups/stickyRecs, the fold/card context
  // menus, and the delete flow all live in post-grid-builder.ts now (Wave19/V5
  // "allPosts ownership transfer" — the viewer.ts decomposition's biggest slice).
  // Everything still owned by this closure (density/view state, the inspector,
  // selection, tabs, poster view, boot orchestration) is injected below; several
  // are forward references (postQB/buildUsers/showDetail/renderPosters/…
  // declared later in this closure) — deferred arrows the same TDZ-safe way
  // every other service wiring in this file already works.
  const postGrid = makePostGridBuilder({
    MSG,
    PF_NAME,
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
    syncBrowseBar: () => syncBrowseBar(),
    applyTileLayout: () => gridDensity.applyTileLayout(),
    getBrowseMode: () => browseMode,
    renderPosters: (keepLimit) => renderPosters(keepLimit),
    onPostsLoaded: () => {
      // An active image tab shows library records — re-resolve it against the fresh
      // set so t._g stays current (inspector re-open); the React model itself
      // re-derives live via renderer/image-tab.ts's posts-data.ts subscription.
      const it = tabsCtl.activeTab();
      if (it && tabsCtl.isImageTab(it)) it._g = imageTabCtl.resolveImageTabGroup(it);
    },
    getInspectedKey: () => inspectedKey,
    closeDetail: () => closeDetail(),
    showDetail: (g) => showDetail(g),
    jumpToPoster: (post) => jumpToPoster(post),
    addImageTab: (g) => imageTabCtl.addImageTab(g),
    getSkipDeleteConfirm: () => skipDeleteConfirm,
    setSkipDeleteConfirm: (v) => {
      skipDeleteConfirm = v;
    },
  });
  const { loadPosts, renderPosts, markPostsMutated, reconcileFolders, keepCurrentVisible, showFoldMenu, showCardMenu, requestDeleteGroup } = postGrid;

  // The listing pipeline — getFilteredPosts (content gate → query tree → sticky
  // merge → sort), namedPosters/filteredPosters, and the collection derivations —
  // moved to listing.ts (imported above), 7th extraction slice. Runtime
  // couplings are injected: reassigned lets (allPosts/_postsById/posterSort/
  // collectionSort) as getters; posterQB is a const declared later — arrow
  // wrappers defer the read past TDZ (they only run once posters render).
  // Collection derivations (filteredCollections / dynamicMatches / …) are no longer
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
    searchQuery: () => searchQuery(),
    buildUsers,
    posterQBEval: (u) => posterQB.eval(u),
    posterQBTree: () => posterQB.getTree(),
    // Poster sort's single source is corpusStore 'sortPoster' (the GlassSelect writes it);
    // default 'count' when unset (poster sort isn't persisted, so it resets on reload — same
    // as the old closure default).
    posterSort: () => (storeGet('sortPoster') as string) || 'count',
    // Collections migrated to sidebar folders; the collection-sort UI is gone, so
    // listing.js's filteredCollections() is dormant smart-collection foundation and
    // is never called here. This getter satisfies its contract with the default
    // (alphabetical) sort — never actually invoked in the current build.
    collectionSort: () => 'name',
    allCollections: () => (CF() ? CF().allCollections() : []) as CorpusCollection[],
    filterLabel,
  });
  // Bound onto listing.ts's namedPosters live binding so renderer/sidebar.ts's poster
  // source (P4-B スライス⑰) can read the same namedPosters() this viewer instance uses
  // (poster-instance row disclosure) — see the corpusTags.tagKindOf note above for why
  // this is a bind, not a reimplementation.
  bindNamedPosters(namedPosters);

  // The render-reuse guard (lastRenderedState/_lastRenderGen/_lastViewGroups/
  // _lastStickySize) lives in post-grid-builder.ts now; tabsCtl.syncTitleAndPersist()
  // below writes lastRenderedState via postGrid.setLastRenderedState.
  //
  // Nav history (browser-style back/forward), the corpusStore-backed tabs/
  // activeTabId/tabEditingId accessors (P4-B slice⑯), and the tab bar CRUD/DOM
  // handlers all moved to tabs-builder.ts — viewer.ts decomposition's V12 slice
  // (Wave26). Image tabs moved to image-tab-builder.ts below — V13/Wave27's
  // scope — and receive tabsCtl's tab-state surface as deferred deps/direct
  // references (imageTabCtl is constructed just below, after tabsCtl).
  const tabsCtl = makeTabsController({
    MSG,
    tabTitleOf,
    postQB,
    getSortValue: () => sortSelect.value,
    setSortValue: (v) => {
      sortSelect.value = v;
      storeSet('sortPost', sortSelect.value); // mirror into the store so the GlassSelect island reflects it
    },
    getMultiOnly: () => multiOnly,
    setMultiOnly: (v) => {
      multiOnly = v;
      storeSet('multiOnly', multiOnly); // mirror into the store — the sidebar/Tabs sources read it directly (P4-B slices⑯⑰)
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
    contentScrollTop: () => contentScrollTop(),
    scrollContentTo: (y) => scrollContentTo(y),
    showImageTab: (t) => imageTabCtl.showImageTab(t), // imageTabCtl is constructed just below — deferred
    hideImageTabView: () => imageTabCtl.hideImageTabView(),
  });
  const {
    getTabs,
    mutateTabs,
    getActiveTabId,
    setActiveTabId,
    isImageTab,
    activeTab,
    nav,
    navBack,
    navForward,
    persistTabsDebounced,
    saveActiveTabState,
    closeTab,
    handleShortcutNavKey,
    handleShortcutMouseNav,
    handleTabBarKeydown,
    handleTabBarFocusout,
    handleTabBarClick,
    handleTabBarAuxclick,
    handleTabBarMousedown,
    handleTabBarContextmenu,
    handleTabBarDblclick,
    handleGlobalTabShortcut,
  } = tabsCtl;
  window.corpusViewer = Object.assign(window.corpusViewer || {}, {
    navBack,
    navForward,
    resetAllFilters,
    handleShortcutNavKey,
    handleShortcutMouseNav,
    handleTabBarKeydown,
    handleTabBarFocusout,
    handleTabBarClick,
    handleTabBarAuxclick,
    handleTabBarMousedown,
    handleTabBarContextmenu,
    handleTabBarDblclick,
    handleGlobalTabShortcut,
  });

  // --- Image tabs (type:'image') — fit-to-screen detail view (Eagle 風) ---
  // The model/state cluster (resolveImageTabGroup/showImageTab/hideImageTabView/
  // setImageTabIndex/toggleImageTabInspector/closeImageTab/addImageTab) lives in
  // image-tab-builder.ts now (viewer.ts decomposition's V13 slice, Wave27).
  // showDetail/closeDetail (inspector-builder.ts) are declared far below —
  // deferred arrows the same TDZ-safe way postGrid's own showDetail/closeDetail
  // deps already work.
  const imageTabCtl = makeImageTabController({
    MSG,
    getPostById: postGrid.getPostById,
    showDetail: (g) => showDetail(g),
    closeDetail: () => closeDetail(),
    isImageTab,
    activeTab,
    closeTab,
    getActiveTabId,
    setActiveTabId,
    mutateTabs,
    saveActiveTabState,
    nav,
    persistTabsDebounced,
  });
  const { resolveImageTabGroup, showImageTab, hideImageTabView, setImageTabIndex, toggleImageTabInspector, closeImageTab, addImageTab } = imageTabCtl;

  // initTabs/showTabMenu/tab-rename commit-cancel/tab-bar DOM handlers/the
  // Ctrl+T/W/Tab shortcut all live in tabsCtl now (destructured above); the
  // window.corpusViewer registration for the tab-bar handlers happened at
  // that destructure site too.

  // keepCurrentVisible/imgAspect/cardModel/corpusPostGridSource.configure/
  // renderPosts all moved to post-grid-builder.ts (postGrid above).
  const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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

  // Image lightbox / gallery (captured screenshot + downloaded originals). The
  // overlay UI lives in the React island (window.corpusLightbox); viewer.js only
  // resolves a post's gallery items below and hands them to open(). Labels are
  // pushed once so the island can set the nav buttons' aria-labels. In dev the
  // island is a deferred module that may not have loaded yet — stash for catch-up.
  {
    const lbLabels = { lbPrev: MSG.lbPrev, lbNext: MSG.lbNext };
    if (window.corpusLightbox) window.corpusLightbox.setLabels(lbLabels);
    else window.__corpusLbLabels = lbLabels;
  }

  // Lightbox gallery items — built by records.js (makeGallery); the psimg URL
  // scheme stays viewer-owned via the injected fileSrc.
  const { buildGroupGalleryItems } = makeGallery({ fileSrc });
  // renderer/image-tab.ts's pull source reuses the SAME gallery instance (P4-B slice⑮) —
  // configure() sets it once, same "invariant callbacks set once" shape as the grid sources.
  // onIndexChange/onToggleInspector/onCloseTab are the DI callbacks that replaced
  // image-tab.ts's former window.corpusViewer dispatch (V13/Wave27, §5).
  corpusImageTabSource.configure({
    gallery: { buildGroupGalleryItems },
    labels: { missing: MSG.imgTabMissing, closeTab: MSG.imgTabCloseBtn, prev: MSG.lbPrev, next: MSG.lbNext, info: MSG.tipInfo },
    onIndexChange: setImageTabIndex,
    onToggleInspector: toggleImageTabInspector,
    onCloseTab: closeImageTab,
  });

  byId('postGrid').addEventListener('click', (e) => {
    // Image -> open the gallery (screenshot + originals, whole group).
    // While the inspector is open, a single click swaps its content instead
    // (inline browsing); the gallery is then reached by double-click.
    const img = closestOf(e, '.card-img');
    if (img) {
      e.stopPropagation();
      const g = postGrid.getViewGroups()[Number.parseInt((img.closest('.post-card') as HTMLElement | null)?.dataset.index ?? '', 10)];
      if (!g) return;
      if (!byId('postDetail').hidden) {
        showDetail(g);
        return;
      }
      window.corpusLightbox.open(buildGroupGalleryItems(g), 0);
    }
  });
  byId('postGrid').addEventListener('dblclick', (e) => {
    const img = closestOf(e, '.card-img');
    if (!img || byId('postDetail').hidden) return;
    const g = postGrid.getViewGroups()[Number.parseInt((img.closest('.post-card') as HTMLElement | null)?.dataset.index ?? '', 10)];
    if (g) window.corpusLightbox.open(buildGroupGalleryItems(g), 0);
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

  // Clip button: one-click flag/unflag this post (no picking). Mutations never replay
  // the entrance animation: re-render (keepLimit) only when a clip filter could change
  // the visible set.
  byId('postGrid').addEventListener('click', (e) => {
    const btn = closestOf(e, '.clip-btn');
    if (!btn) return;
    e.stopPropagation();
    if (!CF()) return;
    const g = postGrid.getViewGroups()[Number.parseInt(btn.dataset.clip ?? '', 10)];
    if (!g || !g.rep.captureId) return;
    keepCurrentVisible(); // removal can un-match an active clip filter
    const res = CF().toggleClip(
      g.records.map((r) => r.captureId),
      g.rep.captureId,
    );
    if (!res) return;
    btn.classList.toggle('in', res === 'added');
    if (postQB.shadow().some((f: { type: string }) => f.type === 'clip')) renderPosts(true);
  });

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
  // postFolderChips was retired (collections moved to the collections view); the クリップ
  // + 複数画像 row entries (active state, clip count) are self-derived now by
  // renderer/sidebar.ts's corpusPostSidebarSource (P4-B slice⑰) — no viewer-side
  // re-render call needed after a clip/multi/folder mutation.
  // フォルダ管理の起動口はフライアウト下部の qf-pop フッターボタン（onManage→CF().openManager()）に統一。
  // 旧 #postFolderManage ボタンは HTML から撤去済み（デッドリスナーを削除）。
  // The クリップ row toggle + 空にする clear are handled by the delegated #filterRows
  // listener now (the rows are React-owned, so a setup-time addEventListener on a
  // specific node would miss the island's re-renders).

  // 複数画像 sidebar row: reflects the group-level multiOnly flag as the row's active
  // state (accent icon) via the model. The click that flips it is handled by the
  // delegated #filterRows listener.

  // toggleCardSelection/syncSelectionClasses/selectedRecords/clearSelection/
  // updateSelectionBar/groupSelected/toggleSelectAll/handleShortcutSelectAllKey/
  // requestDeleteSelected/handleSelectionBarClick moved to selection-builder.ts —
  // viewer.ts decomposition's V8 slice (Wave22). Constructed below, after the
  // inspector (needs its persistManual) — see selectionCtl.

  // requestDeleteGroup/executeDeleteGroup moved to post-grid-builder.ts (postGrid above).

  // === Inspector (ℹ on a card): persistent right column / slide-over ===
  // Open/close chrome, the inline tag editor (add/toggle/adopt-source-tag +
  // homonym check), the group dissolve/regroup buttons, and the Esc/outside-click
  // dismiss guards moved to inspector-builder.ts — viewer.ts decomposition's V7
  // slice (Wave21). inspectedKey/setInspectedKey stay here — other not-yet-
  // extracted clusters read/write them too (poster card click below, undo,
  // browse-mode switch) — inspector-builder.ts only gets the accessor pair.
  const inspector = makeInspector({
    MSG,
    fileSrc,
    showToast: (msg) => showToast(msg), // showToast is declared far below — deferred
    showKindMenu,
    buildUsers,
    tagKindOf,
    worksCooccurringWith,
    jumpToPoster: (post) => jumpToPoster(post), // jumpToPoster (posterGrid) is declared far below — deferred
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
    refreshTileSlider: () => gridDensity.refreshTileSlider(),
    getActiveTabId,
    closeTab,
    imageTabShowing: () => imageTabCtl.isShowing(), // primitive read — live, not a snapshot
  });
  const { closeDetail, showDetail, persistManual, handleEscDismissDetail, handleOutsideClickDismissDetail } = inspector;
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleEscDismissDetail, handleOutsideClickDismissDetail });

  // === Selection (click a card to select; the bar appears when 1+ are selected) ===
  // groupSelected needs inspector's persistManual, so this is constructed here
  // (after inspector above), not at the cluster's original spot.
  const selectionCtl = makeSelectionBar({
    MSG,
    showToast: (msg) => showToast(msg), // showToast is declared far below — deferred
    getViewGroups: postGrid.getViewGroups,
    getManualGroups: postGrid.getManualGroups,
    setManualGroups: postGrid.setManualGroups,
    markPostsMutated,
    renderPosts,
    loadPosts,
    persistManual,
    showFoldMenu,
    // bulkEdit (bulk-edit.ts, edit-overlay.ts consumer) is constructed just
    // below — deferred since it needs this selectionCtl's own selectedRecords.
    openTagSelectedOverlay: () => bulkEdit.openTagSelectedOverlay(),
    getBrowseMode: () => browseMode, // viewer.ts `let`, read live
  });
  const { toggleCardSelection, selectedRecords, handleShortcutSelectAllKey } = selectionCtl;
  // ○ select ring (top-left, shown on hover) — the ONLY way INTO the selection.
  // Clicking the card body does not select while nothing is selected yet.
  byId('postGrid').addEventListener('click', (e) => {
    const ring = closestOf(e, '.select-check');
    if (!ring) return;
    e.stopPropagation();
    const card = ring.closest('.post-card') as HTMLElement | null;
    if (card) toggleCardSelection(card, e.shiftKey);
  });
  // Selection mode (≥1 selected): a click ANYWHERE on a card toggles it.
  // Capture phase so it pre-empts every other card action (gallery, text
  // expand, ℹ/edit/delete/📁/open) until the selection is cleared.
  byId('postGrid').addEventListener(
    'click',
    (e) => {
      if (selection.size() === 0) return;
      const card = closestOf(e, '.post-card');
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      toggleCardSelection(card, e.shiftKey);
    },
    true,
  );
  byId('selectionBar').addEventListener('click', selectionCtl.handleSelectionBarClick);
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleShortcutSelectAllKey });

  // ℹ button on card → detail popup (re-click same card toggles close)
  byId('postGrid').addEventListener('click', (e) => {
    const btn = closestOf(e, '.info-btn');
    if (!btn) return;
    e.stopPropagation();
    const g = postGrid.getViewGroups()[Number.parseInt(btn.dataset.info ?? '', 10)];
    if (!byId('postDetail').hidden && inspectedKey && g && postIdKey(g.rep) === inspectedKey) {
      closeDetail();
      return;
    }
    showDetail(g);
  });
  // 🏷 button on card → open the inspector (tags are editable inline there)
  byId('postGrid').addEventListener('click', (e) => {
    const btn = closestOf(e, '.tag-btn');
    if (!btn) return;
    e.stopPropagation();
    const g = postGrid.getViewGroups()[Number.parseInt(btn.dataset.tagedit ?? '', 10)];
    if (!g) return;
    showDetail(g);
  });

  // --- Edit overlay (bulk "add tags to selection") ---
  // The staging list itself (selected records / tags-in-progress / additive flag)
  // lives in bulk-edit.ts — nothing persists until Save (see openTagSelectedOverlay/
  // onSave inside bulk-edit-builder.ts) writes it out. Constructed here (after
  // selectionCtl above) since groupSelected's sibling openTagSelectedOverlay needs
  // this cluster's own selectedRecords — see the deferred dep on selectionCtl above.
  const bulkEdit = makeBulkEdit({
    MSG,
    showToast: (msg) => showToast(msg), // showToast is declared far below — deferred
    showKindMenu,
    inspectorTagPickerData,
    pushUndo,
    markPostsMutated,
    renderPosts,
    keepCurrentVisible,
    getPostById: postGrid.getPostById,
    selectedRecords,
  });
  const { closeEditOverlay } = bulkEdit;

  // Modal chrome (lock background scroll + darken the native titlebar while any
  // full-screen overlay is up) moved to the ModalChrome hook in app/islands/app/App.tsx
  // — same observe-each-overlay logic, just registered by React instead of this IIFE.

  // Inspector inline tag editors (post ivTag* / poster pdTag*) are now the React
  // TagEditor component inside the inspector island — it owns its own input/
  // click/contextmenu handling directly via the callbacks in the model (see
  // showDetail/showPosterDetail), so no delegated #postDetail listeners are needed.

  // Background click (outside the box) cancels, same as editCancel/onCancel below.
  byId('editOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditOverlay();
  });

  // --- Selection (click a card to select; the bar appears when 1+ are selected) ---
  // Wiring (selectionCtl, its listeners, toggleCardSelection/selectedRecords/
  // clearSelection/handleShortcutSelectAllKey) moved up next to the inspector —
  // see the V8/Wave22 comment there.

  // handleShortcutSearchFocusKey (`/` or Ctrl/Cmd+K focuses the search box) moved
  // to search-box-builder.ts's makeSearchBox() return — viewer.ts decomposition's
  // V14 slice (Wave28), wired alongside the rest of that factory's output below.

  // Deferred-render timers so a view/layout switch paints the segment (thumb + active)
  // FIRST, then runs the heavy grid render past a paint (optimistic UI). clearTimeout
  // collapses rapid clicks to a single render.
  let _browseRenderT: any = null;
  // #densityToggle is rendered by the toolbar island (corpusStore 'view'); the
  // reaction (mirror into currentView, persist, re-render with a view transition)
  // lives in grid-density-builder.ts now (V10/Wave24) — this just bridges React's
  // subscribe registration (StoreSubscriptions, App.tsx) to it.
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleViewStoreChange: gridDensity.handleViewStoreChange });

  // === Browse-mode toggle: 投稿グリッド ↔ 投稿者グリッド ===
  // Switches the content area between the post grid and the poster grid (same tab).
  // A semantic "what am I browsing" switch — distinct from the card/tile/list density.
  function setBrowseMode(mode: string, opts?: { silent?: boolean }) {
    mode = mode === 'posters' ? 'posters' : 'posts'; // collections retired (now a sidebar folder list)
    posterReturn = null; // an explicit mode switch ends any pending poster-return
    browseMode = mode;
    // Mirror into the store so the React islands (BrowseToggle active/thumb, SectionTitle's
    // "ビュー · …" suffix) reflect the mode even when we got here from an INTERNAL setter
    // (jumpToPoster / openPosterPosts / openCollection / the filter-reset bounce) rather
    // than a toggle click. Safe against recursion: the store's set is value-guarded, and
    // when the click path drove us the value is already equal (no-op); when an internal
    // setter drove us, browseMode === mode by now so the subscribe handler's guard skips.
    storeSet('browseMode', mode);
    // The active state + glass thumb AND body.browse-posters (CSS hides the inactive grid)
    // are React-owned now — the BrowseToggle island / App's ShellClasses both react to this
    // corpusStore 'browseMode' change (ShellClasses toggles the body class in a
    // useLayoutEffect, before paint = no flash). We only run the heavy switch below.
    // (Changing which toolbars are visible shifts the sidebar width → the toggle's geometry;
    // the island's ResizeObserver re-slides its own thumb, so there is nothing to measure here.)
    closeDetail(); // a stale post/poster detail shouldn't survive the switch
    if (!(opts && opts.silent)) corpusIpc.setPref('browseMode', mode);
    // Optimistic UI: the segment (thumb slide / active state / grid swap via body class)
    // was updated synchronously above; defer the heavy grid render past a paint so the
    // switch shows INSTANTLY instead of blocking on renderPosts/Posters/Collections.
    const render = () => {
      if (browseMode !== mode) return;
      if (mode === 'posters') renderPosters();
      else renderPosts();
    };
    if (opts && opts.silent) {
      render();
      return;
    } // initial restore: render synchronously
    clearTimeout(_browseRenderT);
    _browseRenderT = setTimeout(render, 0);
  }
  // #browseToggle is rendered by the toolbar island (corpusStore 'browseMode').
  // React owns the active state + glass thumb; viewer reacts to a mode change by running
  // the heavy switch. The idempotent guard skips the no-op set from the pref restore
  // below, so the loop stays one-way (island → store → viewer, never back). Subscribe
  // registration lives in React (StoreSubscriptions, App.tsx) via window.corpusViewer
  // below; this stays the guard + action logic.
  function handleBrowseModeStoreChange() {
    const m = storeGet('browseMode');
    if (m === browseMode) return;
    setBrowseMode(m);
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleBrowseModeStoreChange });

  // The browse toggle is React-owned now (BrowseToggle island); it measures its own glass
  // thumb via a ResizeObserver on its container, so the sidebar-width changes that grid
  // renders cause are handled there. Kept as a no-op so the existing call sites
  // (renderPosts / renderPosters / renderCollections) need no change.
  function syncBrowseBar() {}

  // --- Poster grid (投稿者ビュー) ------------------------------------------
  // Cards derived from post author fields (buildUsers — no fetching). Click =
  // inspector (poster profile), double-click = jump to that poster's posts.
  // posterList itself is now poster-grid-builder.ts-internal state (exposed via
  // getPosterList) — V6/Wave20.
  // posterSort ('count' | 'name' | 'date-desc' | 'date-asc') lives in corpusStore
  // 'sortPoster' now (read via the listing dep getter above); a subscription below
  // re-renders on change, replacing the old #posterSortSelect DOM-'change' listener.
  // Poster grid density + tile/card size slider (kept SEPARATE from the post-side
  // currentView — its masonry/tile/list layouts are bound to poster-card markup)
  // lives in grid-density-builder.ts now (V10/Wave24), alongside the post-side
  // equivalent above. This just bridges React's subscribe registration
  // (StoreSubscriptions, App.tsx) and the slider's DOM 'input' listener to it.
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handlePosterViewStoreChange: gridDensity.handlePosterViewStoreChange });
  (function setupPosterSizeSlider() {
    const sl = inputById('posterTileSlider');
    if (!sl) return;
    sl.addEventListener('input', () => gridDensity.onPosterSliderInput());
  })();
  // The column counts depend on the grid width — re-derive both tracks on resize.
  window.addEventListener('resize', () => gridDensity.handleWindowResize(), { passive: true });
  // Poster browse filters (platform / tag / instance / folder / date範囲) live
  // in the posterQB query tree (createQueryBuilder + posterPredOf), not separate Sets.

  // Poster grid/filter/inspector/folder cluster (posterWorkGroups, the named
  // poster-folder store, renderPosterFilterRows, renderPosters, openPosterPosts/
  // jumpToPoster, the poster inspector, and the poster context menu) moved to
  // poster-grid-builder.ts — viewer.ts decomposition's V6 slice (Wave20). Density/
  // tile-size slider state (posterView etc.) moved to grid-density-builder.ts
  // (V10/Wave24, above). Wired BEFORE posterQB below (posterQB's construction
  // needs pfStore/posterFolderById from here as direct values, not deferred
  // arrows) — posterQB itself is only available to this builder as deferred
  // arrows (posterQBGetTree etc.), the mirror image.
  const posterGrid = makePosterGridBuilder({
    MSG,
    PF_NAME,
    fileSrc,
    showToast: (msg) => showToast(msg), // showToast is declared far below — deferred
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
    closeDetail,
    setInspectedKey,
    posterView: gridDensity.getPosterView,
    refreshPosterSlider: gridDensity.refreshPosterSlider,
    syncBrowseBar,
    setPosterReturn: (key) => {
      posterReturn = key;
    },
  });
  const {
    getPosterList,
    pfStore,
    posterFolderById,
    posterFolderHas,
    createPosterFolder,
    deletePosterFolder,
    togglePosterFolderMember,
    renderPosterFilterRows,
    resetPosterFilters,
    renderPosters,
    openPosterPosts,
    jumpToPoster,
    refreshPosterTagFields,
    refreshPosterFolderFields,
    applyPosterTagChange,
    showPosterDetail,
    showPosterMenu,
  } = posterGrid;
  // --- Poster query builder: the SAME drag builder (createQueryBuilder), evaluated
  // against poster (user) objects instead of posts. Leaf types: platform / instance /
  // tag(作品/キャラ含む) / folder / date(範囲). The bar lives in
  // #posterActiveBar; sidebar rows are the entry points (like #filterRows for posts). ---
  // Poster leaf predicate — query.ts's makePosterPredOf (the mirror of postPredOf)
  // is now called inside query-builder.ts's makePosterQueryBuilder (Wave15/V1);
  // posterTagsOf (tags.js) and posterFolderById (pfStore) are passed in as deps,
  // both declared above so a direct ref is TDZ-safe. posterFilterLabel lives in
  // tab-state.js's makeTabLabels (destructured near filterLabel).
  // editingPosterDateNode (the date leaf being edited via the popover) moved into
  // filter-popover-builder.ts's internal state (V4/Wave18).
  // The poster-side builder instance (predOf/glyph/instance construction moved to
  // query-builder.ts, Wave15/V1 — see that file's makePosterQueryBuilder).
  // transient (no tabs / nav history for posters); onChange → renderPosters
  // (which redraws the rows + bar + grid). P4-B slice⑧: this used to also mirror
  // the tree shadow into a module-level `posterShadow` global via onShadow — that
  // global had zero readers (the poster sidebar model read posterQB.shadow()
  // directly, and now renderer/sidebar.ts's source reads the mirrored
  // 'posterQueryTree' store key via query.ts's buildShadow instead), so it's
  // removed outright rather than converted to a read site.
  const { qb: posterQB } = makePosterQueryBuilder({
    msg: qbMsg,
    container: document.getElementById('posterQueryChips')!,
    barEl: document.getElementById('posterActiveBar'), // reveal + --activebar-h measure (empty/reset are the island's)
    labelOf: posterFilterLabel,
    getSearchVal: () => searchQuery(),
    onClearSearch: () => {
      setSearchBoxValue('');
      renderPosters();
    },
    onChange: () => {
      renderPosters();
    },
    openLeafEditor: (n: CorpusQueryLeaf) => {
      if (n.type === 'date') filterPopover.openPosterDate(n);
    },
    posterTagsOf,
    folderById: posterFolderById,
  });

  // renderPosterFilterRows (the #posterFilterRows model's one viewer-side side
  // effect: pruning tag selections whose backing value disappeared) moved to
  // poster-grid-builder.ts (V6/Wave20) along with the rest of the poster cluster —
  // destructured from posterGrid above.

  // qf-pop (value flyout) + filter-popover (date/eng/poster-date-range) bridges —
  // viewer.ts decomposition's V4 slice (Wave18). Wired here (not where they're
  // first used, further up) so postQB/posterQB/pfStore/buildUsers are all
  // already real consts — no deferred-getter indirection needed, same reasoning
  // as makeSearchBox() being wired late (search-box-builder.ts).
  const qfPop = makeQfPop({
    qfValues,
    kindLabel,
    MSG,
    pfStore,
    postShadow: () => postQB.shadow(),
    posterQHasValue: (type, v) => posterQB.qHasValue(type, v),
    posterAddFilter: (filter) => posterQB.addFilter(filter),
    posterRemoveByLeaf: (type, v) => posterQB.removeByLeaf(type, v),
    addFilter,
    removeFilter,
    buildUsers: () => buildUsers(),
    storeSet,
    updateSidebarState,
    renderPosterFilterRows,
    renderPosters,
  });
  // The island may close itself (outside-click / Escape) without going through
  // qfPop.hideQfPop() — subscribe registration lives in React (StoreSubscriptions,
  // App.tsx) via window.corpusViewer below; this stays the guard + action logic.
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleQfPopChange: qfPop.handleQfPopChange });

  const filterPopover = makeFilterPopover({
    MSG,
    engTypeLabels: ENG_TYPE_LABELS,
    addFilter,
    removeNode,
    removeCondsMatching,
    afterQueryChange,
    posterGetTree: () => posterQB.getTree(),
    posterAddFilter: (filter) => posterQB.addFilter(filter),
    posterRemoveByType: (type) => posterQB.removeByType(type),
    posterRefresh: () => posterQB.refresh(),
  });

  // resetPosterFilters/renderPosters/corpusPosterGridSource.configure/
  // openPosterPosts/jumpToPoster/refreshPosterTagFields/refreshPosterFolderFields/
  // applyPosterTagChange/showPosterDetail all moved to poster-grid-builder.ts
  // (V6/Wave20) — destructured from posterGrid above.
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { resetPosterFilters });
  byId('posterGrid').addEventListener('click', (e) => {
    const card = closestOf(e, '.poster-card');
    if (!card) return;
    const u = getPosterList()[Number.parseInt(card.dataset.index ?? '', 10)];
    if (!u) return;
    // ℹ opens the inspector (shared idiom with post cards' .info-btn); re-click the
    // inspected poster's ℹ toggles it closed.
    if (closestOf(e, '.poster-info')) {
      if (!byId('postDetail').hidden && inspectedKey === 'poster:' + u.key) {
        closeDetail();
        return;
      }
      showPosterDetail(u);
      return;
    }
    // 🏷 → open the inspector and focus its tag input (mirrors the library 🏷 button).
    if (closestOf(e, '.poster-tag')) {
      showPosterDetail(u, { focusTag: true });
      return;
    }
    // A plain card click drills into that poster's posts (posts mode + user filter).
    openPosterPosts(u);
  });
  // posterMenuItems/onPosterMenuPick/showPosterMenu moved to poster-grid-builder.ts
  // (V6/Wave20) — destructured (showPosterMenu) from posterGrid above.
  byId('posterGrid').addEventListener('contextmenu', (e) => {
    const card = closestOf(e, '.poster-card');
    if (!card) return;
    e.preventDefault();
    const u = getPosterList()[Number.parseInt(card.dataset.index ?? '', 10)];
    if (u) showPosterMenu(u, e.clientX, e.clientY);
  });
  // Poster-mode sort (sidebar). Single source = corpusStore 'sortPoster' (the GlassSelect
  // writes it on pick); re-render when it changes. This replaces the old #posterSortSelect
  // DOM-'change' listener — the store is now the one trigger (no dual source).
  storeSubscribe('sortPoster', () => renderPosters());
  // Poster query reset (bar右の「リセット」): empty the poster tree + the shared search box.
  // Wired to the activebar island's #posterResetBtn via onPosterReset (React-owned button).
  // Poster filter rows (mirror of the #filterRows handler): a data-qfrow row opens its
  // flyout (poster-* categories); the date row opens the date popover.
  // Selections live in the transient posterXxx state.
  byId('posterFilterRows').addEventListener('click', (e) => {
    const row = closestOf(e, '[data-qfrow]');
    if (!row) return;
    const cat = row.dataset.qfrow as string;
    if (cat === 'poster-date' && filterPopoverGet()?.kind === 'posterDate') {
      filterPopover.closeAll();
      return;
    } // re-click closes
    filterPopover.closeAll(); // switching rows closes any open date popover first
    if (cat === 'poster-date') {
      qfPop.hideQfPop();
      filterPopover.openPosterDate(row);
      return;
    }
    qfPop.showQfPopAt(cat, row);
  });

  // Collections are a sidebar folder list now (renderCollectionSidebar), not a
  // browse view. The old third-mode grid, its context menu, and dynamic collections
  // (saved searches) were removed 2026-07-04 — see the collection sidebar above.

  // View-size slider (post grid) — every density has one; the logic (track math,
  // mid-drag vs commit) lives in grid-density-builder.ts now, alongside the
  // poster-side equivalent above. This just wires the #tileSlider DOM events to it.
  const tileSlider = inputById('tileSlider');
  tileSlider.addEventListener('input', () => gridDensity.onSliderMove(false));
  tileSlider.addEventListener('change', () => gridDensity.onSliderMove(true));
  // Ctrl+- / Ctrl+= step the content-size slider one notch (works in all three view modes).
  // Registration lives in the GlobalShortcuts component (app/islands/app/App.tsx).
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleShortcutSizeKey: gridDensity.handleShortcutSizeKey });

  // Tile overlay lives in the React settings island now; grid-density-builder.ts
  // exposes the apply-and-persist bridge it calls (via window.corpusViewer.setTileOverlay
  // below) so the post grid updates immediately.
  // Bridges the React settings island calls into (the controls live there now,
  // but these effects touch viewer.js-owned state / the post grid).
  window.corpusViewer = Object.assign(window.corpusViewer || {}, {
    setTileOverlay: gridDensity.applyTileOverlay,
    reloadPosts: () => loadPosts(),
    setSkipDeleteConfirm: (v: boolean) => {
      skipDeleteConfirm = v;
      corpusIpc.setPref('skipDeleteConfirm', v);
    },
  });

  // Load saved view mode and skipDeleteConfirm
  corpusIpc.getPrefs().then((prefs) => {
    gridDensity.restorePrefs(prefs);
    skipDeleteConfirm = !!prefs.skipDeleteConfirm;
    // Re-render once after applying the saved view mode. Sort is NOT read here anymore
    // — it comes from the tab state (applied by initTabs), so the old prefs/initTabs
    // load race on sortSelect.value is gone.
    renderPosts();
  });

  // --- Search value source -----------------------------------------------------
  // corpusStore 'searchQuery' IS the search value; the searchbox island renders it
  // as a controlled react-aria ComboBox input. The query-tree text-leaf state
  // machine (search-editing.ts, Wave2), the suggestion-pick bridge to the
  // searchbox island (searchbox.ts, Wave5), and the store plumbing/debounced
  // re-render around them are wired together in search-box-builder.ts now
  // (viewer.ts decomposition's V3 slice, Wave17). searchEditing itself stays a
  // local const here — resetAllFilters (above) and postQB's onLeafMutated/
  // isEditingLeaf deps still reference it directly.
  const {
    searchQuery,
    setSearchBoxValue,
    handleSearchQueryStoreChange,
    rebindEditingTextLeaf,
    handleSearchModeChange,
    handleShortcutSearchFocusKey,
    searchEditing,
  } = makeSearchBox({
    storeGet,
    storeSet,
    getTree: () => postQB.getTree(),
    addFilter: (f) => postQB.addFilter(f),
    removeNode: (n) => postQB.removeNode(n),
    treeLeaves,
    isFuzzy: () => searchIsFuzzy(),
    getBrowseMode: () => browseMode,
    afterQueryChange: () => afterQueryChange(),
    renderPosts: () => renderPosts(),
    renderPosters: () => renderPosters(),
    updateSidebarState: () => updateSidebarState(),
    buildSuggest: (q) => buildSuggest(q),
    searchModeTitle: MSG.searchModeTitle,
  });
  // Subscribe registration lives in React (StoreSubscriptions, App.tsx) via
  // window.corpusViewer below; this stays the guard + action logic.
  // handleShortcutSearchFocusKey's registration lives in GlobalShortcuts (App.tsx) —
  // wired here too since both come off the same makeSearchBox() construction site.
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleSearchQueryStoreChange, handleShortcutSearchFocusKey });

  sortSelect.addEventListener('change', () => {
    // Sort lives in the tab state (persisted per tab via renderPosts→persist), not a
    // separate global pref — that double-storage raced on load. renderPosts captures it.
    renderPosts();
  });

  // 検索方式の切替（おおまか / ぴったり）＝macOS 風セグメント。両方を常に見せ、
  // 状態と切替手段がひと目で分かる。corpusSearch がモードを集約＝メイン検索と
  // フライアウト絞り込みで共有する。UI は toolbar 島（#searchModeSeg）が描画し、
  // 各選択肢の説明は .ui-tip ツールチップが担う（旧・常設ヒント行は撤去）。コンテナの
  // aria-label 設定とhandleSearchModeChange本体はsearch-box-builder.tsへ移設済み
  // （Wave17/V3）。Subscribe registration lives in React (StoreSubscriptions,
  // App.tsx) via window.corpusViewer below; this stays the guard + action logic.
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleSearchModeChange });

  // --- Import from ZIP ---
  // 新形式（完全エクスポート: library/ + corpus-export.json）は main 側で展開して
  // ライブラリへ復元（整理情報もマージ）。旧形式（metadata.json + images/）は従来どおり
  // レンダラで読んで importPosts。
  byId('importZipInput').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    showToast(MSG.importing);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const zip = await JSZip.loadAsync(buf);
      const isComplete = !!zip.file('corpus-export.json') || Object.keys(zip.files).some((p) => p.indexOf('library/') === 0);
      if (isComplete) {
        const res = await importComplete(buf);
        await loadPosts();
        (e.target as HTMLInputElement).value = '';
        if (!res || !res.ok) {
          showToast(MSG.importFailed);
          return;
        }
        if (res.skipped > 0) showToast(MSG.importSkipped(res.imported, res.skipped));
        else showToast(MSG.imported(res.imported));
        return;
      }
      const metaEntry = zip.file('metadata.json');
      if (!metaEntry) {
        showToast(MSG.importFailed);
        (e.target as HTMLInputElement).value = '';
        return;
      }
      const meta = JSON.parse(await metaEntry.async('string'));
      const posts: CorpusPost[] = [];
      for (const m of Array.isArray(meta) ? meta : []) {
        const f = m.imageFile && zip.file(m.imageFile);
        if (!f) continue;
        const b64 = await f.async('base64');
        posts.push(Object.assign({}, m, { image: 'data:image/jpeg;base64,' + b64 }));
      }
      const { imported, skipped } = await importPosts(posts);
      await loadPosts();
      (e.target as HTMLInputElement).value = '';
      if (skipped > 0) showToast(MSG.importSkipped(imported, skipped));
      else showToast(MSG.imported(imported));
    } catch {
      showToast(MSG.importFailed);
      (e.target as HTMLInputElement).value = '';
    }
  });

  // Backup status rail (#mirrorStatus) is fully owned by the MirrorStatus island now — it
  // imports backup.ts (getBackup + onBackupStart/Done) directly and derives the rail model
  // itself. viewer no longer holds any of that state (the old setupMirrorStatusRail +
  // window.corpusMirror bridge are gone).

  // --- Clear data ---
  // Destroying the whole library requires typing the keyword (MSG.deleteKeyword) to
  // enable the OK button — a stray click can't wipe everything. The confirm modal is
  // React-owned now (confirm.ts / the confirm island); openClearAllConfirm just
  // opens it with the keyword gate + the wipe as its onOk. Exposed on corpusViewer so the
  // React Danger section triggers the exact same destructive flow — no second wipe dialog.
  function openClearAllConfirm() {
    confirmOpen({
      message: MSG.confirmClear,
      okLabel: MSG.confirmOk,
      cancelLabel: MSG.confirmCancel,
      keywordPlaceholder: MSG.confirmKeywordPh,
      keywordRequired: MSG.deleteKeyword, // OK stays disabled until this is typed
      onOk: async () => {
        // Clear all data (deletes every image + sidecar in the save folder).
        const res = await clearAll();
        // Main refuses the wipe if config is degraded — keep the library on screen and
        // tell the user to restart (initSaveFolderRedundancy repairs on launch).
        if (res && res.blocked) {
          showToast(MSG.clearBlocked);
          return;
        }
        postGrid.resetAll(); // keep the delta cache in sync with the wipe
        // P4-B slice⑪: this call was missing before (only the two other allPosts
        // reassignment sites called it) — clear-all never bumped _allPostsGeneration,
        // which left stale tag/author/instance facets around after a wipe until
        // something else happened to bump it. Harmless for THIS render (renderPosts()
        // below is never inPlace, so the separate viewGroups-reuse guard was never at
        // risk), but worth fixing here since it's exactly the choke point this slice
        // is unifying.
        markPostsMutated();
        renderPosts();
        showToast(MSG.cleared);
      },
    });
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { confirmClearAll: openClearAllConfirm });

  // --- Utility functions ---
  // Count / date formatters (formatCount / formatDate / compactDate / …) live in
  // format.js now. escapeHtml/escapeAttr no longer have any callers here — the
  // remaining HTML construction is JSX (which escapes automatically, see L2013);
  // ui.ts's escapeHtml is still used directly by folders.ts's own modal markup.

  // Delegates to the shared glass toast (ui.js). Was a dynamically-created solid
  // #333 #toast; unified to #ivToast so viewer + folders share one look.
  function showToast(msg: unknown) {
    return notify(msg);
  }

  // Shared folder changes: refresh chips on any change; re-render cards (📁 states)
  // when the folder list/default changes. Registration lives in React
  // (StoreSubscriptions, App.tsx) via window.corpusViewer below (CF().onChange has no
  // unsubscribe — subs.push — so the effect there has no cleanup, harmless since it
  // mounts once for the app's lifetime like every other App.tsx-level effect); this
  // stays the guard + action logic.
  function handleFolderChange(kind?: string) {
    // 絞り込み中のフォルダが削除されたらそのフィルタを除去（一覧が原因不明に空になるのを防ぐ）。
    if (postQB.removeCondsMatching((c: CorpusQueryLeaf) => c.type === 'collection' && !CF().byId(c.value))) {
      postQB.syncShadow();
      postQB.render();
    }
    // The clip row / sidebar collection state (counts/active) self-derives from the
    // corpusFolders.onChange subscription in renderer/sidebar.ts (P4-B slice⑰).
    if (kind === 'list') renderPosts(true); // folder created/deleted — refresh without anim
  }
  // Background fs-watch refresh (targeted via the changed-file hint). Registration
  // lives in React (StoreSubscriptions, App.tsx) via window.corpusViewer below
  // (posts.ts's onPostsChanged has no unsubscribe either — same reasoning).
  async function handlePostsChanged(names: string[] | null) {
    await loadPosts(true, names);
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleFolderChange, handlePostsChanged });

  // --- Boot: the app's initial data load + first render. Defined here (needs every
  // function/state above in closure) but NOT self-invoked — React's AppBoot (App.tsx)
  // calls it once on mount, after awaiting window.corpusViewer.ready above. This makes
  // the React root the single trigger for app startup (the "cut out and rewire" shape
  // used for the control→hooks phase: React owns WHEN, viewer.ts keeps the orchestration
  // logic of WHAT), rather than viewer.ts self-booting in parallel with React's mount.
  async function bootApp() {
    renderQueryChips();
    if (CF()) await CF().load(); // load folders before first render so 📁/chips are correct
    // Grouping persistence (shared with the old image-view): manual groups + opt-outs.
    postGrid.setUngrouped(await loadUngrouped());
    await pfStore.load();
    postGrid.setManualGroups(await loadManualGroups());
    await loadTags();
    // No sidebar seeding call needed here — renderer/sidebar.ts's sources compute their
    // model on first get() (P4-B slice⑰), so both columns paint immediately with
    // whatever's already loaded and pick up badges/disclosure as data streams in.
    await tabsCtl.initTabs();
    tabsCtl.markBooted(); // saved view is now applied — the first loadPosts render seeds history
    await loadPosts();
    // Restore the last browse mode (ライブラリ / 投稿者) now that posts are loaded so
    // buildUsers has data for the poster grid. silent = no history/pref echo.
    try {
      const prefs = await corpusIpc.getPrefs();
      // 'collections' is retired → falls through to 'posts' (setBrowseMode also coerces it).
      const bm = prefs && prefs.browseMode === 'posters' ? 'posters' : 'posts';
      // Run the heavy restore synchronously (silent = no history/pref echo, no animation),
      // THEN push the mode into the store so the island reflects active + thumb. browseMode
      // is already === bm by then, so the subscribe guard skips the echo. (pull → push, the
      // same shape as the density toggle's pref restore.)
      if (bm !== 'posts') setBrowseMode(bm, { silent: true });
      storeSet('browseMode', bm);
    } catch {
      /* stay in library mode */
    }
    // First paint done — restore the active tab's scroll (survives restart).
    tabsCtl.restoreTabView(getTabs().find((t) => t.id === getActiveTabId()));
    // A restored image tab could only resolve its captureIds now that the
    // library is loaded — enter the detail view here, after the grid restore.
    {
      const bootTab = getTabs().find((t) => t.id === getActiveTabId());
      if (bootTab && isImageTab(bootTab)) showImageTab(bootTab);
      // grid-tab titles deriving live counts (allPostsCount, just set above by the
      // library load) reach the Tabs source automatically — no push needed here.
    }
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
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { bootApp });
  resolveViewerReady();
})();
