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
  const { lang, getMessage } = await window.corpusI18n;
  const _s = (key) => getMessage(key);
  const _f1 = (key) => (a) => getMessage(key, [a]);
  const _f2 = (key) => (a, b) => getMessage(key, [a, b]);
  // Count / date display formatters live in format.js now (loaded before this
  // script). (The backup-rail time formatters fmtTime/fmtBackupTime are used only
  // by the MirrorStatus island now, which reads window.corpusFormat directly.)
  const { formatCount, formatShortDate, compactDate, formatDate, localeDate, localeDateTime } = window.corpusFormat;
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
    likes: (n) => (n != null ? `${formatCount(n)}` : ''),

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
  function clampIntoView(el) {
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth - 8) el.style.left = Math.max(8, innerWidth - r.width - 8) + 'px';
    if (r.bottom > innerHeight - 8) el.style.top = Math.max(8, innerHeight - r.height - 8) + 'px';
  }

  // --- Typed DOM accessors (checkJs). getElementById returns HTMLElement|null;
  // these assert the element exists — it is static markup in index.html and the
  // surrounding code already dereferences it directly — and narrow to the concrete
  // element subtype so .value/.options/.min/.disabled type-check. closestOf mirrors
  // folders.js: casts an event target to the nearest matching element (or null). ---
  const byId = (id) => document.getElementById(id) as HTMLElement;
  const inputById = (id) => document.getElementById(id) as HTMLInputElement;
  const selectById = (id) => document.getElementById(id) as HTMLSelectElement;
  const closestOf = (e: Event, sel: string) => {
    const t = e.target as HTMLElement | null;
    return t instanceof Element ? (t.closest(sel) as HTMLElement | null) : null;
  };

  // --- Apply i18n to static elements ---
  const setAttr = (id, attr, val) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute(attr, val);
  };

  setAttr('settingsBtn', 'data-tip', MSG.tabSettings); // shared glass tooltip (was native title)
  setAttr('settingsBtn', 'aria-label', MSG.tabSettings);
  // #filterRows row labels + the クリップ row / 空にする button (icon, tip, aria) are
  // rendered by the sidebar island from buildSidebarModel now — no static setText here.
  setAttr('contentTop', 'aria-label', MSG.sbTopTip);
  setAttr('tileSlider', 'data-tip', MSG.tileSizeTip); // shared glass tooltip (was native title)
  // #postResetBtn label + the activebar frame (nav / title / empty hint / count / reset /
  // ⓘ help) are the activebar island now (window.corpusActivebar) — no static setText here.
  // segments: icon always, label shown only on the active one (no tooltips —
  // the active label is the affordance). Labels live in their own span so the
  // SVG glyph survives.
  // #densityToggle, #posterDensityToggle and #browseToggle (incl. per-button
  // tooltips) are rendered by the toolbar island now. The browse toggle's old
  // CONTAINER title (「…を切替」) is gone — per-segment .ui-tip hints made it
  // redundant noise on hover (user 2026-07-04).
  // #sbPosterSortTitle is island-owned now too (toolbar SectionTitle) — no static setText.
  // #posterFilterRows title + row labels are model-driven now — the poster sidebar island
  // renders them from buildPosterSidebarModel (window.corpusSidebar poster channel). No
  // static setText here (mirror of the post-side #filterRows note above).
  // #posterSortSelect option labels are the GlassSelect island now (rendered from i18n
  // keys) — the native <select> stays hidden (.cs-host) as the value source, so writing
  // its option textContent here was dead (never shown). No static setText.
  // posterDateDim options / posterDateDimLabel / posterDateRangeLabel / posterDateApply /
  // posterDateClear are the filter-popover React island now — no static labels here.
  // Settings-modal labels (theme/lang/data/backup/trash/danger/about) live in the React
  // settings island; the confirm modal is the React confirm island (labels come through
  // window.corpusConfirm.open's config), so no static confirm setText here either.

  // Edit overlay labels are now passed directly in the corpusEditOverlay model (see
  // openTagSelectedOverlay below) — no static DOM to set text on anymore.

  // Toolbar section titles (検索 / 並び順 / 表示). The search-mode segment itself
  // (labels, thumb, on-state) is rendered by the toolbar island; viewer only keeps
  // the hint text + aria-label (see the wiring block below). The view/layout titles
  // (#sbViewTitle / #sbLayoutTitle / #sbPosterLayoutTitle) are island-owned too now —
  // they name the current mode/layout from the store (SectionTitle), so viewer no
  // longer writes them (writing here would race the island after a language reload).
  // #sbSearchTitle / #sbSortTitle are island-owned now too (toolbar SectionTitle) — no
  // static setText (writing here would race the island after a language reload).
  // #activebarLabel / #qbEmptyHint / #posterQbEmptyHint are the activebar island now
  // (rendered from buildActivebarModel) — no static setText here.
  // #filterRows titles/row names (フィルタ / 作品 / キャラ / タグ / ハッシュタグ …) are
  // rendered by the sidebar island from buildSidebarModel — no static setText here.
  byId('sbTop').dataset.tip = MSG.sbTopTip; // shared glass tooltip (was native title)

  // #sortSelect stays the (hidden .cs-host) value source; its option LABELS are rendered
  // by the GlassSelect island from i18n keys, so writing option textContent here was dead.
  const sortSelect = selectById('sortSelect');

  // Custom glass dropdown for the sort selects (#sortSelect / #posterSortSelect /
  // #collectionSortSelect) is React-owned now — the toolbar island's GlassSelect hides
  // the native <select> (.cs-host), renders the glass trigger + popup, and drives the
  // select on pick so the change handlers below still fire. The active value is mirrored
  // into window.corpusStore ('sortPost' etc.) so the island reflects programmatic changes
  // (tab restore pushes 'sortPost'; see applyState / the tab click handler).

  // --- Query Field ---
  const ENG_TYPE_LABELS = {
    likes: MSG.qfEngLikes,
    reposts: MSG.qfEngReposts,
    replies: MSG.qfEngReplies,
    bookmarks: MSG.qfEngBookmarks,
    views: MSG.qfEngViews,
  };

  // filterLabel (query-chip renderer + tab titles share it) and tabTitleOf moved
  // to tab-state.js (window.corpusTabState) — 6th extraction slice. Consts
  // declared after this point (PF_NAME / CF) are injected as deferred arrows — a
  // direct ref here would hit TDZ at wiring time; the wrappers only run at
  // render time. formatShortDate / formatCount are hoisted function declarations
  // (direct refs are fine).
  const { filterLabel, tabTitleOf, posterFilterLabel } = window.corpusTabState.makeTabLabels({
    MSG,
    engTypeLabels: ENG_TYPE_LABELS,
    platformName: (v) => PF_NAME[v] || v,
    formatShortDate,
    formatCount,
    collectionName: (id) => {
      const fobj = CF() && CF().byId(id);
      return fobj ? fobj.name : null;
    },
    // Deferred arrow (posterFolderById is a const declared far below — same TDZ
    // dance as CF()/collectionName; the wrapper only runs at render time).
    posterFolderName: (id) => {
      const fo = posterFolderById(id);
      return fo ? fo.name : null;
    },
  });

  // Leading type glyph for a query-builder chip — the SAME icons as the sidebar
  // filter rows, so a chip's category reads at a glance (the monotone glass pill
  // dropped per-type tints; the icon now carries the "which filter" cue).
  const QC_GLYPH = {
    kind: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    platform: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    postType: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    media: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M21 7.5h-4"/><path d="M21 16.5h-4"/>',
    date: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    engagement: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="0.6" fill="currentColor"/>',
    hashtag: '<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    instance: '<rect x="3" y="4" width="18" height="8" rx="2"/><rect x="3" y="12" width="18" height="8" rx="2"/><line x1="7" y1="8" x2="7.01" y2="8"/><line x1="7" y1="16" x2="7.01" y2="16"/>',
    clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  };
  const qcGlyph = (type) => {
    const g = QC_GLYPH[type === 'text' ? 'search' : type]; // text leaf reuses the magnifier glyph
    return g ? `<svg class="qc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g}</svg>` : '';
  };

  const PF_NAME = { x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' };

  // 全フィルタを一括リセット（アクティブフィルタバーの「リセット」）。検索・フォルダ・
  // 日付・エンゲージも含めて消す。afterQueryChange() が sidebar の active 状態も同期。
  function resetAllFilters() {
    // Bounce back to the poster grid only if we drilled in from a poster AND that
    // poster's user filter is still active (check before emptying the tree).
    const bounce = posterReturn && qHasValue('user', posterReturn);
    postQB.resetTree();
    searchEditing.clear(); // the editing text leaf is gone with the tree
    const set = (id, v) => {
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
  // #postResetBtn / #navBackBtn / #navFwdBtn clicks are wired by the activebar island
  // (onReset / onNavBack / onNavFwd callbacks in the model) — the buttons are React-owned.

  // Back/forward through the per-tab view history: Alt+←/→ + mouse side buttons (the bar
  // buttons themselves route through the island callbacks above). Guarded so they never fire
  // while typing, with an overlay open, or in poster mode (mirrors the Ctrl+A guard convention).
  // Registration lives in the useGlobalShortcuts hook (app/islands/app/App.tsx); this stays
  // the handler + guard logic (viewer keeps the orchestration, React owns the wiring).
  function handleShortcutNavKey(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!navAllowed()) return;
    e.preventDefault();
    if (e.key === 'ArrowLeft') navBack();
    else navForward();
  }
  // Mouse back/forward (buttons 3/4). DOM events fire in the renderer on most
  // platforms; preventDefault stops any stray in-page navigation.
  function handleShortcutMouseNav(e) {
    if (e.button !== 3 && e.button !== 4) return;
    if (!navAllowed()) return;
    e.preventDefault();
    if (e.button === 3) navBack();
    else navForward();
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleShortcutNavKey, handleShortcutMouseNav });

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
  // Rendering lives in the qf-pop React island (window.corpusQfPop); this only builds
  // the row model (qfValues — bespoke facet logic, unchanged) and routes picks. The
  // find-input's "no re-render, just toggle row visibility" trick from the old
  // implementation is no longer needed: the island keeps its own local filter state,
  // so typing never touches this bridge (only a pick or a fresh open does). ----
  let qfCat: any = null;
  let qfAnchor: HTMLElement | null = null; // 同じ行をもう一度押したら閉じる（トグル）
  // Bumped only on a FRESH open (showQfPopAt), NOT on the re-render after a pick. The
  // island keys its root on this, so a value pick re-renders in place (preserving the
  // selected tag group + find text) while opening a different row remounts fresh.
  let qfSession = 0;
  function hideQfPop() {
    window.corpusQfPop.close();
  }
  // The island may close itself (outside-click / Escape) without going through
  // hideQfPop() — this handler keeps the anchor highlight + bookkeeping in sync with
  // whoever closed it. Registration lives in React (StoreSubscriptions, App.tsx) via
  // window.corpusViewer below; this stays the guard + action logic (viewer keeps the
  // orchestration, React owns the wiring) — same "cut out and rewire" as the tab bar.
  function handleQfPopChange() {
    if (!window.corpusQfPop.get()) {
      qfCat = null;
      qfAnchor = null;
      // Both columns own .qf-open through their model (openCat) now, so clearing the
      // highlight is a re-push, not an imperative classList sweep.
      pushSidebar();
      pushPosterSidebar();
    }
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleQfPopChange });
  // Tag vocabulary / 種別 domain (tagKindOf/kindLabel/groupedTagVocab/
  // inspectorTagPickerData/posterTagsOf/posterFilterVocab) moved to tags.js
  // (window.corpusTags) — 8th extraction slice. The 4 tag stores themselves
  // (tagTypes/tagLabels/tagGroups/posterTags) also live in tags.js now (P4
  // "状態→store" tags slice) — its own getters go in where viewer.js's local
  // `let`s used to. Wired BEFORE the facets/cooc wiring below, which passes
  // tagKindOf/posterTagsOf/posterFilterVocab as direct refs.
  // charCandidatesFor/relatedTagCandidates are consts from the cooc
  // destructure below, so they enter as deferred arrows.
  const { tagKindOf, kindLabel, groupedTagVocab, inspectorTagPickerData, posterTagsOf, posterFilterVocab } = window.corpusTags.makeTags({
    tagTypes: window.corpusTags.getTagTypes,
    tagLabels: window.corpusTags.getTagLabels,
    tagGroups: window.corpusTags.getTagGroups,
    posterTags: window.corpusTags.getPosterTags,
    allPosts: () => allPosts,
    MSG,
    charCandidatesFor: (w) => charCandidatesFor(w),
    relatedTagCandidates: (sel, opts) => relatedTagCandidates(sel, opts),
  });
  const { sameTags } = window.corpusTags;
  // Facet aggregation (facetCounts) + value-flyout row models (qfValues) moved to
  // facets.js (window.corpusFacets) — 3rd extraction slice. Runtime couplings are
  // injected: reassigned lets (allPosts/multiOnly) + tags.js's own getter
  // (tagGroups) as getters, and consts declared after this point (posterQB /
  // pfStore / the corpusQuery destructure / the listing.js products) as
  // deferred arrow wrappers — a direct ref here would hit TDZ at wiring time;
  // the wrappers only run when a flyout opens.
  const { qfValues } = window.corpusFacets.makeFacets({
    getFilteredPosts: () => getFilteredPosts(),
    qHasValue,
    posterQHasValue: (type, v) => posterQB.qHasValue(type, v),
    allPosts: () => allPosts,
    hostOf: (u) => hostOf(u),
    userKey: (p) => userKey(p),
    MSG,
    PF_NAME,
    tagKindOf,
    tagGroups: window.corpusTags.getTagGroups,
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
  // relatedTagCandidates) moved to cooc.js (window.corpusCooc) — 4th extraction
  // slice. Same deferred-getter wiring as facets above (allPosts is a reassigned
  // let; the getters only run when a picker or homonym check fires).
  const { charCandidatesFor, worksCooccurringWith, relatedTagCandidates } = window.corpusCooc.makeCooc({ allPosts: () => allPosts, tagKindOf });
  // Push the current category's row model to the qf-pop bridge. Called on every open
  // AND after every pick (the bridge bumps openId each call, which keys the island's
  // root and remounts its find-input local state — matching the old rebuild-on-every-
  // change behavior, incl. the reset+refocus of the find box after a pick).
  function renderQfPop() {
    if (!qfCat) return;
    const cat = qfCat; // capture: hideQfPop() (called from onManage) clears qfCat
    const rawItems = qfValues(cat);
    // 種別 dot (用語帳): a tag carrying it.kind ('work'/'character') wears the shared
    // category dot, so resolve its (possibly custom) label here — the island only draws.
    const items = rawItems.map((it) => (it.kind ? { ...it, dotTitle: kindLabel(it.kind) } : it));
    // 長いリスト（タグ/作者など）はその場で絞り込める入力を付ける。Find box only for
    // genuinely long, open-ended lists (tags/authors). The platform list is short +
    // fixed (5 PFs + their instances), so no find box.
    const valueCount = items.filter((it) => it.ghead == null).length;
    const showFind = !['platform', 'poster-platform'].includes(cat) && valueCount > 8;
    // The タグ flyout carries user tag-groups (facets emits ghead markers). When
    // present, the island lays them out Eagle-style — group list on the LEFT,
    // the selected group's tags as rows on the RIGHT (2026-07-04, replacing the
    // one-flyout wrapped-chip layout). Everything else stays a single row column.
    // No heading row: the user already clicked the category row, so repeating its name
    // as a (hover-highlighted, seemingly-clickable) row was noise.
    // The folder flyouts (library 'collection' + poster 'poster-folder') carry a
    // 「フォルダを管理」 footer that opens the shared folder-manager modal — the create/
    // rename/delete home now that folders live in a flyout, not a sidebar list.
    const showManage = (cat === 'poster-folder' || cat === 'collection') && !!CF();
    window.corpusQfPop.open({
      anchorRect: (qfAnchor as HTMLElement).getBoundingClientRect(),
      sessionId: qfSession,
      items,
      showFind,
      allGroupLabel: MSG.qfAllTags,
      findPlaceholder: MSG.qfFindPh,
      searchModeTitle: MSG.searchModeTitle,
      exactLabel: MSG.searchExact,
      fuzzyLabel: MSG.searchFuzzy,
      exactHint: MSG.searchHintExact,
      fuzzyHint: MSG.searchHintLoose,
      footerLabel: showManage ? MSG.ctxManage : null,
      onManage: showManage
        ? () => {
            hideQfPop();
            if (cat === 'poster-folder') {
              // Poster folder store — refresh the poster sidebar/grid on change.
              CF().openManager({
                store: pfStore,
                onChange: () => {
                  renderPosterFilterRows();
                  renderPosters();
                },
              });
            } else {
              // Library folder store (default) — its onChange runs the shared refresh below.
              CF().openManager();
            }
          }
        : null,
      onPick: (it) => onQfPick(cat, it),
    });
  }
  // Route a value pick to the right business action, then refresh (the flyout stays
  // open so several values can be picked in a row).
  function onQfPick(cat, it) {
    const v = it.v;
    // (複数画像 moved to its own sidebar toggle row — see setupMultiSidebar. It's no
    //  longer emitted into the メディア flyout, so there's no __multi case here.)
    // Poster flyouts toggle a top-level leaf in the poster query tree (addFilter /
    // removeByLeaf both refresh rows + bar + grid). 作品/キャラ/タグ all map to one tag
    // leaf type (種別 only scopes which the row offers).
    if (cat === 'poster-tag' || cat === 'poster-work' || cat === 'poster-character') {
      if (posterQB.qHasValue('tag', v)) posterQB.removeByLeaf('tag', v);
      else posterQB.addFilter({ type: 'tag', value: v });
      renderQfPop();
      return;
    }
    if (cat === 'poster-platform') {
      if (posterQB.qHasValue('platform', v)) posterQB.removeByLeaf('platform', v);
      else posterQB.addFilter({ type: 'platform', value: v });
      renderQfPop();
      return;
    }
    if (cat === 'poster-instance') {
      if (posterQB.qHasValue('instance', v)) posterQB.removeByLeaf('instance', v);
      else posterQB.addFilter({ type: 'instance', value: v });
      renderQfPop();
      return;
    }
    if (cat === 'poster-folder') {
      // folder is single-valued (singleValueTypes): addFilter replaces any existing folder leaf.
      if (posterQB.qHasValue('folder', v)) posterQB.removeByLeaf('folder', v);
      else posterQB.addFilter({ type: 'folder', value: v });
      renderQfPop();
      return;
    }
    const vtype = it.type || cat; // sub-rows (instances) override the type
    const i = postQB.shadow().findIndex((f) => f.type === vtype && f.value === v);
    if (i >= 0) {
      removeFilter(i);
    } else if (vtype === 'tag' || vtype === 'hashtag') {
      addFilter({ type: vtype, value: v });
    } else if (vtype === 'user') {
      const u = buildUsers().find((x) => x.key === v);
      addFilter({ type: 'user', value: v, label: u ? u.displayName || u.screenName : v });
    } else {
      addFilter({ type: vtype, value: v });
    }
    updateSidebarState();
    renderQfPop();
  }
  // 行の横にフライアウトを開く（同じアンカー再クリックで閉じる）
  function showQfPopAt(cat, anchorEl) {
    // Re-clicking the open row toggles it closed (cat, not node identity — robust to the
    // island re-rendering the row on a badge change).
    if (window.corpusQfPop.get() && qfCat === cat) {
      hideQfPop();
      return;
    }
    // .qf-open is model-driven on BOTH columns now (React owns each container's className,
    // so an imperative classList.add would be clobbered on the next render; switching rows
    // is handled by openCat in the model). A cat is post- or poster-side; the matching
    // column lights its row, the other clears — both re-push below.
    qfCat = cat;
    qfAnchor = anchorEl;
    qfSession++; // fresh open → island remounts (resets group/find); picks keep it
    pushSidebar(); // light up the post-side row via openCat
    pushPosterSidebar(); // …or the poster-side row (whichever cat matches)
    renderQfPop();
  }

  // The ⓘ クエリビルダの使い方 hover popover is the activebar island now (HelpPop) — its
  // content (title + 5 rows) rides the model's `help` field; hover/positioning live there.

  // 日付/エンゲージのポップオーバーは値フライアウト(qfPop)と同じ「行クリックで開閉・
  // 外側クリックで閉じる」挙動に統一する。旧実装は全画面 .qf-backdrop(z999) が
  // クリックを奪い、開いている間は他の行へワンクリックで切り替えられなかった
  // （クリックが backdrop に吸われて closeAllMenus するだけ＝ユーザー報告のバグ）。
  // backdrop は撤去し、下の document クリックハンドラ + 行ハンドラで開閉する。
  function closeAllMenus() {
    window.corpusFilterPopover.close();
  }

  // Date popover. editingDateNode = the date cond being edited (null = new). Rendering
  // is the filter-popover React island now (window.corpusFilterPopover) — this only
  // builds the field model + owns the apply/remove actions.
  let editingDateNode: CorpusQueryLeaf | null = null;
  // The single 'text' leaf bound to the search box (post mode only) is owned by
  // search-editing.ts now (P4-B slice⑨) — see the searchEditing construction
  // near syncEditingTextLeaf/confirmEditingTextLeaf/rebindEditingTextLeaf below.

  function openDatePopover(node) {
    closeAllMenus(); // close the other popover if open (no backdrop anymore)
    editingDateNode = node || null;
    const existing = editingDateNode;
    const anchor = document.querySelector('#filterRows [data-qfrow="date"]') as HTMLElement;
    const r = anchor.getBoundingClientRect();
    window.corpusFilterPopover.open({
      kind: 'date',
      anchorRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      editing: !!editingDateNode,
      fields: { dateField: existing?.dateField || 'date', from: existing?.from || '', to: existing?.to || '' },
      labels: { typeDate: MSG.qfDatePost, typeCaptured: MSG.qfDateCaptured, removeLabel: MSG.qfDelete, applyLabel: MSG.qfApply },
      onApply({ dateField, from, to }) {
        if (!from && !to) return;
        if (editingDateNode) {
          Object.assign(editingDateNode, { dateField, from, to });
          afterQueryChange();
        } // edit in place (keeps its position / group in the tree)
        else addFilter({ type: 'date', dateField, from, to }); // replaces any existing date
      },
      onRemove() {
        if (editingDateNode) removeNode(editingDateNode);
      },
    });
  }

  // Poster date-range popover (3 dims: 最終投稿日 / 最終取得日 / アカウント作成日).
  // Separate from the post date popover — writes the transient posterDate state.
  // arg = the date leaf to edit (from openLeafEditor) OR the row element (from the row click).
  // Range only — the 並べ替え方向 moved to the sort select (フィルタとソートの分離).
  function openPosterDatePopover(arg) {
    closeAllMenus();
    const editNode = arg && arg.kind === 'cond' ? arg : null;
    editingPosterDateNode = editNode;
    const anchor = document.querySelector('#posterFilterRows [data-qfrow="poster-date"]') as HTMLElement;
    if (!anchor) return;
    const existing = editNode || treeLeaves(posterQB.getTree()).find((c) => c.type === 'date');
    const r = anchor.getBoundingClientRect();
    window.corpusFilterPopover.open({
      kind: 'posterDate',
      anchorRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      editing: !!existing,
      fields: { dateField: (existing && existing.dateField) || 'latest', from: (existing && existing.from) || '', to: (existing && existing.to) || '' },
      labels: { dimLabel: MSG.posterDateDimLabel, rangeLabel: MSG.posterDateRangeLabel, removeLabel: MSG.posterDateClear, applyLabel: MSG.qfApply },
      dimOptions: [
        { value: 'latest', label: MSG.posterDateLastPost },
        { value: 'lastCapture', label: MSG.posterDateLastCapture },
        { value: 'authorCreatedAt', label: MSG.posterDateCreated },
      ],
      onApply({ dateField, from, to }) {
        if (!from && !to) return;
        if (editingPosterDateNode) {
          Object.assign(editingPosterDateNode, { dateField, from, to });
          posterQB.refresh();
        } else posterQB.addFilter({ type: 'date', dateField, from, to }); // date is single-valued (replaces)
      },
      onRemove() {
        posterQB.removeByType('date');
      },
    });
  }

  // Engagement popover. editingEngNode = the engagement cond being edited (null = new).
  let editingEngNode: CorpusQueryLeaf | null = null;

  function openEngPopover(node) {
    closeAllMenus(); // close the other popover if open (no backdrop anymore)
    editingEngNode = node || null;
    const existing = editingEngNode;
    const anchor = document.querySelector('#filterRows [data-qfrow="engagement"]') as HTMLElement;
    const r = anchor.getBoundingClientRect();
    window.corpusFilterPopover.open({
      kind: 'eng',
      anchorRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      editing: !!editingEngNode,
      fields: { engType: existing?.engType || 'likes', min: existing?.min || '', op: existing?.op || 'gte' },
      labels: { removeLabel: MSG.qfDelete, applyLabel: MSG.qfApply, opGte: MSG.qfEngGte, opLte: MSG.qfEngLte },
      typeOptions: Object.entries(ENG_TYPE_LABELS).map(([value, label]) => ({ value, label })),
      onApply({ engType, min, op }) {
        if (!min || min <= 0) return;
        if (editingEngNode) {
          Object.assign(editingEngNode, { engType, min, op });
          afterQueryChange();
        } // edit in place (keeps its position / group in the tree)
        else {
          removeCondsMatching((c) => c.type === 'engagement' && c.engType === engType); // no gte+lte on one type
          addFilter({ type: 'engagement', engType, min, op });
        }
      },
      onRemove() {
        if (editingEngNode) removeNode(editingEngNode);
      },
    });
  }

  // --- Sidebar filter controls ---
  // (#filterRows row labels are model-driven now — the sidebar island renders them from
  // buildSidebarModel. No static setText for プラットフォーム / 投稿 / メディア / 日付 /
  // エンゲージメント here.)

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
      const idx = postQB.shadow().findIndex((f) => f.type === 'clip');
      if (idx < 0) addFilter({ type: 'clip', value: '*' });
      else removeFilter(idx);
      renderClipRow();
      return;
    }
    // 複数画像: a direct 2-state toggle (no data-qfrow, no flyout). Handled via this
    // delegated listener rather than its own — the row can be (re)built after wiring
    // time, so a listener bound at load could miss it. Flips the group-level flag.
    if (closestOf(e, '#multiRow')) {
      multiOnly = !multiOnly;
      renderMultiRow();
      renderFilterBadges();
      renderPosts();
      return;
    }
    const row = closestOf(e, '[data-qfrow]');
    if (!row) return;
    const cat = row.dataset.qfrow;
    const openKind = window.corpusFilterPopover.get()?.kind;
    // Re-clicking the row whose popover is already open = toggle it closed.
    if (cat === 'date' && openKind === 'date') {
      closeAllMenus();
      return;
    }
    if (cat === 'engagement' && openKind === 'eng') {
      closeAllMenus();
      return;
    }
    closeAllMenus(); // switching rows closes any open date/eng popover first
    if (cat === 'date') {
      hideQfPop();
      openDatePopover(null);
      return;
    }
    if (cat === 'engagement') {
      hideQfPop();
      openEngPopover(null);
      return;
    }
    showQfPopAt(cat, row);
  });

  // フライアウトはクリックのみで開閉（ホバーで開く実験は撤回＝誤爆・絞り込み入力中に
  // 別行へカーソルが乗って別フライアウトに化ける問題があったため）。

  // Update sidebar state (chip actives, row badges, tag area, active bar)
  function updateSidebarState() {
    // (#searchBox's has-value accent is owned by the searchbox island)
    renderFilterBadges();
    updateSidebarTags();
    renderQueryChips(); // 検索/フォルダ等の変化を下部アクティブバーへ即時反映
  }

  // Build the whole post-mode filter-row model (#filterRows) from current viewer state
  // and push it to the sidebar island. Aggregates what used to be scattered imperative
  // DOM writes across renderFilterBadges / renderClipRow / renderMultiRow / updateKindRows
  // / applyKindLabels + the boot setText calls: row labels (MSG + custom 種別 labels),
  // per-category active-filter badge counts, the クリップ/複数画像 toggle states, the
  // 作品/キャラ progressive-disclosure visibility, and which flyout row wears .qf-open.
  // Cheap to rebuild; called on every filter/clip/vocab change (React diffs it).
  function buildSidebarModel(): CorpusSidebarModel {
    // Per-category active-filter counts. Instance filters live inside the platform
    // flyout, so they count toward the platform badge; the tag badge splits by 種別 so a
    // 作品/キャラ filter lights its own row, leaving タグ for general (未分類) tags only.
    const activeFilters = postQB.shadow();
    const badges: Record<string, number> = {};
    for (const f of activeFilters) badges[f.type] = (badges[f.type] || 0) + 1;
    badges.platform = (badges.platform || 0) + (badges.instance || 0);
    let tagWork = 0,
      tagChar = 0,
      tagGen = 0;
    for (const f of activeFilters)
      if (f.type === 'tag') {
        const k = tagKindOf(f.value);
        if (k === 'work') tagWork++;
        else if (k === 'character') tagChar++;
        else tagGen++;
      }
    badges.tag = tagGen;
    badges.work = tagWork;
    badges.character = tagChar;
    // 作品/キャラ rows are progressively disclosed — shown only once at least one tag
    // wears that 種別 (zero trace for people who just save posts).
    const tagset = _cachedTagSet || new Set<string>();
    let hasWork = false,
      hasChar = false;
    for (const t of tagset) {
      const k = tagKindOf(t);
      if (k === 'work') hasWork = true;
      else if (k === 'character') hasChar = true;
      if (hasWork && hasChar) break;
    }
    // クリップ: count library-wide clipped posts; the row is active when its filter is on.
    const existing = new Set(allPosts.map((p) => p.captureId));
    const clipCount = CF() ? CF().clipCount(existing) : 0;
    return {
      title: MSG.sbFilterTitle,
      // Only post-side flyout rows carry .qf-open (poster rows are still static HTML).
      openCat: qfCat && !String(qfCat).startsWith('poster-') ? qfCat : null,
      clip: {
        label: MSG.clipTitle,
        active: activeFilters.some((f) => f.type === 'clip'),
        count: clipCount,
        clearVisible: clipCount > 0,
        emptyTip: MSG.clipEmptyTip,
        emptyAria: MSG.clipEmpty,
      },
      multi: { label: MSG.qfMultiImage, active: multiOnly },
      labels: {
        collection: MSG.qfCatFolder,
        platform: MSG.qfPlatform,
        postType: MSG.qfPostType,
        media: MSG.qfMediaTitle,
        date: MSG.qfDate,
        engagement: MSG.qfEngagement,
        user: MSG.sidebarAuthors,
        work: kindLabel('work'),
        character: kindLabel('character'),
        hashtag: MSG.tabTags,
        tag: MSG.qfTag,
      },
      badges,
      visible: { work: hasWork, character: hasChar },
    };
  }
  function pushSidebar() {
    window.corpusSidebar.render(buildSidebarModel());
  }
  // Row badges / labels / toggle states are all model-driven now; the island renders
  // them from buildSidebarModel via window.corpusSidebar. Kept as a thin alias so the
  // many call sites (updateSidebarState, the #multiRow toggle, afterQueryChange, …) are
  // unchanged.
  function renderFilterBadges() {
    pushSidebar();
  }

  // --- Tag area: the タグ row opens ONE flyout listing every general tag,
  // sectioned by tag group (facets.js emits the ghead rows). Groups are
  // user-created and unbounded, so they live INSIDE the scrollable flyout —
  // permanent sidebar rows for them stretched the column without bound
  // (sub-rows removed 2026-07-03).
  // tagGroups/tagTypes/tagLabels (種別・グループ語彙) + tagKindOf/kindLabel moved
  // to tags.js (corpusTags wiring above) — the P4 "状態→store" tags slice.
  // Reflect the (possibly custom) 作品/キャラ names onto both sidebar columns' 種別 rows.
  // The rest (palette section headers, kind menu, dot tooltips) read kindLabel() live.
  function applyKindLabels() {
    // 作品/キャラ row names on BOTH columns are model-driven now — the sidebar islands read
    // kindLabel() via buildSidebarModel / buildPosterSidebarModel, so a 種別 rename lands by
    // re-pushing each model (no setText).
    pushSidebar();
    pushPosterSidebar();
  }
  // Mutation + persistence now live in tags.js (setTagKind/setKindLabel); these
  // wrappers keep the view-specific side effects (sidebar re-derive/re-push).
  async function setTagKind(tag, kind) {
    await window.corpusTags.setTagKind(tag, kind);
    updateSidebarTags(); // a newly classified tag may reveal/hide its 作品/キャラ section
  }
  // Rename a 種別 (work/character) globally; blank resets to the built-in label.
  async function setKindLabel(kind, label) {
    await window.corpusTags.setKindLabel(kind, label);
    applyKindLabels();
    updateSidebarTags(); // section header names + counts re-read kindLabel
  }
  const _ic = (paths) => `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  // Cached sets — rebuilt only when allPosts changes (tracked by generation counter).
  let _sidebarSetsGen = -1;
  let _cachedTagSet: Set<string> | null = null,
    _cachedHtSet: Set<string> | null = null,
    _cachedUserSet: Set<string> | null = null,
    _cachedInstSet: Set<string> | null = null;
  function _rebuildSidebarSets() {
    if (_sidebarSetsGen === _allPostsGeneration) return;
    const snPosts = allPosts.filter((p) => p.url);
    // Tags / body hashtags are user-applied to ALL posts (incl. imported, url-less
    // images migrated from Eagle), so build their choice sets from the whole library.
    // Authors / instances only make sense for SNS posts, so keep those url-scoped.
    _cachedTagSet = new Set(allPosts.flatMap((p) => p.tags || []));
    _cachedHtSet = new Set(allPosts.flatMap((p) => p.hashtags || []));
    _cachedUserSet = new Set(snPosts.map((p) => userKey(p)));
    _cachedInstSet = new Set(
      snPosts
        .filter((p) => p.platform === 'misskey' || p.platform === 'mastodon')
        .map((p) => hostOf(p.url))
        .filter(Boolean),
    );
    _sidebarSetsGen = _allPostsGeneration;
  }
  // Refresh the tag-derived sidebar rows (作品/キャラ 種別 rows).
  function updateSidebarTags() {
    _rebuildSidebarSets();
    updateKindRows();
  }
  // 用語帳 (Phase 2 ②): the 作品/キャラ rows are progressively disclosed — each appears
  // only once at least one tag wears that 種別. No kinds set → no rows → zero trace for
  // people who just save posts (Corpus isn't illustration-only).
  function updateKindRows() {
    // 作品/キャラ row visibility is derived in buildSidebarModel from _cachedTagSet.
    pushSidebar();
  }
  // --- In-session Edit Undo/Redo ---
  // Records tag-edit operations so the user can undo bulk mistakes (Ctrl+Z / Ctrl+Shift+Z).
  // Linear stack, clears on restart. Deletions are NOT included (handled by trash).
  // Stack semantics (cap / redo discard / prev-next direction) live in undo.js;
  // the two apply callbacks below carry the viewer-owned side effects.
  const _undo = window.corpusUndo.makeUndo({
    applyTags: (records) => applyTagUndo(records),
    applyPosterTags: (records) => applyPosterTagUndo(records),
  });
  const pushUndo = _undo.push;

  async function applyTagUndo(records) {
    for (const r of records) {
      try {
        await window.corpusPosts.updateTags(r.image, r.tags);
      } catch {}
      const rec = _postsById.get(r.captureId); // O(1) via the delta-cache map (allPosts holds the same record refs)
      if (rec) rec.tags = r.tags.slice();
    }
    markPostsMutated();
    renderPosts(true);
    // Keep the inspector in sync if it's showing the affected group (undo isn't fired
    // while typing in the add input, so a full re-render here is safe).
    if (!byId('postDetail').hidden && inspectedKey) {
      const fresh = viewGroups.find((g2) => postIdKey(g2.rep) === inspectedKey);
      if (fresh) showDetail(fresh);
    }
  }

  // Poster-tag variant: posterTags[key] (tags.js) is the source of truth (NOT a
  // post record), so undo/redo re-applies the captured tag list per poster key
  // and keeps an open poster inspector in sync (mirrors applyTagUndo's inspector
  // refresh). The bulk mutation + persist now live in tags.js.
  async function applyPosterTagUndo(records) {
    window.corpusTags.applyPosterTagRecords(records);
    if (!byId('postDetail').hidden && typeof inspectedKey === 'string' && inspectedKey.indexOf('poster:') === 0) {
      refreshPosterTagFields(inspectedKey.slice('poster:'.length));
    }
  }

  async function doUndo() {
    if (await _undo.undo()) showToast('Undo');
  }

  async function doRedo() {
    if (await _undo.redo()) showToast('Redo');
  }

  // Registration lives in the useGlobalShortcuts hook (app/islands/app/App.tsx).
  function handleShortcutUndoKey(e) {
    if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) return;
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (e.shiftKey) doRedo();
    else doUndo();
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleShortcutUndoKey });

  // --- State ---
  let allPosts: CorpusPost[] = [];
  let _allPostsGeneration = 0; // bumped on every allPosts replacement; invalidates sidebar caches
  // In-place edits (tag add/remove, single delete) mutate allPosts records without
  // replacing the array, so the generation counter won't advance on its own. It gates
  // the sidebar tag/author/instance caches and buildUsers, so mutators must call this —
  // otherwise a newly-added tag never reaches the sidebar rows (and a removed author /
  // instance lingers) even though renderPosts redraws the grid and flyouts.
  // P4-B slice⑪: the SAME choke point now also mirrors allPosts.length into
  // corpusStore (the post-empty-state selector's input, slice⑩) and syncs the
  // subscribable posts-data service (renderer/posts-data.ts) — every allPosts
  // mutation (replace OR in-place edit) is reachable from ONE place instead of
  // scattered pushes at each call site.
  function markPostsMutated() {
    _allPostsGeneration++;
    window.corpusStore.set('allPostsCount', allPosts.length);
    window.corpusPostsData.sync(allPosts);
  }
  let currentView = 'card'; // 'card' | 'tile' | 'list' (display density)
  let browseMode = 'posts'; // 'posts' | 'posters' (what the content area browses)
  // Holds the poster KEY a poster-click drilled into (posts mode + that `user` filter).
  // A query reset bounces back to the poster grid AS LONG AS that user filter is still
  // active (you're still looking at this poster's posts, even with extra library filters
  // added). Removing the user filter or switching mode ends it. null = no pending return.
  let posterReturn: any = null;
  let multiOnly = false; // show only items with more than one image
  let tileOverlay = true; // tile view: show the author/❤ info overlay (pref)
  let tileSize = 180; // tile view: edge px (pref imageTileSize)
  let cardSize = 280; // card view: min column width px (pref cardSize)
  let listThumb = 88; // list view: thumbnail width px (pref listThumb)
  const TILE_MIN = 120,
    TILE_MAX = 400;
  const CARD_MIN = 240,
    CARD_MAX = 560;
  const LIST_MIN = 56,
    LIST_MAX = 200;
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
  // Virtualized grid (window.corpusPostGridSource → islands/grid, P4-B slice⑩): items
  // + layout are now pulled from corpusStore by the source itself (renderer/grid.ts) —
  // viewer just pushes 'postGroups' and no longer tracks an itemsKey/isActive here.
  let _gridAnimT: any = null;
  // How long .anim-in stays on a grid after a fresh build. Must outlive the
  // LAST staggered card or its backwards-fill entrance gets cancelled mid-run:
  // 15 (CSS min() cap) × 34ms (--stagger) + 360ms (--dur-entrance) + buffer.
  const GRID_ANIM_MS = 950;

  // #mode-post is the scroll container (the page itself never scrolls), so scroll
  // position is read/written there, not on window.
  const contentScrollEl = () => document.getElementById('mode-post');
  const contentScrollTop = () => {
    const el = contentScrollEl();
    return el ? el.scrollTop : 0;
  };
  const scrollContentTo = (y) => {
    const el = contentScrollEl();
    if (el) el.scrollTop = y;
  };
  // --- Grouping state (persisted via main: manual-groups.json / ungrouped.json) ---
  let manualGroups: string[][] = []; // [[captureId,…],…] — user-built groups (win over auto)
  let ungrouped = new Set<string>(); // post keys opted out of auto-grouping
  const stickyRecs = new Set<string>(); // captureIds kept visible after a mutation un-matches the filter
  // postIdKey of the group shown in the inspector (ring marker). Mirrored into
  // corpusStore so the grid/poster cells derive their own '.inspected' ring via
  // useSyncExternalStore — no more manual repaint()/pushPosterModel() calls to
  // refresh the ring on open/close (the store notify does that reactively).
  let inspectedKey: string | null = null;
  function setInspectedKey(key: string | null) {
    inspectedKey = key;
    window.corpusStore.set('inspectedKey', key);
  }
  window.corpusStore.set('inspectedKey', null); // establish the initial value (store.get() is undefined otherwise)
  let viewGroups: CorpusPostGroup[] = []; // current render result: [{ key, records, rep, files }]
  let taggingApi: any = null; // shared 種別 (kind) menu API; set by showKindMenu() below
  // Column / slider-track / thumbnail-bucket math lives in geometry.js now.
  const { sizeFor, sliderTrack, trackCols, thumbW } = window.corpusGeometry;
  // Thumbnail width tracks the tile edge so larger tiles stay sharp (60px buckets).
  const tileThumbW = () => thumbW(tileSize * 1.4, 180, 960);
  // card/list serve a thumbnail too now (they used to load the full original —
  // multi-MB pixiv/X art decoded on every scroll and stuttered). DPR-aware, 60px
  // buckets, capped at the thumbnailer's 720px max (main.js getThumbnail).
  const _dpr = Math.min(2, window.devicePixelRatio || 1);
  const cardThumbW = () => thumbW(cardSize * 1.3 * _dpr, 240, 720);
  const listThumbW = () => thumbW(listThumb * 1.5 * _dpr, 120, 720);
  function applyTileLayout(syncSlider = true) {
    const grid = byId('postGrid');
    if (grid) {
      grid.style.setProperty('--tile-size', tileSize + 'px');
      grid.style.setProperty('--card-size', cardSize + 'px');
      grid.style.setProperty('--list-thumb', listThumb + 'px');
    }
    const row = document.getElementById('tileSizeRow');
    if (row) row.style.display = ''; // every density has a size slider now
    // refreshTileSlider reads getBoundingClientRect; calling it right after the
    // CSS-var writes above forces a sync reflow. Skip it during a live drag
    // (syncSlider=false) — the user is already holding the thumb.
    if (syncSlider) refreshTileSlider(); // hoisted; keeps the track in sync with the view
  }
  let skipDeleteConfirm = false;
  // Post-grid selection state (Set + shift-range anchor) lives in
  // window.corpusSelection (renderer/selection.ts, P4-B slice⑬) — corpusStore's
  // 'selectedSet' key IS the state; the grid island's cells read it reactively.
  // --- Query builder: a boolean condition tree is the single source of truth ---
  // (docs/design-query-builder.md 改訂③: flat conditions you drag into parenthesised
  // groups; no auto type-grouping). BOTH views (posts / posters) share ONE builder
  // implementation via the createQueryBuilder(ctx) factory below; ctx carries the
  // per-view differences (container, leaf predicate, label, callbacks). The tree is
  // ALWAYS a root group (op 'and' by default). Each instance's `.shadow()` is a
  // derived flat shadow of the leaves (sidebar highlight / row badges / tab
  // title / counts) — postQB.shadow()/posterQB.shadow(), read fresh at each
  // call site rather than mirrored into a separate module-level global (P4-B
  // slice⑧; see the syncShadow comment below).
  // The tree machinery + post-side predicates live in query.js (window.corpusQuery)
  // — the first "pure logic → service" extraction of the viewer decomposition.
  // Runtime couplings are injected here: collections/clips resolve through CF()
  // lazily (folders.js registers after this closure is built, and predicates only
  // run post-init), fuzzy text matching through corpusSearch.
  const { treeLeaves, facetTreeFrom, evalNode, hostOf, userKey, textHaystackOf } = window.corpusQuery;
  const postPredOf = window.corpusQuery.makePostPredOf({
    isInCollection: (id, cap) => !!(CF() && CF().has(id, cap)),
    isClipped: (cap) => !!(CF() && CF().isClipped(cap)),
    fuzzyCompile: (q) => (window.corpusSearch ? window.corpusSearch.compile(q) : null),
    postKeyOf: window.corpusRecords.postKeyOf, // URL-shaped queries match saved posts across x.com⇄twitter.com etc.
  });

  // The shared facet-chip builder (改訂④, docs/design-query-builder.md) now
  // lives in query-chips.ts (P4-B スライス⑦ event半分): tree state, cluster
  // view-model derivation, qbNodeMap, and click/contextmenu dispatch all moved
  // there — the query-chips island reads a cached model + calls dispatch()
  // directly instead of viewer.js pushing a model and delegating raw DOM
  // events. viewer.js keeps constructing instances (below) and the
  // orchestration around a change (onChange/openLeafEditor/onClearSearch).
  const createQueryBuilder = window.corpusQueryChips.create;
  // i18n strings the builder needs for labels/menus — resolved once here (MSG
  // is a viewer.js-local construct) and passed in via ctx.msg since
  // query-chips.ts has no access to viewer.js's i18n binding.
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
  const postQB = createQueryBuilder({
    msg: qbMsg,
    container: document.getElementById('queryChips'),
    storeKey: 'postQueryTree',
    barEl: document.getElementById('postActiveBar'), // reveal + --activebar-h measure (empty/reset are the island's)
    predOf: postPredOf,
    labelOf: filterLabel,
    glyphOf: qcGlyph,
    getSearchVal: () => searchQuery(),
    onClearSearch: () => {
      setSearchBoxValue('');
      afterQueryChange();
    },
    onChange: () => {
      renderPostFolders();
      renderPosts();
    },
    openLeafEditor: (n) => {
      if (n.type === 'date') openDatePopover(n);
      else if (n.type === 'engagement') openEngPopover(n);
    },
    // When the editing text leaf is removed or dragged on the bar, detach it from
    // the box. textInTree suppresses the legacy echo chip (the term is a real leaf).
    // Deferred arrows: searchEditing is constructed later in this closure (near
    // syncEditingTextLeaf below), same forward-reference pattern as postQB/posterQB
    // being referenced from functions defined above their own declarations.
    onLeafMutated: (node) => searchEditing.onLeafMutated(node),
    isEditingLeaf: (node) => searchEditing.isEditingLeaf(node),
    textInTree: true,
    editableLeafTypes: ['date', 'engagement'],
    singleValueTypes: ['date', 'kind'],
    noDupTypes: ['engagement', 'text'],
    // Facet schema (改訂④): tags/hashtags/collections are multi-value per post
    // (both すべて/どれか meaningful, default すべて); date/engagement/clip/text
    // (+ the legacy 'workspace' alias) stay standalone chips. Everything else
    // (platform/user/instance/kind/media/postType) clusters as a silent どれか.
    multiValueTypes: ['tag', 'hashtag', 'collection'],
    standaloneTypes: ['date', 'engagement', 'clip', 'workspace', 'text'],
  });
  // Establish an initial value (emptyTree()) before any mutation, so a future
  // reader never sees undefined — setTree only runs on tab restore, which may
  // not happen before the first render of a brand-new tab.
  window.corpusStore.set('postQueryTree', JSON.parse(JSON.stringify(postQB.getTree())));
  // Thin module-level wrappers so existing post-side call sites keep their names.
  function currentTree() {
    return postQB.getTree();
  }
  function renderQueryChips() {
    postQB.render();
  }
  function addFilter(filter) {
    postQB.addFilter(filter);
  }
  function removeFilter(index) {
    postQB.removeFilter(index);
  }
  function removeNode(node) {
    postQB.removeNode(node);
  }
  function removeCondsMatching(pred) {
    return postQB.removeCondsMatching(pred);
  }
  function qHasValue(type, value) {
    return postQB.qHasValue(type, value);
  }
  function afterQueryChange() {
    postQB.refresh();
  }

  const CF = () => window.corpusFolders; // shared folder module

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
  // suggestion items) moved to users.js (window.corpusUsers) — 5th extraction
  // slice. Reassigned lets (allPosts / _allPostsGeneration) are injected as
  // getters; userKey/hostOf are consts already initialized at this point (the
  // corpusQuery destructure above), so they pass through directly. corpusSearch
  // is a getter because buildSuggest reads its live fuzzy mode per call.
  const { buildUsers, buildSuggest } = window.corpusUsers.makeUsers({
    allPosts: () => allPosts,
    generation: () => _allPostsGeneration,
    userKey,
    hostOf,
    corpusSearch: () => window.corpusSearch,
  });

  // --- Image source (served from the save folder via the psimg:// protocol) ---
  // psimg URL for a bare filename; w>0 asks main for a downscaled thumbnail (tiles).
  const fileSrc = (file, w?) => (file ? 'psimg://img/' + encodeURIComponent(file) + (w ? '?w=' + w : '') : '');

  // Record-shape helpers (mediaFilesOf/isScreenshot/captureFile/artworkFile/
  // densityImage), normalization (postIdKey/postKeyOf), grouping (groupRecords)
  // and percentileFn moved to records.js (window.corpusRecords) — 2nd extraction
  // slice. groupRecords is rebuilt here with the live manualGroups/ungrouped
  // bindings injected as getters (viewer reassigns them on load/edit).
  const { mediaFilesOf, isScreenshot, captureFile, artworkFile, densityImage, postIdKey, postKeyOf, groupFilesOf, imageTabGroup, imageTabTitleOf, stampPost, percentileFn } = window.corpusRecords;
  const groupRecords = window.corpusRecords.makeGroupRecords({ manualGroups: () => manualGroups, ungrouped: () => ungrouped });

  // hostOf / userKey moved to query.js (destructured from window.corpusQuery above).

  // --- Load posts ---
  // keepLimit: background refreshes (fs-watch, bulk delete) re-read the library
  // without replaying the entrance animation or resetting the scroll window.
  // stampPost (sort-timestamp + post-key precompute) lives in records.js.
  // Authoritative cache keyed by captureId. The renderer holds the full set and
  // main ships only deltas (listPostsDelta) — a post-capture refresh no longer
  // re-serializes all ~9k records over IPC. allPosts is rebuilt from this map;
  // its order is irrelevant since getFilteredPosts() always re-sorts.
  let _postsById = new Map<string, CorpusPost>();
  let _haveBaseline = false; // false until we hold a full snapshot (also reset on reload = fresh module state)
  let _loadPostsInFlight = false;
  let _loadPostsPending = false;
  // changedNames is the fs-watch hint relayed from main (null | [] | [names…]);
  // it lets the refresh re-stat only the changed sidecars instead of the whole
  // folder. Absent (explicit reloads: sort change, import) -> full reconcile.
  async function loadPosts(keepLimit?, changedNames?) {
    if (_loadPostsInFlight) {
      _loadPostsPending = true;
      return;
    }
    _loadPostsInFlight = true;
    try {
      const res = await window.corpusPosts.listPostsDelta(_haveBaseline, changedNames);
      if (!res || res.full) {
        _postsById = new Map();
        for (const p of (res && res.posts) || []) _postsById.set(p.captureId, stampPost(p));
      } else {
        for (const id of res.removed || []) _postsById.delete(id);
        for (const p of res.added || []) _postsById.set(p.captureId, stampPost(p));
      }
      _haveBaseline = true;
      allPosts = [..._postsById.values()];
      markPostsMutated();
      stickyRecs.clear(); // 画面更新（再読込）でミューテーション生存分を整理
      if (browseMode === 'posters') renderPosters(keepLimit);
      else renderPosts(keepLimit);
      reconcileFolders();
      renderPostFolders();
      // An active image tab shows library records — re-resolve it against the
      // fresh set so deletions degrade to the missing state live.
      const it = activeTab();
      if (isImageTab(it)) renderImageTabView(it);
    } finally {
      _loadPostsInFlight = false;
      if (_loadPostsPending) {
        _loadPostsPending = false;
        loadPosts(true); // background reload missed during in-flight — re-run once
      }
    }
  }
  function reconcileFolders() {
    if (!CF()) return;
    CF().reconcile(new Set(allPosts.map((p) => p.captureId)));
  }

  // The listing pipeline — getFilteredPosts (content gate → query tree → sticky
  // merge → sort), namedPosters/filteredPosters, and the collection derivations —
  // moved to listing.js (window.corpusListing), 7th extraction slice. Runtime
  // couplings are injected: reassigned lets (allPosts/_postsById/posterSort/
  // collectionSort) as getters; posterQB is a const declared later — arrow
  // wrappers defer the read past TDZ (they only run once posters render).
  // Collection derivations (filteredCollections / dynamicMatches / …) are no longer
  // destructured — collections became a sidebar folder list (2026-07-04), so only the
  // post/poster selection pipeline is used here. cloneTree stays (tab-state serialize).
  const { getFilteredPosts, namedPosters, filteredPosters } = window.corpusListing.makeListing({
    allPosts: () => allPosts,
    postsById: () => _postsById,
    mediaFilesOf,
    densityImage,
    percentileFn,
    evalNode,
    treeLeaves,
    postPredOf,
    currentTree,
    stickyRecs,
    sortValue: () => sortSelect.value,
    searchQuery,
    buildUsers,
    posterQBEval: (u) => posterQB.eval(u),
    posterQBTree: () => posterQB.getTree(),
    // Poster sort's single source is corpusStore 'sortPoster' (the GlassSelect writes it);
    // default 'count' when unset (poster sort isn't persisted, so it resets on reload — same
    // as the old closure default).
    posterSort: () => (window.corpusStore.get('sortPoster') as string) || 'count',
    // Collections migrated to sidebar folders; the collection-sort UI is gone, so
    // listing.js's filteredCollections() is dormant smart-collection foundation and
    // is never called here. This getter satisfies its contract with the default
    // (alphabetical) sort — never actually invoked in the current build.
    collectionSort: () => 'name',
    allCollections: () => (CF() ? CF().allCollections() : []) as CorpusCollection[],
    filterLabel,
  });
  const { cloneTree } = window.corpusListing;

  let lastRenderedState: any = null;
  let _lastRenderGen = -1; // _allPostsGeneration at the last FULL grid build (fast card-grow guard)
  let _lastViewGroups: CorpusPostGroup[] | null = null; // groups from the last FULL build, reused on a pure load-more (no re-filter/group)
  let _lastStickySize = 0; // stickyRecs.size at that build — part of the group-reuse signature
  let restoringState = false;
  let tabs: CorpusTab[] = [];
  let activeTabId: string | null = null;
  let tabEditingId: string | null = null; // id of the tab being inline-renamed (React renders its input)
  let _tabPersistTimer: any = null;
  // Image tabs (type:'image') show ONE post's media fit-to-screen with the
  // inspector alongside instead of a filtered grid — they have no filter state.
  const isImageTab = (t) => !!t && t.type === 'image';
  const activeTab = () => tabs.find((t) => t.id === activeTabId);
  let appBooted = false; // gate history until initTabs has applied the saved view (avoids a spurious empty entry from the early prefs render)
  const NAV_CAP = 60;
  function snapshotState() {
    return {
      // queryTree is the source of truth; f (the shadow) is kept for the tab title
      // (tabTitleOf reads state.f) and for migrating older persisted states.
      f: JSON.parse(JSON.stringify(postQB.shadow())),
      tree: cloneTree(postQB.getTree()),
      search: searchQuery(),
      sort: sortSelect.value,
      multi: multiOnly,
    };
  }
  // Called from every fresh renderPosts(): keep the tab title + persistence in sync
  // with the current state, record it for the stickyRecs change-detection below,
  // and push it onto the per-tab back/forward history (see nav.push).
  function syncTitleAndPersist() {
    if (isImageTab(activeTab())) return; // grid renders under an image tab are background refreshes — its title/persistence live on the image-tab path
    const snap = snapshotState();
    lastRenderedState = JSON.stringify(snap);
    if (restoringState) return;
    nav.push(snap); // record this view for back/forward (skipped while restoring)
    document.title = tabTitleOf(snap, { allCount: allPosts.length }).text + ' — Corpus';
    updateActiveTabTitle();
    persistTabsDebounced();
  }
  function applyState(s) {
    restoringState = true;
    // Restore the tree (truth); migrate older states (f + ops, no tree) if needed.
    postQB.setTree(s.tree ? s.tree : facetTreeFrom(s.f || [], s.ops || {}));
    setSearchBoxValue(s.search);
    rebindEditingTextLeaf(); // resume editing the restored term instead of duplicating it
    sortSelect.value = s.sort;
    window.corpusStore.set('sortPost', sortSelect.value); // mirror into the store so the GlassSelect island reflects it
    multiOnly = !!s.multi;
    renderPostFolders();
    renderQueryChips();
    renderPosts();
    restoringState = false;
    document.title = tabTitleOf(s, { allCount: allPosts.length }).text + ' — Corpus';
  }

  // --- View history (browser-style back/forward) ---
  // The state machine (hist/idx/cap/dedupe/forward-branch drop/adopt) lives in
  // tab-state.js (makeNavHistory); viewer keeps the DOM button sync and the
  // persistence hooks. applyState's restoringState guards the re-push.
  const nav = window.corpusTabState.makeNavHistory({
    cap: NAV_CAP,
    enabled: () => appBooted,
    snapshot: snapshotState,
    apply: applyState,
    onChange: updateNavButtons,
  });
  // The nav 戻る/進む disabled state is part of the activebar model now — a nav change just
  // re-pushes it (the island reads navBackDisabled/navFwdDisabled).
  function updateNavButtons() {
    pushActivebar();
  }
  function navBack() {
    if (nav.back()) persistTabsDebounced();
  }
  function navForward() {
    if (nav.forward()) persistTabsDebounced();
  }

  // --- Active-bar frame model (window.corpusActivebar) ---
  // The query-builder FRAME (nav / フィルター title / empty hint / result count / リセット /
  // ⓘ help) around #queryChips / #posterQueryChips is a React island now. viewer keeps all
  // the state; buildActivebarModel() aggregates it and pushActivebar() renders it. Called
  // from renderPosts / renderPosters (after the counts are known), updateNavButtons, and
  // boot. The chips themselves stay their own island (createQueryBuilder.render()).
  function buildActivebarModel() {
    const search = searchQuery().trim();
    const postActive = postQB.hasQuery() || !!search;
    const posterActive = posterQB.hasQuery() || !!search;
    return {
      post: {
        label: MSG.activebarLabel,
        emptyHint: MSG.qbEmptyHint,
        emptyVisible: !postActive,
        countLabel: MSG.postCount(viewGroups.length),
        resetLabel: MSG.reset,
        resetVisible: postActive,
        navBackDisabled: !nav.canBack(),
        navFwdDisabled: !nav.canForward(),
      },
      poster: {
        emptyHint: MSG.qbEmptyHint,
        emptyVisible: !posterActive,
        countLabel: MSG.posterCount(posterList.length),
        resetLabel: MSG.reset,
        resetVisible: posterActive,
      },
      help: { title: MSG.qbHelpTitle, rows: [MSG.qbHelp1, MSG.qbHelp2, MSG.qbHelp3, MSG.qbHelp4, MSG.qbHelp5] },
      onNavBack: navBack,
      onNavFwd: navForward,
      onReset: resetAllFilters,
      onPosterReset: resetPosterFilters,
    };
  }
  function pushActivebar() {
    window.corpusActivebar.render(buildActivebarModel());
  }
  // Nav is post-mode only and yields to typing / open overlays / poster mode.
  function navAllowed() {
    if (browseMode !== 'posts') return false; // history nav is post-view only (posters/collections excluded)
    if (isImageTab(activeTab())) return false; // image tabs have no filter history
    if (document.querySelector('.confirm-overlay.show') || (window.corpusLightbox && window.corpusLightbox.isOpen())) return false;
    if (window.corpusSettings && window.corpusSettings.isOpen()) return false;
    if (!byId('ivFolderModal').hidden) return false;
    return true;
  }

  // --- Window tabs ---
  const TAB_ICONS = {
    all: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    tag: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    hashtag: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
    user: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    platform: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    instance:
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    postType: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    media: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    date: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    engagement: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    kind: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    clip: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  };
  // genTabId + the tabs.json payload/restore shape + its load/persist live in
  // tab-state.js (6th extraction slice + P4 domain-grouping follow-up).
  const { genTabId, sanitizeSavedTabs, loadTabs, persistTabs } = window.corpusTabState;
  function persistTabsNow() {
    clearTimeout(_tabPersistTimer);
    const at = tabs.find((t) => t.id === activeTabId);
    if (at && !isImageTab(at)) {
      at.state = snapshotState();
      at._scrollTop = contentScrollTop();
    }
    persistTabs(tabs, activeTabId);
  }
  function persistTabsDebounced() {
    clearTimeout(_tabPersistTimer);
    _tabPersistTimer = setTimeout(persistTabsNow, 800);
  }
  function saveActiveTabState() {
    const t = tabs.find((t) => t.id === activeTabId);
    if (!t) return;
    if (isImageTab(t)) return; // img.idx is kept live by the island callback; there is no filter state to snapshot
    t.state = snapshotState();
    t._scrollTop = contentScrollTop(); // remember content scroll per tab (persisted too)
    nav.saveInto(t); // carry the back/forward history with the tab
  }
  // Restore a tab's remembered content scroll. rAF×2 so the freshly rendered
  // grid has laid out; the virtualized grid derives its window from scrollTop
  // alone (its estimated container height already spans all items).
  function restoreTabView(t) {
    if (!t || isImageTab(t)) return; // no grid scroll to restore under an image tab
    const y = typeof t._scrollTop === 'number' ? t._scrollTop : 0;
    requestAnimationFrame(() => requestAnimationFrame(() => scrollContentTo(y)));
  }
  function updateActiveTabTitle() {
    if (!activeTabId) return;
    const t = tabs.find((t) => t.id === activeTabId);
    if (!t || t.title) return; // custom-named tab: nothing derives, skip the re-render
    renderTabs(); // React diffs the strip; only the active tab's derived title actually changes
  }
  function renderTabTitle(t) {
    if (t.title) return t.title;
    const s = t.id === activeTabId ? snapshotState() : t.state || {};
    return tabTitleOf(s, { allCount: allPosts.length }).text;
  }
  function renderTabs() {
    if (!document.getElementById('tabBarInner')) return;
    const pinSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>';
    // React owns the strip now: build a plain model (titles/icons/flags) and push
    // it to the island. viewer.js keeps the tabs array, activeTabId, editing state,
    // and all #tabBarInner event delegation.
    const tabModels = tabs.map((t) => {
      const isActive = t.id === activeTabId;
      const s = isImageTab(t) ? {} : isActive ? snapshotState() : t.state || {};
      const icon = t.pinned ? pinSvg : isImageTab(t) ? TAB_ICONS.media : TAB_ICONS[tabTitleOf(s, { allCount: allPosts.length }).iconType] || TAB_ICONS.all;
      return { id: t.id, title: renderTabTitle(t), icon, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && tabs.length > 1 };
    });
    const model = { tabs: tabModels, editingId: tabEditingId, closeTitle: MSG.tabClose, newTitle: MSG.tabNew };
    if (window.corpusTabs) window.corpusTabs.render(model);
  }
  function switchTab(id) {
    if (id === activeTabId) return;
    saveActiveTabState();
    activeTabId = id;
    const t = tabs.find((t) => t.id === id);
    if (!t) return;
    if (isImageTab(t)) {
      showImageTab(t);
    } else {
      hideImageTabView();
      if (t.state) applyState(t.state);
      else renderPosts();
    }
    nav.adopt(t);
    restoreTabView(t);
    renderTabs();
    persistTabsDebounced();
  }
  function addTab() {
    saveActiveTabState();
    hideImageTabView(); // Ctrl+T from an image tab lands on a fresh grid tab
    const id = genTabId();
    tabs.push({ id, pinned: false, title: null, state: { f: [], ops: {}, tree: null, search: '', sort: 'date-desc', multi: false } });
    activeTabId = id;
    applyState({ f: [], ops: {}, search: '', sort: sortSelect.value, multi: false });
    nav.adopt(tabs.find((t) => t.id === id)); // fresh tab → fresh history (seeded with the empty view)
    requestAnimationFrame(() => scrollContentTo(0)); // new tab starts at the top
    renderTabs();
    persistTabsDebounced();
  }
  function closeTab(id) {
    if (tabs.length <= 1) {
      if (isImageTab(tabs[0])) {
        // Last tab: a window always keeps one grid tab, so the image tab
        // becomes a fresh filter tab instead of just resetting.
        hideImageTabView();
        const nid = genTabId();
        tabs = [{ id: nid, pinned: false, title: null, state: null }];
        activeTabId = nid;
        resetAllFilters();
        nav.adopt(tabs[0]);
        renderTabs();
        persistTabsDebounced();
        return;
      }
      resetAllFilters();
      updateActiveTabTitle();
      persistTabsDebounced();
      return;
    }
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    tabs.splice(idx, 1);
    if (activeTabId === id) {
      const ni = Math.min(idx, tabs.length - 1);
      activeTabId = tabs[ni].id;
      const t = tabs[ni];
      if (isImageTab(t)) {
        showImageTab(t);
      } else {
        hideImageTabView();
        if (t.state) applyState(t.state);
        else renderPosts();
      }
      nav.adopt(t);
      restoreTabView(t);
    }
    renderTabs();
    persistTabsDebounced();
  }
  function pinTab(id) {
    const t = tabs.find((t) => t.id === id);
    if (!t) return;
    t.pinned = !t.pinned;
    tabs = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
    renderTabs();
    persistTabsDebounced();
  }
  function renameTab(id, name) {
    const t = tabs.find((t) => t.id === id);
    if (!t) return;
    t.title = name.trim() || null;
    renderTabs();
    persistTabsDebounced();
  }
  function duplicateTab(id) {
    saveActiveTabState();
    const src = tabs.find((t) => t.id === id);
    if (!src) return;
    const idx = tabs.indexOf(src);
    const nt = { id: genTabId(), pinned: false, title: src.title ? src.title + ' (2)' : null, type: src.type, img: src.img ? JSON.parse(JSON.stringify(src.img)) : undefined, state: JSON.parse(JSON.stringify(src.state || {})) };
    tabs.splice(idx + 1, 0, nt);
    activeTabId = nt.id;
    if (isImageTab(nt)) {
      showImageTab(nt);
    } else {
      hideImageTabView();
      if (nt.state && Object.keys(nt.state).length) applyState(nt.state);
      else renderPosts();
    }
    nav.adopt(nt); // duplicate starts its own history at the copied view
    renderTabs();
    persistTabsDebounced();
  }

  // --- Image tabs (type:'image') — fit-to-screen detail view (Eagle 風) ---
  // Persisted as { type:'image', img:{ recs:[captureId…], idx } }; recs resolve
  // against the live library on every activation (imageTabGroup, records.ts — the
  // _postsById lookup is injected), so deletions degrade to a "missing" empty state
  // instead of a broken image.
  const resolveImageTabGroup = (t) => imageTabGroup(t, (id) => _postsById.get(id));
  // (Re)build the island model for an image tab and push it. Also called on
  // library refreshes so a deleted post degrades to the missing state live.
  function renderImageTabView(t) {
    const g = resolveImageTabGroup(t);
    t._g = g; // runtime resolution (inspector toggle re-uses it; never persisted)
    const items = g ? buildGroupGalleryItems(g) : [];
    const labels = { missing: MSG.imgTabMissing, closeTab: MSG.imgTabCloseBtn, prev: MSG.lbPrev, next: MSG.lbNext, info: MSG.tipInfo };
    const model = !items.length
      ? { items: [], idx: 0, missing: true, labels, onCloseTab: () => closeTab(t.id) }
      : {
          items,
          idx: Math.max(0, Math.min((t.img && t.img.idx) || 0, items.length - 1)),
          inspectorOpen: !byId('postDetail').hidden,
          labels,
          onIndexChange: (i) => {
            if (t.img) t.img.idx = i;
            persistTabsDebounced();
            renderImageTabView(t); // controlled index — repaint with the new slide
          },
          onToggleInspector: () => {
            if (byId('postDetail').hidden) {
              if (t._g) showDetail(t._g);
            } else closeDetail();
            renderImageTabView(t); // reflect the pressed state on the ℹ button
          },
          onCloseTab: () => closeTab(t.id),
        };
    if (window.corpusImageTab) window.corpusImageTab.render(model);
  }
  // body.image-tab-active is React-owned now (ImageTabHost toggles it from model presence
  // — the class ⟺ an image tab is showing). viewer keeps only this local flag for the
  // re-entrancy guard + the Esc check, so it no longer touches document.body.classList.
  let imageTabShowing = false;
  function showImageTab(t) {
    imageTabShowing = true;
    renderImageTabView(t); // pushes the model → ImageTabHost adds body.image-tab-active
    // The inspector opens with the view (Eagle-style detail screen).
    if (t._g) showDetail(t._g);
    else closeDetail();
    document.title = (t.title || MSG.imgTabFallback) + ' — Corpus';
  }
  function hideImageTabView() {
    if (!imageTabShowing) return;
    imageTabShowing = false;
    if (window.corpusImageTab) window.corpusImageTab.render(null); // → ImageTabHost removes the class
    closeDetail(); // the open detail belonged to the image tab; grid tabs reopen it per card
  }
  // Open a post group as its own tab. Background by default (browser-like:
  // middle-click / context menu leave you in the grid).
  function addImageTab(g, opts?) {
    const recs = g.records.map((r) => r.captureId).filter(Boolean);
    if (!recs.length) return;
    const id = genTabId();
    const t = { id, pinned: false, title: imageTabTitleOf(g, MSG.imgTabFallback), type: 'image', img: { recs, idx: 0 }, state: null } as CorpusTab;
    // Insert next to the current tab (browser-like), never inside the pinned run.
    const ai = tabs.findIndex((tt) => tt.id === activeTabId);
    let pos = ai >= 0 ? ai + 1 : tabs.length;
    const lastPinned = tabs.reduce((acc, tt, i) => (tt.pinned ? i : acc), -1);
    if (pos <= lastPinned) pos = lastPinned + 1;
    tabs.splice(pos, 0, t);
    if (opts && opts.activate) {
      saveActiveTabState();
      activeTabId = id;
      showImageTab(t);
      nav.adopt(t);
    }
    renderTabs();
    persistTabsDebounced();
  }

  async function initTabs() {
    try {
      const saved = await loadTabs();
      const st = sanitizeSavedTabs(saved, genTabId); // null when nothing usable was saved
      if (st) {
        tabs = st.tabs;
        activeTabId = st.activeTabId;
      } else {
        const id = genTabId();
        tabs = [{ id, pinned: false, title: null, state: null }];
        activeTabId = id;
      }
      const at = tabs.find((t) => t.id === activeTabId);
      if (at && at.state && !isImageTab(at)) {
        // queryTree is the truth; migrate older states (f + ops, no tree).
        postQB.setTree(at.state.tree ? at.state.tree : facetTreeFrom(at.state.f || [], at.state.ops || {}));
        setSearchBoxValue(at.state.search || '');
        rebindEditingTextLeaf();
        sortSelect.value = at.state.sort || 'date-desc';
        window.corpusStore.set('sortPost', sortSelect.value); // mirror into the store so the GlassSelect island reflects it
        multiOnly = !!at.state.multi;
      }
    } catch (err) {
      console.error('initTabs error:', err);
      const id = genTabId();
      tabs = [{ id, pinned: false, title: null, state: null }];
      activeTabId = id;
    }
    renderTabs();
  }
  // Tab bar: rename-input commit/cancel, close/new/switch clicks, middle-click close,
  // autoscroll suppression, right-click context menu, double-click rename, and the
  // Ctrl+T/W/Tab document shortcuts. Registration lives in React (TabBarEvents,
  // app/islands/app/App.tsx) via window.corpusViewer below; this stays the guard +
  // action logic (viewer keeps the orchestration, React owns the wiring) — same
  // "cut out and rewire" as the global shortcuts / detail-dismiss slices.
  // Tab context menu (right-click a tab): pin / rename / duplicate / close /
  // close-others. React-owned glass menu (window.corpusContextMenu); viewer owns the
  // items + actions.
  function showTabMenu(id, e) {
    const t = tabs.find((t) => t.id === id);
    if (!t) return;
    const items: any[] = [
      { label: t.pinned ? MSG.tabUnpin : MSG.tabPin, act: 'pin' },
      { label: MSG.tabRename, act: 'rename' },
      { label: MSG.tabDuplicate, act: 'duplicate' },
    ];
    if (tabs.length > 1) {
      items.push({ label: MSG.tabClose, act: 'close' });
      items.push({ label: MSG.tabCloseOthers, act: 'close-others', danger: true });
    }
    window.corpusContextMenu.open({ items, x: e.clientX, y: e.clientY + 4 }, (item) => {
      const tid = id;
      const act = item.act;
      if (act === 'pin') pinTab(tid);
      else if (act === 'rename') startTabRename(tid);
      else if (act === 'duplicate') duplicateTab(tid);
      else if (act === 'close') closeTab(tid);
      else if (act === 'close-others') {
        tabs = tabs.filter((t) => t.id === tid);
        const tt = tabs[0];
        activeTabId = tid;
        if (tt.state) applyState(tt.state);
        else renderPosts();
        renderTabs();
        persistTabsDebounced();
      }
    });
  }
  // Inline rename: flag the tab as editing → React renders a .tab-rename-input in
  // place of its title span (it survives re-renders, unlike the old imperative
  // replaceWith on React-owned DOM). Commit/cancel are delegated on the bar below.
  function startTabRename(id) {
    if (!tabs.find((t) => t.id === id)) return;
    tabEditingId = id;
    renderTabs();
    const input = byId('tabBarInner')?.querySelector('.tab-rename-input') as HTMLInputElement | null;
    if (input) {
      input.focus();
      input.select();
    }
  }
  function commitTabRename() {
    if (!tabEditingId) return;
    const input = byId('tabBarInner')?.querySelector('.tab-rename-input') as HTMLInputElement | null;
    const id = tabEditingId;
    tabEditingId = null;
    if (input) renameTab(id, input.value);
    else renderTabs(); // renameTab re-renders
  }
  function cancelTabRename() {
    if (!tabEditingId) return;
    tabEditingId = null;
    renderTabs(); // discard the edit, restore the title
  }
  // Rename input commit (Enter / blur) + cancel (Escape), delegated on the bar so
  // they keep working across React re-renders of the strip.
  function handleTabBarKeydown(e) {
    if (!tabEditingId || !closestOf(e, '.tab-rename-input')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTabRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelTabRename();
    }
  }
  function handleTabBarFocusout(e) {
    if (tabEditingId && closestOf(e, '.tab-rename-input')) commitTabRename();
  }
  function handleTabBarClick(e) {
    const closeBtn = closestOf(e, '[data-close]');
    if (closeBtn) {
      e.stopPropagation();
      closeTab(closeBtn.dataset.close);
      return;
    }
    const newBtn = closestOf(e, '.tab-new');
    if (newBtn) {
      addTab();
      return;
    }
    const tabBtn = closestOf(e, '.tab-item[data-tab]');
    if (tabBtn && !closestOf(e, '.tab-rename-input')) {
      switchTab(tabBtn.dataset.tab);
      return;
    }
  }
  // Middle-click (wheel) a tab to close it — matches the close-button rule
  // (pinned tabs and the last remaining tab stay protected).
  function handleTabBarAuxclick(e) {
    if (e.button !== 1) return;
    const tabBtn = closestOf(e, '.tab-item[data-tab]');
    if (!tabBtn) return;
    e.preventDefault();
    const t = tabs.find((x) => x.id === tabBtn.dataset.tab);
    if (t && !t.pinned && tabs.length > 1) closeTab(t.id);
  }
  // Suppress the middle-click autoscroll cursor over the tab strip.
  function handleTabBarMousedown(e) {
    if (e.button === 1 && closestOf(e, '.tab-item[data-tab]')) e.preventDefault();
  }
  function handleTabBarContextmenu(e) {
    const tabBtn = closestOf(e, '.tab-item[data-tab]');
    if (!tabBtn) return;
    e.preventDefault();
    showTabMenu(tabBtn.dataset.tab, e);
  }
  function handleTabBarDblclick(e) {
    const tabBtn = closestOf(e, '.tab-item[data-tab]');
    if (!tabBtn || closestOf(e, '[data-close]')) return;
    startTabRename(tabBtn.dataset.tab);
  }
  function handleGlobalTabShortcut(e) {
    if (!e.ctrlKey || e.altKey) return;
    if (e.key === 't') {
      e.preventDefault();
      addTab();
    } else if (e.key === 'w') {
      e.preventDefault();
      closeTab(activeTabId);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx < 0) return;
      const n = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
      switchTab(tabs[n].id);
    }
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, {
    handleTabBarKeydown,
    handleTabBarFocusout,
    handleTabBarClick,
    handleTabBarAuxclick,
    handleTabBarMousedown,
    handleTabBarContextmenu,
    handleTabBarDblclick,
    handleGlobalTabShortcut,
  });

  // Mutations (untag, unfold, ungroup) can make a visible card stop matching the
  // active filter. Instead of vanishing instantly, the card stays until the next
  // filter change / data refresh — call this BEFORE the mutation re-render.
  function keepCurrentVisible() {
    viewGroups.forEach((g) =>
      g.records.forEach((r) => {
        if (r.captureId) stickyRecs.add(r.captureId);
      }),
    );
  }

  const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Per-image aspect ratio cache (captureId -> "W/H"), learned on image load and
  // persisted. Lets a card reserve the right height BEFORE its (lazy) image loads,
  // so masonry packs correctly the first time = no settle/jitter and no eager load.
  let imgAspect = {};
  try {
    imgAspect = JSON.parse(localStorage.getItem('corpus.imgAspect') || '{}') || {};
  } catch (e) {}
  let _aspectT: any = null;
  function persistAspect() {
    clearTimeout(_aspectT);
    _aspectT = setTimeout(() => {
      try {
        localStorage.setItem('corpus.imgAspect', JSON.stringify(imgAspect));
      } catch (e) {}
    }, 1000);
  }
  // Resolve ONE group into a plain, fully-formatted card model: image src,
  // formatted counts/dates, selection, clip, aspect — everything the markup
  // needs as primitives. The grid island renders it with the shared PostCard
  // component (live React cells via window.corpusPostGridSource). Raw text/names are
  // passed unescaped — JSX escapes them (was manual escapeHtml/escapeAttr).
  // Per-card view model (records.js makeCardModel) — the model the grid island
  // renders. Extracted 1:1 from the old inline cardModel; runtime couplings are
  // injected (density/aspect cache as getters; the psimg scheme and folder-clip
  // flag stay viewer-owned via fileSrc / isClipped). Selection is NOT injected —
  // the grid island's Cell derives .selected from corpusStore's 'selectedSet'.
  const cardModel = window.corpusRecords.makeCardModel({
    MSG,
    PF_NAME,
    formatCount,
    formatDate,
    compactDate,
    fileSrc,
    isClipped: (id) => !!(CF() && CF().isClipped(id)),
    smokeCapture: SMOKE_CAPTURE,
    currentView: () => currentView,
    imgAspect: () => imgAspect,
    tileThumbW,
    cardThumbW,
    listThumbW,
  });
  // i18n labels are identical for every card — set up once (also keeps them in sync
  // after a language change, which always full-reloads the app).
  const cardLabels = {
    tipSelect: MSG.tipSelect,
    tipClip: MSG.tipClip,
    tipInfo: MSG.tipInfo,
    tipTagEdit: MSG.tipTagEdit,
    clickToExpand: MSG.clickToExpand,
  };
  // Cards whose image has NO reserved height (no shotW/H in the index, no cached
  // aspect — rare: video poster / unreadable header) report their real aspect on
  // load; the cache reserves the height on the NEXT render.
  function onCardAspect(cap, ar) {
    if (imgAspect[cap] !== ar) {
      imgAspect[cap] = ar;
      persistAspect();
    }
  }
  // P4-B slice⑩: modelOf/keyOf/labels/onAspect never change identity meaningfully
  // between renders (only items/layout do, and those are corpusStore-derived by the
  // source itself) — configure once instead of rebuilding + pushing every renderPosts().
  window.corpusPostGridSource.configure({
    modelOf: (g, i) => cardModel(g, i),
    keyOf: (g) => postIdKey(g.rep),
    labels: cardLabels,
    onAspect: onCardAspect,
  });

  // inPlace (was keepLimit — the renderLimit it kept is gone with the windowed
  // legacy path): true = in-place mutation re-render — reuse the grouped set
  // when possible, keep sticky survivors, no entrance animation, and skip the
  // tab-title/persist sync.
  function renderPosts(inPlace?) {
    // View signature (filter/sort/search/view) — stable across this render, so
    // compute once and reuse for the sticky-drop and group-reuse checks.
    const stateSig = JSON.stringify(snapshotState());
    // A genuine filter/search/sort change drops the sticky survivors (they only
    // outlive in-place mutations, not user-driven view changes).
    if (!inPlace && stickyRecs.size && lastRenderedState !== null && stateSig !== lastRenderedState) {
      stickyRecs.clear();
    }
    updateSidebarState();
    syncBrowseBar(); // keep the ライブラリ/投稿者 toggle's glass thumb measured
    const grid = byId('postGrid');
    const empty = byId('emptyState');
    // Group the filtered records (auto by post URL + manual groups); each group
    // renders as ONE card. multiOnly now means "groups with more than one image".
    // Reuse the previous build's groups on an in-place re-render: re-filtering +
    // re-grouping ~9k records for a mutation that can't change the set was wasted
    // work. Safe only when the view signature, the data generation, AND the
    // sticky set are all unchanged — the only inputs to getFilteredPosts/
    // groupRecords (manual grouping bumps the generation via markPostsMutated).
    // Any mismatch falls through to a fresh build.
    const canReuseGroups = inPlace && _lastViewGroups !== null && lastRenderedState !== null && stateSig === lastRenderedState && _allPostsGeneration === _lastRenderGen && stickyRecs.size === _lastStickySize;
    if (canReuseGroups) {
      viewGroups = _lastViewGroups as CorpusPostGroup[];
    } else {
      viewGroups = groupRecords(getFilteredPosts());
      if (multiOnly) viewGroups = viewGroups.filter((g) => g.files.length > 1 || g.records.some((r) => stickyRecs.has(r.captureId)));
    }

    // Post count + reset/empty/nav frame → the activebar island (viewGroups is now final).
    pushActivebar();

    if (viewGroups.length === 0) {
      // P4-B slice⑩: pushing 'postGroups'=null (not just an empty array — see
      // renderer/grid.ts's computeModel) unmounts the grid island's cells
      // SYNCHRONOUSLY (corpusStore.set's notify loop is synchronous, and the
      // island's subscriber flushSync's the unmount — same guarantee the old
      // window.corpusGrid.render(null) call gave) BEFORE the innerHTML clear
      // below runs. The EmptyState island derives 'firstRun'/'filtered' itself
      // from this same key + 'allPostsCount' + 'searchQuery' — one less push.
      window.corpusStore.set('postGroups', null);
      grid.innerHTML = '';
      grid.style.display = 'none';
      empty.style.display = 'block';
      if (!inPlace && !prefersReducedMotion()) {
        void empty.offsetWidth;
        empty.classList.add('anim-in');
        setTimeout(() => empty.classList.remove('anim-in'), 400);
      }
      if (!inPlace) syncTitleAndPersist(); // 0件の状態もタイトル・永続化を同期
      return;
    }

    // Container-level layout (the old flex column / CSS grid / masonry block) is
    // dead in the virtualized grid — masonic positions cells absolutely inside
    // its host. The view classes stay purely for descendant styling (.masonry
    // keeps card cells content-visibility:visible + width:100%).
    grid.style.display = 'block';
    grid.classList.toggle('list-view', currentView === 'list');
    grid.classList.toggle('tile-view', currentView === 'tile');
    applyTileLayout();
    empty.style.display = 'none';

    // Card entrance plays only on a fresh build (filter/sort/search), never on
    // an in-place mutation re-render. Skipped under prefers-reduced-motion.
    grid.classList.toggle('anim-in', !inPlace && !prefersReducedMotion());
    grid.classList.toggle('masonry', currentView === 'card');
    // Selection mode: rings stay visible on every card, hover actions hide (CSS).
    grid.classList.toggle('selecting', window.corpusSelection.size() > 0);
    // Tile overlay (author/❤) is optional; the ❤ count only shows while an
    // engagement sort or filter is active (otherwise it's noise).
    grid.classList.toggle('no-overlay', !tileOverlay);
    grid.classList.toggle('show-eng', ['likes-desc', 'reposts-desc', 'replies-desc', 'likes-pct'].includes(sortSelect.value) || postQB.shadow().some((f) => f.type === 'engagement'));

    // THE GRID — fully React-owned (grid island via window.corpusPostGridSource):
    // masonic windowing + live cell rendering for all three views. viewer.js keeps
    // the data pipeline (viewGroups above), the container's classes/CSS vars, and
    // every delegated #postGrid handler. P4-B slice⑩: layout (view/columnWidth/
    // rowGutter/itemHeightEstimate/…) is no longer pushed — the source derives it
    // itself from corpusStore's 'view'/'cardSize'/'tileSize'/'listThumb' (already
    // there since slice④); modelOf/keyOf/labels/onAspect were configured once,
    // above. Pushing the SAME array reference (in-place reuse) is a no-op via the
    // store's identity guard, matching the old itemsKey-doesn't-bump behavior.
    window.corpusStore.set('postGroups', viewGroups);
    // With windowing, cells keep MOUNTING while the user scrolls — drop the
    // entrance class once the initial animation has played, or every late
    // cell would replay it mid-scroll.
    clearTimeout(_gridAnimT);
    if (grid.classList.contains('anim-in')) _gridAnimT = setTimeout(() => grid.classList.remove('anim-in'), GRID_ANIM_MS);
    _lastRenderGen = _allPostsGeneration; // mark the generation of this build
    _lastViewGroups = viewGroups;
    _lastStickySize = stickyRecs.size; // snapshot for in-place group reuse
    if (!inPlace) syncTitleAndPersist(); // keep the tab title + persistence in sync
  }

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
  const { buildGroupGalleryItems } = window.corpusRecords.makeGallery({ fileSrc });

  byId('postGrid').addEventListener('click', (e) => {
    // Image -> open the gallery (screenshot + originals, whole group).
    // While the inspector is open, a single click swaps its content instead
    // (inline browsing); the gallery is then reached by double-click.
    const img = closestOf(e, '.card-img');
    if (img) {
      e.stopPropagation();
      const g = viewGroups[Number.parseInt((img.closest('.post-card') as HTMLElement | null)?.dataset.index ?? '', 10)];
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
    const g = viewGroups[Number.parseInt((img.closest('.post-card') as HTMLElement | null)?.dataset.index ?? '', 10)];
    if (g) window.corpusLightbox.open(buildGroupGalleryItems(g), 0);
  });

  // Middle-click an image → open the post as a background image tab
  // (browser-like; replaces the old single-image window).
  byId('postGrid').addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const img = closestOf(e, '.card-img');
    if (!img) return;
    e.preventDefault();
    const g = viewGroups[Number.parseInt((img.closest('.post-card') as HTMLElement | null)?.dataset.index ?? '', 10)];
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
    const g = viewGroups[Number.parseInt(btn.dataset.clip ?? '', 10)];
    if (!g || !g.rep.captureId) return;
    keepCurrentVisible(); // removal can un-match an active clip filter
    const res = CF().toggleClip(
      g.records.map((r) => r.captureId),
      g.rep.captureId,
    );
    if (!res) return;
    btn.classList.toggle('in', res === 'added');
    renderClipRow();
    if (postQB.shadow().some((f) => f.type === 'clip')) renderPosts(true);
  });

  // Folder picker flyout (destinations) — opened from the card context menu
  // and the bulk 「フォルダに追加」 button.
  // Folder picker (destinations) — React-owned glass menu (window.corpusContextMenu);
  // viewer owns the items + actions. A folder row toggles membership and CLOSES (the old
  // foldMenu hid after each toggle — preserved). Opened from the card menu and the bulk
  // 「フォルダに追加」 button.
  function foldMenuItems(g) {
    const list = CF() ? CF().all() : [];
    const rep = g.rep.captureId;
    const items = list.map((f) => ({ label: f.name, act: 'fold', fid: f.id, checked: CF().has(f.id, rep) })) as CorpusMenuItem[];
    if (list.length) items.push({ sep: true });
    items.push({ label: MSG.ctxManage, act: 'manage', manage: true });
    return items;
  }
  function onFoldMenuPick(g, item) {
    if (!CF()) return;
    if (item.act === 'manage') {
      CF().openManager();
      return;
    }
    if (item.act === 'fold') {
      keepCurrentVisible();
      CF().toggleIn(
        item.fid,
        g.records.map((r2) => r2.captureId),
        g.rep.captureId,
      );
      // re-render only if a collection filter could change the visible set
      if (postQB.shadow().some((f) => f.type === 'collection')) renderPosts(true);
    }
  }
  function showFoldMenu(g, x, y) {
    if (!CF()) return;
    window.corpusContextMenu.open({ items: foldMenuItems(g), x, y }, (item) => onFoldMenuPick(g, item));
  }

  // --- Card context menu: the labeled table of contents of per-card actions.
  // Hover keeps the rapid-fire buttons (📎 clip / ℹ info / 🏷 tag);
  // everything else (open, folder, poster, delete) lives here.
  const CM_IC = {
    open: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    clip: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.6" x2="12" y2="7.7"/></svg>',
    del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    sauce: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    poster: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    newtab: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M12 12.5v4M10 14.5h4"/></svg>',
    reveal: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M9 13.5h6"/><path d="m12.8 11 2.5 2.5-2.5 2.5"/></svg>',
  };
  // Card context menu — React-owned glass menu (window.corpusContextMenu); viewer owns
  // items + actions. 'folder' opens the folder picker (a DIFFERENT menu) at the same
  // spot; the bridge's transition guard keeps that open instead of closing it.
  function cardMenuItems(g) {
    const inClip = !!(CF() && CF().isClipped(g.rep.captureId));
    // SNS posts have a poster in the poster view (buildUsers skips url-less migrations).
    const canPoster = !!(g.rep.url && buildUsers().some((u) => u.key === userKey(g.rep)));
    const srcUrl = (g.records.flatMap((r) => (Array.isArray(r.media) ? r.media : [])).find((m) => m && m.url) || {}).url || '';
    const items: any[] = [];
    if (g.rep.url) items.push({ label: MSG.tipOpen, act: 'open', icon: CM_IC.open });
    items.push({ label: MSG.ctxOpenNewTab, act: 'newtab', icon: CM_IC.newtab });
    items.push({ label: MSG.tipFolder, act: 'folder', icon: CM_IC.folder });
    if (CF()) items.push({ label: inClip ? MSG.ctxClipRemove : MSG.ctxClipAdd, act: 'clip', icon: CM_IC.clip });
    items.push({ label: MSG.tipInfo, act: 'info', icon: CM_IC.info });
    if (canPoster) items.push({ label: MSG.ctxViewPoster, act: 'poster', icon: CM_IC.poster });
    // The file the card is showing right now (capture or artwork per density).
    const cardFile = densityImage(g.rep, currentView) || g.rep.image || '';
    if (srcUrl || cardFile) items.push({ sep: true });
    if (srcUrl) {
      items.push({ label: MSG.detailSauce, act: 'sauce', icon: CM_IC.sauce });
      items.push({ label: MSG.detailAscii, act: 'ascii', icon: CM_IC.sauce });
    }
    if (cardFile) items.push({ label: MSG.ctxShowInFolder, act: 'reveal', icon: CM_IC.reveal });
    items.push({ sep: true });
    items.push({ label: MSG.tipDelete, act: 'delete', icon: CM_IC.del, danger: true });
    return { items, srcUrl };
  }
  function onCardMenuPick(g, x, y, srcUrl, item) {
    const act = item.act;
    if (act === 'open') {
      if (g.rep.url) window.corpusIpc.openExternal(g.rep.url);
    } else if (act === 'newtab') {
      addImageTab(g); // background, browser-like
    } else if (act === 'folder') {
      showFoldMenu(g, x, y);
      return;
    } // opens the folder picker (bridge keeps it open)
    else if (act === 'clip') {
      const b = document.querySelector(`.clip-btn[data-clip="${viewGroups.indexOf(g)}"]`) as HTMLElement | null;
      if (b) b.click();
    } else if (act === 'info') showDetail(g);
    else if (act === 'poster') jumpToPoster(g.rep);
    else if (act === 'sauce') window.corpusIpc.openExternal('https://saucenao.com/search.php?url=' + encodeURIComponent(srcUrl));
    else if (act === 'ascii') window.corpusIpc.openExternal('https://ascii2d.net/search/url/' + encodeURIComponent(srcUrl));
    else if (act === 'reveal') {
      const file = densityImage(g.rep, currentView) || g.rep.image;
      if (file && window.corpusIpc.showInFolder) window.corpusIpc.showInFolder(file);
    } else if (act === 'delete') requestDeleteGroup(g);
  }
  function showCardMenu(g, x, y) {
    const { items, srcUrl } = cardMenuItems(g);
    window.corpusContextMenu.open({ items, x, y }, (item) => onCardMenuPick(g, x, y, srcUrl, item));
  }
  byId('postGrid').addEventListener('contextmenu', (e) => {
    const card = closestOf(e, '.post-card');
    if (!card) return;
    e.preventDefault();
    if (byId('postGrid').classList.contains('selecting')) return; // selection bar owns bulk actions
    const g = viewGroups[Number.parseInt(card.dataset.index ?? '', 10)];
    if (g) showCardMenu(g, e.clientX, e.clientY);
  });

  // Sidebar folder chips (shared folders.json): count + ★default. Like tag chips
  // they cycle 解除→いずれか(OR)→＋すべて含む(AND)→解除 and join the same
  // かつ/または expression as the tags.
  // postFolderChips was retired (collections moved to the collections view); this
  // now only keeps the clip + 複数画像 row entries in sync. Call sites keep the name.
  function renderPostFolders() {
    renderClipRow();
    renderMultiRow();
  }
  // Clip sidebar row: the library-wide flag filter. Click toggles a filter to show
  // only clipped posts; 空にする clears all flags (the posts themselves are kept).
  function renderClipRow() {
    // Clip active / count / clear-visibility are model-driven now (buildSidebarModel).
    pushSidebar();
  }
  // フォルダ管理の起動口はフライアウト下部の qf-pop フッターボタン（onManage→CF().openManager()）に統一。
  // 旧 #postFolderManage ボタンは HTML から撤去済み（デッドリスナーを削除）。
  // The クリップ row toggle + 空にする clear are handled by the delegated #filterRows
  // listener now (the rows are React-owned, so a setup-time addEventListener on a
  // specific node would miss the island's re-renders).

  // 複数画像 sidebar row: reflects the group-level multiOnly flag as the row's active
  // state (accent icon) via the model. The click that flips it is handled by the
  // delegated #filterRows listener.
  function renderMultiRow() {
    // 複数画像 active is model-driven now (buildSidebarModel).
    pushSidebar();
  }

  // Toggle a card in/out of the selection; Shift additionally selects the range
  // from the last-selected card (anchor), Google-Photos style.
  function toggleCardSelection(card, shiftKey) {
    const idx = Number.parseInt(card.dataset.index ?? '', 10);
    const key = card.dataset.key;
    window.corpusSelection.toggle(idx, key, shiftKey, viewGroups, postIdKey);
    syncSelectionClasses(); // class-only: don't rebuild the grid (was reloading every visible image)
    updateSelectionBar();
  }
  // Toggle .selecting on the grid container (viewer-owned, static). Per-card
  // .selected is no longer pushed through here — the grid island's Cell reads
  // corpusStore's 'selectedSet' directly (window.corpusSelection.toggle already
  // wrote the fresh snapshot), so it re-renders on its own the moment the store changes.
  function syncSelectionClasses() {
    byId('postGrid').classList.toggle('selecting', window.corpusSelection.size() > 0);
  }

  // ○ select ring (top-left, shown on hover) — the ONLY way INTO the selection.
  // Clicking the card body does not select while nothing is selected yet.
  byId('postGrid').addEventListener('click', (e) => {
    const ring = closestOf(e, '.select-check');
    if (!ring) return;
    e.stopPropagation();
    const card = ring.closest('.post-card');
    if (card) toggleCardSelection(card, e.shiftKey);
  });

  // Selection mode (≥1 selected): a click ANYWHERE on a card toggles it.
  // Capture phase so it pre-empts every other card action (gallery, text
  // expand, ℹ/edit/delete/📁/open) until the selection is cleared.
  byId('postGrid').addEventListener(
    'click',
    (e) => {
      if (window.corpusSelection.size() === 0) return;
      const card = closestOf(e, '.post-card');
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      toggleCardSelection(card, e.shiftKey);
    },
    true,
  );

  // Delete a card group (reached via the card context menu): confirm unless skipped.
  function requestDeleteGroup(g) {
    if (skipDeleteConfirm) {
      executeDeleteGroup(g);
      return;
    }
    window.corpusConfirm.open({
      message: g.records.length > 1 ? MSG.confirmDeleteGroup(g.records.length) : MSG.confirmDeletePost,
      okLabel: MSG.confirmOk,
      cancelLabel: MSG.confirmCancel,
      skipLabel: MSG.confirmSkip, // "次回から確認しない"
      onOk: async ({ skip }) => {
        if (skip) {
          skipDeleteConfirm = true;
          window.corpusIpc.setPref('skipDeleteConfirm', true);
        }
        await executeDeleteGroup(g);
      },
    });
  }

  // Delete every record of the group (a group IS one post in the UI).
  async function executeDeleteGroup(g) {
    if (inspectedKey && g.records.some((r) => postIdKey(r) === inspectedKey)) closeDetail();
    for (const r of g.records) {
      try {
        await window.corpusPosts.deletePost(r.image || r.video);
      } catch {
        /* keep going */
      }
      _postsById.delete(r.captureId); // optimistic removal from the delta cache
    }
    allPosts = [..._postsById.values()]; // rebuild once (O(N), not O(records×N) findIndex+splice); order is irrelevant — getFilteredPosts re-sorts
    markPostsMutated(); // a deleted author/instance must drop out of the sidebar
    renderPosts(true);
    reconcileFolders(); // 削除した captureId をフォルダから即時掃除
    renderPostFolders();
    showToast(MSG.deleted);
  }

  // === Shared 種別 (kind) menu: right-click a tag chip (edit picker / inspector /
  // poster) to classify it 作品/キャラ/一般. A tag's 種別 is the TAG's own attribute
  // (no post is touched), surfaced as a quiet 段階的開示 entry inside tag editing.
  // Rendering lives in the kind-menu React island (dedicated component — a row's
  // pick target and its rename button are two independent click targets, which the
  // generic ContextMenu item shape has no room for); this only builds the row model
  // and runs the pick/rename actions via the corpusKindMenu bridge (kind-menu.js). ===
  function showKindMenu(tag, x, y, onChanged) {
    const cur = tagKindOf(tag);
    // The work/character pair carries a quiet ✎ to rename the 種別 globally
    // (段階的開示: only here, in the tag-management kind menu).
    const row = (k, label) => ({ kind: k, label, dot: !!k, checked: (k || null) === cur, renameable: k === 'work' || k === 'character' });
    window.corpusKindMenu.open({
      x,
      y,
      header: MSG.tagKindHeader,
      renameTitle: MSG.tagKindRename,
      rows: [row('work', kindLabel('work')), row('character', kindLabel('character')), { sep: true }, row('', MSG.kindGeneral)],
      async onPick(kind) {
        if ((tagKindOf(tag) || '') === kind) return; // already that kind — no write
        await setTagKind(tag, kind);
        if (onChanged) onChanged();
        showToast(kind ? MSG.tagKindSet(kindLabel(kind)) : MSG.tagKindCleared);
      },
      async onRename(kind) {
        const next = window.prompt(MSG.tagKindRenamePrompt, kindLabel(kind));
        if (next === null) return; // cancelled (empty string = reset to default)
        await setKindLabel(kind, next);
        if (onChanged) onChanged();
        showToast(MSG.tagKindRenamed);
      },
    });
  }
  taggingApi = { showKindMenu };

  // === Inspector (ℹ on a card): persistent right column / slide-over ===
  function closeDetail() {
    byId('postDetail').hidden = true;
    window.corpusInspector.close();
    setInspectedKey(null); // grid/poster cells clear their own ring reactively (corpusStore subscribe)
    byId('postGrid').classList.remove('insp-open');
    refreshTileSlider(); // the grid width grew back — re-derive the track
  }
  function persistManual() {
    window.corpusRecords.persistManualGroups(manualGroups);
  }
  // Opt a post key out of (or back into) auto-grouping — persisted in ungrouped.json.
  function setGroupKey(key, ungroup) {
    if (!key) return;
    keepCurrentVisible(); // 複数画像のみ等のフィルタから外れても即消えしない
    if (ungroup) ungrouped.add(key);
    else ungrouped.delete(key);
    window.corpusRecords.persistUngrouped(ungrouped);
    closeDetail();
    renderPosts(true);
    if (ungroup) showToast(MSG.ungroupDone);
  }
  function ungroupManual(idx) {
    if (!(idx >= 0 && idx < manualGroups.length)) return;
    keepCurrentVisible();
    manualGroups.splice(idx, 1);
    persistManual();
    closeDetail();
    renderPosts(true);
    showToast(MSG.ungroupDone);
  }
  // --- Inspector inline tag editor (always available while the inspector is open) ---
  // Source of truth = the records' real tags. Each change saves immediately (mirrors
  // adoptSourceTag) and refreshes only the tag fields of the corpusInspector model (not
  // a full re-open) — the React tag editor keeps its own input text/focus and scroll
  // across a refresh (same openId). The chips + picker live in the panel itself — tag
  // editing is per-card here, no mode to enter (matches the poster inspector).
  // sameTags moved to tags.js (window.corpusTags.sameTags).

  // inspectorTagPickerData moved to tags.js (corpusTags wiring above).

  function refreshInspectorTagFields(g) {
    if (!g) return;
    const tags = Array.isArray(g.rep.tags) ? g.rep.tags : [];
    const userSet = new Set(tags);
    const srcTagsView = (Array.isArray(g.rep.hashtags) ? g.rep.hashtags : []).filter((h) => !userSet.has(h));
    window.corpusInspector.refresh({ tags, srcTagsView, ...inspectorTagPickerData(tags, g.records, 'post') });
  }

  // Apply a tag mutation to every record of the inspected group, persist immediately,
  // record undo, and refresh grid + inspector tag fields (NOT a full showDetail — so the
  // image/meta don't flicker and the input keeps focus).
  async function applyInspectorTagChange(g, mutate) {
    if (!g) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    keepCurrentVisible(); // removing a tag can un-match an active tag filter
    const undoRecords: CorpusUndoRecord[] = [];
    for (const r of recs) {
      const prev = (r.tags || []).slice();
      const next = mutate(prev.slice());
      if (!next || sameTags(prev, next)) continue;
      try {
        await window.corpusPosts.updateTags(r.image || r.video, next);
      } catch {
        /* keep going */
      }
      const rec = _postsById.get(r.captureId); // O(1) lookup; allPosts shares the same record refs
      if (rec) rec.tags = next.slice();
      undoRecords.push({ captureId: r.captureId, image: r.image || r.video, prevTags: prev, newTags: next });
    }
    if (!undoRecords.length) return;
    pushUndo('tags', undoRecords);
    markPostsMutated();
    renderPosts(true);
    const fresh = viewGroups.find((g2) => postIdKey(g2.rep) === inspectedKey);
    if (fresh) refreshInspectorTagFields(fresh);
  }

  // Add (typed input / picker click) or toggle (picker click only) a tag on the
  // inspected group, then check for a 同名キャラ homonym ONLY when the tag was newly
  // added (matches the old setupInspectorTagEditor's addTyped / picker-pick handlers).
  async function addInspectorTag(g, tag) {
    const fresh = () => viewGroups.find((gg) => postIdKey(gg.rep) === inspectedKey) || g;
    const adding = !(fresh().rep.tags || []).includes(tag);
    await applyInspectorTagChange(fresh(), (prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    if (adding) await maybeDistinguishHomonym(fresh(), tag);
  }
  async function toggleInspectorTag(g, tag) {
    const fresh = () => viewGroups.find((gg) => postIdKey(gg.rep) === inspectedKey) || g;
    const adding = !(fresh().rep.tags || []).includes(tag);
    await applyInspectorTagChange(fresh(), (prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
    if (adding) await maybeDistinguishHomonym(fresh(), tag);
  }

  // When a キャラ tag joins a 作品-bearing card whose 作品 differs from every 作品
  // this character was seen with before, it's likely a same-name character from
  // another work. Offer the danbooru-style freeform distinction キャラ（作品）.
  // Deterministic + confirm-gated + silent until there's history (薄いうちは沈黙).
  async function maybeDistinguishHomonym(g, addedTag) {
    if (!g || tagKindOf(addedTag) !== 'character') return;
    const cardTags = g.rep && Array.isArray(g.rep.tags) ? g.rep.tags : [];
    const worksNow = cardTags.filter((t) => tagKindOf(t) === 'work');
    if (!worksNow.length) return; // no 作品 context to distinguish by
    const exclude = new Set<string>((g.records || [g.rep]).map((r) => r && r.captureId).filter(Boolean));
    const past = worksCooccurringWith(addedTag, exclude);
    if (!past.size) return; // no history → stay silent
    if (worksNow.some((w) => past.has(w))) return; // seen with one of these works → same character
    const work = worksNow[0];
    const distinguished = `${addedTag}（${work}）`;
    if (cardTags.includes(distinguished)) return;
    if (!window.confirm(MSG.homonymConfirm(addedTag, work))) return;
    // The distinguished string stays a character (danbooru-style); record its 種別.
    if (!tagKindOf(distinguished)) {
      await window.corpusTags.setTagKind(distinguished, 'character');
    }
    await applyInspectorTagChange(g, (prev) => prev.map((t) => (t === addedTag ? distinguished : t)));
    updateSidebarTags();
    showToast(MSG.homonymDistinguished(distinguished));
  }

  function showDetail(g) {
    if (!g) return;
    const p = g.rep;
    const eng: string[] = [];
    if (p.likes != null) eng.push('♡ ' + formatCount(p.likes));
    if (p.reposts != null) eng.push('⇄ ' + formatCount(p.reposts));
    if (p.replies != null) eng.push('🗨︎ ' + formatCount(p.replies));
    if (p.bookmarks != null) eng.push('🔖︎ ' + formatCount(p.bookmarks));
    if (p.views != null) eng.push('👁︎ ' + formatCount(p.views));
    // Source tags (pixiv / SNS hashtags) get their own row. User tags live in the
    // always-editable chips block (TagEditor) so they aren't repeated here. Source
    // tags already adopted into `tags` are hidden; the rest are clickable to adopt.
    const userTags = Array.isArray(p.tags) ? p.tags : [];
    const userSet = new Set(userTags);
    const srcTagsView = (Array.isArray(p.hashtags) ? p.hashtags : []).filter((h) => !userSet.has(h));
    // Poster row carries the locally-saved avatar (psimg://) when present, so the
    // inspector keeps its "label: value" rhythm while adding a face to the name.
    const avatarSrc = p.avatarFile ? fileSrc(p.avatarFile) : null;
    // The poster exists in the poster view only for SNS posts (buildUsers skips url-less
    // migrations); when it does, the name+avatar links to it (双方向ナビ: posts ↔ posters).
    const jumpUser = p.url ? buildUsers().find((u) => u.key === userKey(p)) : null;
    const heading = p.title || p.text || '';
    const thumbFile = g.files[0] || captureFile(p);
    // Reverse image search needs a PUBLIC image URL. media[].url keeps the
    // original CDN URL (pbs.twimg.com / cdn.bsky.app / instance media / pximg);
    // a screenshot-only post has none, so the search links are hidden then.
    // pixiv (i.pximg.net) is referer-gated so the fetcher may 403 — but pixiv
    // IS the source, so reverse search there is moot anyway.
    const srcImageUrl = (g.records.flatMap((r) => (Array.isArray(r.media) ? r.media : [])).find((m) => m && m.url) || {}).url || '';
    // Can this card be (un)grouped? Manual groups get a dissolve link; auto groups
    // (same post URL with siblings) toggle via the persisted ungrouped set.
    const gkey = postKeyOf(p.url);
    const potential = gkey ? allPosts.filter((q) => postKeyOf(q.url) === gkey).length : 0;
    const isManual = !!(g.key && String(g.key).indexOf('manual:') === 0);
    // ✂ also for reply-merged chains (records with DIFFERENT urls): opting the
    // rep's key out stops the self-reply merge at this parent, splitting the card.
    const groupBtn = isManual
      ? { icon: '🔗', label: MSG.groupUngroupManual, onClick: () => ungroupManual(Number.parseInt(String(g.key).split(':')[1], 10)) }
      : gkey && (potential > 1 || g.records.length > 1)
        ? ungrouped.has(gkey)
          ? { icon: '🔗', label: MSG.groupRegroup, onClick: () => setGroupKey(gkey, false) }
          : { icon: '✂', label: MSG.groupUngroup, onClick: () => setGroupKey(gkey, true) }
        : null;
    window.corpusInspector.open({
      kind: 'post',
      heading,
      thumbSrc: thumbFile ? fileSrc(thumbFile, 480) : null,
      platformLabel: (p.platform || '').toUpperCase(),
      avatarSrc,
      authorName: p.displayName || '',
      jumpable: !!jumpUser,
      screenNameLabel: p.screenName ? '@' + p.screenName : '',
      followersLabel: p.followers != null ? formatCount(p.followers) : '',
      joinedLabel: localeDate(p.authorCreatedAt),
      engagementLabel: eng.join('   '),
      postedLabel: localeDateTime(p.date),
      savedLabel: localeDateTime(p.capturedAt),
      updatedLabel: localeDateTime(p.updatedAt),
      imagesLabel: g.files.length > 1 ? MSG.imagesCount(g.files.length) : '',
      imageOfLabel: p.imageIndex && p.imageCount ? MSG.imageOf(p.imageIndex, p.imageCount) : '',
      tags: userTags,
      srcTagsView,
      groupBtn,
      ...inspectorTagPickerData(userTags, g.records, 'post'),
      labels: {
        platform: MSG.detailPlatform,
        author: MSG.detailAuthor,
        user: MSG.detailUser,
        followers: MSG.detailFollowers,
        joined: MSG.detailJoined,
        engagement: MSG.detailEngagement,
        posted: MSG.detailPosted,
        saved: MSG.detailSaved,
        updated: MSG.detailUpdated,
        images: MSG.detailImages,
        imageOf: MSG.detailImageOf,
        sourceTags: MSG.detailSourceTags,
        tipAdoptTag: MSG.tipAdoptTag,
        viewPoster: MSG.ctxViewPoster,
        open: MSG.detailOpen,
        sauce: MSG.detailSauce,
        ascii: MSG.detailAscii,
      },
      tagLabels: {
        tagsLabel: MSG.detailTags,
        newTagPlaceholder: MSG.tagNewName,
        addBtn: MSG.tagAddBtn,
        noTags: MSG.editNoTags,
        noMatch: MSG.tagPalNoMatch,
        noVocab: MSG.tagNoTags,
        adoptSource: MSG.editAdoptSource,
      },
      onClose: closeDetail,
      onOpenExternal: p.url ? () => window.corpusIpc.openExternal(p.url) : null,
      onSauce: srcImageUrl ? () => window.corpusIpc.openExternal('https://saucenao.com/search.php?url=' + encodeURIComponent(srcImageUrl)) : null,
      onAscii: srcImageUrl ? () => window.corpusIpc.openExternal('https://ascii2d.net/search/url/' + encodeURIComponent(srcImageUrl)) : null,
      onPosterJump: jumpUser ? () => jumpToPoster(p) : null,
      onAdoptSourceTag: (tag) => adoptSourceTag(g, tag),
      onTagAdd: (tag) => addInspectorTag(g, tag),
      onTagRemove: (tag) => applyInspectorTagChange(g, (prev) => prev.filter((t) => t !== tag)),
      onTagToggle: (tag) => toggleInspectorTag(g, tag),
      onTagContextMenu: (tag, x, y) => {
        if (taggingApi && taggingApi.showKindMenu) {
          taggingApi.showKindMenu(tag, x, y, () => {
            const g2 = viewGroups.find((gg) => postIdKey(gg.rep) === inspectedKey);
            if (g2) refreshInspectorTagFields(g2);
          });
        }
      },
    });
    byId('postDetail').hidden = false;
    // While open, a card click swaps the panel (not zoom) → plain pointer.
    byId('postGrid').classList.add('insp-open');
    // Ring-mark the inspected card so swapping content stays traceable — the grid
    // cell derives its own ring reactively (corpusStore subscribe), so no manual
    // DOM classList reach-in / repaint() is needed here.
    setInspectedKey(postIdKey(p));
    refreshTileSlider(); // inline column narrows the grid — re-derive the track
  }

  // Promote a source tag (pixiv / SNS hashtag) into a user tag on every record of
  // the inspected group. Persisted + undoable, mirroring the edit overlay's save.
  async function adoptSourceTag(g, tag) {
    if (!tag) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    const undoRecords: CorpusUndoRecord[] = [];
    for (const r of recs) {
      const prev = (r.tags || []).slice();
      if (prev.includes(tag)) continue;
      const newTags = [...prev, tag];
      try {
        await window.corpusPosts.updateTags(r.image || r.video, newTags);
      } catch {
        /* keep going */
      }
      const rec = _postsById.get(r.captureId); // O(1) lookup; allPosts shares the same record refs
      if (rec) rec.tags = newTags.slice();
      undoRecords.push({ captureId: r.captureId, image: r.image || r.video, prevTags: prev, newTags });
    }
    if (!undoRecords.length) return; // all records already had it
    pushUndo('tags', undoRecords);
    markPostsMutated();
    renderPosts(true);
    const fresh = viewGroups.find((g2) => postIdKey(g2.rep) === inspectedKey);
    if (fresh) showDetail(fresh);
    showToast(MSG.tagAdopted(tag));
  }
  // Esc closes the inspector — registered in CAPTURE phase so it can check
  // what else is open BEFORE those handlers dismiss themselves on the same
  // press (lightbox/popovers/modals win the first Esc, the panel the next).
  // Registration lives in the DetailDismiss component (app/islands/app/App.tsx);
  // this stays the handler + guard logic (viewer keeps the orchestration).
  function handleEscDismissDetail(e) {
    if (e.key !== 'Escape') return;
    const inImageTab = imageTabShowing;
    if (byId('postDetail').hidden && !inImageTab) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (window.corpusLightbox && window.corpusLightbox.isOpen()) return;
    if (window.corpusSettings && window.corpusSettings.isOpen()) return;
    if (!byId('ivFolderModal').hidden) return;
    if (document.querySelector('.confirm-overlay.show')) return;
    if (document.querySelector('.fold-menu.show')) return;
    if (window.corpusFilterPopover.get()) return;
    if (inImageTab) {
      closeTab(activeTabId); // Esc leaves the detail view (Eagle-style) — the inspector is part of it
      return;
    }
    closeDetail();
  }
  // Slide-over mode (narrow window): the panel covers the grid, so it acts
  // like a scrim-less drawer — ANY click outside it inside the content area
  // (cards and grid included) dismisses it, and the click is consumed so the
  // card doesn't also react on the same press. ℹ buttons stay live as the
  // explicit "show this one instead" entry. Inline mode (wide) keeps clicks:
  // cards swap the content there since the panel covers nothing. Also
  // registered from DetailDismiss, in CAPTURE phase like the Esc handler above.
  function handleOutsideClickDismissDetail(e) {
    const insp = byId('postDetail');
    if (insp.hidden) return;
    if (!matchMedia('(max-width: 1279px)').matches) return;
    if (insp.contains(e.target as Node | null)) return;
    if (!closestOf(e, '#mode-post')) return; // sidebar/overlays: leave it open
    if (closestOf(e, '.info-btn, .tag-btn')) return; // ℹ/🏷 = swap to that card
    if (closestOf(e, '.poster-card')) return; // poster click = go to that poster's posts
    e.preventDefault();
    e.stopPropagation();
    closeDetail();
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleEscDismissDetail, handleOutsideClickDismissDetail });
  // ℹ button on card → detail popup (re-click same card toggles close)
  byId('postGrid').addEventListener('click', (e) => {
    const btn = closestOf(e, '.info-btn');
    if (!btn) return;
    e.stopPropagation();
    const g = viewGroups[Number.parseInt(btn.dataset.info ?? '', 10)];
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
    const g = viewGroups[Number.parseInt(btn.dataset.tagedit ?? '', 10)];
    if (!g) return;
    showDetail(g);
  });

  // --- Edit overlay logic (bulk "add tags to selection") ---
  // The staging list itself (selected records / tags-in-progress / additive flag)
  // lives in corpusBulkEdit (renderer/bulk-edit.ts) — nothing persists until Save
  // (see openTagSelectedOverlay/onSave below) writes it out.

  // groupedTagVocab moved to tags.js (corpusTags wiring above).

  // Recompute the bulk edit modal's tag fields (chips + picker vocab/cooc) after a
  // staging-list mutation. Not persisted yet — Save (see openTagSelectedOverlay below) is
  // the only thing that writes the staged tags out to the records.
  function refreshEditOverlayFields() {
    const tags = window.corpusBulkEdit.getTags();
    window.corpusEditOverlay.refresh({ tags, ...inspectorTagPickerData(tags, window.corpusBulkEdit.getRecords(), 'post') });
  }

  function closeEditOverlay() {
    window.corpusBulkEdit.close();
    byId('editOverlay').classList.remove('show');
    window.corpusEditOverlay.close();
  }

  // Modal chrome (lock background scroll + darken the native titlebar while any
  // full-screen overlay is up) moved to the ModalChrome hook in app/islands/app/App.tsx
  // — same observe-each-overlay logic, just registered by React instead of this IIFE.

  // Inspector inline tag editors (post ivTag* / poster pdTag*) are now the React
  // TagEditor component inside the corpusInspector island — it owns its own input/
  // click/contextmenu handling directly via the callbacks in the model (see
  // showDetail/showPosterDetail), so no delegated #postDetail listeners are needed.

  // Background click (outside the box) cancels, same as editCancel/onCancel below.
  byId('editOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditOverlay();
  });

  // --- Selection (click a card to select; the bar appears when 1+ are selected) ---
  // #selectionBar buttons + count are React-owned now (the selection-bar island renders
  // them from updateSelectionBar's model via window.corpusSelectionBar). viewer keeps the
  // container (show/hide) and this ONE delegated click handler that dispatches by data-act
  // — the island reproduces the button IDs so scripts/_verify-select.js's
  // getElementById(...).click() still bubbles here.
  const selectionBar = byId('selectionBar');
  selectionBar.addEventListener('click', (e) => {
    const btn = closestOf(e, '[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'selectAll':
        toggleSelectAll();
        break;
      case 'tag':
        openTagSelectedOverlay();
        break;
      case 'folder': {
        // フォルダに追加: open the folder picker for the whole selection (no default
        // folder anymore — you choose the destination, same as a card's 📁).
        if (!CF()) return;
        e.stopPropagation(); // don't let the document outside-click handler close the menu we're opening
        const recs = selectedRecords();
        const ids = recs.map((r) => r.captureId).filter(Boolean);
        if (!ids.length) return;
        const r = btn.getBoundingClientRect();
        showFoldMenu({ rep: { captureId: ids[0] }, records: recs }, r.left, r.bottom + 4);
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
  });

  // Every record of every selected group (bulk actions operate on records).
  function selectedRecords() {
    return window.corpusSelection.selectedRecords(viewGroups, postIdKey);
  }

  // タグを追加: reuse the edit overlay in ADDITIVE mode — entered tags are
  // merged into each selected record's existing tags (nothing is replaced).
  function openTagSelectedOverlay() {
    const records = selectedRecords();
    if (!records.length) return;
    window.corpusBulkEdit.open(records);
    const tags = window.corpusBulkEdit.getTags();
    window.corpusEditOverlay.open({
      titleLabel: MSG.tagSelectedTitle,
      tags,
      ...inspectorTagPickerData(tags, records, 'post'),
      tagLabels: {
        tagsLabel: MSG.detailTags,
        newTagPlaceholder: MSG.tagNewName,
        addBtn: MSG.tagAddBtn,
        noTags: MSG.editNoTags,
        noMatch: MSG.tagPalNoMatch,
        noVocab: MSG.tagNoTags,
        adoptSource: MSG.editAdoptSource,
      },
      cancelLabel: MSG.confirmCancel,
      saveLabel: MSG.save,
      onCancel: closeEditOverlay,
      onTagAdd: (tag) => {
        window.corpusBulkEdit.add(tag);
        refreshEditOverlayFields();
      },
      onTagRemove: (tag) => {
        window.corpusBulkEdit.remove(tag);
        refreshEditOverlayFields();
      },
      onTagToggle: (tag) => {
        window.corpusBulkEdit.toggle(tag);
        refreshEditOverlayFields();
      },
      onTagContextMenu: (tag, x, y) => {
        if (taggingApi && taggingApi.showKindMenu) taggingApi.showKindMenu(tag, x, y, refreshEditOverlayFields);
      },
      onSave: async () => {
        const editingRecords = window.corpusBulkEdit.getRecords();
        if (!editingRecords.length) {
          closeEditOverlay();
          return;
        }
        keepCurrentVisible(); // removing a tag can un-match an active tag filter
        const tags = [...window.corpusBulkEdit.getTags()];
        const editAdditive = window.corpusBulkEdit.isAdditive();
        // Capture before-state for undo, then persist.
        const undoRecords = editingRecords.map((r) => {
          const newTags = editAdditive ? [...new Set([...(r.tags || []), ...tags])] : tags.slice();
          return { captureId: r.captureId, image: r.image || r.video, prevTags: (r.tags || []).slice(), newTags };
        });
        for (const u of undoRecords) {
          try {
            await window.corpusPosts.updateTags(u.image, u.newTags);
          } catch {
            /* keep going */
          }
          const rec = _postsById.get(u.captureId); // O(1) lookup; allPosts shares the same record refs
          if (rec) rec.tags = u.newTags.slice();
        }
        pushUndo('tags', undoRecords);
        markPostsMutated();
        renderPosts(true); // keepLimit: selection (if any) stays put, no anim replay
        const n = editingRecords.length;
        closeEditOverlay();
        showToast(n > 1 ? MSG.tagsSavedN(n) : MSG.tagsSaved);
      },
    });
    byId('editOverlay').classList.add('show');
  }

  function clearSelection() {
    window.corpusSelection.clear();
    syncSelectionClasses(); // class-only (callers that change content re-render themselves)
    updateSelectionBar();
  }

  // Build the #selectionBar model (labels / count / disabled) and push it to the island.
  // The container show/hide stays viewer's — React owns only the children. Every
  // window.corpusSelection mutation site ends by calling this to keep the bar's
  // labels/counts in sync (the 'selectedSet' corpusStore key itself is already
  // fresh by the time this runs — corpusSelection's mutators write it directly).
  function updateSelectionBar() {
    const count = window.corpusSelection.size();
    selectionBar.style.display = count > 0 ? '' : 'none';
    const allSelected = window.corpusSelection.isAllSelected(viewGroups, postIdKey);
    window.corpusSelectionBar.render({
      count,
      countLabel: MSG.selectedCount(count),
      selectAllLabel: allSelected ? MSG.deselectAll : MSG.selectAll,
      // Manual grouping needs at least two selected cards (groups).
      groupDisabled: window.corpusSelection.selectedGroups(viewGroups, postIdKey).length < 2,
      deleteDisabled: count === 0,
      labels: {
        tag: MSG.tagSelected,
        folder: MSG.folderSelected,
        group: MSG.groupSelected,
        delete: MSG.deleteSelected,
        cancel: MSG.cancelSelect,
      },
    });
  }

  // Manual grouping: merge every record of the selected cards into one persisted
  // group (manual-groups.json). Members are first removed from any existing
  // manual group so a record never belongs to two groups.
  function groupSelected() {
    const members = window.corpusSelection.selectedGroups(viewGroups, postIdKey).flatMap((g) => g.records.map((r) => r.captureId).filter(Boolean));
    if (members.length < 2) return;
    manualGroups = manualGroups.map((grp) => grp.filter((c) => !members.includes(c))).filter((grp) => grp.length > 1);
    manualGroups.push(members);
    persistManual();
    markPostsMutated(); // grouping changed viewGroups: bump the generation so the load-more group cache + fast-path both rebuild
    // Grouping changed viewGroups → a real re-render is needed (clearSelection is now
    // class-only). Clear first so the rebuild shows no stale selection.
    window.corpusSelection.clear();
    renderPosts(true);
    updateSelectionBar();
    showToast(MSG.grouped);
  }

  function toggleSelectAll() {
    window.corpusSelection.toggleAll(viewGroups, postIdKey);
    syncSelectionClasses();
    updateSelectionBar();
  }

  // Ctrl/Cmd+A selects every visible (filtered) card. Left to the browser when
  // typing in a field or when a modal/overlay is open (native select-all there).
  // Registration lives in the useGlobalShortcuts hook (app/islands/app/App.tsx).
  function handleShortcutSelectAllKey(e) {
    if (!(e.ctrlKey || e.metaKey) || (e.key || '').toLowerCase() !== 'a') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('.confirm-overlay.show') || (window.corpusLightbox && window.corpusLightbox.isOpen())) return;
    if (window.corpusSettings && window.corpusSettings.isOpen()) return;
    if (!byId('ivFolderModal').hidden) return;
    if (browseMode !== 'posts') return; // select-all is post-grid only (posters/collections excluded)
    if (viewGroups.length === 0) return;
    e.preventDefault();
    window.corpusSelection.selectAll(viewGroups, postIdKey);
    renderPosts(true);
    updateSelectionBar();
  }

  // `/` or Ctrl/Cmd+K focuses the search box (standard library-app shortcut).
  // Same guards as Ctrl+A: never steal keys from fields or open overlays.
  function handleShortcutSearchFocusKey(e) {
    const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
    const ctrlK = (e.ctrlKey || e.metaKey) && !e.altKey && (e.key || '').toLowerCase() === 'k';
    if (!slash && !ctrlK) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('.confirm-overlay.show') || (window.corpusLightbox && window.corpusLightbox.isOpen())) return;
    if (window.corpusSettings && window.corpusSettings.isOpen()) return;
    if (!byId('ivFolderModal').hidden) return;
    e.preventDefault();
    const sb = document.getElementById('searchBox') as HTMLInputElement | null; // the searchbox island's Input (id preserved)
    if (!sb) return; // island not mounted yet (sub-second boot window)
    sb.focus();
    sb.select();
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleShortcutSelectAllKey, handleShortcutSearchFocusKey });

  function requestDeleteSelected() {
    if (window.corpusSelection.size() === 0) return;
    window.corpusConfirm.open({
      message: MSG.confirmDeleteSelected(window.corpusSelection.size()),
      okLabel: MSG.confirmOk,
      cancelLabel: MSG.confirmCancel,
      onOk: async () => {
        // Bulk delete selected groups — every record of each selected group.
        const toDelete = window.corpusSelection.selectedRecords(viewGroups, postIdKey);
        const count = toDelete.length;
        for (const p of toDelete) await window.corpusPosts.deletePost(p.image || p.video);
        window.corpusSelection.clear();
        updateSelectionBar();
        await loadPosts(true);
        showToast(MSG.deletedN(count));
      },
    });
  }

  // Deferred-render timers so a view/layout switch paints the segment (thumb + active)
  // FIRST, then runs the heavy grid render past a paint (optimistic UI). clearTimeout
  // collapses rapid clicks to a single render.
  let _browseRenderT: any = null,
    _densityRenderT: any = null,
    _posterDensityRenderT: any = null;
  // #densityToggle is rendered by the toolbar island (window.corpusStore 'view').
  // React owns the active state + glass thumb; viewer reacts to a view change:
  // mirror it into currentView, persist it, and re-render the grid (deferred past a
  // paint with a view transition, like the old optimistic handler). The idempotent
  // guard skips the no-op set from pref restore below, so the loop stays one-way.
  // Subscribe registration lives in React (StoreSubscriptions, App.tsx) via
  // window.corpusViewer below; this stays the guard + action logic.
  function handleViewStoreChange() {
    const v = window.corpusStore.get('view');
    if (v === currentView) return;
    currentView = v;
    window.corpusIpc.setPref('viewMode', currentView);
    clearTimeout(_densityRenderT);
    _densityRenderT = setTimeout(() => {
      if (document.startViewTransition && !prefersReducedMotion()) document.startViewTransition(() => renderPosts());
      else renderPosts();
    }, 0);
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleViewStoreChange });

  // === Browse-mode toggle: 投稿グリッド ↔ 投稿者グリッド ===
  // Switches the content area between the post grid and the poster grid (same tab).
  // A semantic "what am I browsing" switch — distinct from the card/tile/list density.
  function setBrowseMode(mode, opts?) {
    mode = mode === 'posters' ? 'posters' : 'posts'; // collections retired (now a sidebar folder list)
    posterReturn = null; // an explicit mode switch ends any pending poster-return
    browseMode = mode;
    // Mirror into the store so the React islands (BrowseToggle active/thumb, SectionTitle's
    // "ビュー · …" suffix) reflect the mode even when we got here from an INTERNAL setter
    // (jumpToPoster / openPosterPosts / openCollection / the filter-reset bounce) rather
    // than a toggle click. Safe against recursion: the store's set is value-guarded, and
    // when the click path drove us the value is already equal (no-op); when an internal
    // setter drove us, browseMode === mode by now so the subscribe handler's guard skips.
    window.corpusStore.set('browseMode', mode);
    // The active state + glass thumb AND body.browse-posters (CSS hides the inactive grid)
    // are React-owned now — the BrowseToggle island / App's ShellClasses both react to this
    // corpusStore 'browseMode' change (ShellClasses toggles the body class in a
    // useLayoutEffect, before paint = no flash). We only run the heavy switch below.
    // (Changing which toolbars are visible shifts the sidebar width → the toggle's geometry;
    // the island's ResizeObserver re-slides its own thumb, so there is nothing to measure here.)
    closeDetail(); // a stale post/poster detail shouldn't survive the switch
    if (!(opts && opts.silent)) window.corpusIpc.setPref('browseMode', mode);
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
  // #browseToggle is rendered by the toolbar island (window.corpusStore 'browseMode').
  // React owns the active state + glass thumb; viewer reacts to a mode change by running
  // the heavy switch. The idempotent guard skips the no-op set from the pref restore
  // below, so the loop stays one-way (island → store → viewer, never back). Subscribe
  // registration lives in React (StoreSubscriptions, App.tsx) via window.corpusViewer
  // below; this stays the guard + action logic.
  function handleBrowseModeStoreChange() {
    const m = window.corpusStore.get('browseMode');
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
  let posterList: CorpusUserAgg[] = [];
  // posterSort ('count' | 'name' | 'date-desc' | 'date-asc') lives in corpusStore
  // 'sortPoster' now (read via the listing dep getter above); a subscription below
  // re-renders on change, replacing the old #posterSortSelect DOM-'change' listener.
  // Poster grid density — kept SEPARATE from the post-side currentView (its masonry /
  // tile / list layouts are bound to post-card markup). Tile view leads with avatars.
  let posterView = 'card'; // 'card' | 'tile' | 'list'
  let posterTileSize = 132; // tile view: avatar tile edge px
  let posterCardSize = 200; // card view: min column width px
  const PTILE_MIN = 96,
    PTILE_MAX = 220;
  const PCARD_MIN = 150,
    PCARD_MAX = 340;
  // Which size the slider drives, per density (mirrors the post viewSizeState).
  // The size feeds masonic's columnWidth (minimum — columns stretch to fill, the
  // same math as the old CSS auto-fill minmax); list is a full-width stack with
  // no size axis, so it returns null (slider hidden).
  function posterSizeState() {
    if (posterView === 'tile')
      return {
        get: () => posterTileSize,
        set: (v) => {
          posterTileSize = v;
        },
        min: PTILE_MIN,
        max: PTILE_MAX,
        pref: 'posterTileSize',
      };
    if (posterView === 'card')
      return {
        get: () => posterCardSize,
        set: (v) => {
          posterCardSize = v;
        },
        min: PCARD_MIN,
        max: PCARD_MAX,
        pref: 'posterCardSize',
      };
    return null;
  }
  // The slider track maps to COLUMN COUNTS (like the post tile slider), not raw px:
  // the auto-fill minmax(size,1fr) grid stretches columns, so changing the min only
  // moves the layout at column-count thresholds. Mapping each detent to one column
  // count makes every step visible (no dead zones). Right = larger = fewer columns.
  function posterGridMetrics() {
    const grid = byId('posterGrid');
    if (!grid) return null;
    const W = Math.floor(grid.getBoundingClientRect().width);
    if (!W) return null;
    // Gutters live in the masonic model now (pushPosterModel), not container CSS —
    // keep this math in lockstep with the rowGutter pushed there.
    return { W, g: posterView === 'tile' ? 10 : 14 };
  }
  function refreshPosterSlider() {
    const sl = inputById('posterTileSlider');
    const row = document.getElementById('posterTileSizeRow');
    if (!sl) return;
    const st = posterSizeState();
    if (!st) {
      if (row) row.style.display = 'none';
      return;
    }
    const m = posterGridMetrics();
    if (!m) return;
    const tr = sliderTrack({ min: st.min, max: st.max, size: st.get() }, m);
    if (row) row.style.display = tr.single ? 'none' : 'flex'; // single stop conveys nothing → hide
    sl.step = '1';
    sl.min = String(tr.nBig);
    sl.max = String(tr.nSmall);
    sl.value = String(tr.value); // inverted: right = larger
  }
  // Poster grid density (card / tile / list) — rendered by the toolbar island
  // (window.corpusStore 'posterView'). React owns the active state + glass thumb;
  // viewer reacts to a change: mirror it into posterView, persist it, and re-render
  // the poster grid (deferred past a paint, like the old optimistic handler).
  // renderPosters re-applies the layout classes and refreshes the size slider. The
  // idempotent guard skips the no-op set from pref restore below. Subscribe
  // registration lives in React (StoreSubscriptions, App.tsx) via window.corpusViewer
  // below; this stays the guard + action logic.
  function handlePosterViewStoreChange() {
    const v = window.corpusStore.get('posterView');
    if (v === posterView) return;
    posterView = v;
    window.corpusIpc.setPref('posterViewMode', posterView);
    clearTimeout(_posterDensityRenderT);
    _posterDensityRenderT = setTimeout(() => renderPosters(), 0);
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handlePosterViewStoreChange });
  (function setupPosterSizeSlider() {
    const sl = inputById('posterTileSlider');
    if (!sl) return;
    sl.addEventListener('input', () => {
      const st = posterSizeState();
      const m = posterGridMetrics();
      if (!st || !m) return;
      const n = trackCols(Number.parseInt(sl.value, 10), Number.parseInt(sl.min, 10), Number.parseInt(sl.max, 10)); // un-invert → target column count
      const size = Math.max(st.min, Math.min(st.max, sizeFor(n, m)));
      st.set(size);
      // Mirror into corpusStore (P4-B slice⑫) — the poster grid source derives
      // columnWidth from it, same as the post grid does with cardSize/tileSize.
      // Unlike the post slider there's no separate mid-drag/commit split here (this
      // handler already commits corpusIpc.setPref on every 'input' tick below), so
      // writing the store on every tick too costs nothing extra — masonic still
      // recreates its positioner on the resulting columnWidth change either way.
      window.corpusStore.set(st.pref, size);
      window.corpusIpc.setPref(st.pref, size);
    });
  })();
  // The column counts depend on the grid width — re-derive the track on resize.
  window.addEventListener(
    'resize',
    () => {
      if (browseMode === 'posters') refreshPosterSlider();
    },
    { passive: true },
  );
  let posterWorkGroups: any[] = []; // recent works shown in the poster inspector
  // Per-poster tags (persisted poster-tags.json): { posterKey: [tag, …] }. Shares
  // the post tag vocabulary but is keyed by poster, NOT stored on the posts.
  // Owned by tags.js now (P4 "状態→store" tags slice) — posterTagsOf/
  // posterFilterVocab/setPosterTags/applyPosterTagRecords moved to tags.js
  // (corpusTags wiring above).
  // Poster browse filters (platform / tag / instance / folder / date範囲) live
  // in the posterQB query tree (createQueryBuilder + posterPredOf), not separate Sets.

  // --- Named poster folders (poster view) — { id, name, items:[posterKey] } ---
  // Reuses the shared folder-list store (folders.js createPersistedFolderStore) so the
  // CRUD/id-minting/toggle/persist/load logic isn't reimplemented; only the
  // view-specific toast/re-render live here.
  const pfStore = window.corpusPosterFolderStore();
  const posterFolderById = pfStore.byId;
  const posterFolderHas = pfStore.has;
  function createPosterFolder(name) {
    return pfStore.create(name);
  }
  function deletePosterFolder(id) {
    pfStore.remove(id);
    posterQB.removeByLeaf('folder', id); // drop the filter leaf if its folder is gone
  }
  function togglePosterFolderMember(id, key) {
    const res = pfStore.toggleIn(id, key);
    if (!res) return false;
    const f = posterFolderById(id);
    showToast((res === 'removed' ? MSG.posterFolderRemoved : MSG.posterFolderAdded)(f?.name ?? ''));
    renderPosterFilterRows(); // folder badge count changed
    if (treeLeaves(posterQB.getTree()).some((c) => c.type === 'folder')) renderPosters(); // membership change may add/remove from the filtered grid
    return res === 'added';
  }
  // --- Poster query builder: the SAME drag builder (createQueryBuilder), evaluated
  // against poster (user) objects instead of posts. Leaf types: platform / instance /
  // tag(作品/キャラ含む) / folder / date(範囲). The bar lives in
  // #posterActiveBar; sidebar rows are the entry points (like #filterRows for posts). ---
  // Poster leaf predicate — extracted to query.js (makePosterPredOf), the mirror
  // of postPredOf above. posterTagsOf (tags.js) and posterFolderById (pfStore)
  // are both declared above, so a direct ref is TDZ-safe. posterFilterLabel now
  // lives in tab-state.js's makeTabLabels (destructured near filterLabel).
  const posterPredOf = window.corpusQuery.makePosterPredOf({
    posterTagsOf,
    folderById: posterFolderById,
  });
  let editingPosterDateNode: CorpusQueryLeaf | null = null; // the date leaf being edited via the popover (null = new)
  // The poster-side builder instance. transient (no tabs / nav history for posters);
  // onChange → renderPosters (which redraws the rows + bar + grid). P4-B slice⑧:
  // this used to also mirror the tree shadow into a module-level `posterShadow`
  // global via onShadow — that global had zero readers (buildPosterSidebarModel
  // already called posterQB.shadow() directly), so it's removed outright rather
  // than converted to a read site.
  const posterQB = createQueryBuilder({
    msg: qbMsg,
    container: document.getElementById('posterQueryChips'),
    storeKey: 'posterQueryTree',
    barEl: document.getElementById('posterActiveBar'), // reveal + --activebar-h measure (empty/reset are the island's)
    predOf: posterPredOf,
    labelOf: posterFilterLabel,
    glyphOf: qcGlyph,
    getSearchVal: () => searchQuery(),
    onClearSearch: () => {
      setSearchBoxValue('');
      renderPosters();
    },
    onChange: () => {
      renderPosters();
    },
    openLeafEditor: (n) => {
      if (n.type === 'date') openPosterDatePopover(n);
    },
    editableLeafTypes: ['date'],
    singleValueTypes: ['date', 'folder'], // 択一: 1つ選ぶと既存を置換
    noDupTypes: [],
    // Poster facet schema: a poster aggregates many tags (すべて/どれか both
    // meaningful); date + the workspace toggle stay standalone chips.
    multiValueTypes: ['tag'],
    standaloneTypes: ['date', 'workspace'],
  });
  // Establish an initial value (emptyTree()) before any mutation — posters have
  // no tabs/setTree restore path, so this is the ONLY populator until the first
  // filter interaction.
  window.corpusStore.set('posterQueryTree', JSON.parse(JSON.stringify(posterQB.getTree())));

  // Build the whole poster-mode filter-row model (#posterFilterRows) from current state
  // and hand it to the poster sidebar island (twin of buildSidebarModel for the post side).
  // Aggregates row labels (MSG + custom 種別 labels), per-row active-leaf badge counts
  // (from the poster query shadow), the 作品/キャラ/タグ/サーバー progressive-disclosure
  // visibility, and which flyout row wears .qf-open. PURE (no tree mutation — the prune
  // side-effect lives in renderPosterFilterRows), so it's safe to call on every flyout
  // open/close for an openCat refresh. Cheap: posterFilterVocab scans the small poster-tag
  // map and namedPosters is a cached buildUsers().
  function buildPosterSidebarModel(): CorpusPosterSidebarModel {
    const vocab = posterFilterVocab();
    const named = namedPosters();
    const instPresent = new Set(named.map((u) => u.instance).filter(Boolean));
    // Row badges count the matching leaves in the poster query tree (shadow).
    const leaves = posterQB.shadow();
    const tagLeaves = leaves.filter((f) => f.type === 'tag');
    const badges: Record<string, number> = {
      'poster-platform': leaves.filter((f) => f.type === 'platform').length,
      'poster-work': tagLeaves.filter((f) => tagKindOf(f.value) === 'work').length,
      'poster-character': tagLeaves.filter((f) => tagKindOf(f.value) === 'character').length,
      'poster-tag': tagLeaves.filter((f) => !tagKindOf(f.value)).length,
      'poster-instance': leaves.filter((f) => f.type === 'instance').length,
      'poster-date': leaves.some((f) => f.type === 'date') ? 1 : 0,
      'poster-folder': leaves.some((f) => f.type === 'folder') ? 1 : 0,
    };
    return {
      title: MSG.sbFilterTitle,
      // Only poster-side flyout rows carry .qf-open here (post rows live in buildSidebarModel).
      openCat: qfCat && String(qfCat).startsWith('poster-') ? qfCat : null,
      labels: {
        'poster-platform': MSG.qfPlatform,
        'poster-work': kindLabel('work'),
        'poster-character': kindLabel('character'),
        'poster-tag': MSG.qfTag,
        'poster-instance': MSG.qfInstance,
        'poster-date': MSG.qfDate,
        'poster-folder': MSG.qfCatFolder,
      },
      badges,
      // 段階的開示: reveal a row only when posters actually carry that kind of value.
      visible: {
        work: vocab.some((t) => tagKindOf(t) === 'work'),
        character: vocab.some((t) => tagKindOf(t) === 'character'),
        tag: vocab.some((t) => !tagKindOf(t)),
        instance: instPresent.size > 0,
      },
    };
  }
  function pushPosterSidebar() {
    window.corpusSidebar.renderPoster(buildPosterSidebarModel());
  }
  // Poster sidebar filter rows (mirror of renderFilterBadges for posters): prune tag
  // selections that no longer have a backing value (poster removed/edited), then re-push
  // the model. The rows are React-owned now — this only carries the ONE side effect (the
  // shadow prune); labels / badges / disclosure ride the model via pushPosterSidebar.
  function renderPosterFilterRows() {
    const present = new Set(posterFilterVocab());
    if (posterQB.removeCondsMatching((c) => c.type === 'tag' && !present.has(c.value))) posterQB.syncShadow();
    pushPosterSidebar();
  }
  // namedPosters / filteredPosters moved to listing.js (7th slice — destructured
  // with getFilteredPosts above).
  // (PF_ORDER — the platform display order — moved to facets.js with qfValues.)
  // Poster query reset — the activebar island's #posterResetBtn onClick (onPosterReset).
  function resetPosterFilters() {
    posterQB.resetTree();
    setSearchBoxValue('');
    renderPosters();
  }
  function renderPosters(keepLimit?) {
    const grid = byId('posterGrid');
    const empty = byId('emptyState');
    renderPosterFilterRows();
    posterQB.render(); // draw the query bar (pills / groups) for the poster tree
    posterList = filteredPosters();
    // 投稿者モードはクエリバー（postCount の常設先）を隠すので、件数はポスターコントロール
    // 側の #posterCount に出す（バー右端の件数と役割分担）。#posterCount + poster reset/empty
    // frame は activebar 島が描画する（posterList が確定した後に push）。
    pushActivebar();
    syncBrowseBar();
    // Density: the classes style the CELLS (descendant selectors); the column
    // layout itself lives in the masonic model (pushPosterModel).
    grid.classList.toggle('tile-view', posterView === 'tile');
    grid.classList.toggle('list-view', posterView === 'list');
    // (The #posterDensityToggle glass thumb is positioned by the toolbar island, not here.)
    // Size slider: card + tile (auto-fill grids) have a size axis; list (full-width stack)
    // doesn't. The track maps to column counts so every step reflows (no dead zones).
    refreshPosterSlider();
    if (posterList.length === 0) {
      empty.style.display = 'block';
      // allUsersCount feeds the EmptyState island's self-derived 'posterFirstRun'
      // vs 'filtered' choice (P4-B slice⑫ — mirrors slice⑩'s allPostsCount). Only
      // computed here (buildUsers() is the generation-cached poster roll-up — the
      // OLD code only ever called it in this branch too, so this preserves the
      // same laziness, not a new cost).
      window.corpusStore.set('allUsersCount', buildUsers().length);
      window.corpusStore.set('posterGroups', posterList); // [] — React renders an empty grid (no cards)
      return;
    }
    empty.style.display = 'none';
    grid.classList.toggle('anim-in', !keepLimit && !prefersReducedMotion());
    window.corpusStore.set('posterGroups', posterList);
    // With windowing, cells keep MOUNTING while the user scrolls — drop the
    // entrance class once the initial animation has played, or every late
    // cell would replay it mid-scroll (same wiring as the post grid).
    clearTimeout(_posterAnimT);
    if (grid.classList.contains('anim-in')) _posterAnimT = setTimeout(() => grid.classList.remove('anim-in'), GRID_ANIM_MS);
  }
  let _posterAnimT: any = null;
  // React owns the poster cells (virtualized — window.corpusPosterGridSource,
  // P4-B slice⑫); viewer.js keeps posterList, the count badge, the density
  // classes, and #posterGrid's click/contextmenu delegation. The inspected
  // highlight is NOT part of this model — the island derives its own ring from
  // corpusStore's 'inspectedKey' (useSyncExternalStore), keyed off the raw
  // item's `.key`. modelOf/keyOf/tagTitle/infoTitle never change identity
  // meaningfully between renders, so they're configured ONCE (mirrors the post
  // source's cardModel/cardLabels hoist) instead of rebuilt every renderPosters().
  window.corpusPosterGridSource.configure({
    modelOf: (u, i) => {
      const hasName = !!u.displayName;
      const s = (u.displayName || u.screenName || '').trim();
      return {
        index: i,
        avatarSrc: u.avatarFile ? fileSrc(u.avatarFile) : null,
        monogram: u.avatarFile ? null : s ? s[0].toUpperCase() : '?',
        name: hasName ? u.displayName : u.screenName ? '@' + u.screenName : '(unknown)',
        handle: hasName && u.screenName ? u.screenName : null,
        platform: u.platform || null,
        pfName: u.platform ? PF_NAME[u.platform] || u.platform : null,
        countLabel: MSG.posterPosts(formatCount(u.count)),
      };
    },
    keyOf: (u, i) => (u && u.key != null ? 'p:' + u.key : i),
    tagTitle: MSG.tipTagEdit,
    infoTitle: MSG.tipInfo,
  });
  // Jump from a poster to its posts: posts mode + a single user filter for it.
  // We want ONLY this poster's posts, so drop every post filter carried over from
  // the prior posts view (tags/date/media/search/engagement) — not just a previous
  // user filter — otherwise unrelated leftover filters AND-narrow the result and
  // hide posts the user expects to see.
  function openPosterPosts(u) {
    if (!u) return;
    postQB.resetTree();
    const set = (id, v) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = v;
    };
    setSearchBoxValue('');
    set('sbDateFrom', '');
    set('sbDateTo', '');
    set('sbEngMin', '');
    setBrowseMode('posts');
    addFilter({ type: 'user', value: u.key, label: u.displayName || u.screenName || u.key });
    posterReturn = u.key; // set LAST (setBrowseMode clears it): reset returns to posters while this user filter is active
  }
  // Jump from a post to its poster (双方向ナビ: posts → posters): switch to the poster
  // view and open that poster's inspector. Only SNS posts have a poster in buildUsers()
  // (url-less Eagle migrations don't), so callers guard on existence before offering it.
  function jumpToPoster(p) {
    if (!p || !p.url) return;
    const u = buildUsers().find((x) => x.key === userKey(p));
    if (!u) return;
    setBrowseMode('posters'); // clears any stale detail, then we open the poster's
    showPosterDetail(u);
  }
  // --- Poster inspector inline tag editor ---
  // Mirrors the post inspector's tag editor, but the source of truth is posterTags[key]
  // (NOT a post's tags), persisted to poster-tags.json. Posters carry no source (pixiv/
  // SNS) tags, so the picker is fed recordsForSource:[]. The UI shows whenever the
  // poster inspector is open (no tagging-edit gate — there is no poster tagging mode).
  function refreshPosterTagFields(key) {
    window.corpusInspector.refresh({ tags: posterTagsOf(key), ...inspectorTagPickerData(posterTagsOf(key), [], 'poster') });
  }
  function refreshPosterFolderFields(key) {
    window.corpusInspector.refresh({ folders: pfStore.all().map((f) => ({ id: f.id, name: f.name, on: posterFolderHas(f.id, key) })) });
  }
  // Apply a tag mutation to a poster, persist, and refresh the inspector tag fields
  // (input keeps focus and the picker keeps its scroll — same openId, no remount).
  // Records the change on the shared undo stack (type 'poster-tags') so Ctrl+Z works
  // the same as for posts.
  function applyPosterTagChange(key, mutate) {
    if (!key) return;
    const prev = posterTagsOf(key);
    const next = mutate(prev.slice());
    if (!next) return;
    const changed = next.length !== prev.length || next.some((t, i) => t !== prev[i]);
    if (!changed) return;
    pushUndo('poster-tags', [{ key, prevTags: prev.slice(), newTags: next.slice() }]);
    window.corpusTags.setPosterTags(key, next.length ? next : null);
    refreshPosterTagFields(key);
  }
  function showPosterDetail(u, opts?) {
    if (!u) return;
    const pfName = u.platform ? PF_NAME[u.platform] || u.platform : '';
    const avatarSrc = u.avatarFile ? fileSrc(u.avatarFile) : null;
    const name = u.displayName || (u.screenName ? '@' + u.screenName : '(unknown)');
    // Recent works: group this poster's posts (newest first) and preview the lead
    // image of each. Click → open that work in the gallery (over the inspector).
    posterWorkGroups = groupRecords(allPosts.filter((p) => userKey(p) === u.key))
      .sort((a, b) => String(b.rep.date || '').localeCompare(String(a.rep.date || '')))
      .slice(0, 6);
    const works = posterWorkGroups
      .map((g) => {
        const f = (g.files && g.files[0]) || captureFile(g.rep);
        return f ? { thumbSrc: fileSrc(f, 200), onClick: () => window.corpusLightbox.open(buildGroupGalleryItems(g), 0) } : null;
      })
      .filter(Boolean);
    const tags = posterTagsOf(u.key);
    window.corpusInspector.open({
      kind: 'poster',
      avatarSrc,
      name,
      screenNameLabel: u.screenName ? '@' + u.screenName : '',
      platformLabel: pfName,
      postsLabel: formatCount(u.count),
      followersLabel: u.followers != null ? formatCount(u.followers) : '',
      joinedLabel: localeDate(u.authorCreatedAt),
      works,
      tags,
      ...inspectorTagPickerData(tags, [], 'poster'),
      folders: pfStore.all().map((f) => ({ id: f.id, name: f.name, on: posterFolderHas(f.id, u.key) })),
      autoFocusTag: !!(opts && opts.focusTag),
      labels: {
        user: MSG.detailUser,
        platform: MSG.detailPlatform,
        posts: MSG.detailPosts,
        followers: MSG.detailFollowers,
        joined: MSG.detailJoined,
        posterFolders: MSG.ivPosterFolders,
        newFolderPlaceholder: MSG.posterFolderNewPlaceholder,
        posterViewPosts: MSG.posterViewPosts,
      },
      tagLabels: {
        tagsLabel: MSG.ivPosterTags,
        newTagPlaceholder: MSG.tagNewName,
        addBtn: MSG.tagAddBtn,
        noTags: MSG.editNoTags,
        noMatch: MSG.tagPalNoMatch,
        noVocab: MSG.tagNoTags,
        adoptSource: MSG.editAdoptSource,
      },
      onClose: closeDetail,
      onPosterPosts: () => openPosterPosts(u),
      onFolderToggle: (id) => {
        togglePosterFolderMember(id, u.key);
        refreshPosterFolderFields(u.key);
      },
      onFolderCreate: () => {
        const name = window.prompt(MSG.posterFolderRenamePrompt, '');
        if (name && name.trim()) {
          const nf = createPosterFolder(name);
          if (nf) {
            togglePosterFolderMember(nf.id, u.key);
            showPosterDetail(u);
          }
        }
      },
      onTagAdd: (tag) => applyPosterTagChange(u.key, (prev) => (prev.includes(tag) ? prev : [...prev, tag])),
      onTagRemove: (tag) => applyPosterTagChange(u.key, (prev) => prev.filter((t) => t !== tag)),
      onTagToggle: (tag) => applyPosterTagChange(u.key, (prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])),
      onTagContextMenu: (tag, x, y) => {
        if (taggingApi && taggingApi.showKindMenu) taggingApi.showKindMenu(tag, x, y, () => refreshPosterTagFields(u.key));
      },
    });
    byId('postDetail').hidden = false;
    setInspectedKey('poster:' + u.key); // post + poster cards clear/set their ring reactively (corpusStore subscribe)
  }
  byId('posterGrid').addEventListener('click', (e) => {
    const card = closestOf(e, '.poster-card');
    if (!card) return;
    const u = posterList[Number.parseInt(card.dataset.index ?? '', 10)];
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
  // Poster context menu (right-click a card): assign to poster folders + quick actions,
  // so folder membership no longer requires opening the inspector. Reuses the shared
  // .fold-menu chrome + clampIntoView; folder rows toggle in place (menu stays open).
  // Poster context menu (right-click a poster card): jump to その投稿者の投稿 + assign to
  // poster-folders (toggle, stays open). React-owned glass popup via
  // window.corpusContextMenu; viewer owns the items + actions here.
  function posterMenuItems(u) {
    const items = [{ label: MSG.posterViewPosts, act: 'posts' }, { sep: true }] as CorpusMenuItem[];
    for (const f of pfStore.all()) {
      items.push({ label: f.name, act: 'folder', fid: f.id, checked: posterFolderHas(f.id, u.key) });
    }
    items.push({ label: MSG.posterMenuNewFolder, act: 'newfolder', manage: true });
    return items;
  }
  function onPosterMenuPick(u, item) {
    if (item.act === 'posts') {
      openPosterPosts(u);
      return;
    } // close
    if (item.act === 'newfolder') {
      const name = window.prompt(MSG.posterFolderRenamePrompt, '');
      if (name && name.trim()) {
        const nf = createPosterFolder(name);
        if (nf) togglePosterFolderMember(nf.id, u.key);
      }
      return; // close
    }
    if (item.act === 'folder') {
      togglePosterFolderMember(item.fid, u.key);
      return posterMenuItems(u); // keep open to assign more
    }
  }
  function showPosterMenu(u, x, y) {
    window.corpusContextMenu.open({ items: posterMenuItems(u), x, y }, (item) => onPosterMenuPick(u, item));
  }
  byId('posterGrid').addEventListener('contextmenu', (e) => {
    const card = closestOf(e, '.poster-card');
    if (!card) return;
    e.preventDefault();
    const u = posterList[Number.parseInt(card.dataset.index ?? '', 10)];
    if (u) showPosterMenu(u, e.clientX, e.clientY);
  });
  // Poster-mode sort (sidebar). Single source = corpusStore 'sortPoster' (the GlassSelect
  // writes it on pick); re-render when it changes. This replaces the old #posterSortSelect
  // DOM-'change' listener — the store is now the one trigger (no dual source).
  window.corpusStore.subscribe('sortPoster', () => renderPosters());
  // Poster query reset (bar右の「リセット」): empty the poster tree + the shared search box.
  // Wired to the activebar island's #posterResetBtn via onPosterReset (React-owned button).
  // Poster filter rows (mirror of the #filterRows handler): a data-qfrow row opens its
  // flyout (poster-* categories); the date row opens the date popover.
  // Selections live in the transient posterXxx state.
  byId('posterFilterRows').addEventListener('click', (e) => {
    const row = closestOf(e, '[data-qfrow]');
    if (!row) return;
    const cat = row.dataset.qfrow;
    if (cat === 'poster-date' && window.corpusFilterPopover.get()?.kind === 'posterDate') {
      closeAllMenus();
      return;
    } // re-click closes
    closeAllMenus(); // switching rows closes any open date popover first
    if (cat === 'poster-date') {
      hideQfPop();
      openPosterDatePopover(row);
      return;
    }
    showQfPopAt(cat, row);
  });

  // Collections are a sidebar folder list now (renderCollectionSidebar), not a
  // browse view. The old third-mode grid, its context menu, and dynamic collections
  // (saved searches) were removed 2026-07-04 — see the collection sidebar above.

  // View-size slider — every density has one. The auto-fill grids (tile/card)
  // quantize the real width to "how many columns fit", so their track maps to
  // COLUMN COUNTS (one detent = exactly one column, no dead notches). The
  // list is a full-width stack, so its track maps straight to the thumbnail
  // px. Right = larger. While dragging only the CSS
  // vars update; persisting + re-requesting thumbnails happens on release.
  function viewSizeState() {
    if (currentView === 'card')
      return {
        get: () => cardSize,
        set: (v) => {
          cardSize = v;
        },
        min: CARD_MIN,
        max: CARD_MAX,
        pref: 'cardSize',
        storeKey: 'cardSize',
        columns: true,
      };
    if (currentView === 'list')
      return {
        get: () => listThumb,
        set: (v) => {
          listThumb = v;
        },
        min: LIST_MIN,
        max: LIST_MAX,
        pref: 'listThumb',
        storeKey: 'listThumb',
        columns: false,
      };
    return {
      get: () => tileSize,
      set: (v) => {
        tileSize = v;
      },
      min: TILE_MIN,
      max: TILE_MAX,
      pref: 'imageTileSize',
      storeKey: 'tileSize',
      columns: true,
    };
  }
  function setViewSize(px, commit = true) {
    const st = viewSizeState();
    st.set(Math.max(st.min, Math.min(st.max, px)));
    applyTileLayout(commit); // mid-drag (!commit): skip the slider re-measure to avoid a forced reflow per input
    if (!commit) {
      // Live re-flow while dragging (masonic recreates its positioner on columnWidth
      // change) via a deliberate side channel, NOT corpusStore — writing every drag
      // input to the store would recompute+notify on every pointermove for no
      // benefit (P4-B slice④'s reasoning, carried into slice⑩'s pulled source).
      if (st.columns) window.corpusPostGridSource.setLiveColumnWidth(st.get());
      return;
    }
    window.corpusIpc.setPref(st.pref, st.get());
    // The settled size mirrors into corpusStore (P4-B slice④) — the post-grid
    // source (slice⑩) derives columnWidth/itemHeightEstimate from it. Clear the
    // live-drag override so a later VIEW change (which reads a different
    // storeKey) can't see a stale value from this one.
    window.corpusStore.set(st.storeKey, st.get());
    window.corpusPostGridSource.setLiveColumnWidth(null);
    renderPosts(); // re-request thumbnails at the new size
  }
  function tileGridMetrics() {
    const grid = byId('postGrid');
    if (!grid) return null;
    // floor of the FRACTIONAL width: clientWidth rounds up half-pixels, which
    // makes an exact-fill size 1px too wide and silently drops a column.
    const W = Math.floor(grid.getBoundingClientRect().width);
    if (!W) return null;
    const gv = Number.parseFloat(getComputedStyle(grid).columnGap);
    return { W, g: Number.isFinite(gv) ? gv : 8 };
  }
  function refreshTileSlider() {
    const sl = inputById('tileSlider');
    if (!sl) return;
    const st = viewSizeState();
    if (!st.columns) {
      // list: direct px track
      sl.step = '8';
      sl.min = String(st.min);
      sl.max = String(st.max);
      sl.disabled = false;
      sl.value = String(st.get());
      return;
    }
    const m = tileGridMetrics();
    if (!m) return;
    sl.step = '1';
    // Card view: always allow 1 column — CSS auto-fill handles width naturally.
    const tr = sliderTrack({ min: st.min, max: st.max, size: st.get() }, m, currentView === 'card' ? { minCols: 1 } : undefined);
    // Hide the row when only one column count is geometrically possible — the
    // slider would have a single stop and convey nothing.
    const sizeRow = document.getElementById('tileSizeRow');
    if (sizeRow) sizeRow.style.display = tr.single ? 'none' : '';
    sl.min = String(tr.nBig);
    sl.max = String(tr.nSmall);
    sl.disabled = false;
    sl.value = String(tr.value); // inverted: right = larger
  }
  const tileSlider = inputById('tileSlider');
  function sliderCols() {
    return trackCols(Number.parseInt(tileSlider.value, 10), Number.parseInt(tileSlider.min, 10), Number.parseInt(tileSlider.max, 10));
  }
  let _dragMetrics: CorpusGridMetrics | null = null; // grid geometry cached for the duration of one size drag
  function onSliderMove(commit) {
    if (!viewSizeState().columns) {
      setViewSize(Number.parseInt(tileSlider.value, 10), commit);
      return;
    }
    // The grid container width and column gap don't change while only --tile-size
    // does, so measure once at the drag's first input and reuse it. Re-reading
    // getBoundingClientRect each input would force a reflow against the previous
    // input's CSS-var write. Cleared on commit (the slider's change event).
    const m = (!commit && _dragMetrics) || tileGridMetrics();
    if (!m) return;
    _dragMetrics = commit ? null : m;
    setViewSize(sizeFor(sliderCols(), m), commit);
  }
  tileSlider.addEventListener('input', () => onSliderMove(false));
  tileSlider.addEventListener('change', () => onSliderMove(true));
  // Ctrl+- / Ctrl+= step the content-size slider one notch (works in all three view modes).
  // Registration lives in the useGlobalShortcuts hook (app/islands/app/App.tsx).
  function handleShortcutSizeKey(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key !== '-' && e.key !== '=' && e.key !== '+') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    if (tileSlider.disabled) return;
    const step = Number.parseInt(tileSlider.step, 10) || 1;
    tileSlider.value = String(Math.max(Number.parseInt(tileSlider.min, 10), Math.min(Number.parseInt(tileSlider.max, 10), Number.parseInt(tileSlider.value, 10) + (e.key === '-' ? -step : step))));
    onSliderMove(true);
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleShortcutSizeKey });
  // Window resizes change how many columns fit → re-derive the track range.
  let tileResizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(tileResizeT);
    tileResizeT = setTimeout(refreshTileSlider, 150);
  });

  // Tile overlay lives in the React settings island now; expose an apply-and-
  // persist bridge it can call so the post grid updates immediately.
  function applyTileOverlay(v) {
    tileOverlay = v;
    window.corpusIpc.setPref('tileOverlay', tileOverlay);
    // Class-only: the overlay markup is always in the DOM (.no-overlay just hides it
    // via CSS), so flip the class directly instead of re-grouping + rebuilding the
    // grid (a full renderPosts reloaded every tile image = flicker).
    const grid = byId('postGrid');
    if (grid) grid.classList.toggle('no-overlay', !tileOverlay);
  }
  // Bridges the React settings island calls into (the controls live there now,
  // but these effects touch viewer.js-owned state / the post grid).
  window.corpusViewer = Object.assign(window.corpusViewer || {}, {
    setTileOverlay: applyTileOverlay,
    reloadPosts: () => loadPosts(),
    setSkipDeleteConfirm: (v) => {
      skipDeleteConfirm = v;
      window.corpusIpc.setPref('skipDeleteConfirm', v);
    },
  });

  // Load saved view mode and skipDeleteConfirm
  window.corpusIpc.getPrefs().then((prefs) => {
    if (['card', 'tile', 'list'].includes(prefs.viewMode)) {
      currentView = prefs.viewMode;
      // Push the restored view into the store so the toolbar island renders the right
      // button active. currentView is already set, so the subscribe above no-ops
      // (idempotent guard) — no double render, no echo.
      window.corpusStore.set('view', currentView);
    }
    if (['card', 'tile', 'list'].includes(prefs.posterViewMode)) {
      posterView = prefs.posterViewMode;
      // Push into the store so the island renders the right button active; posterView
      // is already set, so the subscribe above no-ops (idempotent guard).
      window.corpusStore.set('posterView', posterView);
    }
    // Poster-grid view sizes mirror into corpusStore (P4-B slice⑫, mirrors slice④'s post-side treatment below).
    if (Number.isFinite(prefs.posterTileSize)) {
      posterTileSize = Math.max(PTILE_MIN, Math.min(PTILE_MAX, prefs.posterTileSize));
      window.corpusStore.set('posterTileSize', posterTileSize);
    }
    if (Number.isFinite(prefs.posterCardSize)) {
      posterCardSize = Math.max(PCARD_MIN, Math.min(PCARD_MAX, prefs.posterCardSize));
      window.corpusStore.set('posterCardSize', posterCardSize);
    }
    // Post-grid view sizes also mirror into corpusStore (P4-B slice④ — see setViewSize).
    if (Number.isFinite(prefs.imageTileSize)) {
      tileSize = Math.max(TILE_MIN, Math.min(TILE_MAX, prefs.imageTileSize));
      window.corpusStore.set('tileSize', tileSize);
    }
    if (Number.isFinite(prefs.cardSize)) {
      cardSize = Math.max(CARD_MIN, Math.min(CARD_MAX, prefs.cardSize));
      window.corpusStore.set('cardSize', cardSize);
    }
    if (Number.isFinite(prefs.listThumb)) {
      listThumb = Math.max(LIST_MIN, Math.min(LIST_MAX, prefs.listThumb));
      window.corpusStore.set('listThumb', listThumb);
    }
    if (prefs.tileOverlay === false) {
      tileOverlay = false;
    }
    skipDeleteConfirm = !!prefs.skipDeleteConfirm;
    // Re-render once after applying the saved view mode. Sort is NOT read here anymore
    // — it comes from the tab state (applied by initTabs), so the old prefs/initTabs
    // load race on sortSelect.value is gone.
    renderPosts();
  });

  // --- Search value source -----------------------------------------------------
  // corpusStore 'searchQuery' IS the search value; the searchbox island renders it
  // as a controlled react-aria ComboBox input. Typing: island → store → the
  // subscriber below runs the debounced heavy side effects. Programmatic writes
  // (resets / tab & history restore / leaf confirm): viewer → setSearchBoxValue →
  // store → island re-renders the input. _searchEcho tells the two apart — every
  // setSearchBoxValue caller triggers its own re-render, so feeding the echo into
  // the typing pipeline would double-render and churn the editing text leaf.
  function searchQuery() {
    return String(window.corpusStore.get('searchQuery') || '');
  }
  let _searchEcho = '';
  function setSearchBoxValue(v) {
    _searchEcho = String(v ?? '');
    window.corpusStore.set('searchQuery', _searchEcho);
  }

  // Search / sort events
  // Typing arrives via the store (the searchbox island pushes every keystroke).
  // Debounced 150ms: filtering + re-rendering ~9k records on every keystroke
  // stutters; coalesce to the pause after typing. NOTE: renderPosts is called with
  // no args — a truthy arg would be taken as keepLimit and skip the history push.
  // Subscribe registration lives in React (StoreSubscriptions, App.tsx) via
  // window.corpusViewer below; this stays the guard + action logic.
  let _searchRenderTimer: any = null;
  function handleSearchQueryStoreChange() {
    const v = searchQuery();
    if (v === _searchEcho) return; // setSearchBoxValue echo — its caller re-renders itself
    _searchEcho = v;
    clearTimeout(_searchRenderTimer);
    _searchRenderTimer = setTimeout(() => {
      if (browseMode === 'posters') {
        renderPosters();
        return;
      }
      syncEditingTextLeaf(); // posts: the box edits a 'text' leaf in the query tree
    }, 150);
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { handleSearchQueryStoreChange });
  // Search box ↔ query-tree text-leaf state machine + suggestion-pick handling —
  // extracted to search-editing.ts (P4-B slice⑨; window.corpusSearchEditing).
  // The functions below are thin wrappers keeping the existing call-site names
  // (handleSearchQueryStoreChange/onConfirmText/postQB ctx/window.corpusViewer
  // all reference these by name) — same "wrapper preserves names" shape as the
  // postQB.addFilter/removeFilter/removeNode module-level wrappers above.
  const searchEditing = window.corpusSearchEditing.makeSearchEditing({
    getTree: () => postQB.getTree(),
    addFilter: (f) => postQB.addFilter(f),
    removeNode: (n) => postQB.removeNode(n),
    treeLeaves,
    searchQuery: () => searchQuery(),
    setSearchBoxValue: (v) => setSearchBoxValue(v),
    isFuzzy: () => !!(window.corpusSearch && window.corpusSearch.isFuzzy()),
    isPostsMode: () => browseMode === 'posts',
    afterQueryChange: () => afterQueryChange(),
    renderPosts: () => renderPosts(),
    updateSidebarState: () => updateSidebarState(),
  });
  function syncEditingTextLeaf() {
    searchEditing.sync();
  }
  function confirmEditingTextLeaf() {
    clearTimeout(_searchRenderTimer); // beat the debounce so the leaf holds the latest value
    searchEditing.confirm();
  }
  function rebindEditingTextLeaf() {
    searchEditing.rebind();
  }

  // --- リアルタイム検索サジェスト -------------------------------------------
  // タイプのたびに、本文検索と並行してタグ/作者の候補を検索ボックス直下に表示。
  // クリック/Enter でそのままフィルタ化（タイプした文字は消す）。
  // The searchbox island (react-aria ComboBox) owns the input + dropdown UI:
  // rendering, keyboard nav, open/close, positioning. The suggestion DATA comes
  // from buildSuggest (users.js — wired above with buildUsers); what a pick DOES
  // is searchEditing.pick (wired through the corpusSearchBox bridge registered below).
  function applySuggest(it) {
    searchEditing.pick(it);
  }
  // Register the island's data callbacks. onConfirmText replicates the old bare-
  // Enter behavior: only posts mode confirms a text leaf (posters/collections
  // filter live off the box value, Enter is a no-op there).
  window.corpusSearchBox?.init({
    getSuggestions: (q) => buildSuggest(q),
    onPick: applySuggest,
    onConfirmText: () => {
      if (browseMode === 'posts' && searchQuery().trim()) confirmEditingTextLeaf();
    },
  });
  sortSelect.addEventListener('change', () => {
    // Sort lives in the tab state (persisted per tab via renderPosts→persist), not a
    // separate global pref — that double-storage raced on load. renderPosts captures it.
    renderPosts();
  });

  // 検索方式の切替（おおまか / ぴったり）＝macOS 風セグメント。両方を常に見せ、
  // 状態と切替手段がひと目で分かる。corpusSearch がモードを集約＝メイン検索と
  // フライアウト絞り込みで共有する。UI は toolbar 島（#searchModeSeg）が描画し、
  // 各選択肢の説明は .ui-tip ツールチップが担う（旧・常設ヒント行は撤去）。viewer
  // はコンテナの aria-label とモード変更時の副作用（編集中リーフ追従 / 再描画）だけ持つ。
  {
    const sms = document.getElementById('searchModeSeg');
    if (sms) sms.setAttribute('aria-label', MSG.searchModeTitle);
  }
  // The toggle now sets the mode for the NEXT term. The editing (un-confirmed)
  // leaf follows it; confirmed leaves keep their own frozen mode (postPredOf reads
  // f.mode). Subscribe registration lives in React (StoreSubscriptions, App.tsx) via
  // window.corpusViewer below; this stays the guard + action logic.
  function handleSearchModeChange() {
    searchEditing.onSearchModeChange();
  }
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
        const res = await window.corpusPosts.importComplete(buf);
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
      const { imported, skipped } = await window.corpusPosts.importPosts(posts);
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
  // reads window.corpusBackup (getBackup + onBackupStart/Done) and derives the rail model
  // itself. viewer no longer holds any of that state (the old setupMirrorStatusRail +
  // window.corpusMirror bridge are gone).

  // --- Clear data ---
  // Destroying the whole library requires typing the keyword (MSG.deleteKeyword) to
  // enable the OK button — a stray click can't wipe everything. The confirm modal is
  // React-owned now (window.corpusConfirm / the confirm island); openClearAllConfirm just
  // opens it with the keyword gate + the wipe as its onOk. Exposed on corpusViewer so the
  // React Danger section triggers the exact same destructive flow — no second wipe dialog.
  function openClearAllConfirm() {
    window.corpusConfirm.open({
      message: MSG.confirmClear,
      okLabel: MSG.confirmOk,
      cancelLabel: MSG.confirmCancel,
      keywordPlaceholder: MSG.confirmKeywordPh,
      keywordRequired: MSG.deleteKeyword, // OK stays disabled until this is typed
      onOk: async () => {
        // Clear all data (deletes every image + sidecar in the save folder).
        const res = await window.corpusPosts.clearAll();
        // Main refuses the wipe if config is degraded — keep the library on screen and
        // tell the user to restart (initSaveFolderRedundancy repairs on launch).
        if (res && res.blocked) {
          showToast(MSG.clearBlocked);
          return;
        }
        _postsById = new Map(); // keep the delta cache in sync with the wipe
        allPosts = [];
        // P4-B slice⑪: this call was missing before (only the two other allPosts
        // reassignment sites called it) — clear-all never bumped _allPostsGeneration,
        // so updateSidebarState()'s `_sidebarSetsGen === _allPostsGeneration` cache
        // guard stayed "fresh" and could leave stale tag/author/instance facets in
        // the sidebar after a wipe. Harmless for THIS render (renderPosts() below is
        // never inPlace, so the separate viewGroups-reuse guard was never at risk),
        // but the sidebar cache guard has no such protection — worth fixing here
        // since it's exactly the choke point this slice is unifying.
        markPostsMutated();
        renderPosts();
        showToast(MSG.cleared);
      },
    });
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { confirmClearAll: openClearAllConfirm });

  // --- Utility functions ---
  // Count / date formatters (formatCount / formatDate / compactDate / …) live in
  // format.js now; escapeHtml/escapeAttr stay as thin aliases over corpusUI.
  function escapeHtml(str) {
    return window.corpusUI.escapeHtml(str);
  }
  // corpusUI.escapeHtml is quote-safe (escapes " and '), so attribute values are
  // safe through the same call — escapeAttr stays as a named alias to keep the
  // intent ("this value lands in an attribute") legible at the 35 call sites.
  function escapeAttr(str) {
    return window.corpusUI.escapeHtml(str);
  }

  // Delegates to the shared glass toast (ui.js). Was a dynamically-created solid
  // #333 #toast; unified to #ivToast so viewer + folders share one look.
  function showToast(msg) {
    return window.corpusUI.notify(msg);
  }

  // Shared folder changes: refresh chips on any change; re-render cards (📁 states)
  // when the folder list/default changes. Registration lives in React
  // (StoreSubscriptions, App.tsx) via window.corpusViewer below (CF().onChange has no
  // unsubscribe — subs.push — so the effect there has no cleanup, harmless since it
  // mounts once for the app's lifetime like every other App.tsx-level effect); this
  // stays the guard + action logic.
  function handleFolderChange(kind) {
    // 絞り込み中のフォルダが削除されたらそのフィルタを除去（一覧が原因不明に空になるのを防ぐ）。
    if (postQB.removeCondsMatching((c) => c.type === 'collection' && !CF().byId(c.value))) {
      postQB.syncShadow();
      postQB.render();
    }
    renderPostFolders(); // refreshes the clip row + the sidebar collection list (counts/active)
    if (kind === 'list') renderPosts(true); // folder created/deleted — refresh without anim
  }
  // Background fs-watch refresh (targeted via the changed-file hint). Registration
  // lives in React (StoreSubscriptions, App.tsx) via window.corpusViewer below
  // (window.corpusPosts.onPostsChanged has no unsubscribe either — same reasoning).
  async function handlePostsChanged(names) {
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
    pushActivebar(); // initial frame (label / empty hint / reset hidden / nav disabled) before first render
    if (CF()) await CF().load(); // load folders before first render so 📁/chips are correct
    // Grouping persistence (shared with the old image-view): manual groups + opt-outs.
    ungrouped = await window.corpusRecords.loadUngrouped();
    await pfStore.load();
    manualGroups = await window.corpusRecords.loadManualGroups();
    await window.corpusTags.load();
    applyKindLabels();
    // Seed both sidebar columns with labels + initial state before the first loadPosts so the
    // filter rows paint immediately (badges/disclosure fill in as data loads). Unconditional
    // (applyKindLabels above also pushes, but only if getTagTypes resolved).
    pushSidebar();
    pushPosterSidebar();
    await initTabs();
    appBooted = true; // saved view is now applied — the first loadPosts render seeds history
    await loadPosts();
    // Restore the last browse mode (ライブラリ / 投稿者) now that posts are loaded so
    // buildUsers has data for the poster grid. silent = no history/pref echo.
    try {
      const prefs = await window.corpusIpc.getPrefs();
      // 'collections' is retired → falls through to 'posts' (setBrowseMode also coerces it).
      const bm = prefs && prefs.browseMode === 'posters' ? 'posters' : 'posts';
      // Run the heavy restore synchronously (silent = no history/pref echo, no animation),
      // THEN push the mode into the store so the island reflects active + thumb. browseMode
      // is already === bm by then, so the subscribe guard skips the echo. (pull → push, the
      // same shape as the density toggle's pref restore.)
      if (bm !== 'posts') setBrowseMode(bm, { silent: true });
      window.corpusStore.set('browseMode', bm);
    } catch {
      /* stay in library mode */
    }
    // First paint done — restore the active tab's scroll (survives restart).
    restoreTabView(tabs.find((t) => t.id === activeTabId));
    // A restored image tab could only resolve its captureIds now that the
    // library is loaded — enter the detail view here, after the grid restore.
    {
      const bootTab = tabs.find((t) => t.id === activeTabId);
      if (isImageTab(bootTab)) {
        showImageTab(bootTab);
        renderTabs(); // grid-tab titles derive live counts — the load render skipped syncTitle under the image tab
      }
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
    window.addEventListener('pagehide', persistTabsNow);
  }
  window.corpusViewer = Object.assign(window.corpusViewer || {}, { bootApp });
  resolveViewerReady();
})();
