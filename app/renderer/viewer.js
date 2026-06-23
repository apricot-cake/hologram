(async () => {
  // --- i18n ---
  // Messages live in i18n.js (loaded before this script via index.html).
  // Manifest-level strings come from _locales/*/messages.json via Chrome.
  const { lang, getMessage } = await window.corpusI18n;
  const _s = (key) => getMessage(key);
  const _f1 = (key) => (a) => getMessage(key, [a]);
  const _f2 = (key) => (a, b) => getMessage(key, [a, b]);
  // Back-compat shim so existing call sites (MSG.key / MSG.key(args)) keep working.
  // Static keys are pre-resolved strings; interpolated keys are bound functions.
  const MSG = {
    // tabs / search / sort
    tabTags: _s('tabTags'),
    tabSettings: _s('tabSettings'),
    searchPlaceholder: _s('searchPlaceholder'),
    searchTags: _s('searchTags'),
    sidebarAuthors: _s('sidebarAuthors'),
    searchAuthors: _s('searchAuthors'),
    kindPost: _s('kindPost'),
    kindImage: _s('kindImage'),
    confirmDeleteGroup: _f1('confirmDeleteGroup'),
    tipInfo: _s('tipInfo'),
    tipTagEdit: _s('tipTagEdit'),
    tipSelect: _s('tipSelect'),
    tagSelected: _s('tagSelected'),
    folderSelected: _s('folderSelected'),
    tagSelectedTitle: _s('tagSelectedTitle'),
    sbSearchTitle: _s('sbSearchTitle'),
    sbSortTitle: _s('sbSortTitle'),
    tipTagCycle: _s('tipTagCycle'),
    tipFolderFilter: _s('tipFolderFilter'),
    sbFilterTitle: _s('sbFilterTitle'),
    activebarLabel: _s('activebarLabel'),
    engParticle: _s('engParticle'),
    ctxManage: _s('ctxManage'),
    ctxWsAdd: _s('ctxWsAdd'),
    ctxWsRemove: _s('ctxWsRemove'),
    qcJoinAnd: _s('qcJoinAnd'),
    qcJoinOr: _s('qcJoinOr'),
    qbAddGroup: _s('qbAddGroup'),
    qbAddGroupTip: _s('qbAddGroupTip'),
    qbTipOp: _s('qbTipOp'),
    qbMenuNeg: _s('qbMenuNeg'),
    qbMenuNegGroup: _s('qbMenuNegGroup'),
    tileOverlay: _s('tileOverlay'),
    qbHelpTitle: _s('qbHelpTitle'),
    qbHelp1: _s('qbHelp1'),
    qbHelp2: _s('qbHelp2'),
    qbHelp3: _s('qbHelp3'),
    qbHelp4: _s('qbHelp4'),
    qbHelp5: _s('qbHelp5'),
    qbHelp6: _s('qbHelp6'),
    qfCatFolder: _s('qfCatFolder'),
    sbTopTip: _s('sbTopTip'),
    ungroupDone: _s('ungroupDone'),
    tagGroupOther: _s('tagGroupOther'),
    tagAllRow: _s('tagAllRow'),
    qfFindPh: _s('qfFindPh'),
    exportModeFull: _s('exportModeFull'),
    exportModeImages: _s('exportModeImages'),
    backupSubTitle: _s('backupSubTitle'),
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
    tagAdopted: _f1('tagAdopted'),
    editAdoptSource: _s('editAdoptSource'),
    editCoocCharsOf: _f1('editCoocCharsOf'),
    editCoocChars: _s('editCoocChars'),
    editCoocWhy: _f2('editCoocWhy'),
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
    imagesCount: _f1('imagesCount'),
    tagsSaved: _s('tagsSaved'),
    tagsSavedN: _f1('tagsSavedN'),
    tipWorkspace: _s('tipWorkspace'),
    tipFolder: _s('tipFolder'),
    workspaceTitle: _s('workspaceTitle'),
    wsEmpty: _s('wsEmpty'),
    wsEmptyTip: _s('wsEmptyTip'),
    wsEmptyConfirm: _s('wsEmptyConfirm'),
    posterWsEmptyConfirm: _s('posterWsEmptyConfirm'),
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
    close: _s('close'),
    tileSizeTip: _s('tileSizeTip'),
    foldersNone: _s('foldersNone'),
    postCount: _f1('postCount'),

    // ライブラリ/投稿者/コレクション モード切替・投稿者ビュー
    browsePosts: _s('browsePosts'),
    browsePosters: _s('browsePosters'),
    browseCollections: _s('browseCollections'),
    browseModeTitle: _s('browseModeTitle'),
    // コレクションビュー（第3モード）
    collectionCount: _f1('collectionCount'),
    collItemCount: _f1('collItemCount'),
    collNew: _s('collNew'),
    collNewPrompt: _s('collNewPrompt'),
    collOpen: _s('collOpen'),
    collSetActive: _s('collSetActive'),
    collRename: _s('collRename'),
    collRenamePrompt: _s('collRenamePrompt'),
    collDelete: _s('collDelete'),
    collDeleteConfirm: _f1('collDeleteConfirm'),
    sbCollectionSortTitle: _s('sbCollectionSortTitle'),
    collSortName: _s('collSortName'),
    collSortRecent: _s('collSortRecent'),
    collSortCount: _s('collSortCount'),
    collEmptyTitle: _s('collEmptyTitle'),
    collEmptyDesc: _s('collEmptyDesc'),
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

    save: _s('save'),       // tag editor save button
    saved: _s('saved'),     // settings status toast
    // settings > appearance / language / shortcut
    themeTitle: _s('themeTitle'),
    themeMode: _s('themeMode'),
    themeAuto: _s('themeAuto'),
    themeLight: _s('themeLight'),
    themeDark: _s('themeDark'),
    hintTheme: _s('hintTheme'),
    langTitle: _s('langTitle'),
    settingsSearch: _s('settingsSearch'),
    settingsNoMatch: _s('settingsNoMatch'),
    langAuto: _s('langAuto'),
    hintLang: _s('hintLang'),
    shortcutTitle: _s('shortcutTitle'),
    shortcutLink: _s('shortcutLink'),
    hintShortcut: _s('hintShortcut'),

    // settings > data / danger
    dataTitle: _s('dataTitle'),
    saveFolderSubTitle: _s('saveFolderSubTitle'),
    saveFolderChange: _s('saveFolderChange'),
    saveFolderHint: _s('saveFolderHint'),
    saveFolderMoving: _s('saveFolderMoving'),
    saveFolderMoved: _f1('saveFolderMoved'),
    saveFolderProgressTitle: _s('saveFolderProgressTitle'),
    logCopyStart: _f1('logCopyStart'),
    logCopying: _f1('logCopying'),
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
    exportZip: _s('exportZip'),
    importZip: _s('importZip'),
    importImages: _s('importImages'),
    hintZip: _s('hintZip'),
    hintMedia: _s('hintMedia'),
    dangerTitle: _s('dangerTitle'),
    labelResetDeleteConfirm: _s('labelResetDeleteConfirm'),
    hintResetDeleteConfirm: _s('hintResetDeleteConfirm'),
    clearData: _s('clearData'),
    confirmClear: _s('confirmClear'),
    confirmOk: _s('confirmOk'),
    confirmCancel: _s('confirmCancel'),
    cleared: _s('cleared'),

    // settings > backup（指定フォルダへの増分エクスポート）
    hintBackup: _s('hintBackup'),
    backupDirNone: _s('backupDirNone'),
    backupChoose: _s('backupChoose'),
    backupClear: _s('backupClear'),
    backupInterval: _s('backupInterval'),
    backupIntervalUnit: _s('backupIntervalUnit'),
    unitDay: _s('unitDay'),
    unitWeek: _s('unitWeek'),
    unitMonth: _s('unitMonth'),
    backupOverlap: _s('backupOverlap'),
    backupLastLabel: _s('backupLastLabel'),
    mirrorDone: _s('mirrorDone'),
    mirrorSyncingShort: _s('mirrorSyncingShort'),
    mirrorFailed: _s('mirrorFailed'),
    timeToday: _s('timeToday'),
    timeYesterday: _s('timeYesterday'),
    backupItemsUnit: _s('backupItemsUnit'),
    backupSyncing: _s('backupSyncing'),

    // settings > trash
    trashTitle: _s('trashTitle'),
    trashEmpty: _s('trashEmpty'),
    trashCount: _f1('trashCount'),
    trashEmptyBtn: _s('trashEmptyBtn'),
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
    likes: (n) => n != null ? `${formatCount(n)}` : '',

    // edit overlay
    tagsLabel: _s('tagsLabel'),
    addTag: _s('addTag'),
    tagPlaceholder: _s('tagPlaceholder'),

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
    // window tabs
    tabNew: _s('tabNew'),
    tabClose: _s('tabClose'),
    tabPin: _s('tabPin'),
    tabUnpin: _s('tabUnpin'),
    tabRename: _s('tabRename'),
    tabDuplicate: _s('tabDuplicate'),
    tabCloseOthers: _s('tabCloseOthers')
  };

  // Shared trash glyph (poster-folder delete + workspace clear). One source so the
  // icon can't drift between the JS-rendered button and the static #wsClear button.
  const ICON_TRASH = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
  // Nudge an already-shown, cursor-positioned popup back inside the viewport (8px
  // margin). Shared by the cursor-placed context menus (query-builder / folder /
  // card / 種別) so the clamp formula stays in one place instead of drifting between
  // copies. Anchored flyouts (cs/qf/tab) keep their own placement strategy.
  function clampIntoView(el) {
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth - 8) el.style.left = Math.max(8, innerWidth - r.width - 8) + 'px';
    if (r.bottom > innerHeight - 8) el.style.top = Math.max(8, innerHeight - r.height - 8) + 'px';
  }
  // Open an anchored flyout to the RIGHT of anchorRect (tops aligned), then clamp into
  // the viewport. opts.maxHeight caps the height to the space below the final top so a
  // long scrolling list never overruns the screen (its inner scroller takes over). The
  // caller makes el visible first (.show / display:block) so it can be measured. Shared
  // by the sidebar filter flyout and the date / engagement popovers.
  function placeFlyout(el, anchorRect, opts = {}) {
    el.style.maxHeight = '';   // reset before measuring (a prior open may have capped it)
    el.style.right = 'auto';
    el.style.left = (anchorRect.right + 8) + 'px';
    el.style.top = anchorRect.top + 'px';
    const pr = el.getBoundingClientRect();
    if (pr.right > innerWidth - 8) el.style.left = Math.max(8, innerWidth - pr.width - 8) + 'px';
    let top = anchorRect.top;
    if (pr.bottom > innerHeight - 8) { top = Math.max(8, innerHeight - pr.height - 8); el.style.top = top + 'px'; }
    if (opts.maxHeight) el.style.maxHeight = (innerHeight - top - 8) + 'px';
  }

  // --- Apply i18n to static elements ---
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const setAttr = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };

  setText('settingsViewTitle', MSG.tabSettings);
  setAttr('settingsBtn', 'title', MSG.tabSettings);
  setAttr('settingsBtn', 'aria-label', MSG.tabSettings);
  setText('sbAuthorTitle', MSG.sidebarAuthors);
  setText('sbWorkspaceTitle', MSG.workspaceTitle);
  const wsClearEl = document.getElementById('wsClear');
  if (wsClearEl) { wsClearEl.innerHTML = ICON_TRASH; wsClearEl.title = MSG.wsEmptyTip; wsClearEl.setAttribute('aria-label', MSG.wsEmpty); }
  setText('sbPosterWsRowName', MSG.workspaceTitle);
  const posterWsClearEl = document.getElementById('posterWsClear');
  if (posterWsClearEl) { posterWsClearEl.innerHTML = ICON_TRASH; posterWsClearEl.title = MSG.wsEmptyTip; posterWsClearEl.setAttribute('aria-label', MSG.wsEmpty); }
  setAttr('contentTop', 'aria-label', MSG.sbTopTip);
  setAttr('tileSlider', 'title', MSG.tileSizeTip);
  setText('postResetBtn', MSG.reset);
  setAttr('settingsClose', 'aria-label', MSG.close);
  setAttr('settingsClose', 'title', MSG.close);
  setAttr('searchBox', 'placeholder', MSG.searchPlaceholder);
  setAttr('sbTagSearch', 'placeholder', MSG.searchTags);
  setAttr('sbAuthorSearch', 'placeholder', MSG.searchAuthors);
  // segments: icon always, label shown only on the active one (no tooltips —
  // the active label is the affordance). Labels live in their own span so the
  // SVG glyph survives.
  setText('viewCardLabel', MSG.viewCard);
  setText('viewTileLabel', MSG.viewTile);
  setText('viewListLabel', MSG.viewList);
  setText('posterViewCardLabel', MSG.viewCard);
  setText('posterViewTileLabel', MSG.viewTile);
  setText('posterViewListLabel', MSG.viewList);
  setText('browsePostsLabel', MSG.browsePosts);
  setText('browsePostersLabel', MSG.browsePosters);
  setText('browseCollectionsLabel', MSG.browseCollections);
  { const bt = document.getElementById('browseToggle'); if (bt) bt.title = MSG.browseModeTitle; }
  // Per-button tooltips so the icon-only (inactive) segments still name themselves on hover.
  { const lbl = { posts: MSG.browsePosts, posters: MSG.browsePosters, collections: MSG.browseCollections };
    document.querySelectorAll('#browseToggle button').forEach((b) => { if (lbl[b.dataset.mode]) b.title = lbl[b.dataset.mode]; }); }
  setText('sbCollectionSortTitle', MSG.sbCollectionSortTitle);
  setText('collectionNewLabel', MSG.collNew);
  { const cs = document.getElementById('collectionSortSelect');
    if (cs) { cs.options[0].textContent = MSG.collSortName; cs.options[1].textContent = MSG.collSortRecent; cs.options[2].textContent = MSG.collSortCount; } }
  setText('sbPosterSortTitle', MSG.sbPosterSortTitle);
  // Poster filter rows reuse the post-side row labels (same concepts).
  setText('sbPosterFilterTitle', MSG.sbFilterTitle);
  setText('sbPosterPlatformRowName', MSG.qfPlatform);
  setText('sbPosterWorkRowName', MSG.kindWork);
  setText('sbPosterCharRowName', MSG.kindCharacter);
  setText('sbPosterTagRowName', MSG.qfTag);
  setText('sbPosterInstRowName', MSG.qfInstance);
  setText('sbPosterDateRowName', MSG.qfDate);
  setText('sbPosterFolderRowName', MSG.qfCatFolder);
  { const ps = document.getElementById('posterSortSelect');
    if (ps) { ps.options[0].textContent = MSG.posterSortCount; ps.options[1].textContent = MSG.posterSortName;
      if (ps.options[2]) ps.options[2].textContent = MSG.posterSortNewest;
      if (ps.options[3]) ps.options[3].textContent = MSG.posterSortOldest; } }
  { const pd = document.getElementById('posterDateDim');
    if (pd) { pd.options[0].textContent = MSG.posterDateLastPost; pd.options[1].textContent = MSG.posterDateLastCapture; pd.options[2].textContent = MSG.posterDateCreated; } }
  setText('posterDateDimLabel', MSG.posterDateDimLabel);
  setText('posterDateRangeLabel', MSG.posterDateRangeLabel);
  setText('posterDateApply', MSG.qfApply);
  setText('posterDateClear', MSG.posterDateClear);
  setText('settingsThemeTitle', MSG.themeTitle);
  setText('settingsThemeLabel', MSG.themeMode);
  setText('themeOptAuto', MSG.themeAuto);
  setText('themeOptLight', MSG.themeLight);
  setText('themeOptDark', MSG.themeDark);
  setText('hintTheme', MSG.hintTheme);
  setText('settingsLangTitle', MSG.langTitle);
  setText('langAuto', MSG.langAuto);
  setText('hintLang', MSG.hintLang);
  document.getElementById('langSelect').value = lang;
  document.getElementById('langSelect').addEventListener('change', async (e) => {
    await window.corpus.setPref('language', e.target.value);
    location.reload();
  });
  setText('settingsShortcutTitle', MSG.shortcutTitle);
  setText('shortcutLink', MSG.shortcutLink);
  setText('hintShortcut', MSG.hintShortcut);
  setText('settingsDataTitle', MSG.dataTitle);
  setText('saveFolderSubTitle', MSG.saveFolderSubTitle);
  setText('chooseSaveFolder', MSG.saveFolderChange);
  setText('hintSaveFolder', MSG.saveFolderHint);
  setText('saveFolderProgressTitle', MSG.saveFolderProgressTitle);
  setText('exportZip', MSG.exportZip);
  setText('importZip', MSG.importZip);
  setText('importImages', MSG.importImages);
  setText('exportModeFull', MSG.exportModeFull);
  setText('exportModeImages', MSG.exportModeImages);
  setText('hintZip', MSG.hintZip);
  setText('hintMedia', MSG.hintMedia);
  setText('backupSubTitle', MSG.backupSubTitle);
  setText('hintBackup', MSG.hintBackup);
  setText('chooseBackupDir', MSG.backupChoose);
  setText('clearBackupDir', MSG.backupClear);
  setText('backupIntervalLabel', MSG.backupInterval);
  setText('backupIntervalEvery', MSG.backupIntervalUnit);
  setText('unitDay', MSG.unitDay);
  setText('unitWeek', MSG.unitWeek);
  setText('unitMonth', MSG.unitMonth);
  setText('settingsTrashTitle', MSG.trashTitle);
  setText('emptyTrash', MSG.trashEmptyBtn);
  setText('settingsDangerTitle', MSG.dangerTitle);
  setText('labelResetDeleteConfirm', MSG.labelResetDeleteConfirm);
  setText('hintResetDeleteConfirm', MSG.hintResetDeleteConfirm);
  setText('clearData', MSG.clearData);
  setText('confirmCancel', MSG.confirmCancel);
  setText('confirmOk', MSG.confirmOk);
  setText('settingsStatus', MSG.saved);
  setText('confirmSkipText', MSG.confirmSkip);

  // Edit overlay i18n
  setText('editTagsLabel', MSG.tagsLabel);
  document.getElementById('editTagInput').placeholder = MSG.tagPlaceholder;
  document.getElementById('editTagAdd').textContent = MSG.addTag;
  document.getElementById('editCancel').textContent = MSG.confirmCancel;
  document.getElementById('editSave').textContent = MSG.save;

  // Toolbar section titles (検索 / 並び順 / 表示). The search-mode label is set on
  // the in-bar toggle button by syncSearchToggle (the old select was removed).
  setText('sbSearchTitle', MSG.sbSearchTitle);
  setText('sbSortTitle', MSG.sbSortTitle);
  // Engagement sentence particle (「…が 0 以上」); en has none → hide the span
  setText('sbEngParticle', MSG.engParticle);
  const engParticleEl = document.getElementById('sbEngParticle');
  if (engParticleEl && !MSG.engParticle) engParticleEl.style.display = 'none';
  setText('sbFilterTitle', MSG.sbFilterTitle);
  setText('activebarLabel', MSG.activebarLabel);
  setText('sbWorkRowTitle', MSG.kindWork);
  setText('sbCharRowTitle', MSG.kindCharacter);
  setText('sbTagRowTitle', MSG.qfTag);
  setText('sbHashtagRowTitle', MSG.tabTags);
  setText('sbFolderRowTitle', MSG.qfCatFolder);
  setText('tileOverlayLabel', MSG.tileOverlay);
  document.getElementById('sbTop').title = MSG.sbTopTip;

  // Sort select options
  const sortSelect = document.getElementById('sortSelect');
  sortSelect.options[0].textContent = MSG.sortDateDesc;
  sortSelect.options[1].textContent = MSG.sortDateAsc;
  sortSelect.options[2].textContent = MSG.sortLikes;
  sortSelect.options[3].textContent = MSG.sortReposts;
  sortSelect.options[4].textContent = MSG.sortReplies;
  sortSelect.options[5].textContent = MSG.sortCaptured;
  sortSelect.options[6].textContent = MSG.sortLikesPct;

  // --- Disclosure chevrons (thin SVG; right = flyout indicator, down = collapsible) ---
  const CHEV_R = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 1.5l4 4-4 4"/></svg>';
  const CHEV_D = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 3.5l4 4 4-4"/></svg>';
  // Geometric check (replaces the ✓ glyph, which read as thin/cursive). Thick
  // stroke + high-contrast monotone color via .fm-check.
  const CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17 19 7"/></svg>';

  // --- Custom glass dropdown: a native <select> popup is OS-drawn and can't
  // be glassed, so we hide the select (keeping it as the value source — all
  // existing change handlers still fire) and drive a field-styled trigger +
  // a glass option list that matches the flyout menus. ---
  const csHosts = [];
  const csPop = document.createElement('div');
  // glass-frost (tier B): pulldowns open over the sparse sidebar, so a frosted
  // mid-opacity material reads as glass without busy content behind it.
  csPop.className = 'fold-menu cs-pop glass-frost';
  document.body.appendChild(csPop);
  let csSel = null, csBtn = null;
  function hideCsPop() { csPop.classList.remove('show'); csSel = null; csBtn = null; }
  function csLabel(sel) { const o = sel.options[sel.selectedIndex]; return o ? o.textContent : ''; }
  function refreshCustomSelects() { for (const s of csHosts) if (s.__csBtn) s.__csBtn.querySelector('.cs-label').textContent = csLabel(s); }
  function openCsPop(sel, btn) {
    if (csPop.classList.contains('show') && csSel === sel) { hideCsPop(); return; }
    csSel = sel; csBtn = btn;
    csPop.innerHTML = Array.from(sel.options).map((o, i) =>
      `<div class="fm-row cs-opt${i === sel.selectedIndex ? ' cs-on' : ''}" data-i="${i}"><span class="fm-name">${escapeHtml(o.textContent)}</span>${i === sel.selectedIndex ? `<span class="fm-check">${CHECK_SVG}</span>` : ''}</div>`).join('');
    const r = btn.getBoundingClientRect();
    csPop.style.left = r.left + 'px';
    csPop.style.top = (r.bottom + 4) + 'px';
    csPop.style.minWidth = r.width + 'px';
    csPop.classList.add('show');
    const pr = csPop.getBoundingClientRect();
    if (pr.bottom > innerHeight - 8) csPop.style.top = Math.max(8, r.top - pr.height - 4) + 'px';
    if (pr.right > innerWidth - 8) csPop.style.left = Math.max(8, innerWidth - pr.width - 8) + 'px';
  }
  csPop.addEventListener('click', (e) => {
    const opt = e.target.closest('.cs-opt');
    if (!opt || !csSel) return;
    const idx = parseInt(opt.dataset.i, 10);
    if (idx !== csSel.selectedIndex) {
      csSel.selectedIndex = idx;
      csSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    refreshCustomSelects();
    hideCsPop();
  });
  document.addEventListener('click', (e) => {
    if (csPop.classList.contains('show') && !csPop.contains(e.target) && !(csBtn && csBtn.contains(e.target))) hideCsPop();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCsPop(); });
  function enhanceSelect(sel) {
    if (!sel || sel.__csBtn) return;
    sel.classList.add('cs-host');
    csHosts.push(sel);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cs-btn';
    btn.innerHTML = '<span class="cs-label"></span><span class="cs-arrow">' + CHEV_D + '</span>';
    btn.querySelector('.cs-label').textContent = csLabel(sel);
    sel.insertAdjacentElement('afterend', btn);
    sel.__csBtn = btn;
    btn.addEventListener('click', (e) => { e.stopPropagation(); openCsPop(sel, btn); });
  }
  enhanceSelect(sortSelect);
  enhanceSelect(document.getElementById('posterSortSelect'));
  enhanceSelect(document.getElementById('collectionSortSelect'));

  // --- Query Field ---
  const ENG_TYPE_LABELS = {
    likes: MSG.qfEngLikes,
    reposts: MSG.qfEngReposts,
    replies: MSG.qfEngReplies,
    bookmarks: MSG.qfEngBookmarks,
    views: MSG.qfEngViews
  };

  // Returns the human-readable label for a single active filter. Shared by
  // the query-chip renderer and the tab title generator.
  function filterLabel(f) {
    switch (f.type) {
      case 'kind':       return f.value === 'post' ? MSG.kindPost : MSG.kindImage;
      case 'platform':   return f.value === '__none' ? MSG.qfPlatformNone : (PF_NAME[f.value] || f.value);
      case 'postType':   return f.value === 'post' ? MSG.qfPost : f.value === 'reply' ? MSG.qfReply : f.value === 'quote' ? MSG.qfQuote : MSG.qfThread;
      case 'date': {
        const typeName = f.dateField === 'capturedAt' ? MSG.qfDateCaptured : MSG.qfDatePost;
        const fromStr = f.from ? formatShortDate(f.from) : '';
        const toStr = f.to ? formatShortDate(f.to) : '';
        return `${typeName}: ${fromStr}〜${toStr}`;
      }
      case 'engagement': return `${ENG_TYPE_LABELS[f.engType] || f.engType} ${f.op === 'lte' ? '≤' : '≥'} ${formatCount(f.min)}`;
      case 'tag':        return f.value;
      case 'hashtag':    return `#${f.value}`;
      case 'folder': {   const fobj = CF() && CF().byId(f.value); return fobj ? fobj.name : f.value; }
      case 'workspace':  return MSG.workspaceTitle;
      case 'media':      return f.value === 'image' ? MSG.qfImage : f.value === 'video' ? MSG.qfVideo : MSG.qfGif;
      case 'instance':   return f.value;
      case 'user':       return f.label || f.value;
      default:           return f.value || f.type;
    }
  }

  // Derives a tab title from a snapshot state. Pure function (no DOM reads).
  // All active labels joined with ・ in priority order so every tab is unique.
  function tabTitleOf(state, ctx) {
    const filters  = (state && state.f) || [];
    const search   = (state && state.search) || '';
    const multi    = !!(state && state.multi);
    const allCount = (ctx && ctx.allCount != null) ? ctx.allCount : 0;

    if (!filters.length && !search && !multi) {
      return { text: MSG.filterAll + '(' + formatCount(allCount) + ')', iconType: 'all' };
    }

    const parts = [];
    let primaryIconType = null;
    const add = (label, iconType) => { parts.push(label); if (!primaryIconType) primaryIconType = iconType; };

    if (search) { const q = search.length > 12 ? search.slice(0, 12) + '…' : search; add('”' + q + '”', 'search'); }

    const byType = {};
    filters.forEach((f) => { (byType[f.type] = byType[f.type] || []).push(f); });

    if (byType.tag)        byType.tag.forEach((f)        => add(filterLabel(f), 'tag'));
    if (byType.hashtag)    byType.hashtag.forEach((f)    => add(filterLabel(f), 'hashtag'));
    if (byType.user)       byType.user.forEach((f)       => add(filterLabel(f), 'user'));
    filters.filter((f) => f.type === 'platform' || f.type === 'instance').forEach((f) => add(filterLabel(f), f.type));
    filters.filter((f) => f.type === 'postType'  || f.type === 'media').forEach((f) => add(filterLabel(f), f.type));
    if (multi && !byType.media) add(MSG.qfMultiImage, 'media');
    if (byType.date)       byType.date.forEach((f)       => add(filterLabel(f), 'date'));
    if (byType.engagement) byType.engagement.forEach((f) => add(filterLabel(f), 'engagement'));
    if (byType.kind)       byType.kind.forEach((f)       => add(filterLabel(f), 'kind'));
    filters.filter((f) => f.type === 'workspace' || f.type === 'folder').forEach((f) => add(filterLabel(f), f.type));

    return { text: parts.join('・'), iconType: primaryIconType || 'all' };
  }

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
    workspace: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  };
  const qcGlyph = (type) => (QC_GLYPH[type]
    ? `<svg class="qc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${QC_GLYPH[type]}</svg>`
    : '');

  function formatShortDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    const thisYear = new Date().getFullYear().toString();
    return y === thisYear ? `${parseInt(m)}/${parseInt(d)}` : `${y}/${parseInt(m)}/${parseInt(d)}`;
  }

  // Card footer date: ONE compact date (Ivory/Tweetbot cell anatomy — full
  // timestamps belong to the tooltip and the inspector, not the card).
  // Month-name short date (e.g. "Jun 13" / "6月13日") — a bare "6/13" reads as a
  // fraction / page count next to the ×N image badge (user report). Formatters
  // cached: compactDate runs once per card × up to 150 cards.
  const _compactFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const _compactFmtY = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  function compactDate(ds) {
    if (!ds) return '';
    const d = new Date(ds);
    if (isNaN(d)) return '';
    return d.getFullYear() === new Date().getFullYear()
      ? _compactFmt.format(d)
      : _compactFmtY.format(d);
  }

  const PF_NAME = { x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' };

  // 全フィルタを一括リセット（アクティブフィルタバーの「リセット」）。検索・フォルダ・
  // 日付・エンゲージも含めて消す。afterQueryChange() が sidebar の active 状態も同期。
  function resetAllFilters() {
    // Bounce back to the poster grid only if we drilled in from a poster AND that
    // poster's user filter is still active (check before emptying the tree).
    const bounce = posterReturn && qHasValue('user', posterReturn);
    postQB.resetTree();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('searchBox', ''); set('sbDateFrom', ''); set('sbDateTo', ''); set('sbEngMin', '');
    afterQueryChange();
    posterReturn = null;
    if (bounce) setBrowseMode('posters');
  }
  document.getElementById('postResetBtn').addEventListener('click', resetAllFilters);

  // Back/forward through the per-tab view history: buttons + Alt+←/→ + mouse
  // side buttons. Guarded so they never fire while typing, with an overlay open,
  // or in poster mode (mirrors the Ctrl+A guard convention).
  document.getElementById('navBackBtn').addEventListener('click', navBack);
  document.getElementById('navFwdBtn').addEventListener('click', navForward);
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!navAllowed()) return;
    e.preventDefault();
    if (e.key === 'ArrowLeft') navBack(); else navForward();
  });
  // Mouse back/forward (buttons 3/4). DOM events fire in the renderer on most
  // platforms; preventDefault stops any stray in-page navigation.
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    if (!navAllowed()) return;
    e.preventDefault();
    if (e.button === 3) navBack(); else navForward();
  });

  // Empty-state CTAs (innerHTML rebuilds the buttons each render → delegate)
  document.getElementById('emptyState').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'emptyResetBtn') {
      if (browseMode === 'posters') { document.getElementById('searchBox').value = ''; renderPosters(); }
      else resetAllFilters();
    }
    else if (btn.id === 'emptyImportBtn') document.getElementById('importZipInput').click();
  });

  // --- カテゴリ値フライアウト: サイドバーの行/タググループボタンの横に開く ----
  const qfPop = document.createElement('div');
  qfPop.className = 'fold-menu qf-pop';
  document.body.appendChild(qfPop);
  let qfCat = null;
  let qfAnchor = null;     // 同じ行をもう一度押したら閉じる（トグル）
  let qfTagGroup = null;   // タグサブ行クリック時にセット（グループ絞り込み）
  function hideQfPop() {
    document.querySelectorAll('#filterRows .qf-open, #posterFilterRows .qf-open').forEach(r => r.classList.remove('qf-open'));
    qfPop.classList.remove('show'); qfCat = null; qfAnchor = null; qfTagGroup = null;
  }
  function qfValues(cat) {
    // "on" = this value already exists anywhere in the query tree.
    const act = (type, v) => qHasValue(type, v);
    switch (cat) {
      case 'kind': return [['post', MSG.kindPost], ['image', MSG.kindImage]].map(([v, l]) => ({ v, l, on: act('kind', v) }));
      case 'platform': {
        // Misskey/Mastodon の直下に各インスタンスをサブ行で展開（独立に選択可）
        const hostsOf = (plat) => {
          const set = new Set();
          for (const p of allPosts) if (p.platform === plat) { const h = hostOf(p.url); if (h) set.add(h); }
          return [...set].sort();
        };
        const out = [];
        for (const v of ['x', 'bluesky', 'misskey', 'mastodon', 'pixiv']) {
          out.push({ v, l: PF_NAME[v], on: act('platform', v) });
          if (v === 'misskey' || v === 'mastodon') {
            for (const h of hostsOf(v)) out.push({ v: h, l: h, on: act('instance', h), type: 'instance', sub: true });
          }
        }
        // 「プラットフォームなし」= platform 未設定の投稿（取り込み画像など）。
        // 該当が1件もなければ出さない（空振りする項目を並べない）。
        if (allPosts.some(p => !p.platform)) out.push({ v: '__none', l: MSG.qfPlatformNone, on: act('platform', '__none') });
        return out;
      }
      case 'postType': return [['post', MSG.qfPost], ['reply', MSG.qfReply], ['quote', MSG.qfQuote], ['thread', MSG.qfThread]].map(([v, l]) => ({ v, l, on: act('postType', v) }));
      case 'media': {
        const out = [['image', MSG.qfImage], ['video', MSG.qfVideo], ['gif', MSG.qfGif]].map(([v, l]) => ({ v, l, on: act('media', v) }));
        // 複数画像 = group-level (>1 image); the old standalone checkbox folded
        // in here since it's an attachment property. Routed to multiOnly, not
        // a per-record media filter (which is mediaType image/video/gif).
        out.push({ v: '__multi', l: MSG.qfMultiImage, on: multiOnly });
        return out;
      }
      case 'poster-tag': {
        // Poster-mode sidebar tag filter: lists GENERAL (non-kinded) tags applied to
        // posters. 作品/キャラ live in their own rows. Picking one adds/removes a tag leaf
        // in the poster query tree (posterQB), NOT the post query. "on" = already chosen.
        return posterFilterVocab().filter((t) => !tagKindOf(t)).map((t) => ({ v: t, l: t, on: posterQB.qHasValue('tag', t) }));
      }
      case 'poster-work':
      case 'poster-character': {
        // 作品/キャラ rows: the poster tags whose 種別 matches. They map to the same tag
        // leaf type as the general タグ row; the kind only scopes which this flyout offers.
        const kind = cat === 'poster-work' ? 'work' : 'character';
        return posterFilterVocab().filter((t) => tagKindOf(t) === kind).map((t) => ({ v: t, l: t, on: posterQB.qHasValue('tag', t), kind }));
      }
      case 'poster-platform': {
        const present = new Set(namedPosters().map((u) => u.platform).filter(Boolean));
        return [...present].sort((a, b) => { const ia = PF_ORDER.indexOf(a), ib = PF_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); })
          .map((v) => ({ v, l: PF_NAME[v] || v, on: posterQB.qHasValue('platform', v) }));
      }
      case 'poster-instance': {
        const hosts = new Set();
        for (const u of namedPosters()) if (u.instance) hosts.add(u.instance);
        return [...hosts].sort().map((h) => ({ v: h, l: h, on: posterQB.qHasValue('instance', h) }));
      }
      case 'poster-folder': return pfStore.all().map((f) => ({ v: f.id, l: f.name, on: posterQB.qHasValue('folder', f.id) }));
      case 'work':
      case 'character': {
        // 用語帳 (Phase 2 ②): a 作品/キャラ section lists the tags whose 種別 matches.
        // They ARE tags (type:'tag'), so picking one adds an ordinary tag filter —
        // the kind only scopes which tags this flyout offers.
        const kindTags = [...new Set(allPosts.flatMap(p => p.tags || []))].sort()
          .filter(t => tagKindOf(t) === cat);
        return kindTags.map(t => ({ v: t, l: t, on: act('tag', t), type: 'tag' }));
      }
      case 'tag': {
        // Include tags from all posts (incl. imported url-less images), not just SNS posts.
        // 用語帳: kinded tags live in the 作品/キャラ rows — the タグ flyout is general-only.
        const allTags = [...new Set(allPosts.flatMap(p => p.tags || []))].filter(t => !tagKindOf(t)).sort();
        if (qfTagGroup) {
          if (qfTagGroup === '__other') {
            const grouped = new Set(tagGroups.flatMap(g => g.tags || []));
            return allTags.filter(t => !grouped.has(t)).map(t => ({ v: t, l: t, on: act('tag', t) }));
          }
          const g = tagGroups.find(x => x.id === qfTagGroup);
          if (g) return (g.tags || []).filter(t => allTags.includes(t)).map(t => ({ v: t, l: t, on: act('tag', t) }));
          return [];
        }
        if (!tagGroups.length) return allTags.map(t => ({ v: t, l: t, on: act('tag', t) }));
        const grouped = new Set();
        const out = [];
        for (const g of tagGroups) {
          const own = (g.tags || []).filter(t => allTags.includes(t));
          if (!own.length) continue;
          own.forEach(t => grouped.add(t));
          out.push({ ghead: g.name || '' });
          own.forEach(t => out.push({ v: t, l: t, on: act('tag', t) }));
        }
        const rest = allTags.filter(t => !grouped.has(t));
        if (rest.length) {
          out.push({ ghead: MSG.tagGroupOther });
          rest.forEach(t => out.push({ v: t, l: t, on: act('tag', t) }));
        }
        return out;
      }
      case 'hashtag': {
        const counts = {};
        allPosts.forEach(p => (p.hashtags || []).forEach(h => { counts[h] = (counts[h] || 0) + 1; }));
        return Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map(h => ({ v: h, l: '#' + h, on: act('hashtag', h) }));
      }
      case 'folder': return (CF() ? CF().all() : []).map(f => ({ v: f.id, l: f.name, on: act('folder', f.id) }));
      case 'user': return buildUsers().sort((a, b) => b.count - a.count).slice(0, 100)
        .map(u => ({ v: u.key, l: u.displayName || u.screenName || '(unknown)', sn: u.screenName, on: act('user', u.key) }));
      case 'instance': {
        const hosts = new Map();
        for (const p of allPosts) {
          if (p.platform !== 'misskey' && p.platform !== 'mastodon') continue;
          const h = hostOf(p.url);
          if (h) hosts.set(h, (hosts.get(h) || 0) + 1);
        }
        return [...hosts.keys()].sort().map(h => ({ v: h, l: h, on: act('instance', h) }));
      }
      default: return [];
    }
  }
  function renderQfPop() {
    if (!qfCat) return;
    const items = qfValues(qfCat);
    const rowOf = (it) => {
      if (it.ghead != null) return `<div class="qf-ghead">${escapeHtml(it.ghead)}</div>`;
      // 種別 dot (用語帳): a tag carrying it.kind ('work'/'character') wears the
      // shared category dot so the poster-tag flyout isn't flattened (作品=紫/キャラ=緑).
      const kindDot = it.kind ? `<span class="tk-dot tk-${it.kind}" title="${escapeAttr(kindLabel(it.kind))}"></span>` : '';
      return `<div class="fm-row${it.sub ? ' fm-sub' : ''}" data-qfval="${escapeAttr(it.v)}"${it.type ? ` data-qftype="${it.type}"` : ''}${it.sn ? ` data-sn="${escapeAttr(it.sn)}"` : ''}>${kindDot}<span class="fm-name">${escapeHtml(it.l)}</span>${it.on ? `<span class="fm-check">${CHECK_SVG}</span>` : ''}</div>`;
    };
    const listHtml = items.map(rowOf).join('');
    // 長いリスト（タグ/作者など）はその場で絞り込める入力を付ける
    // Find box only for genuinely long, open-ended lists (tags/authors). The
    // platform list is short + fixed (5 PFs + their instances), so no find box.
    const valueCount = items.filter(it => it.ghead == null).length;
    const find = (!['platform', 'poster-platform'].includes(qfCat) && (qfTagGroup || valueCount > 8))
      ? `<div class="qf-find-wrap"><input type="text" class="qf-find" id="qfFind" placeholder="${MSG.qfFindPh}" autocomplete="off"><button type="button" class="qf-mode-btn" id="qfModeBtn"></button></div>`
      : '';
    // No heading row: the user already clicked the category row, so repeating
    // its name as a (hover-highlighted, seemingly-clickable) row was noise.
    const footer = ((qfCat === 'folder' || qfCat === 'poster-folder') && CF())
      ? `<div class="qf-footer"><button class="qf-footer-link" type="button" id="qfFolderManage">${escapeHtml(MSG.ctxManage)}</button></div>`
      : '';
    qfPop.innerHTML =
      find +
      `<div class="qf-vals">` + (listHtml || `<div class="qf-zone-empty" style="padding:6px 8px;">—</div>`) + `</div>` +
      footer;
    const fi = document.getElementById('qfFind');
    if (fi) setTimeout(() => fi.focus(), 0);
    syncQfMode();   // label the in-bar 通常/あいまい toggle
  }
  // 値リストの絞り込み（再描画せず行の表示/非表示だけ切替＝入力フォーカス維持）。
  // 検索方式（通常=部分一致 / あいまい=corpusSearch）はメイン検索と共有。
  function applyQfFind() {
    const fi = document.getElementById('qfFind');
    if (!fi) return;
    const raw = fi.value.trim().toLowerCase();
    const atMode = raw.startsWith('@');
    const q = atMode ? raw.slice(1) : raw;
    const matcher = (q && window.corpusSearch && window.corpusSearch.isFuzzy()) ? window.corpusSearch.compile(q) : null;
    const hit = (hay) => { const s = String(hay || ''); return matcher ? matcher(s) : s.toLowerCase().includes(q); };
    qfPop.querySelectorAll('.qf-vals .fm-row').forEach((row) => {
      const match = !q || (atMode ? hit(row.dataset.sn || '') : hit(row.textContent));
      row.style.display = match ? '' : 'none';
    });
    qfPop.querySelectorAll('.qf-vals .qf-ghead').forEach((h) => { h.style.display = q ? 'none' : ''; });
  }
  // フライアウトのバー内トグルにラベルを反映（メイン検索ボタンと同じ表示）。
  function syncQfMode() {
    const mb = document.getElementById('qfModeBtn');
    if (!mb || !window.corpusSearch) return;
    const fz = window.corpusSearch.isFuzzy();
    mb.textContent = fz ? MSG.searchFuzzy : MSG.searchExact;
    mb.classList.toggle('fuzzy', fz);
    mb.title = MSG.searchModeTitle;
  }
  // Keep the in-flyout toggle labeled correctly when the mode is changed elsewhere
  // (e.g. the main #searchModeBtn). syncQfMode no-ops while the flyout is closed
  // because #qfModeBtn is absent from the DOM (its `if (!mb) return` guard). Registered
  // once here — same scope as the qfPop listeners below (runs on setup, not per render).
  if (window.corpusSearch) window.corpusSearch.onChange(syncQfMode);
  qfPop.addEventListener('input', (e) => { if (e.target.classList.contains('qf-find')) applyQfFind(); });
  // 行/グループボタンの横にフライアウトを開く（同じアンカー再クリックで閉じる）
  function showQfPopAt(cat, anchorEl, tagGroupId) {
    if (qfPop.classList.contains('show') && qfAnchor === anchorEl) { hideQfPop(); return; }
    document.querySelectorAll('#filterRows .qf-open, #posterFilterRows .qf-open').forEach(r => r.classList.remove('qf-open'));
    anchorEl.classList.add('qf-open');
    qfCat = cat;
    qfAnchor = anchorEl;
    qfTagGroup = tagGroupId || null;
    renderQfPop();
    qfPop.classList.add('show');
    // Right-anchored flyout; maxHeight caps a long value list so its inner .qf-vals
    // scrolls instead of overrunning the viewport bottom (shared placeFlyout).
    placeFlyout(qfPop, anchorEl.getBoundingClientRect(), { maxHeight: true });
  }
  qfPop.addEventListener('click', (e) => {
    if (e.target.closest('#qfFolderManage')) {
      if (CF()) {
        // Reuse the shared modal for whichever folder store this flyout is about.
        if (qfCat === 'poster-folder') CF().openManager({ store: pfStore, onChange: () => { renderPosterFilterRows(); renderPosters(); } });
        else CF().openManager();
      }
      hideQfPop(); return;
    }
    // バー内の 通常/あいまい トグル（メイン検索と共有のモードを切替→絞り込み再適用）
    if (e.target.closest('.qf-mode-btn')) {
      if (window.corpusSearch) window.corpusSearch.toggle();
      syncQfMode();
      applyQfFind();
      const fi = document.getElementById('qfFind'); if (fi) fi.focus();
      return;
    }
    const val = e.target.closest('[data-qfval]');
    if (val && qfCat) {
      const v = val.dataset.qfval;
      // 複数画像 (media flyout): toggles the group-level multiOnly, not a filter.
      if (qfCat === 'media' && v === '__multi') {
        multiOnly = !multiOnly;
        renderQfPop();
        renderFilterBadges();
        renderPosts();
        return;
      }
      // Poster flyouts toggle a top-level leaf in the poster query tree (addFilter /
      // removeByLeaf both refresh rows + bar + grid); the flyout stays open for picks.
      // 作品/キャラ/タグ all map to one tag leaf type (種別 only scopes which the row offers).
      if (qfCat === 'poster-tag' || qfCat === 'poster-work' || qfCat === 'poster-character') {
        if (posterQB.qHasValue('tag', v)) posterQB.removeByLeaf('tag', v); else posterQB.addFilter({ type: 'tag', value: v });
        renderQfPop();
        return;
      }
      if (qfCat === 'poster-platform') {
        if (posterQB.qHasValue('platform', v)) posterQB.removeByLeaf('platform', v); else posterQB.addFilter({ type: 'platform', value: v });
        renderQfPop();
        return;
      }
      if (qfCat === 'poster-instance') {
        if (posterQB.qHasValue('instance', v)) posterQB.removeByLeaf('instance', v); else posterQB.addFilter({ type: 'instance', value: v });
        renderQfPop();
        return;
      }
      if (qfCat === 'poster-folder') {
        // folder is single-valued (singleValueTypes): addFilter replaces any existing folder leaf.
        if (posterQB.qHasValue('folder', v)) posterQB.removeByLeaf('folder', v); else posterQB.addFilter({ type: 'folder', value: v });
        renderQfPop();
        return;
      }
      const vtype = val.dataset.qftype || qfCat;   // sub-rows (instances) override the type
      const i = activeFilters.findIndex(f => f.type === vtype && f.value === v);
      if (i >= 0) {
        removeFilter(i);
      } else if (vtype === 'tag' || vtype === 'folder' || vtype === 'hashtag') {
        addFilter({ type: vtype, value: v });
      } else if (vtype === 'user') {
        const u = buildUsers().find(x => x.key === v);
        addFilter({ type: 'user', value: v, label: u ? (u.displayName || u.screenName) : v });
      } else {
        addFilter({ type: vtype, value: v });
      }
      if (vtype === 'folder') renderPostFolders();
      updateSidebarState();
      renderQfPop();   // stays open so several values can be picked in a row
    }
  });
  document.addEventListener('click', (e) => {
    // a row click re-renders the popover, detaching e.target — that's an INSIDE
    // click even though contains() can no longer see it
    if (!document.contains(e.target)) return;
    if (qfPop.classList.contains('show') && !qfPop.contains(e.target) &&
        !e.target.closest('.sb-row') && !e.target.closest('[data-tag-group]') &&
        !e.target.closest('[data-poster-tag-add]')) hideQfPop();
    // date/eng popovers (no backdrop now): close on outside click, but NOT on a
    // filter-row click — those switch to the new row (handled by the row handler).
    const dp = document.getElementById('qfDatePopover');
    const ep = document.getElementById('qfEngPopover');
    const pd = document.getElementById('posterDatePopover');
    if ((dp.style.display === 'block' || ep.style.display === 'block' || (pd && pd.style.display === 'block')) &&
        !dp.contains(e.target) && !ep.contains(e.target) && !(pd && pd.contains(e.target)) &&
        !e.target.closest('.sb-row') && !e.target.closest('[data-tag-group]')) closeAllMenus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideQfPop(); closeAllMenus(); } });

  // --- ⓘ クエリビルダの使い方（初見向けの説明ポップオーバー） ---------------
  const qbHelpPop = document.createElement('div');
  qbHelpPop.className = 'qb-help-pop';
  document.body.appendChild(qbHelpPop);
  function hideQbHelp() { qbHelpPop.classList.remove('show'); }
  function showQbHelp() {
    const btn = document.getElementById('qbHelpBtn');
    if (!btn) return;
    qbHelpPop.innerHTML = `<div class="qh-title">${escapeHtml(MSG.qbHelpTitle)}</div>` +
      [MSG.qbHelp1, MSG.qbHelp2, MSG.qbHelp3, MSG.qbHelp4, MSG.qbHelp5, MSG.qbHelp6]
        .map((t) => `<div class="qh-row">${escapeHtml(t)}</div>`).join('');
    const r = btn.getBoundingClientRect();
    qbHelpPop.style.left = r.left + 'px';
    qbHelpPop.style.top = (r.bottom + 6) + 'px';
    qbHelpPop.classList.add('show');
    const pr = qbHelpPop.getBoundingClientRect();
    if (pr.right > innerWidth - 8) qbHelpPop.style.left = Math.max(8, innerWidth - pr.width - 8) + 'px';
  }
  // Hover (and keyboard focus) to reveal — it's a passive hint, no click needed.
  const qbHelpBtn = document.getElementById('qbHelpBtn');
  qbHelpBtn.addEventListener('mouseenter', showQbHelp);
  qbHelpBtn.addEventListener('mouseleave', hideQbHelp);
  qbHelpBtn.addEventListener('focus', showQbHelp);
  qbHelpBtn.addEventListener('blur', hideQbHelp);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideQbHelp(); });

  // 日付/エンゲージのポップオーバーは値フライアウト(qfPop)と同じ「行クリックで開閉・
  // 外側クリックで閉じる」挙動に統一する。旧実装は全画面 .qf-backdrop(z999) が
  // クリックを奪い、開いている間は他の行へワンクリックで切り替えられなかった
  // （クリックが backdrop に吸われて closeAllMenus するだけ＝ユーザー報告のバグ）。
  // backdrop は撤去し、下の document クリックハンドラ + 行ハンドラで開閉する。
  function closeAllMenus() {
    document.getElementById('qfDatePopover').style.display = 'none';
    document.getElementById('qfEngPopover').style.display = 'none';
    const pd = document.getElementById('posterDatePopover'); if (pd) pd.style.display = 'none';
  }

  // Date popover. editingDateNode = the date cond being edited (null = new).
  let editingDateNode = null;

  function openDatePopover(node) {
    closeAllMenus();   // close the other popover if open (no backdrop anymore)
    editingDateNode = node || null;
    const existing = editingDateNode;
    const popover = document.getElementById('qfDatePopover');
    const anchor = document.querySelector('#filterRows [data-qfrow="date"]');
    const rect = anchor.getBoundingClientRect();

    document.getElementById('qfDateFrom').value = existing?.from || '';
    document.getElementById('qfDateTo').value = existing?.to || '';
    const dateType = existing?.dateField || 'date';
    const dateTypeBtn = document.getElementById('qfDateType');
    dateTypeBtn.textContent = dateType === 'capturedAt' ? MSG.qfDateCaptured : MSG.qfDatePost;
    dateTypeBtn.dataset.field = dateType;
    dateTypeBtn.classList.toggle('active', dateType === 'capturedAt');

    document.getElementById('qfDateDelete').style.display = editingDateNode ? '' : 'none';
    document.getElementById('qfDateDelete').textContent = MSG.qfDelete;
    document.getElementById('qfDateApply').textContent = MSG.qfApply;

    // Open to the RIGHT of the row (same as the category flyouts) — opening
    // straight down covered the rows below and made switching awkward.
    popover.style.display = 'block';
    placeFlyout(popover, rect);
  }

  document.getElementById('qfDateType').addEventListener('click', function() {
    const current = this.dataset.field;
    const next = current === 'date' ? 'capturedAt' : 'date';
    this.dataset.field = next;
    this.textContent = next === 'capturedAt' ? MSG.qfDateCaptured : MSG.qfDatePost;
    this.classList.toggle('active', next === 'capturedAt');
  });

  document.getElementById('qfDateApply').addEventListener('click', () => {
    const from = document.getElementById('qfDateFrom').value;
    const to = document.getElementById('qfDateTo').value;
    const dateField = document.getElementById('qfDateType').dataset.field;
    if (!from && !to) { closeAllMenus(); return; }
    if (editingDateNode) {
      // Edit in place (keeps its position / group in the tree).
      Object.assign(editingDateNode, { dateField, from, to });
      afterQueryChange();
    } else {
      addFilter({ type: 'date', dateField, from, to });   // replaces any existing date
    }
    closeAllMenus();
  });

  document.getElementById('qfDateDelete').addEventListener('click', () => {
    if (editingDateNode) removeNode(editingDateNode);
    closeAllMenus();
  });

  // Poster date-range popover (3 dims: 最終投稿日 / 最終取得日 / アカウント作成日).
  // Separate from the post date popover — writes the transient posterDate state.
  // arg = the date leaf to edit (from openLeafEditor) OR the row element (from the row click).
  // Range only — the 並べ替え方向 moved to the sort select (フィルタとソートの分離).
  function openPosterDatePopover(arg) {
    closeAllMenus();
    const editNode = (arg && arg.kind === 'cond') ? arg : null;
    editingPosterDateNode = editNode;
    const popover = document.getElementById('posterDatePopover');
    const anchor = document.querySelector('#posterFilterRows [data-qfrow="poster-date"]');
    if (!anchor) return;
    const existing = editNode || treeLeaves(posterQB.getTree()).find((c) => c.type === 'date');
    document.getElementById('posterDateDim').value = (existing && existing.dateField) || 'latest';
    document.getElementById('posterDateFrom').value = (existing && existing.from) || '';
    document.getElementById('posterDateTo').value = (existing && existing.to) || '';
    document.getElementById('posterDateClear').style.display = existing ? '' : 'none';
    popover.style.display = 'block';
    placeFlyout(popover, anchor.getBoundingClientRect());
  }
  document.getElementById('posterDateApply').addEventListener('click', () => {
    const dateField = document.getElementById('posterDateDim').value || 'latest';
    const from = document.getElementById('posterDateFrom').value || '';
    const to = document.getElementById('posterDateTo').value || '';
    if (!from && !to) { closeAllMenus(); return; }
    if (editingPosterDateNode) { Object.assign(editingPosterDateNode, { dateField, from, to }); posterQB.refresh(); }
    else posterQB.addFilter({ type: 'date', dateField, from, to });   // date is single-valued (replaces)
    closeAllMenus();
  });
  document.getElementById('posterDateClear').addEventListener('click', () => {
    posterQB.removeByType('date');
    closeAllMenus();
  });

  // Engagement popover. editingEngNode = the engagement cond being edited (null = new).
  let editingEngNode = null;

  function openEngPopover(node) {
    closeAllMenus();   // close the other popover if open (no backdrop anymore)
    editingEngNode = node || null;
    const existing = editingEngNode;
    const popover = document.getElementById('qfEngPopover');
    const anchor = document.querySelector('#filterRows [data-qfrow="engagement"]');
    const rect = anchor.getBoundingClientRect();

    const select = document.getElementById('qfEngType');
    select.innerHTML = Object.entries(ENG_TYPE_LABELS).map(([k, v]) =>
      `<option value="${k}">${escapeHtml(v)}</option>`
    ).join('');
    select.value = existing?.engType || 'likes';
    document.getElementById('qfEngMin').value = existing?.min || '';
    const opBtn = document.getElementById('qfEngOp');
    const op = existing?.op || 'gte';
    opBtn.textContent = op === 'lte' ? MSG.qfEngLte : MSG.qfEngGte;
    opBtn.dataset.op = op;
    opBtn.classList.toggle('active', op === 'lte');

    document.getElementById('qfEngDelete').style.display = editingEngNode ? '' : 'none';
    document.getElementById('qfEngDelete').textContent = MSG.qfDelete;
    document.getElementById('qfEngApply').textContent = MSG.qfApply;

    popover.style.display = 'block';
    placeFlyout(popover, rect);
  }

  document.getElementById('qfEngOp').addEventListener('click', function() {
    const next = this.dataset.op === 'gte' ? 'lte' : 'gte';
    this.dataset.op = next;
    this.textContent = next === 'lte' ? MSG.qfEngLte : MSG.qfEngGte;
    this.classList.toggle('active', next === 'lte');
  });

  document.getElementById('qfEngApply').addEventListener('click', () => {
    const engType = document.getElementById('qfEngType').value;
    const min = parseInt(document.getElementById('qfEngMin').value, 10);
    const op = document.getElementById('qfEngOp').dataset.op || 'gte';
    if (!min || min <= 0) { closeAllMenus(); return; }
    if (editingEngNode) {
      // Edit in place (keeps its position / group in the tree).
      Object.assign(editingEngNode, { engType, min, op });
      afterQueryChange();
    } else {
      // Remove any existing condition for the same engType (no gte+lte on one type).
      removeCondsMatching((c) => c.type === 'engagement' && c.engType === engType);
      addFilter({ type: 'engagement', engType, min, op });
    }
    closeAllMenus();
  });

  document.getElementById('qfEngDelete').addEventListener('click', () => {
    if (editingEngNode) removeNode(editingEngNode);
    closeAllMenus();
  });

  // --- Sidebar filter controls ---

  // Sidebar i18n
  setText('sbKindPost', MSG.kindPost);
  setText('sbKindImage', MSG.kindImage);
  setText('sbPlatformTitle', MSG.qfPlatform);
  setText('sbInstanceTitle', MSG.qfInstance);
  setText('sbPostTypeTitle', MSG.qfPostType);
  setText('sbMediaTitle', MSG.qfMediaTitle);
  setText('sbDateTitle', MSG.qfDate);
  setText('sbEngTitle', MSG.qfEngagement);
  setText('sbPost', MSG.qfPost);
  setText('sbReply', MSG.qfReply);
  setText('sbQuote', MSG.qfQuote);
  setText('sbThread', MSG.qfThread);
  setText('sbImage', MSG.qfImage);
  setText('sbVideo', MSG.qfVideo);
  setText('sbGif', MSG.qfGif);

  // Sidebar chip toggle (platform, postType, media)
  // Filter rows: click a row → flyout with that category's values beside it.
  // 日付/エンゲージはパラメータ入力付きの専用ポップオーバーへ委譲。
  document.getElementById('filterRows').addEventListener('click', (e) => {
    const sub = e.target.closest('[data-tag-group]');
    const row = e.target.closest('[data-qfrow]');
    if (!sub && !row) return;
    const cat = sub ? 'tag' : row.dataset.qfrow;
    const dp = document.getElementById('qfDatePopover');
    const ep = document.getElementById('qfEngPopover');
    // Re-clicking the row whose popover is already open = toggle it closed.
    if (cat === 'date' && dp.style.display === 'block') { closeAllMenus(); return; }
    if (cat === 'engagement' && ep.style.display === 'block') { closeAllMenus(); return; }
    closeAllMenus();   // switching rows closes any open date/eng popover first
    if (sub) { const gid = sub.dataset.tagGroup; showQfPopAt('tag', sub, gid === '__all' ? null : gid); return; }
    if (cat === 'tag' && tagGroups.length) { hideQfPop(); toggleTagGroupsCollapsed(); return; }
    if (cat === 'date') { hideQfPop(); openDatePopover(null); return; }
    if (cat === 'engagement') { hideQfPop(); openEngPopover(null); return; }
    showQfPopAt(cat, row);
  });

  // フライアウトはクリックのみで開閉（ホバーで開く実験は撤回＝誤爆・絞り込み入力中に
  // 別行へカーソルが乗って別フライアウトに化ける問題があったため）。

  // Update sidebar state (chip actives, row badges, tag area, active bar)
  function updateSidebarState() {
    const sb = document.getElementById('searchBox');
    if (sb) sb.classList.toggle('has-value', !!sb.value.trim());
    renderFilterBadges();
    updateSidebarTags();
    renderQueryChips();   // 検索/フォルダ等の変化を下部アクティブバーへ即時反映
  }

  // Row badges: number of active filters per category. Instance filters live
  // inside the platform flyout, so they count toward the platform badge.
  function renderFilterBadges() {
    const counts = {};
    for (const f of activeFilters) counts[f.type] = (counts[f.type] || 0) + 1;
    counts.platform = (counts.platform || 0) + (counts.instance || 0);
    if (multiOnly) counts.media = (counts.media || 0) + 1;   // 複数画像 folded into メディア
    // 用語帳: split the tag badge by 種別 so a 作品/キャラ filter lights its own row's
    // badge, leaving the タグ row badge for general (未分類) tags only.
    let tagWork = 0, tagChar = 0, tagGen = 0;
    for (const f of activeFilters) if (f.type === 'tag') {
      const k = tagKindOf(f.value);
      if (k === 'work') tagWork++; else if (k === 'character') tagChar++; else tagGen++;
    }
    counts.tag = tagGen; counts.work = tagWork; counts.character = tagChar;
    document.querySelectorAll('#filterRows .sb-row-badge').forEach((b) => {
      const n = counts[b.dataset.badge] || 0;
      b.textContent = n || '';
      b.classList.toggle('on', n > 0);
    });
  }

  // --- Tag area: ★よく使うタグ（チップ直置き・3状態サイクル）＋タググループの
  // 行ボタン（押すとそのグループのタグがフライアウトで開く）。タグ本体は
  // 青天井に増えるが、グループはユーザーが作る有限リストなので常設できる。
  let tagGroups = [];   // {id,name,tags[]} from tag-groups.json (loaded at startup)
  // 用語帳 (Phase 2 ①): a tag's 種別 is an attribute of the TAG. `tagTypes` maps a
  // tag string → kind ('work' | 'character'); tags absent from it are 一般 (general).
  // Flat, so no post migration. The renamable work⊃character pair (B=裏方) drives the
  // later category sections; here we only assign + reflect the kind on the tag itself.
  let tagTypes = {};
  const KIND_LABEL = { work: MSG.kindWork, character: MSG.kindCharacter };   // MSG is finalized at load
  function tagKindOf(tag) { return tagTypes[tag] || null; }
  function kindLabel(kind) { return KIND_LABEL[kind] || ''; }
  async function setTagKind(tag, kind) {
    if (kind) tagTypes[tag] = kind; else delete tagTypes[tag];
    try { if (window.corpus.setTagTypes) await window.corpus.setTagTypes(tagTypes); } catch { /* best-effort */ }
    updateSidebarTags();   // a newly classified tag may reveal/hide its 作品/キャラ section
  }
  const _ic = (paths) => `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  // Cached sets — rebuilt only when allPosts changes (tracked by generation counter).
  let _sidebarSetsGen = -1;
  let _cachedTagSet = null, _cachedHtSet = null, _cachedUserSet = null, _cachedInstSet = null;
  function _rebuildSidebarSets() {
    if (_sidebarSetsGen === _allPostsGeneration) return;
    const snPosts = allPosts.filter(p => p.url);
    // Tags / body hashtags are user-applied to ALL posts (incl. imported, url-less
    // images migrated from Eagle), so build their choice sets from the whole library.
    // Authors / instances only make sense for SNS posts, so keep those url-scoped.
    _cachedTagSet  = new Set(allPosts.flatMap(p => p.tags || []));
    _cachedHtSet   = new Set(allPosts.flatMap(p => p.hashtags || []));
    _cachedUserSet = new Set(snPosts.map(p => userKey(p)));
    _cachedInstSet = new Set(snPosts.filter(p => p.platform === 'misskey' || p.platform === 'mastodon').map(p => hostOf(p.url)).filter(Boolean));
    _sidebarSetsGen = _allPostsGeneration;
  }
  // Refresh the tag-derived sidebar rows (作品/キャラ 種別 rows + tag-group sub-rows).
  function updateSidebarTags() {
    _rebuildSidebarSets();
    updateKindRows();
    updateSidebarTagGroups();
  }
  // 用語帳 (Phase 2 ②): the 作品/キャラ rows are progressively disclosed — each appears
  // only once at least one tag wears that 種別. No kinds set → no rows → zero trace for
  // people who just save posts (Corpus isn't illustration-only).
  function updateKindRows() {
    const tags = _cachedTagSet || new Set();
    let hasWork = false, hasChar = false;
    for (const t of tags) {
      const k = tagKindOf(t);
      if (k === 'work') hasWork = true;
      else if (k === 'character') hasChar = true;
      if (hasWork && hasChar) break;
    }
    const wr = document.getElementById('sbWorkRow');
    const cr = document.getElementById('sbCharRow');
    if (wr) wr.style.display = hasWork ? '' : 'none';
    if (cr) cr.style.display = hasChar ? '' : 'none';
  }
  // --- Tag group sub-rows (Plan A) ---
  const TAGGROUPS_COLLAPSED_KEY = 'corpus.tagGroupsCollapsed';
  let tagGroupsCollapsed = localStorage.getItem(TAGGROUPS_COLLAPSED_KEY) === '1';

  function toggleTagGroupsCollapsed() {
    const tagRow = document.querySelector('[data-qfrow="tag"]');
    const yBefore = tagRow ? tagRow.getBoundingClientRect().top : null;
    tagGroupsCollapsed = !tagGroupsCollapsed;
    localStorage.setItem(TAGGROUPS_COLLAPSED_KEY, tagGroupsCollapsed ? '1' : '');
    updateSidebarTagGroups();
    // アニメーション完了後にタグ行の Y ずれをスクロール補正（カーソル下を維持）
    if (yBefore !== null) setTimeout(() => {
      const yAfter = tagRow.getBoundingClientRect().top;
      const delta = yAfter - yBefore;
      if (Math.abs(delta) > 0.5) {
        const scroll = tagRow.closest('.sb-scroll');
        if (scroll) scroll.scrollTop += delta;
      }
    }, 190);
  }

  function updateSidebarTagGroups() {
    const host = document.getElementById('sbTagGroupSubRows');
    const chev = document.getElementById('sbTagChevron');
    if (!host) return;
    // .sb-subrows-inner が消えていたら（起動タイミング競合など）再生成する
    let inner = host.querySelector('.sb-subrows-inner');
    if (!inner) {
      inner = document.createElement('div');
      inner.className = 'sb-subrows-inner';
      host.appendChild(inner);
    }
    if (!tagGroups.length) {
      if (chev) { chev.innerHTML = CHEV_R; chev.classList.remove('collapsed'); }
      inner.innerHTML = '';
      return;
    }
    if (chev) { chev.innerHTML = CHEV_D; chev.classList.toggle('collapsed', tagGroupsCollapsed); }
    host.classList.toggle('collapsed', tagGroupsCollapsed);
    _rebuildSidebarSets();
    const allTagSet = _cachedTagSet;
    // 用語帳: kinded tags graduated to the 作品/キャラ rows — the タグ section counts
    // and lists general tags only, so they aren't shown / counted twice.
    const genTags = [...allTagSet].filter(t => !tagKindOf(t));
    const genSet = new Set(genTags);
    const activeTags = new Set(activeFilters.filter(f => f.type === 'tag').map(f => f.value));
    const rows = [];
    if (genTags.length) {
      rows.push(`<button class="sb-subrow" type="button" data-tag-group="__all"><span class="sb-subrow-name">${escapeHtml(MSG.tagAllRow)}</span><span class="sb-subrow-count">${genTags.length}</span><span class="sb-subrow-arrow">${CHEV_R}</span></button>`);
    }
    for (const g of tagGroups) {
      const count = (g.tags || []).filter(t => genSet.has(t)).length;
      if (!count) continue;
      const active = (g.tags || []).some(t => activeTags.has(t));
      rows.push(`<button class="sb-subrow${active ? ' active' : ''}" type="button" data-tag-group="${escapeAttr(g.id)}"><span class="sb-subrow-name">${escapeHtml(g.name || '')}</span><span class="sb-subrow-count">${count}</span><span class="sb-subrow-arrow">${CHEV_R}</span></button>`);
    }
    const grouped = new Set(tagGroups.flatMap(g => g.tags || []));
    const otherCount = genTags.filter(t => !grouped.has(t)).length;
    if (otherCount) {
      const active = [...activeTags].some(t => !grouped.has(t) && !tagKindOf(t));
      rows.push(`<button class="sb-subrow${active ? ' active' : ''}" type="button" data-tag-group="__other"><span class="sb-subrow-name">${escapeHtml(MSG.tagGroupOther)}</span><span class="sb-subrow-count">${otherCount}</span><span class="sb-subrow-arrow">${CHEV_R}</span></button>`);
    }
    inner.innerHTML = rows.join('');
  }

  // --- In-session Edit Undo/Redo ---
  // Records tag-edit operations so the user can undo bulk mistakes (Ctrl+Z / Ctrl+Shift+Z).
  // Linear stack, clears on restart. Deletions are NOT included (handled by trash).
  const UNDO_MAX = 50;
  let undoStack = [];   // [{type, records: [{captureId, image, prevTags, newTags}]}]
  let redoStack = [];

  function pushUndo(type, records) {
    if (!records || !records.length) return;
    undoStack.push({ type, records });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];   // discard redo on new edit (linear history)
  }

  async function applyTagUndo(records) {
    for (const r of records) {
      try { await window.corpus.updateTags(r.image, r.tags); } catch { }
      const idx = allPosts.findIndex(p => p.captureId === r.captureId);
      if (idx >= 0) allPosts[idx].tags = r.tags.slice();
    }
    markPostsMutated();
    renderPosts(true);
    // Keep the inspector in sync if it's showing the affected group (undo isn't fired
    // while typing in the add input, so a full re-render here is safe).
    if (!document.getElementById('postDetail').hidden && inspectedKey) {
      const fresh = viewGroups.find((g2) => postIdKey(g2.rep) === inspectedKey);
      if (fresh) showDetail(fresh);
    }
  }

  // Poster-tag variant: posterTags[key] is the source of truth (NOT a post record),
  // so undo/redo re-applies the captured tag list per poster key and keeps an open
  // poster inspector in sync (mirrors applyTagUndo's inspector refresh).
  async function applyPosterTagUndo(records) {
    for (const r of records) {
      if (r.tags && r.tags.length) posterTags[r.key] = r.tags.slice(); else delete posterTags[r.key];
    }
    persistPosterTags();
    if (!document.getElementById('postDetail').hidden && typeof inspectedKey === 'string' && inspectedKey.indexOf('poster:') === 0) {
      const k = inspectedKey.slice('poster:'.length);
      refreshPosterTags(k);
      refreshPosterPicker(k);
    }
  }

  async function doUndo() {
    const entry = undoStack.pop();
    if (!entry) return;
    if (entry.type === 'poster-tags') {
      await applyPosterTagUndo(entry.records.map(r => ({ key: r.key, tags: r.prevTags })));
    } else {
      const reverse = entry.records.map(r => ({ captureId: r.captureId, image: r.image, tags: r.prevTags }));
      await applyTagUndo(reverse);
    }
    redoStack.push(entry);
    showToast('Undo');
  }

  async function doRedo() {
    const entry = redoStack.pop();
    if (!entry) return;
    if (entry.type === 'poster-tags') {
      await applyPosterTagUndo(entry.records.map(r => ({ key: r.key, tags: r.newTags })));
    } else {
      const forward = entry.records.map(r => ({ captureId: r.captureId, image: r.image, tags: r.newTags }));
      await applyTagUndo(forward);
    }
    undoStack.push(entry);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    showToast('Redo');
  }

  document.addEventListener('keydown', (e) => {
    if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) return;
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
  });

  // --- State ---
  let allPosts = [];
  let _allPostsGeneration = 0;  // bumped on every allPosts replacement; invalidates sidebar caches
  // In-place edits (tag add/remove, single delete) mutate allPosts records without
  // replacing the array, so the generation counter won't advance on its own. It gates
  // the sidebar tag/author/instance caches and buildUsers, so mutators must call this —
  // otherwise a newly-added tag never reaches the sidebar rows (and a removed author /
  // instance lingers) even though renderPosts redraws the grid and flyouts.
  function markPostsMutated() { _allPostsGeneration++; }
  let activeFilters = []; // { type, value?, dateField?, from?, to?, engType?, min? }
  let currentView = 'card';   // 'card' | 'tile' | 'list' (display density)
  let browseMode = 'posts';   // 'posts' | 'posters' (what the content area browses)
  // Holds the poster KEY a poster-click drilled into (posts mode + that `user` filter).
  // A query reset bounces back to the poster grid AS LONG AS that user filter is still
  // active (you're still looking at this poster's posts, even with extra library filters
  // added). Removing the user filter or switching mode ends it. null = no pending return.
  let posterReturn = null;
  let multiOnly = false;      // show only items with more than one image
  let tileOverlay = true;     // tile view: show the author/❤ info overlay (pref)
  let tileSize = 180;         // tile view: edge px (pref imageTileSize)
  let cardSize = 280;         // card view: min column width px (pref cardSize)
  let listThumb = 88;         // list view: thumbnail width px (pref listThumb)
  const TILE_MIN = 120, TILE_MAX = 400;
  const CARD_MIN = 240, CARD_MAX = 560;
  const LIST_MIN = 56, LIST_MAX = 200;
  // SMOKE capture: the hidden screenshot instance never has anything "on-screen",
  // so content-visibility:auto skips painting every card and loading=lazy images
  // never fetch → blank grid. Launched via ?smoke=1, we flip both off (CSS class
  // + eager images) so capturePage() sees real cards. Normal app is untouched.
  const SMOKE_CAPTURE = (() => { try { return new URLSearchParams(location.search).get('smoke') === '1'; } catch { return false; } })();
  if (SMOKE_CAPTURE) document.documentElement.classList.add('smoke-capture');
  // Windowed rendering: render only the first `renderLimit` filtered posts and
  // grow as a bottom sentinel nears the viewport. Rendering all (thousands) at
  // once froze the UI and starved image (psimg) loads. Reset to one page on any
  // filter/view/search change; the load-more path passes keepLimit=true.
  const RENDER_PAGE = 150;
  let renderLimit = RENDER_PAGE;

  // #mode-post is the scroll container (the page itself never scrolls), so scroll
  // position is read/written there, not on window.
  const contentScrollEl = () => document.getElementById('mode-post');
  const contentScrollTop = () => { const el = contentScrollEl(); return el ? el.scrollTop : 0; };
  const scrollContentTo = (y) => { const el = contentScrollEl(); if (el) el.scrollTop = y; };
  let moreObserver = null;
  // --- Grouping state (persisted via main: manual-groups.json / ungrouped.json) ---
  let manualGroups = [];        // [[captureId,…],…] — user-built groups (win over auto)
  let ungrouped = new Set();    // post keys opted out of auto-grouping
  const stickyRecs = new Set(); // captureIds kept visible after a mutation un-matches the filter
  let inspectedKey = null;      // postIdKey of the group shown in the inspector (ring marker)
  let viewGroups = [];          // current render result: [{ key, records, rep, files }]
  let taggingApi = null;        // shared 種別 (kind) menu API; set by setupKindMenu() below
  // Thumbnail width tracks the tile edge so larger tiles stay sharp (60px buckets).
  const tileThumbW = () => Math.min(960, Math.max(180, Math.ceil((tileSize * 1.4) / 60) * 60));
  // card/list serve a thumbnail too now (they used to load the full original —
  // multi-MB pixiv/X art decoded on every scroll and stuttered). DPR-aware, 60px
  // buckets, capped at the thumbnailer's 720px max (main.js getThumbnail).
  const _dpr = Math.min(2, window.devicePixelRatio || 1);
  const cardThumbW = () => Math.min(720, Math.max(240, Math.ceil((cardSize * 1.3 * _dpr) / 60) * 60));
  const listThumbW = () => Math.min(720, Math.max(120, Math.ceil((listThumb * 1.5 * _dpr) / 60) * 60));
  function applyTileLayout() {
    const grid = document.getElementById('postGrid');
    if (grid) {
      grid.style.setProperty('--tile-size', tileSize + 'px');
      grid.style.setProperty('--card-size', cardSize + 'px');
      grid.style.setProperty('--list-thumb', listThumb + 'px');
    }
    const row = document.getElementById('tileSizeRow');
    if (row) row.style.display = '';   // every density has a size slider now
    refreshTileSlider();   // hoisted; keeps the track in sync with the view
  }
  let skipDeleteConfirm = false;
  const selectedSet = new Set(); // stores post identifiers (url + capturedAt)
  let selectionAnchor = null;    // index in the filtered list, for shift-range select
  // --- Query builder: a boolean condition tree is the single source of truth ---
  // (docs/design-query-builder.md 改訂③: flat conditions you drag into parenthesised
  // groups; no auto type-grouping). BOTH views (posts / posters) share ONE builder
  // implementation via the createQueryBuilder(ctx) factory below; ctx carries the
  // per-view differences (container, leaf predicate, label, callbacks). The tree is
  // ALWAYS a root group (op 'and' by default). For posts, activeFilters is a derived
  // flat shadow of the leaves (sidebar highlight / row badges / tab title / counts).
  function emptyTree() { return { kind: 'group', op: 'and', neg: false, children: [] }; }
  function treeLeaves(n, out) { out = out || []; if (!n) return out; if (n.kind === 'cond') out.push(n); else (n.children || []).forEach((c) => treeLeaves(c, out)); return out; }
  function opposite(op) { return op === 'and' ? 'or' : 'and'; }
  // Migration only: rebuild a tree from an old persisted faceted state (f + typeOps).
  function facetTreeFrom(f, ops) {
    const root = emptyTree();
    const NO_OP = new Set(['date', 'engagement', 'workspace']);
    const byType = new Map();
    for (const x of f) { if (!byType.has(x.type)) byType.set(x.type, []); byType.get(x.type).push(x); }
    for (const [type, list] of byType) {
      const leaves = list.map((x) => Object.assign({ kind: 'cond' }, x));
      if (NO_OP.has(type)) { root.children.push(...leaves); continue; }
      const op = (ops || {})[type] || 'or';
      root.children.push({ kind: 'group', op: op === 'and' ? 'and' : 'or', neg: op === 'not', children: leaves });
    }
    return root;
  }
  // Post-side leaf predicate: a leaf condition → (post)=>bool. Hoisted out of
  // renderPosts so the shared evalNode (and the poster builder) can reuse the engine.
  function postPredOf(f) {
    switch (f.type) {
      // 'post' = SNS投稿（リンクあり）/ 'image' = 取り込み画像（リンクなし）。url の有無が本質。
      case 'kind': return (p) => (f.value === 'post') === !!p.url;
      case 'platform': return (p) => f.value === '__none' ? !p.platform : p.platform === f.value;
      case 'user': return (p) => userKey(p) === f.value;
      case 'instance': return (p) => (p.platform === 'misskey' || p.platform === 'mastodon') && hostOf(p.url) === f.value;
      case 'postType': return (p) =>
        f.value === 'post' ? (!p.isReply && !p.isQuote && !p.isThread) :
        f.value === 'reply' ? !!p.isReply :
        f.value === 'quote' ? !!p.isQuote : !!p.isThread;
      case 'media': return (p) => p.mediaType === f.value;
      case 'tag':     return (p) => (p.tags     || []).includes(f.value);
      case 'hashtag': return (p) => (p.hashtags || []).includes(f.value);
      case 'folder': return (p) => !!(CF() && CF().has(f.value, p.captureId));
      case 'workspace': return (p) => !!(CF() && CF().inWorkspace(p.captureId));
      case 'date': {
        const field = f.dateField || 'date';
        const from = f.from ? new Date(f.from + 'T00:00:00') : null;
        let to = null;
        // Exclusive next-day bound so the whole selected end day is included.
        if (f.to) { to = new Date(f.to + 'T00:00:00'); to.setDate(to.getDate() + 1); }
        return (p) => {
          if (!p[field]) return false;
          const d = new Date(p[field]);
          return (!from || d >= from) && (!to || d < to);
        };
      }
      case 'engagement': {
        if (!(f.min > 0)) return () => true;
        return (p) => f.op === 'lte' ? (p[f.engType] || 0) <= f.min : (p[f.engType] || 0) >= f.min;
      }
      default: return () => true;
    }
  }
  // Recursive evaluation of a query tree against one item, using a view-supplied
  // leaf predicate factory (predOf). Shared by both builders (post + poster).
  function evalNode(n, item, predOf) {
    if (n.kind === 'cond') { const r = predOf(n)(item); return n.neg ? !r : r; }
    const r = n.op === 'or' ? n.children.some((c) => evalNode(c, item, predOf)) : n.children.every((c) => evalNode(c, item, predOf));
    return n.neg ? !r : r;
  }

  // The shared inline drag-builder. One instance per view. Encapsulates the tree
  // state, render, drag/drop, right-click menu, and mutation helpers so two
  // independent bars (posts / posters) get identical behaviour from one codebase.
  // ctx: { container, barEl?, resetBtn?, predOf, labelOf, glyphOf, getSearchVal?,
  //        onClearSearch?, onChange, onShadow?, openLeafEditor?, editableLeafTypes?,
  //        singleValueTypes?, noDupTypes? }
  function createQueryBuilder(ctx) {
    let tree = emptyTree();
    let qbNodeMap = new Map();      // data-nid → tree node (rebuilt each render)
    let qbDragId = null;            // node id currently being dragged
    let shadow = [];                // last computed flat (deduped) leaf shadow
    const chips = ctx.container;
    const nodeById = (id) => qbNodeMap.get(id) || null;
    const editableLeafTypes = ctx.editableLeafTypes || [];
    const singleValueTypes = ctx.singleValueTypes || [];
    const noDupTypes = ctx.noDupTypes || [];

    // --- Tree mutation helpers (all operate on THIS instance's tree). ---
    const treeParentMap = () => { const m = new Map(); (function rec(n) { (n.children || []).forEach((c) => { m.set(c, n); rec(c); }); })(tree); return m; };
    const nodeContains = (a, b) => { if (a === b) return true; if (!a || a.kind !== 'group') return false; return (a.children || []).some((c) => nodeContains(c, b)); };
    const detachNode = (node, pmap) => { const par = pmap.get(node); if (!par) return; const i = par.children.indexOf(node); if (i >= 0) par.children.splice(i, 1); };
    // Auto-clean: drop empty groups, collapse single-member non-root groups (folding
    // their negation into the survivor) — “1メンバーになったら括弧は自動で消える”.
    const cleanupTree = () => {
      (function rec(node) {
        if (node.kind !== 'group') return;
        const out = [];
        for (let c of node.children) {
          rec(c);
          if (c.kind === 'group') {
            if (!c.children.length) continue;                                   // drop empty
            if (c.children.length === 1) { const only = c.children[0]; if (c.neg) only.neg = !only.neg; out.push(only); continue; }  // collapse singleton
          }
          out.push(c);
        }
        node.children = out;
      })(tree);
    };
    const qHasValue = (type, value) => treeLeaves(tree).some((c) => c.type === type && c.value === value);
    const removeCondsMatching = (pred) => {
      const before = treeLeaves(tree).length;
      (function rec(node) {
        if (node.kind !== 'group') return;
        node.children = node.children.filter((c) => !(c.kind === 'cond' && pred(c)));
        node.children.forEach(rec);
      })(tree);
      cleanupTree();
      return treeLeaves(tree).length !== before;   // changed?
    };
    const sameLeaf = (c, f) => {
      if (c.type !== f.type) return false;
      if (f.type === 'date') return true;                       // single date condition
      if (f.type === 'engagement') return c.engType === f.engType;
      return c.value === f.value;
    };
    // Rebuild the flat (deduped) leaf shadow and hand it to the view (onShadow).
    const syncShadow = () => {
      const seen = new Set();
      const out = [];
      for (const c of treeLeaves(tree)) {
        if (c.type === 'date' || c.type === 'engagement') { const f = Object.assign({}, c); delete f.kind; delete f.neg; out.push(f); continue; }
        const k = c.type + ' ' + c.value;
        if (seen.has(k)) continue;
        seen.add(k);
        const f = { type: c.type, value: c.value };
        if (c.label) f.label = c.label;
        out.push(f);
      }
      shadow = out;
      if (ctx.onShadow) ctx.onShadow(shadow);
    };
    // One canonical refresh after any tree mutation: rebuild the shadow, then let
    // the view re-render (which itself re-renders this bar via render()).
    const refresh = () => { syncShadow(); ctx.onChange(); };

    // --- Render: the tree as draggable pills + parenthesised groups on the bar. ---
    function render() {
      const container = chips;
      const prevLabels = new Set(Array.from(container.querySelectorAll('.qb-pill')).map(el => el.textContent.trim()));
      const bar = ctx.barEl || null;
      const searchVal = ctx.getSearchVal ? (ctx.getSearchVal() || '').trim() : '';
      // ビルダは常時表示（空でもバーは出す＝リセット/ⓘ の置き場）。
      if (bar) bar.style.display = '';
      // The bar is a full-width top bar; the floating sidebar offsets its sticky top
      // by this height. Measure after layout, and only when the bar is actually shown.
      if (bar) requestAnimationFrame(() => { const h = bar.offsetHeight; if (h) document.documentElement.style.setProperty('--activebar-h', h + 'px'); });
      const resetBtn = ctx.resetBtn || null;
      const saveBtn = ctx.saveBtn || null;
      const hasQuery = tree.children.length > 0;
      if (resetBtn) resetBtn.style.display = (hasQuery || searchVal) ? '' : 'none';
      // Save-as-dynamic-collection button: shown only when there's something to save.
      if (saveBtn) saveBtn.style.display = (hasQuery || searchVal) ? '' : 'none';
      qbNodeMap = new Map();
      let idc = 0;
      const NE = '≠';
      // Small ✕ glyph for the in-pill delete button (revealed on hover, inside bounds).
      const delIc = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
      const opWord = (op) => escapeHtml(op === 'or' ? MSG.qcJoinOr : MSG.qcJoinAnd);
      // A condition leaf → draggable pill (hover ✕ removes; right-click negate/delete);
      // a group → its members joined by clickable operator connectors, wrapped in
      // literal parens (root has no parens and its connectors are .qb-op-root).
      const renderNode = (node, isRoot) => {
        const id = 'n' + (idc++);
        qbNodeMap.set(id, node);
        if (node.kind === 'cond') {
          return `<span class="qb-pill sb-active-chip qc-${node.type}${node.neg ? ' neg' : ''}" draggable="true" data-nid="${id}">` +
            ctx.glyphOf(node.type) + (node.neg ? `<span class="qb-ne">${NE}</span>` : '') +
            `<span class="qb-pill-label">${escapeHtml(ctx.labelOf(node))}</span>` +
            `<button type="button" class="qb-del-btn" data-act="del" data-nid="${id}" title="${escapeAttr(MSG.qfDelete)}" aria-label="${escapeAttr(MSG.qfDelete)}" tabindex="-1">${delIc}</button>` +
            `</span>`;
        }
        const opCls = isRoot ? 'qb-op qb-op-root' : 'qb-op';
        const conn = `<button type="button" class="${opCls}" data-act="op" data-nid="${id}" title="${escapeAttr(MSG.qbTipOp)}"${isRoot ? '' : ' draggable="true"'}>${opWord(node.op)}</button>`;
        const inner = node.children.map((c) => renderNode(c, false)).join(conn);
        if (isRoot) return inner;   // root: bare members, no parens / no negation
        return `<span class="qb-grp${node.neg ? ' neg' : ''}" data-nid="${id}">` +
          `<span class="qb-paren qb-paren-l" draggable="true">${node.neg ? NE : ''}(</span>` +
          inner +
          `<span class="qb-paren qb-paren-r" draggable="true">)</span>` +
          `</span>`;
      };
      const searchSeg = searchVal
        ? `<span class="sb-active-chip qc-search" data-special="search">${ctx.glyphOf('search')}${escapeHtml(searchVal)}</span>` +
          (hasQuery ? `<span class="qc-conn">${escapeHtml(MSG.qcJoinAnd)}</span>` : '')
        : '';
      const addBtn = hasQuery
        ? `<button type="button" class="qb-group-add" data-qb-group-add title="${escapeAttr(MSG.qbAddGroupTip)}">( )</button>`
        : '';
      container.innerHTML = searchSeg + renderNode(tree, true) + addBtn;
      if (!prefersReducedMotion()) {
        container.querySelectorAll('.qb-pill').forEach(el => { if (!prevLabels.has(el.textContent.trim())) el.classList.add('chip-new'); });
      }
      // No custom <select>s in the bar anymore; prune any detached hosts left over.
      for (let i = csHosts.length - 1; i >= 0; i--) if (!document.contains(csHosts[i])) csHosts.splice(i, 1);
    }

    // Sidebar entry points add a NEW condition at the TOP level of the tree (改訂③:
    // 新しい条件はトップ階層に載る). Structure (groups / nesting) is built only by
    // dragging on the bar.
    function addFilter(filter) {
      // Single-valued types (択一): a new one replaces the existing anywhere.
      if (singleValueTypes.includes(filter.type)) removeCondsMatching((c) => c.type === filter.type);
      // Prevent exact duplicates (anywhere in the tree), except for multi types.
      else if (!noDupTypes.includes(filter.type) && qHasValue(filter.type, filter.value)) return;
      tree.children.push(Object.assign({ kind: 'cond' }, filter));
      cleanupTree();
      refresh();
    }
    // Remove the condition(s) matching the shadow filter at `index` (sidebar toggle
    // handlers findIndex into the shadow). Bar-pill removal targets a node by id.
    function removeFilter(index) {
      const f = shadow[index];
      if (!f) return;
      removeCondsMatching((c) => sameLeaf(c, f));
      refresh();
    }
    function removeNode(node) {
      const pmap = treeParentMap();
      detachNode(node, pmap);
      cleanupTree();
      refresh();
    }
    // グループ追加ボタン: 今の式ぜんぶを一発で囲う＝ネストのショートカット（押すたび深く）。
    function wrapAllInGroup() {
      if (!tree.children.length) return;
      const g = { kind: 'group', op: tree.op, neg: false, children: tree.children };
      tree = { kind: 'group', op: 'and', neg: false, children: [g] };
      cleanupTree();   // single-condition wrap collapses (nothing meaningful to group)
      refresh();
    }

    // Bar interaction (click): toggle a group's operator, clear search, delete a
    // condition (the ✕ button), wrap the whole expression, or open a leaf editor
    // (date/engagement). Negation + a redundant delete live in the right-click menu.
    chips.addEventListener('click', (e) => {
      if (e.target.closest('[data-qb-group-add]')) { wrapAllInGroup(); return; }
      const opBtn = e.target.closest('.qb-op[data-act="op"]');
      if (opBtn) { const n = nodeById(opBtn.dataset.nid); if (n) { n.op = opposite(n.op); refresh(); } return; }
      const delBtn = e.target.closest('.qb-del-btn[data-act="del"]');
      if (delBtn) { const n = nodeById(delBtn.dataset.nid); if (n) removeNode(n); return; }
      // 検索の特殊ピルは検索を解除。
      if (e.target.closest('[data-special="search"]')) { if (ctx.onClearSearch) ctx.onClearSearch(); return; }
      const pill = e.target.closest('.qb-pill');
      if (!pill) return;
      const node = nodeById(pill.dataset.nid);
      if (!node || node.kind !== 'cond') return;
      // 編集可能な葉（日付・反応）は左クリックで編集ポップへ。それ以外は何もしない
      // （削除は✕、否定は右クリック、ピル本体はドラッグのつかみどころ）。
      if (editableLeafTypes.includes(node.type) && ctx.openLeafEditor) ctx.openLeafEditor(node);
    });

    // --- Drag & drop: drag pills/groups into parenthesised groups (改訂③). ---
    function qbClearDropHints() { chips.querySelectorAll('.qb-drop-into, .qb-drop-on').forEach((el) => el.classList.remove('qb-drop-into', 'qb-drop-on')); chips.classList.remove('qb-drop-root'); }
    // Where does a drag-event drop? onto a pill (merge → pair group), a group frame
    // (wrap → nest), inside a group body (add member), or the bar background (→ root).
    function qbDropTarget(e) {
      let el = (e.target && e.target.nodeType === 1) ? e.target : null;
      if (!el || !chips.contains(el)) el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || !chips.contains(el)) return { kind: 'root' };
      const pill = el.closest('.qb-pill');
      if (pill) return { kind: 'pill', nid: pill.dataset.nid, el: pill };
      const frame = el.closest('.qb-paren, .qb-op:not(.qb-op-root)');
      if (frame) { const g = frame.closest('.qb-grp'); if (g && !g.classList.contains('qb-root')) return { kind: 'frame', nid: g.dataset.nid, el: g }; }
      const grp = el.closest('.qb-grp:not(.qb-root)');
      if (grp) return { kind: 'inside', nid: grp.dataset.nid, el: grp };
      return { kind: 'root' };
    }
    // Drag start: a pill drags that condition; a paren / operator label drags the
    // whole enclosing group (掴む対象で「中身 vs 丸ごと」を分ける).
    chips.addEventListener('dragstart', (e) => {
      const handle = e.target.closest('.qb-pill, .qb-paren, .qb-op:not(.qb-op-root)');
      if (!handle) { e.preventDefault(); return; }
      let id, dragEl;
      if (handle.classList.contains('qb-pill')) { id = handle.dataset.nid; dragEl = handle; }
      else { const g = handle.closest('.qb-grp'); id = g && g.dataset.nid; dragEl = g; }
      if (!id) { e.preventDefault(); return; }
      qbDragId = id;
      try { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
      if (dragEl) requestAnimationFrame(() => dragEl.classList.add('qb-dragging'));
    });
    chips.addEventListener('dragend', () => {
      qbDragId = null;
      chips.querySelectorAll('.qb-dragging').forEach((el) => el.classList.remove('qb-dragging'));
      qbClearDropHints();
    });
    chips.addEventListener('dragover', (e) => {
      if (!qbDragId) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      qbClearDropHints();
      const t = qbDropTarget(e);
      const drag = nodeById(qbDragId);
      const tnode = t.nid ? nodeById(t.nid) : tree;
      if (drag && tnode && (tnode === drag || nodeContains(drag, tnode))) return;   // can't drop into self / own descendant
      if (t.kind === 'pill' || t.kind === 'frame') t.el.classList.add('qb-drop-on');
      else if (t.kind === 'inside') t.el.classList.add('qb-drop-into');
      else chips.classList.add('qb-drop-root');
    });
    chips.addEventListener('dragleave', (e) => { if (e.target === chips) qbClearDropHints(); });
    chips.addEventListener('drop', (e) => {
      if (!qbDragId) return;
      e.preventDefault();
      const t = qbDropTarget(e);
      const drag = nodeById(qbDragId);
      qbDragId = null;
      qbClearDropHints();
      if (!drag) return;
      const target = t.nid ? nodeById(t.nid) : tree;
      if (!target || target === drag || nodeContains(drag, target)) return;   // can't drop onto itself / own descendant
      const pmap = treeParentMap();
      detachNode(drag, pmap);                          // remove from its current parent first
      if (t.kind === 'pill' || t.kind === 'frame') {   // wrap target + drag in a new group (pair / nest)
        const par = pmap.get(target) || tree;
        const g = { kind: 'group', op: opposite(par.op), neg: false, children: [target, drag] };
        const i = par.children.indexOf(target); if (i >= 0) par.children[i] = g; else par.children.push(g);
      } else if (t.kind === 'inside') {                // add as a member of the group
        target.children.push(drag);
      } else {                                         // bar background → move to the top level
        tree.children.push(drag);
      }
      cleanupTree();
      refresh();
    });

    // --- Right-click menu: negate / delete a pill or group. Negation is a low-
    // frequency operation, so (like the card menu, DESIGN.md) it lives behind a
    // right-click rather than a hover badge. One menu DOM per builder instance so
    // qbMenuNode is never ambiguous between the two bars.
    const qbMenu = document.createElement('div');
    qbMenu.className = 'fold-menu qb-menu';
    document.body.appendChild(qbMenu);
    let qbMenuNode = null;
    const hideQbMenu = () => { qbMenu.classList.remove('show'); qbMenuNode = null; };
    const QB_IC = {
      neg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>',
      del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'
    };
    function showQbMenu(node, isGroup, x, y) {
      qbMenuNode = node;
      const row = (act, ic, label, cls, on) =>
        `<div class="fm-row${cls ? ' ' + cls : ''}" data-act="${act}"><span class="fm-ic">${ic}</span><span class="fm-name">${label}</span>${on ? `<span class="fm-check">${CHECK_SVG}</span>` : ''}</div>`;
      qbMenu.innerHTML =
        row('neg', QB_IC.neg, isGroup ? MSG.qbMenuNegGroup : MSG.qbMenuNeg, '', !!node.neg) +
        '<div class="fm-sep"></div>' +
        row('del', QB_IC.del, MSG.qfDelete, 'fm-danger');
      qbMenu.style.left = x + 'px';
      qbMenu.style.top = y + 'px';
      qbMenu.classList.add('show');
      clampIntoView(qbMenu);
    }
    // Right-click a pill → its leaf menu; a paren / operator / group body → the group's.
    chips.addEventListener('contextmenu', (e) => {
      const pill = e.target.closest('.qb-pill');
      if (pill) {
        const n = nodeById(pill.dataset.nid);
        if (n && n.kind === 'cond') { e.preventDefault(); hideQbMenu(); showQbMenu(n, false, e.clientX, e.clientY); }
        return;
      }
      const frameEl = e.target.closest('.qb-paren, .qb-op:not(.qb-op-root)');
      const g = frameEl ? frameEl.closest('.qb-grp:not(.qb-root)') : e.target.closest('.qb-grp:not(.qb-root)');
      if (g) {
        const n = nodeById(g.dataset.nid);
        if (n && n.kind === 'group') { e.preventDefault(); hideQbMenu(); showQbMenu(n, true, e.clientX, e.clientY); }
      }
    });
    qbMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const rowEl = e.target.closest('.fm-row');
      const n = qbMenuNode;
      hideQbMenu();
      if (!rowEl || !n) return;
      if (rowEl.dataset.act === 'neg') { n.neg = !n.neg; refresh(); }
      else if (rowEl.dataset.act === 'del') { removeNode(n); }
    });
    document.addEventListener('click', (e) => { if (qbMenu.classList.contains('show') && !qbMenu.contains(e.target)) hideQbMenu(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideQbMenu(); });

    return {
      getTree: () => tree,
      // Replace the tree (clone + self-heal singleton groups + recompute shadow).
      setTree: (t) => { tree = t ? JSON.parse(JSON.stringify(t)) : emptyTree(); cleanupTree(); syncShadow(); },
      resetTree: () => { tree = emptyTree(); },
      addFilter, removeFilter, removeNode,
      removeByLeaf: (type, value) => { if (removeCondsMatching((c) => c.type === type && c.value === value)) refresh(); },
      removeByType: (type) => { if (removeCondsMatching((c) => c.type === type)) refresh(); },
      removeCondsMatching,
      qHasValue,
      render, refresh, syncShadow,
      eval: (item) => evalNode(tree, item, ctx.predOf),
      hasQuery: () => tree.children.length > 0,
      shadow: () => shadow,
    };
  }

  // The post-side builder instance. activeFilters stays a module-level global,
  // refreshed from the tree shadow (onShadow) so the sidebar / tab title keep working.
  const postQB = createQueryBuilder({
    container: document.getElementById('queryChips'),
    barEl: document.getElementById('postActiveBar'),
    resetBtn: document.getElementById('postResetBtn'),
    saveBtn: document.getElementById('saveSearchBtn'),
    predOf: postPredOf,
    labelOf: filterLabel,
    glyphOf: qcGlyph,
    getSearchVal: () => { const sb = document.getElementById('searchBox'); return sb ? sb.value : ''; },
    onClearSearch: () => { const sb = document.getElementById('searchBox'); if (sb) sb.value = ''; afterQueryChange(); },
    onChange: () => { renderPostFolders(); renderPosts(); },
    onShadow: (leaves) => { activeFilters = leaves; },
    openLeafEditor: (n) => { if (n.type === 'date') openDatePopover(n); else if (n.type === 'engagement') openEngPopover(n); },
    editableLeafTypes: ['date', 'engagement'],
    singleValueTypes: ['date', 'kind'],
    noDupTypes: ['engagement'],
  });
  // Thin module-level wrappers so existing post-side call sites keep their names.
  function currentTree() { return postQB.getTree(); }
  function renderQueryChips() { postQB.render(); }
  function addFilter(filter) { postQB.addFilter(filter); }
  function removeFilter(index) { postQB.removeFilter(index); }
  function removeNode(node) { postQB.removeNode(node); }
  function removeCondsMatching(pred) { return postQB.removeCondsMatching(pred); }
  function qHasValue(type, value) { return postQB.qHasValue(type, value); }
  function afterQueryChange() { postQB.refresh(); }

  const CF = () => window.corpusFolders;   // shared folder module

  // --- Settings overlay (opened by the brand-bar gear; floats above both modes) ---
  // Relocate #panelSettings out of #mode-post (which is display:none in image mode)
  // into the always-available overlay shell so the gear reaches it from anywhere.
  (function setupSettingsView() {
    const view = document.getElementById('settingsView');
    const panel = document.getElementById('panelSettings');
    const inner = view && view.querySelector('.settings-view-inner');
    const body = document.getElementById('settingsBody');
    const toc = document.getElementById('settingsToc');
    const search = document.getElementById('settingsSearch');
    const empty = document.getElementById('settingsNoMatch');
    if (body && panel) body.appendChild(panel);

    // Side TOC from the section headings (one entry per .section). Each section
    // gets an id so the TOC can select it as a standalone "page".
    const sections = panel ? [...panel.querySelectorAll('.section')] : [];
    sections.forEach((sec, i) => { sec.id = sec.id || ('set-sec-' + i); });
    // Master-detail: the TOC picks ONE section to show as a page; the others are
    // hidden. activeId is the current page (remembered across opens this session).
    let activeId = sections[0] ? sections[0].id : null;
    if (toc && sections.length) {
      toc.innerHTML = sections.map((sec) => {
        const h = sec.querySelector('h2');
        return `<button type="button" class="toc-item" data-target="${sec.id}">${escapeHtml(h ? h.textContent.trim() : sec.id)}</button>`;
      }).join('');
      toc.addEventListener('click', (e) => {
        const it = e.target.closest('.toc-item'); if (!it) return;
        showPage(it.dataset.target);
      });
    }
    // Section labels are i18n'd at init; refresh the TOC text whenever opening.
    function syncTocLabels() {
      if (!toc) return;
      toc.querySelectorAll('.toc-item').forEach((it) => {
        const h = document.getElementById(it.dataset.target)?.querySelector('h2');
        if (h && h.textContent.trim()) it.textContent = h.textContent.trim();
      });
    }
    // Show exactly one section as the active page (clears any search first).
    function showPage(id) {
      if (id) activeId = id;
      if (search) search.value = '';
      applySearch();
      inner && inner.scrollTo({ top: 0 });
    }
    // Item-level highlight: wrap the matching substring in <mark> inside the shown
    // sections so the exact setting is pinpointed (esp. in the long データ section),
    // not just its whole section surfaced. Skips form controls (SELECT/OPTION/INPUT).
    function clearHighlights() {
      if (!panel) return;
      panel.querySelectorAll('mark.set-hl').forEach((m) => {
        const t = document.createTextNode(m.textContent);
        const parent = m.parentNode;
        m.replaceWith(t);
        parent && parent.normalize();
      });
    }
    function highlightIn(root, q) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const tag = node.parentNode && node.parentNode.nodeName;
          if (tag === 'SELECT' || tag === 'OPTION' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') return NodeFilter.FILTER_REJECT;
          return node.nodeValue.toLowerCase().includes(q) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      const targets = [];
      while (walker.nextNode()) targets.push(walker.currentNode);
      targets.forEach((node) => {
        const text = node.nodeValue, low = text.toLowerCase();
        const frag = document.createDocumentFragment();
        let i = 0, idx;
        while ((idx = low.indexOf(q, i)) !== -1) {
          if (idx > i) frag.appendChild(document.createTextNode(text.slice(i, idx)));
          const mk = document.createElement('mark');
          mk.className = 'set-hl';
          mk.textContent = text.slice(idx, idx + q.length);
          frag.appendChild(mk);
          i = idx + q.length;
        }
        if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
        node.parentNode.replaceChild(frag, node);
      });
    }
    // No query  → single-page mode: show only the active section.
    // With query → cross-page search: show every matching section stacked, filter
    // the TOC, and highlight the matching text within each shown section.
    function applySearch() {
      const q = (search ? search.value : '').trim().toLowerCase();
      clearHighlights();
      if (!q) {
        sections.forEach((sec) => { sec.style.display = (sec.id === activeId) ? '' : 'none'; });
        if (toc) toc.querySelectorAll('.toc-item').forEach((it) => {
          it.hidden = false;
          it.classList.toggle('active', it.dataset.target === activeId);
        });
        if (empty) empty.hidden = true;
        return;
      }
      let shown = 0;
      sections.forEach((sec) => {
        const match = sec.textContent.toLowerCase().includes(q);
        sec.style.display = match ? '' : 'none';
        if (match) { shown++; highlightIn(sec, q); }
        const it = toc && toc.querySelector(`.toc-item[data-target="${sec.id}"]`);
        if (it) { it.hidden = !match; it.classList.remove('active'); }
      });
      if (empty) empty.hidden = shown > 0;
    }
    if (search) { search.placeholder = MSG.settingsSearch; search.addEventListener('input', applySearch); }
    if (empty) empty.textContent = MSG.settingsNoMatch;

    const close = () => { if (view) view.hidden = true; };
    const open = () => { if (view) { view.hidden = false; syncTocLabels(); showPage(activeId); } };
    const btn = document.getElementById('settingsBtn');
    const x = document.getElementById('settingsClose');
    if (btn) btn.addEventListener('click', open);
    if (x) x.addEventListener('click', close);
    // モーダル化に伴い、薄暗い背景のクリックでも閉じる
    if (view) view.addEventListener('click', (e) => { if (e.target === view) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view && !view.hidden) close(); });
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
    scroller.addEventListener('scroll', () => {
      btn.style.display = scroller.scrollTop > 80 ? 'flex' : 'none';
    }, { passive: true });
    btn.addEventListener('click', () => scroller.scrollTo({ top: 0, behavior: 'smooth' }));
  })();

  // Back-to-top for the CONTENT area. #mode-post is the scroll container (the page
  // itself never scrolls), so watch its scrollTop, not the window.
  (function setupContentTop() {
    const btn = document.getElementById('contentTop');
    const scroller = contentScrollEl();
    if (!btn || !scroller) return;
    const onScroll = () => { btn.style.display = scroller.scrollTop > 300 ? 'flex' : 'none'; };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    btn.addEventListener('click', () => scroller.scrollTo({ top: 0, behavior: 'smooth' }));
    onScroll();
  })();

  // --- Authors (作者 row → flyout; derived from post author fields, no fetching) ---
  // Group posts by author. Posts arrive newest-first, so the first occurrence
  // carries the latest display name / handle for that user.
  // Cached behind the allPosts generation (same idiom as _rebuildSidebarSets):
  // buildUsers scans all ~9000 posts, and it was being re-run on every search
  // keystroke via buildSuggest. Rebuild only when the library changes.
  let _buildUsersGen = -1, _cachedUsers = null;
  function buildUsers() {
    if (_buildUsersGen === _allPostsGeneration && _cachedUsers) return _cachedUsers;
    const map = new Map();
    for (const p of allPosts) {
      if (!p.url) continue;   // SNS posts only — match the post-view dataset
      const key = userKey(p);
      let u = map.get(key);
      if (!u) {
        u = { key, platform: p.platform, screenName: p.screenName || '', displayName: p.displayName || '',
              avatarFile: '', followers: null, authorCreatedAt: '', instance: '',
              latest: '', firstPost: '', lastCapture: '', firstCapture: '', count: 0 };
        map.set(key, u);
      }
      u.count++;
      // Posts arrive newest-first, so the first non-empty occurrence is the latest
      // value for that poster (same idiom as displayName/screenName below).
      if (!u.displayName && p.displayName) u.displayName = p.displayName;
      if (!u.screenName && p.screenName) u.screenName = p.screenName;
      if (!u.avatarFile && p.avatarFile) u.avatarFile = p.avatarFile;
      if (u.followers == null && p.followers != null) u.followers = p.followers;
      if (!u.authorCreatedAt && p.authorCreatedAt) u.authorCreatedAt = p.authorCreatedAt;
      if (!u.instance && (p.platform === 'misskey' || p.platform === 'mastodon')) { const h = hostOf(p.url); if (h) u.instance = h; }
      // Aggregate date range across this poster's posts (ISO strings compare lexically).
      // latest/firstPost = 最終/初回投稿日; lastCapture/firstCapture = 最終/初回取得日.
      if (p.date && (!u.latest || p.date > u.latest)) u.latest = p.date;
      if (p.date && (!u.firstPost || p.date < u.firstPost)) u.firstPost = p.date;
      if (p.capturedAt && (!u.lastCapture || p.capturedAt > u.lastCapture)) u.lastCapture = p.capturedAt;
      if (p.capturedAt && (!u.firstCapture || p.capturedAt < u.firstCapture)) u.firstCapture = p.capturedAt;
    }
    _cachedUsers = [...map.values()];
    _buildUsersGen = _allPostsGeneration;
    return _cachedUsers;
  }

  // --- Image source (served from the save folder via the psimg:// protocol) ---
  const imgSrc = (p) => (p.image ? 'psimg://img/' + encodeURIComponent(p.image) : '');
  // psimg URL for a bare filename; w>0 asks main for a downscaled thumbnail (tiles).
  const fileSrc = (file, w) => (file ? 'psimg://img/' + encodeURIComponent(file) + (w ? ('?w=' + w) : '') : '');

  // Per-density image source. A post may carry both a capture (screenshot) and
  // real media/artwork; the density decides which leads:
  //   tile / card → artwork preferred (the actual image leads — a clean grid),
  //                 capture as fallback (posts whose original didn't download)
  //   list        → capture preferred (the post as it looked in its compact row)
  // NOTE: lib-index's cardImageFile() MUST mirror the card branch so the masonry
  // height reservation (shotW/shotH) sizes the same image the card shows.
  const SS_EXT = /\.jpe?g$/i;
  const mediaFilesOf = (p) => (Array.isArray(p.media) ? p.media.filter((m) => m && m.file).map((m) => m.file) : []);
  // p.image is a screenshot unless it's a dragged/migrated artwork or a non-JPEG original.
  const isScreenshot = (p) => !!p.image && SS_EXT.test(p.image) && p.source !== 'drag' && p.source !== 'eagle-migration';
  const captureFile = (p) => (isScreenshot(p) ? p.image : '');
  const artworkFile = (p) => { const m = mediaFilesOf(p); if (m.length) return m[0]; return (p.image && !isScreenshot(p)) ? p.image : ''; };
  function densityImage(p, density) {
    const cap = captureFile(p), art = artworkFile(p);
    return density === 'list' ? (cap || art) : (art || cap);
  }

  // --- Grouping (ported from image-view) --------------------------------------
  // Auto: records sharing the same post URL (multi-image drags, re-captures of
  // one post) collapse into one card. Manual groups (manual-groups.json) win
  // over auto. ungrouped.json opts individual post keys out.
  const postIdKey = (p) => (p.captureId || ((p.url || '') + '|' + (p.capturedAt || '')));
  // Same URL patterns as metadata.js parsePostUrl (renderer-side copy). null = don't group.
  function postKeyOf(url) {
    if (!url) return null;
    let u; try { u = new URL(url); } catch { return null; }
    const host = u.hostname, pa = u.pathname; let m;
    if (host === 'bsky.app' && (m = pa.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/))) return 'bluesky:' + m[1] + '/' + m[2];
    if ((host === 'x.com' || host === 'twitter.com') && (m = pa.match(/\/status\/(\d+)/))) return 'x:' + m[1];
    if ((m = pa.match(/^\/@[^/]+\/(\d[\w-]*)\/?$/))) return 'mastodon:' + host + ':' + m[1];
    if ((m = pa.match(/^\/notes\/([^/?#]+)/))) return 'misskey:' + host + ':' + m[1];
    if ((host === 'www.pixiv.net' || host === 'pixiv.net') && (m = pa.match(/^(?:\/[a-z]{2})?\/artworks\/(\d+)/))) return 'pixiv:' + m[1];
    return null;
  }
  // The "artwork pages" of one record: original media, else the dragged/migrated image.
  const groupFilesOf = (p) => { const m = mediaFilesOf(p); if (m.length) return m; const a = artworkFile(p); return a ? [a] : []; };
  function groupRecords(list) {
    // url-derived group key, precomputed once per record by stampPost (_postKey);
    // fall back to a live parse for any record that somehow predates the stamp.
    const pk = (p) => (p._postKey !== undefined ? p._postKey : postKeyOf(p.url));
    const manualOf = new Map();   // captureId → 'manual:idx' (manual groups win)
    manualGroups.forEach((members, idx) => members.forEach((cid) => manualOf.set(cid, 'manual:' + idx)));
    let solo = 0;
    const base = list.map((p) => {
      let key;
      const mg = manualOf.get(p.captureId);
      if (mg) key = mg;
      else {
        const k = pk(p);
        key = (k && !ungrouped.has(k)) ? k : ('__solo' + (solo++));
      }
      return { p, key };
    });
    // Self-reply chains: a record replying (replyToId) to another record IN THE
    // LIBRARY by the SAME author joins that record's group, so リプ元＋セルフリプ
    // render as one card. The platform-local own-id is the last segment of the
    // post key (tweet id / rkey / note id / status id). Opt-outs (ungrouped)
    // suppress the merge for either side.
    const pidOf = (p) => { const k = pk(p); return k ? k.split(/[/:]/).pop() : null; };
    const idIndex = new Map();    // userId + '|' + ownPostId → entry
    for (const e of base) {
      const id = pidOf(e.p);
      if (id && e.p.userId) idIndex.set(e.p.userId + '|' + id, e);
    }
    const alias = new Map();      // child group key → parent group key
    for (const e of base) {
      const p = e.p;
      if (!p.replyToId || !p.userId) continue;
      const ownKey = pk(p);
      if (!ownKey || ungrouped.has(ownKey)) continue;
      const parent = idIndex.get(p.userId + '|' + String(p.replyToId));
      if (!parent || parent.key === e.key) continue;
      if (String(parent.key).indexOf('__solo') === 0) continue;   // parent opted out / unkeyed
      alias.set(e.key, parent.key);
    }
    const resolveKey = (k) => { let n = 0; while (alias.has(k) && n++ < 10) k = alias.get(k); return k; };
    const map = new Map(); const order = [];
    for (const e of base) {
      const key = resolveKey(e.key);
      let g = map.get(key);
      if (!g) { g = { key, records: [] }; map.set(key, g); order.push(g); }
      g.records.push(e.p);
    }
    for (const g of order) {
      g.records.sort((a, b) => String(a.captureId || '').localeCompare(String(b.captureId || '')));
      // Card rep: prefer the click-capture (screenshot+full meta), then any record
      // with text, then the earliest — drags often carry no text/stats.
      g.rep = g.records.find(isScreenshot) || g.records.find((r) => r.text) || g.records[0];
      g.files = g.records.flatMap(groupFilesOf);
    }
    return order;
  }

  // Likes percentile within each platform — ranks "did well for its SNS" so X's
  // raw counts don't dominate. Returns a fn p→[0,1]. (Ported from image-view.)
  function percentileFn(list) {
    const byPlat = {};
    list.forEach((p) => { const k = p.platform || ''; (byPlat[k] || (byPlat[k] = [])).push(p.likes || 0); });
    Object.values(byPlat).forEach((a) => a.sort((x, y) => x - y));
    return (p) => {
      const arr = byPlat[p.platform || ''] || [];
      if (arr.length <= 1) return 1;
      const v = p.likes || 0;
      let lo = 0, hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; }
      return (lo - 1) / (arr.length - 1);
    };
  }

  const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
  // Stable per-author key: prefer the platform user id, fall back to the handle.
  const userKey = (p) => p.platform + ':' + (p.userId || ('@' + (p.screenName || '')));

  // --- Load posts ---
  // keepLimit: background refreshes (fs-watch, bulk delete) re-read the library
  // without replaying the entrance animation or resetting the scroll window.
  // Pre-compute sort timestamps so getFilteredPosts() never calls new Date() per
  // comparison (done once per record on arrival, not per render).
  function stampPost(p) {
    p._dateMs     = p.date       ? +new Date(p.date)       : 0;
    p._capturedMs = p.capturedAt ? +new Date(p.capturedAt) : 0;
    p._postKey    = postKeyOf(p.url);   // url-derived group key; groupRecords would re-parse it 3x/record otherwise
    return p;
  }
  // Authoritative cache keyed by captureId. The renderer holds the full set and
  // main ships only deltas (listPostsDelta) — a post-capture refresh no longer
  // re-serializes all ~9k records over IPC. allPosts is rebuilt from this map;
  // its order is irrelevant since getFilteredPosts() always re-sorts.
  let _postsById = new Map();
  let _haveBaseline = false;     // false until we hold a full snapshot (also reset on reload = fresh module state)
  let _loadPostsInFlight = false;
  let _loadPostsPending = false;
  // changedNames is the fs-watch hint relayed from main (null | [] | [names…]);
  // it lets the refresh re-stat only the changed sidecars instead of the whole
  // folder. Absent (explicit reloads: sort change, import) -> full reconcile.
  async function loadPosts(keepLimit, changedNames) {
    if (_loadPostsInFlight) { _loadPostsPending = true; return; }
    _loadPostsInFlight = true;
    try {
      const res = await window.corpus.listPostsDelta(_haveBaseline, changedNames);
      if (!res || res.full) {
        _postsById = new Map();
        for (const p of (res && res.posts) || []) _postsById.set(p.captureId, stampPost(p));
      } else {
        for (const id of (res.removed || [])) _postsById.delete(id);
        for (const p of (res.added || [])) _postsById.set(p.captureId, stampPost(p));
      }
      _haveBaseline = true;
      allPosts = [..._postsById.values()];
      _allPostsGeneration++;
      stickyRecs.clear();   // 画面更新（再読込）でミューテーション生存分を整理
      if (browseMode === 'posters') renderPosters(keepLimit); else if (browseMode === 'collections') renderCollections(); else renderPosts(keepLimit);
      reconcileFolders();
      renderPostFolders();
    } finally {
      _loadPostsInFlight = false;
      if (_loadPostsPending) {
        _loadPostsPending = false;
        loadPosts(true);  // background reload missed during in-flight — re-run once
      }
    }
  }
  function reconcileFolders() {
    if (!CF()) return;
    CF().reconcile(new Set(allPosts.map(p => p.captureId)));
    if (CF().reconcilePoster) CF().reconcilePoster(new Set(buildUsers().map(u => u.key)));   // drop posterKeys whose poster vanished
  }

  // Text-search predicate shared by the live filter (getFilteredPosts) and the
  // dynamic-collection preview (dynamicMatches): 通常＝部分一致 /
  // あいまい＝サブシーケンス一致（corpusSearch が方式を保持）. Empty query ⇒ match all.
  function makeTextMatcher(rawQuery) {
    const raw = (rawQuery || '').trim();
    if (!raw) return () => true;
    if (window.corpusSearch && window.corpusSearch.isFuzzy()) {
      const matchHay = window.corpusSearch.compile(raw);   // クエリは1回だけ正規化・前処理
      return (p) => matchHay([p.text, p.title, p.eagleName, p.screenName, p.displayName]
        .concat(p.tags || []).concat(p.hashtags || [])
        .map((x) => (x == null ? '' : String(x))).join(' '));
    }
    const q = raw.toLowerCase();
    return (p) =>
      (p.text || '').toLowerCase().includes(q) ||
      (p.title || '').toLowerCase().includes(q) ||
      (p.eagleName || '').toLowerCase().includes(q) ||
      (p.screenName || '').toLowerCase().includes(q) ||
      (p.displayName || '').toLowerCase().includes(q) ||
      (p.tags || []).some((t) => t.toLowerCase().includes(q)) ||
      (p.hashtags || []).some((t) => t.toLowerCase().includes(q));
  }

  function getFilteredPosts() {
    // 統一ビュー: 全アイテム（SNS投稿＋ライブラリ画像）が対象。中身（画像 or 本文）の
    // 無いレコードだけ除外。SNS投稿だけ/画像だけの絞り込みは「種別」フィルタ(kind)で。
    let posts = allPosts.filter(p => p.image || mediaFilesOf(p).length || p.text || p.title);
    const rawQuery = document.getElementById('searchBox').value.trim();
    const sort = sortSelect.value;

    // Text search: 通常＝部分一致 / あいまい＝サブシーケンス一致（corpusSearch が方式を保持）
    if (rawQuery) posts = posts.filter(makeTextMatcher(rawQuery));

    // ---- Query-builder evaluation: boolean condition tree ----
    // queryTree is a tree of groups (AND/OR, optionally negated) over leaf
    // conditions, built directly by the inline drag builder; evalNode walks it
    // recursively. See docs/design-query-builder.md「改訂③」.
    const queryRoot = currentTree();   // the boolean query tree (root group)
    if (queryRoot.children.length) posts = posts.filter((p) => evalNode(queryRoot, p, postPredOf));

    // Sticky records: items un-matched by a recent mutation stay visible
    // (cleared on the next filter change / data refresh).
    if (stickyRecs.size) {
      const have = new Set(posts.map((p) => p.captureId));
      for (const p of allPosts) if (stickyRecs.has(p.captureId) && !have.has(p.captureId)) posts.push(p);
    }


    // Sort — use pre-cached numeric timestamps (_dateMs/_capturedMs) to avoid
    // new Date() per comparator call (was ~120k allocations per sort on 9k posts).
    switch (sort) {
      case 'date-desc': posts.sort((a, b) => (b._dateMs || 0) - (a._dateMs || 0)); break;
      case 'date-asc': posts.sort((a, b) => (a._dateMs || 0) - (b._dateMs || 0)); break;
      case 'likes-desc': posts.sort((a, b) => (b.likes || 0) - (a.likes || 0)); break;
      case 'reposts-desc': posts.sort((a, b) => (b.reposts || 0) - (a.reposts || 0)); break;
      case 'replies-desc': posts.sort((a, b) => (b.replies || 0) - (a.replies || 0)); break;
      case 'captured-desc': posts.sort((a, b) => (b._capturedMs || 0) - (a._capturedMs || 0)); break;
      case 'likes-pct': { const pct = percentileFn(posts); posts.sort((a, b) => pct(b) - pct(a)); break; }
    }

    return posts;
  }

  let lastRenderedState = null;
  let _lastRenderGen = -1;   // _allPostsGeneration at the last FULL grid build (fast card-grow guard)
  let restoringState = false;
  let tabs = [];
  let activeTabId = null;
  let _tabPersistTimer = null;
  // Per-tab view-history for browser-style back/forward. Holds JSON snapshots of
  // snapshotState(); navIdx points at the current entry. Linear: navigating back
  // then making a fresh change drops the forward entries. In-memory per session
  // (rides on the tab object across switches; not written to disk).
  let navHist = [];
  let navIdx = -1;
  let appBooted = false;   // gate history until initTabs has applied the saved view (avoids a spurious empty entry from the early prefs render)
  const NAV_CAP = 60;
  function snapshotState() {
    return {
      // queryTree is the source of truth; f (the shadow) is kept for the tab title
      // (tabTitleOf reads state.f) and for migrating older persisted states.
      f: JSON.parse(JSON.stringify(activeFilters)),
      tree: JSON.parse(JSON.stringify(postQB.getTree())),
      search: document.getElementById('searchBox').value,
      sort: sortSelect.value,
      multi: multiOnly
    };
  }
  // Called from every fresh renderPosts(): keep the tab title + persistence in sync
  // with the current state, record it for the stickyRecs change-detection below,
  // and push it onto the per-tab back/forward history (see pushNavHistory).
  function syncTitleAndPersist() {
    const snap = snapshotState();
    lastRenderedState = JSON.stringify(snap);
    if (restoringState) return;
    pushNavHistory(snap);   // record this view for back/forward (skipped while restoring)
    document.title = tabTitleOf(snap, { allCount: allPosts.length }).text + ' — Corpus';
    updateActiveTabTitle(); persistTabsDebounced();
  }
  function applyState(s) {
    restoringState = true;
    // Restore the tree (truth); migrate older states (f + ops, no tree) if needed.
    postQB.setTree(s.tree ? s.tree : facetTreeFrom(s.f || [], s.ops || {}));
    document.getElementById('searchBox').value = s.search;
    sortSelect.value = s.sort;
    refreshCustomSelects();
    multiOnly = !!s.multi;
    renderPostFolders();
    renderQueryChips();
    renderPosts();
    restoringState = false;
    document.title = tabTitleOf(s, { allCount: allPosts.length }).text + ' — Corpus';
  }

  // --- View history (browser-style back/forward) ---
  function updateNavButtons() {
    const b = document.getElementById('navBackBtn'), f = document.getElementById('navFwdBtn');
    if (b) b.disabled = navIdx <= 0;
    if (f) f.disabled = navIdx >= navHist.length - 1;
  }
  // Record a fresh view. Called from syncTitleAndPersist on every real render
  // that isn't a restore. No-op when the state equals the current entry, so
  // background refreshes / re-renders of the same query don't pile up.
  function pushNavHistory(snap) {
    if (!appBooted) return;
    const s = JSON.stringify(snap);
    if (navIdx >= 0 && navHist[navIdx] === s) return;
    if (navIdx < navHist.length - 1) navHist = navHist.slice(0, navIdx + 1);   // drop forward branch
    navHist.push(s);
    if (navHist.length > NAV_CAP) navHist = navHist.slice(navHist.length - NAV_CAP);
    navIdx = navHist.length - 1;
    updateNavButtons();
  }
  function navTo(idx) {
    if (idx < 0 || idx >= navHist.length || idx === navIdx) return;
    navIdx = idx;
    applyState(JSON.parse(navHist[navIdx]));   // restoringState in applyState guards the re-push
    updateNavButtons();
    persistTabsDebounced();
  }
  function navBack() { navTo(navIdx - 1); }
  function navForward() { navTo(navIdx + 1); }
  // Adopt (or seed) a tab's history when it becomes active.
  function adoptTabNav(t) {
    if (t && Array.isArray(t._navHist) && t._navHist.length) {
      navHist = t._navHist;
      navIdx = (typeof t._navIdx === 'number') ? Math.max(0, Math.min(t._navIdx, navHist.length - 1)) : navHist.length - 1;
    } else {
      navHist = [JSON.stringify(snapshotState())];
      navIdx = 0;
    }
    updateNavButtons();
  }
  // Nav is post-mode only and yields to typing / open overlays / poster mode.
  function navAllowed() {
    if (browseMode !== 'posts') return false;   // history nav is post-view only (posters/collections excluded)
    if (document.querySelector('.confirm-overlay.show') || lightbox.classList.contains('show')) return false;
    if (!document.getElementById('settingsView').hidden) return false;
    if (!document.getElementById('ivFolderModal').hidden) return false;
    return true;
  }

  // --- Window tabs ---
  const TAB_ICONS = {
    all:        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    search:     '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    tag:        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    hashtag:    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
    user:       '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    platform:   '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    instance:   '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    postType:   '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    media:      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    date:       '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    engagement: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    kind:       '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    workspace:  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    folder:     '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  };
  function genTabId() { return 'tab_' + Math.random().toString(36).slice(2, 10); }
  function persistTabsDebounced() {
    clearTimeout(_tabPersistTimer);
    _tabPersistTimer = setTimeout(() => {
      if (!window.corpus.setTabs) return;
      const at = tabs.find((t) => t.id === activeTabId);
      if (at) { at.state = snapshotState(); at._scrollTop = contentScrollTop(); at._renderLimit = renderLimit; }
      // scrollTop + renderLimit ride along so the view restores across RESTART, not
      // just tab switches (main.js writes the payload verbatim — no whitelist).
      window.corpus.setTabs({ activeTabId, tabs: tabs.map((t) => ({ id: t.id, pinned: t.pinned, title: t.title, state: t.state, scrollTop: t._scrollTop, renderLimit: t._renderLimit })) });
    }, 800);
  }
  function saveActiveTabState() {
    const t = tabs.find((t) => t.id === activeTabId);
    if (!t) return;
    t.state = snapshotState();
    t._scrollTop = contentScrollTop();    // remember content scroll per tab (persisted too)
    t._renderLimit = renderLimit;     // …and how far the windowed list had grown
    t._navHist = navHist;             // carry the back/forward history with the tab
    t._navIdx = navIdx;
  }
  // Restore a tab's remembered renderLimit (re-render to it so a deep-scroll layout is
  // reproduced) then its content scroll. rAF×2 so the re-rendered content has laid out.
  // Capped so a pathological deep scroll doesn't render thousands of cards at once.
  function restoreTabView(t) {
    if (!t) return;
    const lim = Math.min((typeof t._renderLimit === 'number' ? t._renderLimit : RENDER_PAGE), RENDER_PAGE * 8);
    if (lim > renderLimit) { renderLimit = lim; renderPosts(true); }
    const y = (typeof t._scrollTop === 'number') ? t._scrollTop : 0;
    requestAnimationFrame(() => requestAnimationFrame(() => scrollContentTo(y)));
  }
  function updateActiveTabTitle() {
    if (!activeTabId) return;
    const bar = document.getElementById('tabBarInner');
    if (!bar) return;
    const t = tabs.find((t) => t.id === activeTabId);
    if (!t || t.title) return;
    const snap = snapshotState();
    const info = tabTitleOf(snap, { allCount: allPosts.length });
    const tabEl = bar.querySelector('[data-tab="' + CSS.escape(activeTabId) + '"]');
    if (!tabEl) return;
    const titleEl = tabEl.querySelector('.tab-title');
    if (titleEl) { titleEl.textContent = info.text; tabEl.title = info.text; }
  }
  function renderTabTitle(t) {
    if (t.title) return t.title;
    const s = (t.id === activeTabId) ? snapshotState() : (t.state || {});
    return tabTitleOf(s, { allCount: allPosts.length }).text;
  }
  function renderTabs() {
    const bar = document.getElementById('tabBarInner');
    if (!bar) return;
    let html = '';
    for (const t of tabs) {
      const isActive = t.id === activeTabId;
      const ttl = renderTabTitle(t);
      const s = (t.id === activeTabId) ? snapshotState() : (t.state || {});
      const pinSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>';
      const icon = t.pinned ? pinSvg : (TAB_ICONS[tabTitleOf(s, { allCount: allPosts.length }).iconType] || TAB_ICONS.all);
      const closeBtn = (!t.pinned && tabs.length > 1)
        ? '<button class="tab-close" data-close="' + escapeAttr(t.id) + '" title="' + escapeAttr(MSG.tabClose) + '" aria-label="' + escapeAttr(MSG.tabClose) + '"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
        : '';
      // NOTE: must be a <div>, not <button> — a button cannot contain the
      // .tab-close button (the HTML parser auto-closes the outer one, which
      // sprays the close buttons between the tabs as siblings).
      html += '<div class="tab-item' + (isActive ? ' active' : '') + (t.pinned ? ' pinned' : '') + '" role="tab" aria-selected="' + (isActive ? 'true' : 'false') + '" tabindex="0" data-tab="' + escapeAttr(t.id) + '">'
        + '<span class="tab-body"><span class="tab-icon" aria-hidden="true">' + icon + '</span>'
        + '<span class="tab-title">' + escapeHtml(ttl) + '</span></span>'
        + closeBtn + '</div>';
    }
    html += '<button class="tab-new" title="' + escapeAttr(MSG.tabNew) + '" aria-label="' + escapeAttr(MSG.tabNew) + '"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>';
    bar.innerHTML = html;
  }
  function switchTab(id) {
    if (id === activeTabId) return;
    saveActiveTabState();
    activeTabId = id;
    const t = tabs.find((t) => t.id === id);
    if (!t) return;
    if (t.state) applyState(t.state); else renderPosts();
    adoptTabNav(t);
    restoreTabView(t);
    renderTabs(); persistTabsDebounced();
  }
  function addTab() {
    saveActiveTabState();
    const id = genTabId();
    tabs.push({ id, pinned: false, title: null, state: { f: [], ops: {}, tree: null, search: '', sort: 'date-desc', multi: false } });
    activeTabId = id;
    applyState({ f: [], ops: {}, search: '', sort: sortSelect.value, multi: false });
    adoptTabNav(tabs.find((t) => t.id === id));   // fresh tab → fresh history (seeded with the empty view)
    requestAnimationFrame(() => scrollContentTo(0));   // new tab starts at the top
    renderTabs(); persistTabsDebounced();
  }
  function closeTab(id) {
    if (tabs.length <= 1) {
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
      if (t.state) applyState(t.state); else renderPosts();
      adoptTabNav(t);
      restoreTabView(t);
    }
    renderTabs(); persistTabsDebounced();
  }
  function pinTab(id) {
    const t = tabs.find((t) => t.id === id);
    if (!t) return;
    t.pinned = !t.pinned;
    tabs = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
    renderTabs(); persistTabsDebounced();
  }
  function renameTab(id, name) {
    const t = tabs.find((t) => t.id === id);
    if (!t) return;
    t.title = name.trim() || null;
    renderTabs(); persistTabsDebounced();
  }
  function duplicateTab(id) {
    saveActiveTabState();
    const src = tabs.find((t) => t.id === id);
    if (!src) return;
    const idx = tabs.indexOf(src);
    const nt = { id: genTabId(), pinned: false, title: src.title ? src.title + ' (2)' : null, state: JSON.parse(JSON.stringify(src.state || {})) };
    tabs.splice(idx + 1, 0, nt);
    activeTabId = nt.id;
    if (nt.state && Object.keys(nt.state).length) applyState(nt.state); else renderPosts();
    adoptTabNav(nt);   // duplicate starts its own history at the copied view
    renderTabs(); persistTabsDebounced();
  }
  async function initTabs() {
    try {
      const saved = window.corpus.getTabs ? await window.corpus.getTabs() : null;
      if (saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
        tabs = saved.tabs.map((t) => ({ id: t.id || genTabId(), pinned: !!t.pinned, title: t.title || null, state: t.state || null, _scrollTop: (typeof t.scrollTop === 'number' ? t.scrollTop : 0), _renderLimit: (typeof t.renderLimit === 'number' ? t.renderLimit : RENDER_PAGE) }));
        const sid = saved.activeTabId;
        activeTabId = (sid && tabs.find((t) => t.id === sid)) ? sid : tabs[0].id;
      } else {
        const id = genTabId();
        tabs = [{ id, pinned: false, title: null, state: null }];
        activeTabId = id;
      }
      const at = tabs.find((t) => t.id === activeTabId);
      if (at && at.state) {
        // queryTree is the truth; migrate older states (f + ops, no tree).
        postQB.setTree(at.state.tree ? at.state.tree : facetTreeFrom(at.state.f || [], at.state.ops || {}));
        document.getElementById('searchBox').value = at.state.search || '';
        sortSelect.value = at.state.sort || 'date-desc';
        refreshCustomSelects();
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
  (function setupTabBar() {
    const bar = document.getElementById('tabBarInner');
    if (!bar) return;
    let tabMenu = null;
    let tabMenuTargetId = null;
    function hideTabMenu() {
      if (tabMenu) { tabMenu.remove(); tabMenu = null; tabMenuTargetId = null; }
    }
    function showTabMenu(id, e) {
      hideTabMenu();
      tabMenuTargetId = id;
      const t = tabs.find((t) => t.id === id);
      if (!t) return;
      const menu = document.createElement('div');
      menu.className = 'fold-menu';
      menu.innerHTML = [
        '<div class="fm-row" data-tab-act="pin">' + (t.pinned ? MSG.tabUnpin : MSG.tabPin) + '</div>',
        '<div class="fm-row" data-tab-act="rename">' + MSG.tabRename + '</div>',
        '<div class="fm-row" data-tab-act="duplicate">' + MSG.tabDuplicate + '</div>',
        tabs.length > 1 ? '<div class="fm-row" data-tab-act="close">' + MSG.tabClose + '</div>' : '',
        tabs.length > 1 ? '<div class="fm-row fm-danger" data-tab-act="close-others">' + MSG.tabCloseOthers + '</div>' : '',
      ].join('');
      document.body.appendChild(menu);
      tabMenu = menu;
      menu.style.left = e.clientX + 'px';
      menu.style.top = (e.clientY + 4) + 'px';
      menu.classList.add('show');
      clampIntoView(menu);   // same cursor-menu clamp as the other context menus
      menu.addEventListener('click', (ev) => {
        const row = ev.target.closest('[data-tab-act]');
        if (!row) return;
        const act = row.dataset.tabAct;
        const tid = tabMenuTargetId;
        hideTabMenu();
        if (act === 'pin') pinTab(tid);
        else if (act === 'rename') startTabRename(tid);
        else if (act === 'duplicate') duplicateTab(tid);
        else if (act === 'close') closeTab(tid);
        else if (act === 'close-others') {
          tabs = tabs.filter((t) => t.id === tid);
          const t = tabs[0];
          activeTabId = tid;
          if (t.state) applyState(t.state); else renderPosts();
          renderTabs(); persistTabsDebounced();
        }
      });
    }
    function startTabRename(id) {
      const tabEl = bar.querySelector('[data-tab="' + CSS.escape(id) + '"]');
      if (!tabEl) return;
      const t = tabs.find((t) => t.id === id);
      if (!t) return;
      const titleEl = tabEl.querySelector('.tab-title');
      if (!titleEl) return;
      const input = document.createElement('input');
      input.className = 'tab-rename-input';
      input.value = renderTabTitle(t);
      titleEl.replaceWith(input);
      input.focus(); input.select();
      let committed = false;
      const commit = () => { if (committed) return; committed = true; renameTab(id, input.value); };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        else if (ev.key === 'Escape') { committed = true; renderTabs(); }
      });
      input.addEventListener('blur', commit);
    }
    bar.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close]');
      if (closeBtn) { e.stopPropagation(); closeTab(closeBtn.dataset.close); return; }
      const newBtn = e.target.closest('.tab-new');
      if (newBtn) { addTab(); return; }
      const tabBtn = e.target.closest('.tab-item[data-tab]');
      if (tabBtn && !e.target.closest('.tab-rename-input')) { switchTab(tabBtn.dataset.tab); return; }
    });
    // Middle-click (wheel) a tab to close it — matches the close-button rule
    // (pinned tabs and the last remaining tab stay protected).
    bar.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const tabBtn = e.target.closest('.tab-item[data-tab]');
      if (!tabBtn) return;
      e.preventDefault();
      const t = tabs.find((x) => x.id === tabBtn.dataset.tab);
      if (t && !t.pinned && tabs.length > 1) closeTab(t.id);
    });
    // Suppress the middle-click autoscroll cursor over the tab strip.
    bar.addEventListener('mousedown', (e) => {
      if (e.button === 1 && e.target.closest('.tab-item[data-tab]')) e.preventDefault();
    });
    bar.addEventListener('contextmenu', (e) => {
      const tabBtn = e.target.closest('.tab-item[data-tab]');
      if (!tabBtn) return;
      e.preventDefault();
      showTabMenu(tabBtn.dataset.tab, e);
    });
    bar.addEventListener('dblclick', (e) => {
      const tabBtn = e.target.closest('.tab-item[data-tab]');
      if (!tabBtn || e.target.closest('[data-close]')) return;
      startTabRename(tabBtn.dataset.tab);
    });
    document.addEventListener('click', (e) => {
      if (tabMenu && !tabMenu.contains(e.target)) hideTabMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && tabMenu) { hideTabMenu(); return; }
      if (!e.ctrlKey || e.altKey) return;
      if (e.key === 't') {
        e.preventDefault(); addTab();
      } else if (e.key === 'w') {
        e.preventDefault(); closeTab(activeTabId);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (idx < 0) return;
        const n = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
        switchTab(tabs[n].id);
      }
    });
  })();

  // Mutations (untag, unfold, ungroup) can make a visible card stop matching the
  // active filter. Instead of vanishing instantly, the card stays until the next
  // filter change / data refresh — call this BEFORE the mutation re-render.
  function keepCurrentVisible() {
    viewGroups.forEach((g) => g.records.forEach((r) => { if (r.captureId) stickyRecs.add(r.captureId); }));
  }

  const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // --- Masonry (card view): pack cards into N equal flex columns by measured
  // height so short cards don't stretch (Eagle-style waterfall). Re-runs on image
  // load (debounced) and resize; load-more re-renders so it re-packs naturally.
  // Approach A (measure live); a future B could store image dims to skip the
  // load-time settle and the eager image load.
  let _masonryT = null;
  function masonryColCount(gridW) {
    const gap = 16;
    return Math.max(1, Math.floor((gridW + gap) / (cardSize + gap)));
  }
  function layoutMasonry() {
    const grid = document.getElementById('postGrid');
    if (!grid || currentView !== 'card' || !grid.classList.contains('masonry')) return;
    const cards = Array.from(grid.querySelectorAll('.post-card'));
    if (!cards.length) return;
    const sentinel = grid.querySelector('.more-sentinel');
    const gap = 16;
    const N = masonryColCount(grid.clientWidth);
    const cols = Array.from({ length: N }, () => {
      const d = document.createElement('div'); d.className = 'mcol'; return d;
    });
    const wrap = document.createElement('div'); wrap.className = 'mcols';
    cols.forEach((c) => wrap.appendChild(c));
    // Drop every card into col 0 first so each measures at the real COLUMN width.
    cols[0].append(...cards);
    grid.replaceChildren(wrap);
    if (sentinel) grid.appendChild(sentinel);
    const hs = cards.map((c) => c.offsetHeight);   // one reflow read, correct width
    // Greedy: each card into the currently-shortest column (keeps rough order).
    const colH = new Array(N).fill(0);
    cards.forEach((card, i) => {
      let m = 0; for (let c = 1; c < N; c++) if (colH[c] < colH[m]) m = c;
      cols[m].appendChild(card);
      colH[m] += hs[i] + gap;
    });
  }
  function scheduleMasonry() {
    clearTimeout(_masonryT);   // reset-debounce: re-pack ONCE after image loads quiet down (not on every load = no jitter)
    _masonryT = setTimeout(() => { _masonryT = null; layoutMasonry(); }, 160);
  }
  // Load-more sentinel: render the next page when a bottom marker nears the viewport.
  // Shared by the full build and the fast card-grow path.
  function setupMoreSentinel(grid) {
    if (moreObserver) { moreObserver.disconnect(); moreObserver = null; }
    const old = grid.querySelector('.more-sentinel'); if (old) old.remove();
    if (viewGroups.length <= renderLimit) return;
    const sentinel = document.createElement('div');
    sentinel.className = 'more-sentinel';
    sentinel.style.cssText = 'grid-column:1/-1;width:100%;height:1px;';
    grid.appendChild(sentinel);
    moreObserver = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) { renderLimit += RENDER_PAGE; renderPosts(true); }
    }, { root: contentScrollEl(), rootMargin: '800px' });
    moreObserver.observe(sentinel);
  }
  // Card images with a reserved height (shotW/shotH or cached aspect) don't re-pack
  // on load. Only UNSIZED ones learn their aspect on load + trigger one debounced
  // re-pack. Shared by the full build and the fast card-grow path.
  function learnCardAspects(imgs) {
    imgs.forEach((img) => {
      if (img.style.aspectRatio && img.style.aspectRatio !== 'auto') return;   // height reserved → leave it
      const cap = img.getAttribute('data-cap');
      const onReady = () => {
        if (cap && img.naturalWidth && img.naturalHeight) {
          const ar = img.naturalWidth + '/' + img.naturalHeight;
          if (imgAspect[cap] !== ar) { imgAspect[cap] = ar; persistAspect(); }
        }
        scheduleMasonry();
      };
      if (img.complete && img.naturalWidth) onReady();
      else img.addEventListener('load', onReady, { once: true });
    });
  }
  // Per-image aspect ratio cache (captureId -> "W/H"), learned on image load and
  // persisted. Lets a card reserve the right height BEFORE its (lazy) image loads,
  // so masonry packs correctly the first time = no settle/jitter and no eager load.
  let imgAspect = {};
  try { imgAspect = JSON.parse(localStorage.getItem('corpus.imgAspect') || '{}') || {}; } catch (e) {}
  let _aspectT = null;
  function persistAspect() {
    clearTimeout(_aspectT);
    _aspectT = setTimeout(() => { try { localStorage.setItem('corpus.imgAspect', JSON.stringify(imgAspect)); } catch (e) {} }, 1000);
  }
  window.addEventListener('resize', () => { if (currentView === 'card') scheduleMasonry(); }, { passive: true });

  function renderPosts(keepLimit) {
    if (!keepLimit) renderLimit = RENDER_PAGE;
    // View signature (filter/sort/search/view) — stable across this render, so
    // compute once and reuse for both the sticky-drop check and the fast-path guard.
    const stateSig = JSON.stringify(snapshotState());
    // A genuine filter/search/sort change drops the sticky survivors (they only
    // outlive in-place mutations, not user-driven view changes).
    if (!keepLimit && stickyRecs.size && lastRenderedState !== null &&
        stateSig !== lastRenderedState) {
      stickyRecs.clear();
    }
    updateSidebarState();
    syncBrowseBar();   // keep the ライブラリ/投稿者 toggle's glass thumb measured
    const grid = document.getElementById('postGrid');
    const empty = document.getElementById('emptyState');
    const countEl = document.getElementById('postCount');
    // Group the filtered records (auto by post URL + manual groups); each group
    // renders as ONE card. multiOnly now means "groups with more than one image".
    viewGroups = groupRecords(getFilteredPosts());
    if (multiOnly) viewGroups = viewGroups.filter((g) => g.files.length > 1 || g.records.some((r) => stickyRecs.has(r.captureId)));
    const query = document.getElementById('searchBox').value.trim();

    countEl.textContent = MSG.postCount(viewGroups.length);

    if (viewGroups.length === 0) {
      grid.innerHTML = '';
      grid.style.display = 'none';
      empty.style.display = 'block';
      if (!keepLimit && !prefersReducedMotion()) { void empty.offsetWidth; empty.classList.add('anim-in'); setTimeout(() => empty.classList.remove('anim-in'), 400); }
      // Empty states carry a "what to do next" affordance: the capture
      // shortcut + ZIP restore on first run, a one-click reset when filters
      // ate everything. Buttons are re-created each render → delegated below.
      if (allPosts.length === 0 && !query) {
        empty.innerHTML = `<p><strong>${MSG.emptyTitle}</strong></p><p>${MSG.emptyDesc}</p>` +
          `<p>${MSG.emptyCaptureHint}</p>` +
          `<button type="button" class="empty-cta" id="emptyImportBtn">${MSG.importZip}</button>`;
      } else {
        empty.innerHTML = `<p><strong>${MSG.emptySearchTitle}</strong></p><p>${MSG.emptySearchDesc}</p>` +
          `<button type="button" class="empty-cta" id="emptyResetBtn">${MSG.emptyResetBtn}</button>`;
      }
      if (!keepLimit) syncTitleAndPersist();   // 0件の状態もタイトル・永続化を同期
      return;
    }

    grid.style.display = currentView === 'list' ? 'flex' : currentView === 'card' ? 'block' : 'grid';
    grid.classList.toggle('list-view', currentView === 'list');
    grid.classList.toggle('tile-view', currentView === 'tile');
    applyTileLayout();
    empty.style.display = 'none';

    // Card entrance plays only on a fresh build (filter/sort/search), never on
    // load-more (keepLimit) — otherwise every already-visible card re-animates
    // on each scroll page. Skipped under prefers-reduced-motion.
    grid.classList.toggle('anim-in', !keepLimit && !prefersReducedMotion());
    grid.classList.toggle('masonry', currentView === 'card');
    // Selection mode: rings stay visible on every card, hover actions hide (CSS).
    grid.classList.toggle('selecting', selectedSet.size > 0);
    // Tile overlay (author/❤) is optional; the ❤ count only shows while an
    // engagement sort or filter is active (otherwise it's noise).
    grid.classList.toggle('no-overlay', !tileOverlay);
    grid.classList.toggle('show-eng',
      ['likes-desc', 'reposts-desc', 'replies-desc', 'likes-pct'].includes(sortSelect.value) ||
      activeFilters.some(f => f.type === 'engagement'));

    // FAST PATH — pure load-more in card view: append ONLY the new slice into the
    // existing masonry columns so already-visible cards (and their <img>) aren't
    // recreated. The old full innerHTML rebuild reloaded every visible image at the
    // 150-card boundary (一瞬チラつき). Guarded tightly; any mismatch (filter/sort
    // change, background reload, resized columns, list/tile view) falls through to
    // the full rebuild below.
    {
      const wrap = grid.querySelector('.mcols');
      const rendered = wrap ? wrap.querySelectorAll('.post-card').length : 0;
      const sameQuery = lastRenderedState !== null && stateSig === lastRenderedState;
      if (keepLimit && currentView === 'card' && wrap && rendered > 0 &&
          _allPostsGeneration === _lastRenderGen && sameQuery &&
          wrap.children.length === masonryColCount(grid.clientWidth) &&
          rendered < viewGroups.length && renderLimit > rendered) {
        const cols = [...wrap.querySelectorAll('.mcol')];
        const upto = Math.min(renderLimit, viewGroups.length);
        const frag = document.createElement('div');
        frag.innerHTML = viewGroups.slice(rendered, upto).map((g, k) => cardHtml(g, rendered + k)).join('');
        const newCards = [...frag.children];
        const colH = cols.map((c) => c.offsetHeight);   // current column heights
        cols[0].append(...newCards);                     // park to measure at column width
        const gap = 16, hs = newCards.map((c) => c.offsetHeight);
        newCards.forEach((card, k) => {                  // greedy: continue packing the shortest column
          let m = 0; for (let c = 1; c < cols.length; c++) if (colH[c] < colH[m]) m = c;
          cols[m].appendChild(card); colH[m] += hs[k] + gap;
        });
        learnCardAspects(newCards.flatMap((c) => [...c.querySelectorAll('.card-img')]));
        setupMoreSentinel(grid);
        requestAnimationFrame(() => newCards.forEach((card) => card.querySelectorAll('.text')
          .forEach((el) => el.classList.toggle('truncated', el.scrollHeight > el.clientHeight))));
        return;
      }
    }

    grid.innerHTML = viewGroups.slice(0, renderLimit).map(cardHtml).join('');
    _lastRenderGen = _allPostsGeneration;   // mark the generation of this FULL build
    function cardHtml(g, i) {
      const p = g.rep;
      // Engagement: nonzero only (zeros are noise \u2014 every client hides them),
      // outline TEXT glyphs (\u2661 \u21c4 \ud83d\udde8 \u2014 text presentation, not color emoji,
      // not SVG: user-picked style) + bare count, no unit words.
      const statsHtml = [
        p.likes > 0 ? `<span class="st">\u2661 ${formatCount(p.likes)}</span>` : '',
        p.reposts > 0 ? `<span class="st">\u21c4 ${formatCount(p.reposts)}</span>` : '',
        p.replies > 0 ? `<span class="st">\ud83d\udde8\ufe0e ${formatCount(p.replies)}</span>` : '',
        p.bookmarks > 0 ? `<span class="st">\ud83d\udd16\ufe0e ${formatCount(p.bookmarks)}</span>` : ''
      ].filter(Boolean).join('');

      const dateStr = p.date ? MSG.postedOn(formatDate(p.date)) : '';
      const capturedStr = p.capturedAt ? MSG.captured(formatDate(p.capturedAt)) : '';
      // Both dates on the card: post date bare (primary) + capture date with a
      // 📷 mark (secondary, muted). Deduped when they land on the same day.
      const postCompact = p.date ? compactDate(p.date) : '';
      const capCompact = p.capturedAt ? compactDate(p.capturedAt) : '';
      const footDates = [
        postCompact ? `<span class="pdate"${dateStr ? ` title="${escapeAttr(dateStr)}"` : ''}>${postCompact}</span>` : '',
        (capCompact && capCompact !== postCompact) ? `<span class="cdate"${capturedStr ? ` title="${escapeAttr(capturedStr)}"` : ''}><svg class="cdate-ic" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></svg>${capCompact}</span>` : ''
      ].filter(Boolean).join('');
      // Platform = a source badge on the thumbnail's bottom-left (Instagram/Pinterest
      // style). It used to live in the bottom-right WITH the date, which read oddly
      // (a category label paired with a timestamp); the head of line 1 was rejected
      // earlier for crowding the author. The thumbnail corner keeps it off the text.
      const pfName = p.platform ? (PF_NAME[p.platform] || p.platform) : '';
      const pfBadge = p.platform ? `<div class="pf-badge" title="${escapeAttr(pfName)}"><span class="pf-dot ${p.platform}"></span><span class="pf-badge-name">${escapeHtml(pfName)}</span></div>` : '';
      const userName = p.displayName || p.screenName || p.title || '';
      const handle = p.screenName ? `@${p.screenName}` : '';
      // Library images carry the filename as BOTH title and text — showing it
      // twice (user line + body) is pure noise, so drop the duplicate body.
      const textRaw = p.text || p.title || '';
      const textPreview = textRaw === userName ? '' : escapeHtml(textRaw);
      const imgFile = densityImage(p, currentView);   // tile: artwork→capture; card/list: capture→artwork
      // GIFs stay full-size in card/list so they keep animating (the thumbnailer
      // flattens GIF to a static JPEG); tile already used a thumb, so unchanged.
      const imgW = currentView === 'tile' ? tileThumbW()
        : /\.gif$/i.test(imgFile || '') ? 0
        : (currentView === 'list' ? listThumbW() : cardThumbW());
      // Reserve the card image's height BEFORE its lazy image loads (card masonry)
      // so the column packs correctly the first time = no load-time settle/jitter.
      // Pixel size from the index (shotW/shotH) covers every post up front; the
      // learned cache is a fallback for any the index couldn't size yet.
      const aspRatio = currentView !== 'card' ? ''
        : (p.shotW > 0 && p.shotH > 0) ? (p.shotW + '/' + p.shotH)
        : (p.captureId && imgAspect[p.captureId]) ? imgAspect[p.captureId]
        : '';
      const nImg = g.files.length;                    // ×N badge: total images across the group
      const likesOv = p.likes != null ? `<span class="ov-likes">♡ ${MSG.likes(p.likes)}</span>` : '';

      // Post-type + media flags (grid view only; hidden in the compact list view).
      const flags = [];
      if (p.isThread) flags.push(MSG.qfThread);
      if (p.isReply) flags.push(MSG.qfReply);
      if (p.isQuote) flags.push(MSG.qfQuote);
      const mediaLabel = p.mediaType === 'image' ? MSG.qfImage
        : p.mediaType === 'video' ? MSG.qfVideo
        : p.mediaType === 'gif' ? MSG.qfGif : '';
      const flagsHtml = (flags.length || mediaLabel)
        ? `<div class="post-flags">${flags.map(f => `<span class="post-flag flag-type">${escapeHtml(f)}</span>`).join('')}${mediaLabel ? `<span class="post-flag flag-media">${escapeHtml(mediaLabel)}</span>` : ''}</div>`
        : '';

      const postKey = postIdKey(p);
      const isSelected = selectedSet.has(postKey);
      return `<div class="post-card${isSelected ? ' selected' : ''}${p.url ? '' : ' no-url'}" data-url="${escapeAttr(p.url || '')}" data-index="${i}" data-key="${escapeAttr(postKey)}">
        <div class="select-check" title="${MSG.tipSelect}"></div>
        <div class="act-pill" aria-hidden="true"></div>
        <button class="ws-btn${CF() && CF().inWorkspace(p.captureId) ? ' in' : ''}" data-ws="${i}" title="${MSG.tipWorkspace}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>
        <button class="info-btn" data-info="${i}" title="${MSG.tipInfo}" aria-label="${MSG.tipInfo}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.6" x2="12" y2="7.7"/></svg></button>
        <button class="tag-btn" data-tagedit="${i}" title="${MSG.tipTagEdit}" aria-label="${MSG.tipTagEdit}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg></button>
        ${(imgFile || p.video) ? `<div class="card-thumb">${imgFile ? `<img class="card-img" src="${fileSrc(imgFile, imgW)}" alt="" data-cap="${escapeAttr(p.captureId || '')}"${aspRatio ? ` style="aspect-ratio:${aspRatio}"` : ''} loading="${SMOKE_CAPTURE ? 'eager' : 'lazy'}" decoding="async">` : '<div class="card-img card-video">▶</div>'}${pfBadge}</div>` : ''}
        ${nImg > 1 ? `<div class="card-ntag">×${nImg}</div>` : ''}
        <div class="card-overlay"><span class="ov-author">${escapeHtml(userName)}</span>${likesOv}</div>
        <div class="post-meta">
          <div class="user"><span class="uname">${escapeHtml(userName)}</span>${handle ? `<span class="handle">${escapeHtml(handle)}</span>` : ''}</div>
          ${flagsHtml}
          ${textPreview ? `<div class="text">${textPreview}<span class="text-hint">${MSG.clickToExpand}</span></div>` : ''}
          ${(statsHtml || footDates) ? `<div class="post-foot">${statsHtml ? `<div class="stats">${statsHtml}</div>` : ''}<span class="foot-r">${footDates}</span></div>` : ''}
          ${p.tags?.length ? `<div class="tags-label">${p.tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>
      </div>`;
    }

    // Load-more sentinel (shared helper).
    setupMoreSentinel(grid);

    // Card view: pack into masonry columns once, now. Cards whose height is
    // reserved up front (shotW/shotH from the index, or a cached aspect) DON'T
    // re-pack when their image loads — the box is already the right size, so the
    // lazy image just fills it with no layout change. Re-packing on every load was
    // tearing down and rebuilding the WHOLE grid as images streamed in on scroll
    // (the "コマ送り" full-grid flicker). Only UNSIZED cards (rare: video / a
    // header we couldn't read) actually change height on load, so only those learn
    // their aspect and trigger one debounced re-pack.
    if (currentView === 'card') {
      layoutMasonry();
      learnCardAspects([...grid.querySelectorAll('.card-img')]);
    }

    // Mark truncated text elements
    requestAnimationFrame(() => {
      grid.querySelectorAll('.text').forEach(el => {
        el.classList.toggle('truncated', el.scrollHeight > el.clientHeight);
      });
    });

    // Re-apply the inspected-card ring (innerHTML rebuilds drop the class)
    if (inspectedKey) {
      const ii = viewGroups.findIndex((g2) => postIdKey(g2.rep) === inspectedKey);
      if (ii >= 0) {
        const el = grid.querySelector('.post-card[data-index="' + ii + '"]');
        if (el) el.classList.add('inspected');
      }
    }

    if (!keepLimit) syncTitleAndPersist();   // keep the tab title + persistence in sync
  }

  // Text expand/collapse on click
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const textEl = e.target.closest('.text');
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

  // Image lightbox / gallery (captured screenshot + downloaded originals)
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxVideo = document.getElementById('lightboxVideo');
  const lbCounter = document.getElementById('lbCounter');
  const lbPrev = document.getElementById('lbPrev');
  const lbNext = document.getElementById('lbNext');
  lbPrev.setAttribute('aria-label', MSG.lbPrev);
  lbNext.setAttribute('aria-label', MSG.lbNext);
  let galleryItems = [];
  let galleryIndex = 0;

  // Gallery items for a post: the screenshot first, then each original image.
  const isVideoFile = (f) => /\.(mp4|webm|mov|m4v)$/i.test(f || '');
  // Gallery for a whole group: every record's items in captureId order, deduped by src.
  function buildGroupGalleryItems(g) {
    if (g.records.length === 1) return buildGalleryItems(g.rep);
    const seen = new Set(); const items = [];
    for (const r of g.records) {
      for (const it of buildGalleryItems(r)) {
        if (seen.has(it.src)) continue;
        seen.add(it.src); items.push(it);
      }
    }
    return items;
  }
  function buildGalleryItems(p) {
    const items = [];
    if (p.image) items.push({ src: imgSrc(p), alt: '', video: false });
    if (p.video) items.push({ src: 'psimg://img/' + encodeURIComponent(p.video), alt: '', video: true });
    if (Array.isArray(p.media)) {
      for (const m of p.media) {
        if (m && m.file) items.push({ src: 'psimg://img/' + encodeURIComponent(m.file), alt: m.alt || '', video: isVideoFile(m.file) });
      }
    }
    return items;
  }

  function stopVideo() {
    try { lightboxVideo.pause(); lightboxVideo.removeAttribute('src'); lightboxVideo.load(); } catch { /* ignore */ }
  }
  function showGallerySlide() {
    const item = galleryItems[galleryIndex];
    if (!item) return;
    if (item.video) {
      lightboxImg.style.display = 'none'; lightboxImg.src = '';
      lightboxVideo.style.display = ''; lightboxVideo.src = item.src;
    } else {
      stopVideo(); lightboxVideo.style.display = 'none';
      lightboxImg.style.display = ''; lightboxImg.src = item.src;
      lightboxImg.alt = item.alt || ''; // DOM property assignment — XSS-safe
    }
    lbCounter.textContent = (galleryIndex + 1) + ' / ' + galleryItems.length;
    lightbox.classList.toggle('multi', galleryItems.length > 1);
    // Restart the slide-in animation on the visible element so both opening the
    // gallery and stepping prev/next get the same quick fade (reduced-motion makes
    // it instant via the global CSS neutralizer). offsetWidth forces a reflow.
    const visEl = item.video ? lightboxVideo : lightboxImg;
    visEl.classList.remove('lb-in'); void visEl.offsetWidth; visEl.classList.add('lb-in');
  }

  function openGallery(items, start) {
    if (!items.length) return;
    galleryItems = items;
    galleryIndex = Math.max(0, Math.min(start || 0, items.length - 1));
    showGallerySlide();
    lightbox.classList.add('show');
  }

  function galleryStep(d) {
    if (galleryItems.length < 2) return;
    galleryIndex = (galleryIndex + d + galleryItems.length) % galleryItems.length;
    showGallerySlide();
  }

  function closeGallery() {
    lightbox.classList.remove('show', 'multi');
    lightboxImg.src = '';
    stopVideo(); lightboxVideo.style.display = 'none'; lightboxImg.style.display = '';
    galleryItems = [];
  }

  document.getElementById('postGrid').addEventListener('click', (e) => {
    // Image -> open the gallery (screenshot + originals, whole group).
    // While the inspector is open, a single click swaps its content instead
    // (inline browsing); the gallery is then reached by double-click.
    const img = e.target.closest('.card-img');
    if (img) {
      e.stopPropagation();
      const g = viewGroups[parseInt(img.closest('.post-card')?.dataset.index, 10)];
      if (!g) return;
      if (!document.getElementById('postDetail').hidden) { showDetail(g); return; }
      openGallery(buildGroupGalleryItems(g), 0);
    }
  });
  document.getElementById('postGrid').addEventListener('dblclick', (e) => {
    const img = e.target.closest('.card-img');
    if (!img || document.getElementById('postDetail').hidden) return;
    const g = viewGroups[parseInt(img.closest('.post-card')?.dataset.index, 10)];
    if (g) openGallery(buildGroupGalleryItems(g), 0);
  });

  // Middle-click an image → open it full-size in its own window (Chromium's
  // built-in image view via a bare psimg:// load).
  document.getElementById('postGrid').addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const img = e.target.closest('.card-img');
    if (!img) return;
    e.preventDefault();
    const g = viewGroups[parseInt(img.closest('.post-card')?.dataset.index, 10)];
    if (!g) return;
    const file = densityImage(g.rep, currentView);
    if (file && window.corpus.openImageWindow) window.corpus.openImageWindow(file);
  });
  // suppress the middle-click autoscroll on card images
  document.getElementById('postGrid').addEventListener('mousedown', (e) => {
    if (e.button === 1 && e.target.closest('.card-img')) e.preventDefault();
  });

  lbPrev.addEventListener('click', (e) => { e.stopPropagation(); galleryStep(-1); });
  lbNext.addEventListener('click', (e) => { e.stopPropagation(); galleryStep(1); });
  lightbox.addEventListener('click', (e) => {
    if (e.target.closest('.lb-nav') || e.target.closest('#lightboxVideo')) return; // nav + video controls don't close
    closeGallery();
  });
  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('show')) return;
    if (e.key === 'Escape') closeGallery();
    else if (e.key === 'ArrowLeft') galleryStep(-1);
    else if (e.key === 'ArrowRight') galleryStep(1);
  });

  // Workspace button: one-click add/remove this post to the single ephemeral
  // tray (no picking). Mutations never replay the entrance animation: re-render
  // (keepLimit) only when a workspace filter could change the visible set.
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.ws-btn');
    if (!btn) return;
    e.stopPropagation();
    if (!CF()) return;
    const g = viewGroups[parseInt(btn.dataset.ws, 10)];
    if (!g || !g.rep.captureId) return;
    keepCurrentVisible();   // removal can un-match an active workspace filter
    const res = CF().toggleWorkspace(g.records.map((r) => r.captureId), g.rep.captureId);
    if (!res) return;
    btn.classList.toggle('in', res === 'added');
    if (res === 'added') { btn.classList.add('added'); setTimeout(() => btn.classList.remove('added'), 500); }
    renderWorkspace();
    if (activeFilters.some((f) => f.type === 'workspace')) renderPosts(true);
  });

  // Folder picker flyout (destinations) — opened from the card context menu
  // and the bulk 「フォルダに追加」 button.
  const foldMenu = document.createElement('div');
  foldMenu.className = 'fold-menu';
  document.body.appendChild(foldMenu);
  let foldMenuGroup = null;
  function hideFoldMenu() { foldMenu.classList.remove('show'); foldMenuGroup = null; }
  function showFoldMenu(g, x, y) {
    if (!CF()) return;
    foldMenuGroup = g;
    const list = CF().all();
    const rep = g.rep.captureId;
    foldMenu.innerHTML = list.map((f) => {
      const inF = CF().has(f.id, rep);
      return `<div class="fm-row" data-fid="${escapeAttr(f.id)}">` +
        `<span class="fm-name">${escapeHtml(f.name)}</span>` +
        (inF ? `<span class="fm-check">${CHECK_SVG}</span>` : '') +
        `</div>`;
    }).join('') + (list.length ? '<div class="fm-sep"></div>' : '') +
      `<div class="fm-row fm-manage" data-manage="1">${MSG.ctxManage}</div>`;
    foldMenu.style.left = x + 'px';
    foldMenu.style.top = y + 'px';
    foldMenu.classList.add('show');
    clampIntoView(foldMenu);
  }
  foldMenu.addEventListener('click', (e) => {
    if (!CF()) { hideFoldMenu(); return; }
    if (e.target.closest('[data-manage]')) { hideFoldMenu(); CF().openManager(); return; }
    const row = e.target.closest('.fm-row[data-fid]');
    if (row && foldMenuGroup) {
      keepCurrentVisible();
      CF().toggleIn(row.dataset.fid, foldMenuGroup.records.map((r2) => r2.captureId), foldMenuGroup.rep.captureId);
      // re-render only if a folder filter could change the visible set
      if (activeFilters.some((f) => f.type === 'folder')) renderPosts(true);
    }
    hideFoldMenu();
  });
  document.addEventListener('click', (e) => { if (foldMenu.classList.contains('show') && !foldMenu.contains(e.target)) hideFoldMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideFoldMenu(); });

  // --- Card context menu: the labeled table of contents of per-card actions.
  // Hover keeps the rapid-fire buttons (🔖 workspace / ℹ info / 🏷 tag);
  // everything else (open, folder, poster, delete) lives here.
  const cardMenu = document.createElement('div');
  cardMenu.className = 'fold-menu card-menu';
  document.body.appendChild(cardMenu);
  let cardMenuGroup = null;
  let cardMenuSrcUrl = '';
  function hideCardMenu() { cardMenu.classList.remove('show'); cardMenuGroup = null; cardMenuSrcUrl = ''; }
  const CM_IC = {
    open: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    ws: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.6" x2="12" y2="7.7"/></svg>',
    del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    sauce: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    poster: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
  };
  function showCardMenu(g, x, y) {
    cardMenuGroup = g;
    cardMenuSrcUrl = (g.records.flatMap((r) => Array.isArray(r.media) ? r.media : []).find((m) => m && m.url) || {}).url || '';
    const inWs = !!(CF() && CF().inWorkspace(g.rep.captureId));
    // SNS posts have a poster in the poster view (buildUsers skips url-less migrations).
    const canPoster = !!(g.rep.url && buildUsers().some((u) => u.key === userKey(g.rep)));
    const row = (act, ic, label, cls) =>
      `<div class="fm-row${cls ? ' ' + cls : ''}" data-act="${act}"><span class="fm-ic">${ic}</span><span class="fm-name">${label}</span></div>`;
    cardMenu.innerHTML =
      (g.rep.url ? row('open', CM_IC.open, MSG.tipOpen) : '') +
      row('folder', CM_IC.folder, MSG.tipFolder) +
      (CF() ? row('ws', CM_IC.ws, inWs ? MSG.ctxWsRemove : MSG.ctxWsAdd) : '') +
      row('info', CM_IC.info, MSG.tipInfo) +
      (canPoster ? row('poster', CM_IC.poster, MSG.ctxViewPoster) : '') +
      (cardMenuSrcUrl ? '<div class="fm-sep"></div>' + row('sauce', CM_IC.sauce, MSG.detailSauce) + row('ascii', CM_IC.sauce, MSG.detailAscii) : '') +
      '<div class="fm-sep"></div>' +
      row('delete', CM_IC.del, MSG.tipDelete, 'fm-danger');
    cardMenu.style.left = x + 'px';
    cardMenu.style.top = y + 'px';
    cardMenu.classList.add('show');
    clampIntoView(cardMenu);
  }
  document.getElementById('postGrid').addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.post-card');
    if (!card) return;
    e.preventDefault();
    if (document.getElementById('postGrid').classList.contains('selecting')) return;  // selection bar owns bulk actions
    hideFoldMenu();
    const g = viewGroups[parseInt(card.dataset.index, 10)];
    if (g) showCardMenu(g, e.clientX, e.clientY);
  });
  cardMenu.addEventListener('click', (e) => {
    e.stopPropagation();   // keep the fold-menu we may open below alive past the document hider
    const rowEl = e.target.closest('.fm-row');
    const g = cardMenuGroup;
    const pos = cardMenu.getBoundingClientRect();
    hideCardMenu();
    if (!rowEl || !g) return;
    const act = rowEl.dataset.act;
    if (act === 'open') { if (g.rep.url) window.corpus.openExternal(g.rep.url); }
    else if (act === 'folder') showFoldMenu(g, pos.left, pos.top);
    else if (act === 'ws') { const b = document.querySelector(`.ws-btn[data-ws="${viewGroups.indexOf(g)}"]`); if (b) b.click(); }
    else if (act === 'info') showDetail(g);
    else if (act === 'poster') jumpToPoster(g.rep);
    else if (act === 'sauce') window.corpus.openExternal('https://saucenao.com/search.php?url=' + encodeURIComponent(cardMenuSrcUrl));
    else if (act === 'ascii') window.corpus.openExternal('https://ascii2d.net/search/url/' + encodeURIComponent(cardMenuSrcUrl));
    else if (act === 'delete') requestDeleteGroup(g);
  });
  document.addEventListener('click', (e) => { if (cardMenu.classList.contains('show') && !cardMenu.contains(e.target)) hideCardMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCardMenu(); });

  // Sidebar folder chips (shared folders.json): count + ★default. Like tag chips
  // they cycle 解除→いずれか(OR)→＋すべて含む(AND)→解除 and join the same
  // かつ/または expression as the tags.
  function renderPostFolders() {
    renderWorkspace();
    const host = document.getElementById('postFolderChips');
    if (!host || !CF()) return;
    const list = CF().all();
    const existing = new Set(allPosts.filter(p => p.url && p.captureId).map(p => p.captureId));
    if (!list.length) { host.innerHTML = '<span class="iv-folder-empty">' + escapeHtml(MSG.foldersNone) + '</span>'; return; }
    const active = new Set(activeFilters.filter(f => f.type === 'folder').map(f => f.value));
    host.innerHTML = list.map(f => {
      const n = f.items.filter(c => existing.has(c)).length;
      const on = active.has(f.id);
      return `<button class="sb-chip${on ? ' active' : ''}" data-fid="${escapeAttr(f.id)}" title="${MSG.tipFolderFilter}">${escapeHtml(f.name)}<span class="iv-tagn">${n}</span></button>`;
    }).join('');
  }
  // Workspace sidebar entry: the single ephemeral tray. Click toggles a filter
  // to show only its contents; クリア empties it (items themselves are kept).
  function renderWorkspace() {
    const row = document.getElementById('wsRow');
    const badge = document.getElementById('wsBadge');
    const clear = document.getElementById('wsClear');
    if (!row || !CF()) return;
    const existing = new Set(allPosts.map(p => p.captureId));
    const n = CF().workspaceCount(existing);
    const active = activeFilters.some(f => f.type === 'workspace');
    row.classList.toggle('active', active);
    if (badge) { badge.textContent = n; badge.classList.toggle('on', n > 0); }
    if (clear) clear.style.display = n > 0 ? '' : 'none';
  }
  document.getElementById('postFolderChips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.sb-chip');
    if (!chip) return;
    const fid = chip.dataset.fid;
    const existIdx = activeFilters.findIndex(f => f.type === 'folder' && f.value === fid);
    if (existIdx < 0) addFilter({ type: 'folder', value: fid });
    else removeFilter(existIdx);
    renderPostFolders();
  });
  // フォルダ管理の起動口はフライアウト下部の #qfFolderManage（→ CF().openManager()）に統一。
  // 旧 #postFolderManage ボタンは HTML から撤去済み（デッドリスナーを削除）。

  // Workspace: chip toggles a "show only the tray" filter; 空にする empties the
  // tray itself (confirmed — it reads nothing like removing the filter).
  (function setupWorkspaceSidebar() {
    const row = document.getElementById('wsRow');
    const clear = document.getElementById('wsClear');
    if (row) row.addEventListener('click', () => {
      const idx = activeFilters.findIndex(f => f.type === 'workspace');
      if (idx < 0) addFilter({ type: 'workspace', value: '*' });
      else removeFilter(idx);
      renderWorkspace();
    });
    if (clear) clear.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!CF()) return;
      if (!window.confirm(MSG.wsEmptyConfirm)) return;
      keepCurrentVisible();
      CF().clearWorkspace();
      renderPosts(true);
    });
  })();

  // Toggle a card in/out of the selection; Shift additionally selects the range
  // from the last-selected card (anchor), Google-Photos style.
  function toggleCardSelection(card, shiftKey) {
    const idx = parseInt(card.dataset.index, 10);
    const key = card.dataset.key;
    if (shiftKey && selectionAnchor !== null) {
      const lo = Math.min(selectionAnchor, idx);
      const hi = Math.max(selectionAnchor, idx);
      for (let i = lo; i <= hi; i++) { if (viewGroups[i]) selectedSet.add(postIdKey(viewGroups[i].rep)); }
      selectionAnchor = idx;
    } else if (selectedSet.has(key)) {
      selectedSet.delete(key);
      selectionAnchor = null;
    } else {
      selectedSet.add(key);
      selectionAnchor = idx;
    }
    syncSelectionClasses();   // class-only: don't rebuild the grid (was reloading every visible image)
    updateSelectionBar();
  }
  // Reflect selectedSet onto the DOM without a full re-render: toggle .selecting on
  // the grid + .selected per card. data-key round-trips to the template's postKey, so
  // this matches the template's own isSelected logic exactly.
  function syncSelectionClasses() {
    const grid = document.getElementById('postGrid');
    grid.classList.toggle('selecting', selectedSet.size > 0);
    grid.querySelectorAll('.post-card').forEach((c) => {
      c.classList.toggle('selected', selectedSet.has(c.dataset.key));
    });
  }

  // ○ select ring (top-left, shown on hover) — the ONLY way INTO the selection.
  // Clicking the card body does not select while nothing is selected yet.
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const ring = e.target.closest('.select-check');
    if (!ring) return;
    e.stopPropagation();
    const card = ring.closest('.post-card');
    if (card) toggleCardSelection(card, e.shiftKey);
  });

  // Selection mode (≥1 selected): a click ANYWHERE on a card toggles it.
  // Capture phase so it pre-empts every other card action (gallery, text
  // expand, ℹ/edit/delete/📁/open) until the selection is cleared.
  document.getElementById('postGrid').addEventListener('click', (e) => {
    if (selectedSet.size === 0) return;
    const card = e.target.closest('.post-card');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    toggleCardSelection(card, e.shiftKey);
  }, true);

  // Delete a card group (reached via the card context menu): confirm unless skipped.
  function requestDeleteGroup(g) {
    if (skipDeleteConfirm) {
      executeDeleteGroup(g);
    } else {
      pendingDeleteGroup = g;
      document.getElementById('confirmMsg').textContent =
        g.records.length > 1 ? MSG.confirmDeleteGroup(g.records.length) : MSG.confirmDeletePost;
      document.getElementById('confirmSkipLabel').style.display = 'flex';
      document.getElementById('confirmSkip').checked = false;
      setConfirmKeywordMode(false);
      document.getElementById('confirmOverlay').classList.add('show');
    }
  }

  let pendingDeleteGroup = null;

  // Delete every record of the group (a group IS one post in the UI).
  async function executeDeleteGroup(g) {
    if (inspectedKey && g.records.some((r) => postIdKey(r) === inspectedKey)) closeDetail();
    for (const r of g.records) {
      try { await window.corpus.deletePost(r.image || r.video); } catch { /* keep going */ }
      const idx = allPosts.findIndex(p => p.captureId === r.captureId);
      if (idx >= 0) allPosts.splice(idx, 1);
      _postsById.delete(r.captureId);   // keep the delta cache in sync with the optimistic removal
    }
    markPostsMutated();   // a deleted author/instance must drop out of the sidebar
    renderPosts(true);
    reconcileFolders();   // 削除した captureId をフォルダから即時掃除
    renderPostFolders();
    showToast(MSG.deleted);
  }

  // === Shared 種別 (kind) menu: right-click a tag chip (edit picker / inspector /
  // poster) to classify it 作品/キャラ/一般. A tag's 種別 is the TAG's own attribute
  // (no post is touched), surfaced as a quiet 段階的開示 entry inside tag editing. ===
  (function setupKindMenu() {
    const kindMenu = document.createElement('div');
    kindMenu.className = 'fold-menu kind-menu';
    document.body.appendChild(kindMenu);
    let kindMenuTag = null;
    let kindMenuOnChanged = null;   // re-render after a kind change (edit picker / inspector / poster)
    function hideKindMenu() { kindMenu.classList.remove('show'); kindMenuTag = null; }
    function showKindMenu(tag, x, y, onChanged) {
      kindMenuTag = tag;
      kindMenuOnChanged = onChanged || null;
      const cur = tagKindOf(tag);
      const row = (k, label) => {
        const dot = k ? `<span class="tk-dot tk-${k}"></span>` : '';
        const on = (k || null) === cur;
        return `<div class="fm-row" data-kind="${k || '__none'}"><span class="fm-ic">${dot}</span>` +
          `<span class="fm-name">${escapeHtml(label)}</span>${on ? `<span class="fm-check">${CHECK_SVG}</span>` : ''}</div>`;
      };
      kindMenu.innerHTML =
        `<div class="fm-head">${escapeHtml(MSG.tagKindHeader)}</div>` +
        row('work', MSG.kindWork) +
        row('character', MSG.kindCharacter) +
        '<div class="fm-sep"></div>' +
        row('', MSG.kindGeneral);
      kindMenu.style.left = x + 'px';
      kindMenu.style.top = y + 'px';
      kindMenu.classList.add('show');
      clampIntoView(kindMenu);
    }
    kindMenu.addEventListener('click', async (e) => {
      e.stopPropagation();   // survive the capture-phase document hider below
      const rowEl = e.target.closest('.fm-row'); const tag = kindMenuTag;
      hideKindMenu();
      if (!rowEl || !tag) return;
      const kind = rowEl.dataset.kind === '__none' ? '' : rowEl.dataset.kind;
      if ((tagKindOf(tag) || '') === kind) return;   // already that kind — no write
      await setTagKind(tag, kind);
      if (kindMenuOnChanged) kindMenuOnChanged();
      showToast(kind ? MSG.tagKindSet(kindLabel(kind)) : MSG.tagKindCleared);
    });
    document.addEventListener('click', (e) => { if (kindMenu.classList.contains('show') && !kindMenu.contains(e.target)) hideKindMenu(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideKindMenu(); });
    taggingApi = { showKindMenu };
  })();

  // === Inspector (ℹ on a card): persistent right column / slide-over ===
  function closeDetail() {
    document.getElementById('postDetail').hidden = true;
    document.getElementById('postDetailBox').innerHTML = '';
    inspectedKey = null;
    document.querySelectorAll('.inspected').forEach((el) => el.classList.remove('inspected'));   // post + poster cards
    document.getElementById('postGrid').classList.remove('insp-open');
    refreshTileSlider();   // the grid width grew back — re-derive the track
  }
  function persistManual() { if (window.corpus.setManualGroups) window.corpus.setManualGroups(manualGroups).catch(() => { /* best-effort */ }); }
  // Opt a post key out of (or back into) auto-grouping — persisted in ungrouped.json.
  function setGroupKey(key, ungroup) {
    if (!key) return;
    keepCurrentVisible();   // 複数画像のみ等のフィルタから外れても即消えしない
    if (ungroup) ungrouped.add(key); else ungrouped.delete(key);
    if (window.corpus.setUngrouped) window.corpus.setUngrouped([...ungrouped]).catch(() => { /* best-effort */ });
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
  // adoptSourceTag) and re-renders only the affected sub-parts so the input keeps focus
  // and the picker keeps its scroll. The chips + picker live in the panel itself — tag
  // editing is per-card here, no mode to enter (matches the poster inspector).
  let ivPickQuery = '';
  function sameTags(a, b) { if (a.length !== b.length) return false; const s = new Set(a); return b.every((t) => s.has(t)); }

  function refreshInspectorTags(g) {
    const host = document.getElementById('ivTagChips');
    if (!host || !g) return;
    const tags = Array.isArray(g.rep.tags) ? g.rep.tags : [];
    host.innerHTML = tags.length
      ? tags.map((t, i) => `<span class="tag-chip" data-remove-tag="${i}" data-tag="${escapeAttr(t)}">${escapeHtml(t)} ×</span>`).join('')
      : `<span class="edit-empty">${escapeHtml(MSG.editNoTags)}</span>`;
  }

  function refreshInspectorPicker(g) {
    const host = document.getElementById('ivTagPicker');
    if (!host || !g) return;
    const keep = host.scrollTop;
    renderTagPicker({ host, selectedTags: g.rep.tags || [], recordsForSource: g.records, query: ivPickQuery });
    host.scrollTop = keep;
  }

  // Apply a tag mutation to every record of the inspected group, persist immediately,
  // record undo, and refresh grid + inspector sub-parts (NOT a full showDetail — so the
  // image/meta don't flicker and the input keeps focus).
  async function applyInspectorTagChange(g, mutate) {
    if (!g) return;
    const recs = (g.records && g.records.length) ? g.records : [g.rep];
    keepCurrentVisible();   // removing a tag can un-match an active tag filter
    const undoRecords = [];
    for (const r of recs) {
      const prev = (r.tags || []).slice();
      const next = mutate(prev.slice());
      if (!next || sameTags(prev, next)) continue;
      try { await window.corpus.updateTags(r.image || r.video, next); } catch { /* keep going */ }
      const idx = allPosts.findIndex((p) => p.captureId === r.captureId);
      if (idx >= 0) allPosts[idx].tags = next.slice();
      undoRecords.push({ captureId: r.captureId, image: r.image || r.video, prevTags: prev, newTags: next });
    }
    if (!undoRecords.length) return;
    pushUndo('tags', undoRecords);
    markPostsMutated();
    renderPosts(true);
    const fresh = viewGroups.find((g2) => postIdKey(g2.rep) === inspectedKey);
    if (fresh) { refreshInspectorTags(fresh); refreshInspectorPicker(fresh); }
  }

  function showDetail(g) {
    if (!g) return;
    const p = g.rep;
    const box = document.getElementById('postDetailBox');
    const row = (k, v) => (v != null && v !== '') ? `<div class="iv-insp-row"><span class="iv-insp-k">${escapeHtml(k)}</span><span class="iv-insp-v">${escapeHtml(v)}</span></div>` : '';
    const eng = [];
    if (p.likes != null) eng.push('♡ ' + formatCount(p.likes));
    if (p.reposts != null) eng.push('⇄ ' + formatCount(p.reposts));
    if (p.replies != null) eng.push('🗨︎ ' + formatCount(p.replies));
    if (p.bookmarks != null) eng.push('🔖︎ ' + formatCount(p.bookmarks));
    if (p.views != null) eng.push('👁︎ ' + formatCount(p.views));
    // Source tags (pixiv / SNS hashtags) get their own row. User tags live in the
    // always-editable chips block (#ivTagEdit) so they aren't repeated here. Source
    // tags already adopted into `tags` are hidden; the rest are clickable to adopt.
    const userTags = Array.isArray(p.tags) ? p.tags : [];
    const userSet = new Set(userTags);
    const srcTags = (Array.isArray(p.hashtags) ? p.hashtags : []).filter((h) => !userSet.has(h));
    const srcTagsHtml = srcTags.length
      ? `<div class="iv-insp-row"><span class="iv-insp-k">${escapeHtml(MSG.detailSourceTags)}</span><span class="iv-insp-v"><div class="iv-insp-tags">${srcTags.map((t) => `<button type="button" class="iv-insp-tag iv-insp-tag-src" data-adopt="${escapeAttr(t)}" title="${escapeAttr(MSG.tipAdoptTag)}">${escapeHtml(t)}</button>`).join('')}</div></span></div>`
      : '';
    // Poster row carries the locally-saved avatar (psimg://) when present, so the
    // inspector keeps its "label: value" rhythm while adding a face to the name.
    const avatarImg = p.avatarFile ? `<img class="iv-insp-avatar" src="${fileSrc(p.avatarFile)}" alt="">` : '';
    // The poster exists in the poster view only for SNS posts (buildUsers skips url-less
    // migrations); when it does, the name+avatar links to it (双方向ナビ: posts ↔ posters).
    const jumpUser = p.url ? buildUsers().find((u) => u.key === userKey(p)) : null;
    const authorInner = `${avatarImg}<span>${escapeHtml(p.displayName || '')}</span>`;
    const authorRow = (p.displayName || avatarImg)
      ? `<div class="iv-insp-row"><span class="iv-insp-k">${escapeHtml(MSG.detailAuthor)}</span><span class="iv-insp-v iv-insp-author">${jumpUser ? `<button type="button" class="iv-insp-author-link" id="pdPosterJump" title="${escapeAttr(MSG.ctxViewPoster)}">${authorInner}</button>` : authorInner}</span></div>`
      : '';
    const heading = p.title || p.text || '';
    const thumbFile = g.files[0] || captureFile(p);
    // Reverse image search needs a PUBLIC image URL. media[].url keeps the
    // original CDN URL (pbs.twimg.com / cdn.bsky.app / instance media / pximg);
    // a screenshot-only post has none, so the search links are hidden then.
    // pixiv (i.pximg.net) is referer-gated so the fetcher may 403 — but pixiv
    // IS the source, so reverse search there is moot anyway.
    const srcImageUrl = (g.records.flatMap((r) => Array.isArray(r.media) ? r.media : []).find((m) => m && m.url) || {}).url || '';
    // Can this card be (un)grouped? Manual groups get a dissolve link; auto groups
    // (same post URL with siblings) toggle via the persisted ungrouped set.
    const gkey = postKeyOf(p.url);
    const potential = gkey ? allPosts.filter((q) => postKeyOf(q.url) === gkey).length : 0;
    const isManual = !!(g.key && String(g.key).indexOf('manual:') === 0);
    // ✂ also for reply-merged chains (records with DIFFERENT urls): opting the
    // rep's key out stops the self-reply merge at this parent, splitting the card.
    const groupBtn = isManual
      ? `<a class="iv-insp-open" id="pdUngroupManual">🔗 ${escapeHtml(MSG.groupUngroupManual)}</a>`
      : (gkey && (potential > 1 || g.records.length > 1)
        ? (ungrouped.has(gkey)
          ? `<a class="iv-insp-open" id="pdRegroup">🔗 ${escapeHtml(MSG.groupRegroup)}</a>`
          : `<a class="iv-insp-open" id="pdUngroup">✂ ${escapeHtml(MSG.groupUngroup)}</a>`)
        : '');
    box.innerHTML =
      `<button class="iv-insp-close" id="pdClose" title="×">×</button>` +
      (heading ? `<div class="iv-insp-title">${escapeHtml(heading)}</div>` : '') +
      (thumbFile ? `<img class="iv-insp-thumb" src="${fileSrc(thumbFile, 480)}" alt="">` : '') +
      row(MSG.detailPlatform, (p.platform || '').toUpperCase()) +
      authorRow +
      row(MSG.detailUser, p.screenName ? '@' + p.screenName : '') +
      row(MSG.detailFollowers, p.followers != null ? formatCount(p.followers) : '') +
      row(MSG.detailJoined, p.authorCreatedAt ? new Date(p.authorCreatedAt).toLocaleDateString() : '') +
      row(MSG.detailEngagement, eng.join('   ')) +
      row(MSG.detailPosted, p.date ? new Date(p.date).toLocaleString() : '') +
      row(MSG.detailSaved, p.capturedAt ? new Date(p.capturedAt).toLocaleString() : '') +
      row(MSG.detailUpdated, p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '') +
      row(MSG.detailImages, g.files.length > 1 ? MSG.imagesCount(g.files.length) : '') +
      row(MSG.detailImageOf, (p.imageIndex && p.imageCount) ? MSG.imageOf(p.imageIndex, p.imageCount) : '') +
      `<div id="ivTagEdit" class="iv-tag-edit"><div class="iv-tag-label">${escapeHtml(MSG.detailTags)}</div><div id="ivTagChips" class="iv-tag-chips"></div><div class="iv-tag-addrow"><input type="text" id="ivTagInput" placeholder="${escapeAttr(MSG.tagNewName)}" autocomplete="off"><button class="btn-outline" id="ivTagAdd">${escapeHtml(MSG.tagAddBtn)}</button></div><div id="ivTagPicker" class="edit-picker iv-tag-picker"></div></div>` +
      `<div id="ivTagView" class="iv-tag-view">${srcTagsHtml}</div>` +
      `<div class="iv-insp-actions">` +
      (p.url ? `<a class="iv-insp-open" id="pdOpen">${escapeHtml(MSG.detailOpen)} ↗</a>` : '') +
      (srcImageUrl ? `<a class="iv-insp-open" id="pdSauce">${escapeHtml(MSG.detailSauce)} ↗</a>` : '') +
      (srcImageUrl ? `<a class="iv-insp-open" id="pdAscii">${escapeHtml(MSG.detailAscii)} ↗</a>` : '') +
      groupBtn +
      `</div>`;
    document.getElementById('postDetail').hidden = false;
    refreshInspectorTags(g);
    refreshInspectorPicker(g);   // tag editor is always live in the inspector (no mode)
    // While open, a card click swaps the panel (not zoom) → plain pointer.
    document.getElementById('postGrid').classList.add('insp-open');
    // Ring-mark the inspected card so swapping content stays traceable.
    inspectedKey = postIdKey(p);
    document.querySelectorAll('.post-card.inspected').forEach((el) => el.classList.remove('inspected'));
    const gi = viewGroups.indexOf(g);
    if (gi >= 0) {
      const card = document.querySelector('.post-card[data-index="' + gi + '"]');
      if (card) card.classList.add('inspected');
    }
    refreshTileSlider();   // inline column narrows the grid — re-derive the track
    const c = document.getElementById('pdClose'); if (c) c.onclick = closeDetail;
    const o = document.getElementById('pdOpen'); if (o) o.onclick = () => window.corpus.openExternal(p.url);
    const sa = document.getElementById('pdSauce'); if (sa) sa.onclick = () => window.corpus.openExternal('https://saucenao.com/search.php?url=' + encodeURIComponent(srcImageUrl));
    const as = document.getElementById('pdAscii'); if (as) as.onclick = () => window.corpus.openExternal('https://ascii2d.net/search/url/' + encodeURIComponent(srcImageUrl));
    const ug = document.getElementById('pdUngroup'); if (ug) ug.onclick = () => setGroupKey(gkey, true);
    const rg = document.getElementById('pdRegroup'); if (rg) rg.onclick = () => setGroupKey(gkey, false);
    const um = document.getElementById('pdUngroupManual'); if (um) um.onclick = () => ungroupManual(parseInt(String(g.key).split(':')[1], 10));
    box.querySelectorAll('[data-adopt]').forEach((btn) => { btn.onclick = () => adoptSourceTag(g, btn.dataset.adopt); });
    const pj = document.getElementById('pdPosterJump'); if (pj && jumpUser) pj.onclick = () => jumpToPoster(p);
  }

  // Promote a source tag (pixiv / SNS hashtag) into a user tag on every record of
  // the inspected group. Persisted + undoable, mirroring the edit overlay's save.
  async function adoptSourceTag(g, tag) {
    if (!tag) return;
    const recs = (g.records && g.records.length) ? g.records : [g.rep];
    const undoRecords = [];
    for (const r of recs) {
      const prev = (r.tags || []).slice();
      if (prev.includes(tag)) continue;
      const newTags = [...prev, tag];
      try { await window.corpus.updateTags(r.image || r.video, newTags); } catch { /* keep going */ }
      const idx = allPosts.findIndex((p) => p.captureId === r.captureId);
      if (idx >= 0) allPosts[idx].tags = newTags.slice();
      undoRecords.push({ captureId: r.captureId, image: r.image || r.video, prevTags: prev, newTags });
    }
    if (!undoRecords.length) return;   // all records already had it
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
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('postDetail').hidden) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (lightbox.classList.contains('show')) return;
    if (!document.getElementById('settingsView').hidden) return;
    if (!document.getElementById('ivFolderModal').hidden) return;
    if (document.querySelector('.confirm-overlay.show')) return;
    if (document.querySelector('.fold-menu.show')) return;
    const dp = document.getElementById('qfDatePopover');
    const ep = document.getElementById('qfEngPopover');
    if ((dp && dp.style.display === 'block') || (ep && ep.style.display === 'block')) return;
    closeDetail();
  }, true);
  // Slide-over mode (narrow window): the panel covers the grid, so it acts
  // like a scrim-less drawer — ANY click outside it inside the content area
  // (cards and grid included) dismisses it, and the click is consumed so the
  // card doesn't also react on the same press. ℹ buttons stay live as the
  // explicit "show this one instead" entry. Inline mode (wide) keeps clicks:
  // cards swap the content there since the panel covers nothing.
  document.addEventListener('click', (e) => {
    const insp = document.getElementById('postDetail');
    if (insp.hidden) return;
    if (!matchMedia('(max-width: 1279px)').matches) return;
    if (insp.contains(e.target)) return;
    if (!e.target.closest('#mode-post')) return;   // sidebar/overlays: leave it open
    if (e.target.closest('.info-btn, .tag-btn')) return;  // ℹ/🏷 = swap to that card
    if (e.target.closest('.poster-card')) return;  // poster click = go to that poster's posts
    e.preventDefault();
    e.stopPropagation();
    closeDetail();
  }, true);
  // ℹ button on card → detail popup (re-click same card toggles close)
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.info-btn');
    if (!btn) return;
    e.stopPropagation();
    const g = viewGroups[parseInt(btn.dataset.info, 10)];
    if (!document.getElementById('postDetail').hidden && inspectedKey && g && postIdKey(g.rep) === inspectedKey) {
      closeDetail();
      return;
    }
    showDetail(g);
  });
  // 🏷 button on card → open the inspector (tags are editable inline there)
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.tag-btn');
    if (!btn) return;
    e.stopPropagation();
    const g = viewGroups[parseInt(btn.dataset.tagedit, 10)];
    if (!g) return;
    showDetail(g);
  });

  // --- Edit overlay logic ---
  // Editing a grouped card edits ALL its records (a group is one post in the UI).
  let editingPost = null;
  let editingRecords = [];
  let editTags = [];
  let editAdditive = false;   // true = bulk "タグを追加": merge into each record's tags
  let editPickQuery = '';     // edit picker search filter

  // Tag vocabulary grouped by tag-group (defined groups in order, then 未分類 =
  // ungrouped tags that exist on posts), each section filtered by `query`. Shared
  // by the stamp palette and the card-edit picker.
  function groupedTagVocab(query, opts) {
    const scope = (opts && opts.scope) || 'post';
    const q = (query || '').toLowerCase();
    const ok = (t) => !q || t.toLowerCase().includes(q);
    const byJa = (a, b) => a.localeCompare(b, 'ja');
    const grouped = new Set(tagGroups.flatMap((g) => g.tags || []));
    const out = [];
    // 用語帳: 作品/キャラ are first-class categories — surface them as their own
    // sections ahead of the freeform groups, and pull kinded tags OUT of their
    // group / 未分類 so each tag shows once (種別 takes precedence, danbooru-style).
    const kindSec = { work: [], character: [] };
    for (const [t, k] of Object.entries(tagTypes)) if (k === 'work' || k === 'character') kindSec[k].push(t);
    for (const [k, name] of [['work', MSG.kindWork], ['character', MSG.kindCharacter]]) {
      const tags = kindSec[k].filter(ok).sort(byJa);
      if (tags.length) out.push({ name, tags });
    }
    // Poster scope shares 作品/キャラ (a tag's 種別 is a global attribute of the
    // string) but keeps a SEPARATE general pool: the freeform post groups
    // (人物/角度/形式) and post-applied tags are post-content descriptors,
    // meaningless for a person. The poster general pool grows from poster-applied
    // tags instead (posterTags), so people get their own vocabulary.
    if (scope === 'poster') {
      const applied = new Set();
      for (const arr of Object.values(posterTags)) for (const t of (Array.isArray(arr) ? arr : [])) if (!tagKindOf(t)) applied.add(t);
      const general = [...applied].filter(ok).sort(byJa);
      if (general.length) out.push({ name: MSG.tagGroupOther, tags: general });
      return out;
    }
    for (const g of tagGroups) {
      const tags = (g.tags || []).filter((t) => !tagKindOf(t)).filter(ok).sort(byJa);
      if (tags.length) out.push({ name: g.name, tags });
    }
    const applied = new Set();
    for (const p of allPosts) for (const t of (Array.isArray(p.tags) ? p.tags : [])) if (!grouped.has(t) && !tagKindOf(t)) applied.add(t);
    const ungrouped = [...applied].filter(ok).sort(byJa);
    if (ungrouped.length) out.push({ name: MSG.tagGroupOther, tags: ungrouped });
    return out;
  }

  function renderEditTags() {
    const container = document.getElementById('editTagsList');
    container.innerHTML = editTags.length
      ? editTags.map((t, i) => `<span class="tag-chip" style="cursor:pointer;" data-remove-tag="${i}">${escapeHtml(t)} \u00d7</span>`).join('')
      : `<span class="edit-empty">${escapeHtml(MSG.editNoTags)}</span>`;
  }

  // Tag co-occurrence: 作品 → characters that have shared a post with any of these
  // 作品 tags, most-frequent first. Deterministic + explainable (the count IS the
  // confidence). 種別 already fixes the two hard guesses (which tags relate, which is
  // the parent), so what's left — which character belongs to which work — is high
  // precision (a character co-occurs with ~one work).
  function charCandidatesFor(workTags) {
    if (!workTags || !workTags.length) return [];
    const works = new Set(workTags);
    const counts = new Map();
    for (const p of allPosts) {
      const tags = Array.isArray(p.tags) ? p.tags : [];
      if (!tags.some((t) => works.has(t))) continue;
      for (const t of tags) if (tagKindOf(t) === 'character') counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  // Recognition-over-recall: every existing tag, grouped, click to toggle. Shared by
  // the bulk-edit modal AND the inspector inline editor — the caller passes the host
  // element, the current selection, the records to read source (pixiv/SNS) tags from,
  // and the search query. Clicks are handled by each host's own delegated listener.
  function renderTagPicker({ host, selectedTags, recordsForSource, query, scope }) {
    if (!host) return;
    const q = (query || '').toLowerCase();
    const groups = groupedTagVocab(query || '', { scope: scope || 'post' });
    const srcSet = new Set();
    for (const r of (recordsForSource || [])) for (const h of (Array.isArray(r.hashtags) ? r.hashtags : [])) {
      if (!q || h.toLowerCase().includes(q)) srcSet.add(h);
    }
    const srcTags = [...srcSet];
    if (!groups.length && !srcTags.length) {
      host.innerHTML = `<span class="edit-empty">${escapeHtml(query ? MSG.tagPalNoMatch : MSG.tagNoTags)}</span>`;
      return;
    }
    const sel = selectedTags instanceof Set ? selectedTags : new Set(selectedTags || []);
    // 種別ドット（用語帳）: a 作品/キャラ tag wears a small category dot here too, so the
    // bulk modal / inspector picker reads the same as the sidebar rows + stamp palette.
    const chip = (t) => { const k = tagKindOf(t); const dot = k ? `<span class="tag-pal-kind tk-${k}"></span>` : ''; return `<button class="edit-pick-chip${sel.has(t) ? ' on' : ''}" data-pick="${escapeAttr(t)}">${dot}${escapeHtml(t)}</button>`; };
    let html = '';
    // 共起候補（作品→キャラ）: when a 作品 tag is set and the user isn't searching,
    // surface co-occurring characters. Suggestions only — full vocab still follows.
    if (!q) {
      const workTags = [...sel].filter((t) => tagKindOf(t) === 'work');
      if (workTags.length) {
        const cands = charCandidatesFor(workTags).filter(([t]) => !sel.has(t)).slice(0, 8);
        if (cands.length) {
          const gname = workTags.length === 1 ? MSG.editCoocCharsOf(workTags[0]) : MSG.editCoocChars;
          const who = workTags.join('・');
          html += `<div class="edit-pick-group"><div class="edit-pick-gname">${escapeHtml(gname)}</div><div class="edit-pick-chips">` +
            cands.map(([t, n]) => `<button class="edit-pick-chip" data-pick="${escapeAttr(t)}" title="${escapeAttr(MSG.editCoocWhy(who, n))}">${escapeHtml(t)}</button>`).join('') +
            `</div></div>`;
        }
      }
    }
    if (srcTags.length) {
      html += `<div class="edit-pick-group"><div class="edit-pick-gname">${escapeHtml(MSG.editAdoptSource)}</div><div class="edit-pick-chips">` +
        srcTags.map(chip).join('') + `</div></div>`;
    }
    html += groups.map((g) =>
      `<div class="edit-pick-group"><div class="edit-pick-gname">${escapeHtml(g.name)}</div><div class="edit-pick-chips">` +
      g.tags.map(chip).join('') +
      `</div></div>`
    ).join('');
    host.innerHTML = html;
  }

  // Modal (bulk) picker: thin wrapper over the shared renderer.
  function renderEditPicker() {
    renderTagPicker({ host: document.getElementById('editPicker'), selectedTags: editTags, recordsForSource: editingRecords, query: editPickQuery });
  }

  document.getElementById('editTagsList').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-remove-tag]');
    if (!chip) return;
    editTags.splice(parseInt(chip.dataset.removeTag, 10), 1);
    renderEditTags();
    renderEditPicker();
  });

  // Toggle an existing tag on/off for this card straight from the picker.
  document.getElementById('editPicker').addEventListener('click', (e) => {
    const chip = e.target.closest('.edit-pick-chip');
    if (!chip) return;
    const t = chip.dataset.pick;
    const i = editTags.indexOf(t);
    if (i >= 0) editTags.splice(i, 1); else editTags.push(t);
    renderEditTags();
    renderEditPicker();
  });

  // Right-click a picker chip → set its 種別 (shares the stamp palette's kind menu via
  // taggingApi). Same quiet 段階的開示 entry as the palette, now reachable while editing
  // a card — assign 作品/キャラ in the same flow you're tagging in.
  document.getElementById('editPicker').addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('.edit-pick-chip');
    if (!chip) return;
    e.preventDefault();
    if (taggingApi && taggingApi.showKindMenu) taggingApi.showKindMenu(chip.dataset.pick, e.clientX, e.clientY, renderEditPicker);
  });

  document.getElementById('editTagAdd').addEventListener('click', () => {
    const input = document.getElementById('editTagInput');
    const tag = input.value.trim();
    if (tag && !editTags.includes(tag)) editTags.push(tag);
    input.value = ''; editPickQuery = '';
    renderEditTags();
    renderEditPicker();
    input.focus();
  });

  // Typing filters the picker; Enter commits the typed text as a (possibly new) tag.
  document.getElementById('editTagInput').addEventListener('input', (e) => {
    editPickQuery = e.target.value.trim();
    renderEditPicker();
  });
  document.getElementById('editTagInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('editTagAdd').click();
    }
  });

  // Modal chrome: lock background scroll + darken the native titlebar while any
  // full-screen overlay is up (the scrim can't cover the OS window controls or the
  // page scrollbar, so they'd otherwise stay bright). Driven by observing each
  // overlay's visibility so no open/close site can be missed. The inspector
  // (#postDetail) is a side panel, not a modal, so it's intentionally excluded.
  (function setupModalChrome() {
    const ids = ['editOverlay', 'confirmOverlay', 'ivFolderModal', 'lightbox'];
    const visible = (el) => !!el && !el.hasAttribute('hidden') && getComputedStyle(el).display !== 'none';
    const sync = () => {
      const open = ids.some((id) => visible(document.getElementById(id)));
      document.documentElement.classList.toggle('modal-open', open);
      document.body.classList.toggle('modal-open', open);
      if (window.corpusTheme && window.corpusTheme.applyTitleBar) window.corpusTheme.applyTitleBar(open);
    };
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    }
    sync();
  })();

  // Inspector inline tag editor — delegated events on the persistent #postDetail
  // (its inner box is regenerated by showDetail, so listeners live on the host, not
  // the box). Each handler re-finds the inspected group via inspectedKey.
  (function setupInspectorTagEditor() {
    const panel = document.getElementById('postDetail');
    if (!panel) return;
    const freshG = () => viewGroups.find((g2) => postIdKey(g2.rep) === inspectedKey) || null;
    const addTyped = () => {
      const input = document.getElementById('ivTagInput');
      if (!input) return;
      const tag = input.value.trim();
      const g = freshG();
      if (tag && g) applyInspectorTagChange(g, (prev) => prev.includes(tag) ? prev : [...prev, tag]);
      input.value = ''; ivPickQuery = '';
      const g2 = freshG(); if (g2) refreshInspectorPicker(g2);
      input.focus();
    };
    panel.addEventListener('click', (e) => {
      if (e.target.closest('#ivTagAdd')) { addTyped(); return; }
      const rm = e.target.closest('#ivTagChips [data-remove-tag]');
      // Remove by value, not positional index: a group merges multiple records whose
      // tag arrays may be ordered differently, so applying the rep's index positionally
      // to each record could delete a different tag. The chip carries the exact value.
      if (rm) { const tagVal = rm.dataset.tag; applyInspectorTagChange(freshG(), (prev) => prev.filter((t) => t !== tagVal)); return; }
      const pick = e.target.closest('#ivTagPicker .edit-pick-chip');
      if (pick) { const t = pick.dataset.pick; applyInspectorTagChange(freshG(), (prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]); return; }
    });
    panel.addEventListener('contextmenu', (e) => {
      const chip = e.target.closest('#ivTagChips [data-tag], #ivTagPicker .edit-pick-chip');
      if (!chip) return;
      e.preventDefault();
      const tag = chip.dataset.tag || chip.dataset.pick;
      if (tag && taggingApi && taggingApi.showKindMenu) {
        taggingApi.showKindMenu(tag, e.clientX, e.clientY, () => { const g = freshG(); if (g) { refreshInspectorTags(g); refreshInspectorPicker(g); } });
      }
    });
    panel.addEventListener('input', (e) => {
      if (e.target.id !== 'ivTagInput') return;
      ivPickQuery = e.target.value.trim();
      const g = freshG(); if (g) refreshInspectorPicker(g);
    });
    panel.addEventListener('keydown', (e) => {
      if (e.target.id === 'ivTagInput' && e.key === 'Enter') { e.preventDefault(); addTyped(); }
    });
  })();

  // Poster inspector tag editor — mirrors the post editor above with the poster ids
  // (pdTag*), keyed by the inspected poster (inspectedKey = 'poster:<key>'). Shares
  // the same delegated #postDetail panel; the box is regenerated per showPosterDetail.
  (function setupPosterTagEditor() {
    const panel = document.getElementById('postDetail');
    if (!panel) return;
    const posterKey = () => (typeof inspectedKey === 'string' && inspectedKey.indexOf('poster:') === 0) ? inspectedKey.slice('poster:'.length) : null;
    const addTyped = () => {
      const input = document.getElementById('pdTagInput');
      const key = posterKey();
      if (!input || !key) return;
      const tag = input.value.trim();
      if (tag) applyPosterTagChange(key, (prev) => prev.includes(tag) ? prev : [...prev, tag]);
      input.value = ''; pdPickQuery = '';
      refreshPosterPicker(key);
      input.focus();
    };
    panel.addEventListener('click', (e) => {
      const key = posterKey(); if (!key) return;
      if (e.target.closest('#pdTagAdd')) { addTyped(); return; }
      const rm = e.target.closest('#pdTagChips [data-tag]');
      if (rm) { const t = rm.dataset.tag; applyPosterTagChange(key, (prev) => prev.filter((x) => x !== t)); return; }
      const pick = e.target.closest('#pdTagPicker .edit-pick-chip');
      if (pick) { const t = pick.dataset.pick; applyPosterTagChange(key, (prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]); return; }
    });
    panel.addEventListener('contextmenu', (e) => {
      const key = posterKey(); if (!key) return;
      const chip = e.target.closest('#pdTagChips [data-tag], #pdTagPicker .edit-pick-chip');
      if (!chip) return;
      e.preventDefault();
      const tag = chip.dataset.tag || chip.dataset.pick;
      if (tag && taggingApi && taggingApi.showKindMenu) {
        taggingApi.showKindMenu(tag, e.clientX, e.clientY, () => { const k = posterKey(); if (k) { refreshPosterTags(k); refreshPosterPicker(k); } });
      }
    });
    panel.addEventListener('input', (e) => {
      if (e.target.id !== 'pdTagInput') return;
      const key = posterKey(); if (!key) return;
      pdPickQuery = e.target.value.trim();
      refreshPosterPicker(key);
    });
    panel.addEventListener('keydown', (e) => {
      if (e.target.id === 'pdTagInput' && e.key === 'Enter') { e.preventDefault(); addTyped(); }
    });
  })();

  document.getElementById('editCancel').addEventListener('click', () => {
    editingPost = null;
    editAdditive = false;
    document.getElementById('editOverlay').classList.remove('show');
  });

  document.getElementById('editOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      editingPost = null;
      editAdditive = false;
      e.currentTarget.classList.remove('show');
    }
  });

  document.getElementById('editSave').addEventListener('click', async () => {
    if (!editingPost) return;
    keepCurrentVisible();   // removing a tag can un-match an active tag filter
    const tags = [...editTags];

    // Capture before-state for undo, then persist.
    const undoRecords = editingRecords.map(r => {
      const newTags = editAdditive ? [...new Set([...(r.tags || []), ...tags])] : tags.slice();
      return { captureId: r.captureId, image: r.image || r.video, prevTags: (r.tags || []).slice(), newTags };
    });
    for (const u of undoRecords) {
      try { await window.corpus.updateTags(u.image, u.newTags); } catch { /* keep going */ }
      const idx = allPosts.findIndex(p => p.captureId === u.captureId);
      if (idx >= 0) allPosts[idx].tags = u.newTags.slice();
    }
    pushUndo('tags', undoRecords);
    markPostsMutated();
    renderPosts(true);   // keepLimit: selection (if any) stays put, no anim replay

    const n = editingRecords.length;
    editingPost = null;
    editingRecords = [];
    editAdditive = false;
    document.getElementById('editOverlay').classList.remove('show');
    showToast(n > 1 ? MSG.tagsSavedN(n) : MSG.tagsSaved);
  });


  // --- Selection (click a card to select; the bar appears when 1+ are selected) ---
  const selectionBar = document.getElementById('selectionBar');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const tagSelectedBtn = document.getElementById('tagSelectedBtn');
  const folderSelectedBtn = document.getElementById('folderSelectedBtn');
  const groupSelectedBtn = document.getElementById('groupSelectedBtn');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  const cancelSelectBtn = document.getElementById('cancelSelectBtn');
  const selectedCountEl = document.getElementById('selectedCount');

  selectAllBtn.textContent = MSG.selectAll;
  tagSelectedBtn.textContent = MSG.tagSelected;
  folderSelectedBtn.textContent = MSG.folderSelected;
  groupSelectedBtn.textContent = MSG.groupSelected;
  deleteSelectedBtn.textContent = MSG.deleteSelected;
  cancelSelectBtn.textContent = MSG.cancelSelect;

  // Every record of every selected group (bulk actions operate on records).
  function selectedRecords() {
    const records = [];
    viewGroups.forEach((g) => { if (selectedSet.has(postIdKey(g.rep))) records.push(...g.records); });
    return records;
  }

  // タグを追加: reuse the edit overlay in ADDITIVE mode — entered tags are
  // merged into each selected record's existing tags (nothing is replaced).
  tagSelectedBtn.addEventListener('click', () => {
    const records = selectedRecords();
    if (!records.length) return;
    editingPost = records[0];
    editingRecords = records;
    editTags = [];
    editAdditive = true;
    document.getElementById('editTagsLabel').textContent = MSG.tagSelectedTitle;
    document.getElementById('editTagInput').value = '';
    renderEditTags();
    document.getElementById('editOverlay').classList.add('show');
  });

  // フォルダに追加: open the folder picker for the whole selection (no default
  // folder anymore — you choose the destination, same as a card's 📁).
  folderSelectedBtn.addEventListener('click', (e) => {
    if (!CF()) return;
    e.stopPropagation();   // don't let the document outside-click handler close the menu we're opening
    const recs = selectedRecords();
    const ids = recs.map((r) => r.captureId).filter(Boolean);
    if (!ids.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    showFoldMenu({ rep: { captureId: ids[0] }, records: recs }, r.left, r.bottom + 4);
  });

  function clearSelection() {
    selectedSet.clear();
    selectionAnchor = null;
    syncSelectionClasses();   // class-only (callers that change content re-render themselves)
    updateSelectionBar();
  }

  function updateSelectionBar() {
    const count = selectedSet.size;
    selectionBar.style.display = count > 0 ? '' : 'none';
    selectedCountEl.textContent = MSG.selectedCount(count);
    deleteSelectedBtn.disabled = count === 0;
    // Manual grouping needs at least two selected cards (groups).
    groupSelectedBtn.disabled = viewGroups.filter(g => selectedSet.has(postIdKey(g.rep))).length < 2;
    const allSelected = viewGroups.length > 0 && viewGroups.every(g => selectedSet.has(postIdKey(g.rep)));
    selectAllBtn.textContent = allSelected ? MSG.deselectAll : MSG.selectAll;
  }

  cancelSelectBtn.addEventListener('click', clearSelection);

  // Manual grouping: merge every record of the selected cards into one persisted
  // group (manual-groups.json). Members are first removed from any existing
  // manual group so a record never belongs to two groups.
  groupSelectedBtn.addEventListener('click', () => {
    const members = [];
    viewGroups.forEach((g) => { if (selectedSet.has(postIdKey(g.rep))) members.push(...g.records.map((r) => r.captureId).filter(Boolean)); });
    if (members.length < 2) return;
    manualGroups = manualGroups.map((grp) => grp.filter((c) => !members.includes(c))).filter((grp) => grp.length > 1);
    manualGroups.push(members);
    persistManual();
    // Grouping changed viewGroups → a real re-render is needed (clearSelection is now
    // class-only). Clear first so the rebuild shows no stale selection.
    selectedSet.clear(); selectionAnchor = null;
    renderPosts(true);
    updateSelectionBar();
    showToast(MSG.grouped);
  });

  selectAllBtn.addEventListener('click', () => {
    const allSelected = viewGroups.every(g => selectedSet.has(postIdKey(g.rep)));
    if (allSelected) {
      selectedSet.clear();
    } else {
      viewGroups.forEach(g => selectedSet.add(postIdKey(g.rep)));
    }
    syncSelectionClasses();
    updateSelectionBar();
  });

  // Ctrl/Cmd+A selects every visible (filtered) card. Left to the browser when
  // typing in a field or when a modal/overlay is open (native select-all there).
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.key || '').toLowerCase() !== 'a') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('.confirm-overlay.show') || lightbox.classList.contains('show')) return;
    if (!document.getElementById('settingsView').hidden) return;
    if (!document.getElementById('ivFolderModal').hidden) return;
    if (browseMode !== 'posts') return;   // select-all is post-grid only (posters/collections excluded)
    if (viewGroups.length === 0) return;
    e.preventDefault();
    viewGroups.forEach(g => selectedSet.add(postIdKey(g.rep)));
    selectionAnchor = null;
    renderPosts(true);
    updateSelectionBar();
  });

  // `/` or Ctrl/Cmd+K focuses the search box (standard library-app shortcut).
  // Same guards as Ctrl+A: never steal keys from fields or open overlays.
  document.addEventListener('keydown', (e) => {
    const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
    const ctrlK = (e.ctrlKey || e.metaKey) && !e.altKey && (e.key || '').toLowerCase() === 'k';
    if (!slash && !ctrlK) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('.confirm-overlay.show') || lightbox.classList.contains('show')) return;
    if (!document.getElementById('settingsView').hidden) return;
    if (!document.getElementById('ivFolderModal').hidden) return;
    e.preventDefault();
    const sb = document.getElementById('searchBox');
    sb.focus();
    sb.select();
  });

  deleteSelectedBtn.addEventListener('click', () => {
    if (selectedSet.size === 0) return;
    pendingDeleteGroup = null;
    document.getElementById('confirmMsg').textContent = MSG.confirmDeleteSelected(selectedSet.size);
    document.getElementById('confirmSkipLabel').style.display = 'none';
    setConfirmKeywordMode(false);
    document.getElementById('confirmOverlay').classList.add('show');
    pendingBulkDelete = true;
  });

  let pendingBulkDelete = false;

  // View toggle
  // Slide the glass thumb to the active button using its measured geometry
  // (inline on the real .vt-thumb element — reliable + transitions).
  function positionViewThumb(scope) {
    const containers = scope instanceof Element ? [scope] : document.querySelectorAll('.view-toggle');
    containers.forEach((vt) => {
      const btn = vt.querySelector('button.active');
      const thumb = vt.querySelector('.vt-thumb');
      if (!btn || !thumb || !btn.offsetWidth) return;
      thumb.style.width = btn.offsetWidth + 'px';
      thumb.style.left = btn.offsetLeft + 'px';
    });
  }
  window.addEventListener('resize', positionViewThumb, { passive: true });
  // The sidebar gains/loses a scrollbar as content grows, which changes the
  // view-toggle's width WITHOUT a window resize — the thumb's measured px then
  // overran the now-narrower track (user: list switch "はみ出てる"). Re-measure
  // whenever the control's own box changes.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => positionViewThumb());
    document.querySelectorAll('.view-toggle').forEach((vt) => ro.observe(vt));
  }
  document.querySelectorAll('#densityToggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#densityToggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      positionViewThumb();   // slide the glass thumb
      // Liquid-glass jelly bulge: re-trigger the scale pulse on each slide.
      const _thumb = document.querySelector('#densityToggle .vt-thumb');
      if (_thumb && !prefersReducedMotion()) { _thumb.classList.remove('vt-sliding'); void _thumb.offsetWidth; _thumb.classList.add('vt-sliding'); }
      window.corpus.setPref('viewMode', currentView);
      if (document.startViewTransition && !prefersReducedMotion()) {
        document.startViewTransition(() => renderPosts());
      } else {
        renderPosts();
      }
    });
  });

  // === Browse-mode toggle: 投稿グリッド ↔ 投稿者グリッド ===
  // Switches the content area between the post grid and the poster grid (same tab).
  // A semantic "what am I browsing" switch — distinct from the card/tile/list density.
  function setBrowseMode(mode, opts) {
    mode = (mode === 'posters' || mode === 'collections') ? mode : 'posts';
    posterReturn = null;   // an explicit mode switch ends any pending poster-return
    browseMode = mode;
    document.querySelectorAll('#browseToggle button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const _t = document.querySelector('#browseToggle .vt-thumb');
    positionViewThumb(document.getElementById('browseToggle'));
    if (_t && !(opts && opts.silent) && !prefersReducedMotion()) { _t.classList.remove('vt-sliding'); void _t.offsetWidth; _t.classList.add('vt-sliding'); }
    document.body.classList.toggle('browse-posters', mode === 'posters');   // CSS hides the inactive grid
    document.body.classList.toggle('browse-collections', mode === 'collections');
    closeDetail();   // a stale post/poster detail shouldn't survive the switch
    if (!(opts && opts.silent)) window.corpus.setPref('browseMode', mode);
    if (mode === 'posters') renderPosters(); else if (mode === 'collections') renderCollections(); else renderPosts();
  }
  document.querySelectorAll('#browseToggle button').forEach(btn => {
    btn.addEventListener('click', () => { if (btn.dataset.mode !== browseMode) setBrowseMode(btn.dataset.mode); });
  });

  // The browse toggle is a permanent sidebar fixture now (both modes — moved out
  // of the content area). Just keep its glass thumb measured: the poster count /
  // grid changes can resize the sidebar column (scrollbar appears/disappears).
  function syncBrowseBar() {
    const t = document.getElementById('browseToggle');
    if (t) positionViewThumb(t);
  }

  // --- Poster grid (投稿者ビュー) ------------------------------------------
  // Cards derived from post author fields (buildUsers — no fetching). Click =
  // inspector (poster profile), double-click = jump to that poster's posts.
  let posterList = [];
  let posterSort = 'count';          // 'count' | 'name' | 'date-desc' | 'date-asc'
  // Poster grid density — kept SEPARATE from the post-side currentView (its masonry /
  // tile / list layouts are bound to post-card markup). Tile view leads with avatars.
  let posterView = 'card';           // 'card' | 'tile' | 'list'
  let posterTileSize = 132;          // tile view: avatar tile edge px
  let posterCardSize = 200;          // card view: min column width px
  const PTILE_MIN = 96, PTILE_MAX = 220;
  const PCARD_MIN = 150, PCARD_MAX = 340;
  // Which size the slider drives, per density (mirrors the post viewSizeState). The
  // grid layouts read --ptile-size (tile) / --pcard-size (card) via auto-fill minmax;
  // list is a full-width stack with no size axis, so it returns null (slider hidden).
  function posterSizeState() {
    if (posterView === 'tile') return { get: () => posterTileSize, set: (v) => { posterTileSize = v; }, min: PTILE_MIN, max: PTILE_MAX, varName: '--ptile-size', pref: 'posterTileSize' };
    if (posterView === 'card') return { get: () => posterCardSize, set: (v) => { posterCardSize = v; }, min: PCARD_MIN, max: PCARD_MAX, varName: '--pcard-size', pref: 'posterCardSize' };
    return null;
  }
  // The slider track maps to COLUMN COUNTS (like the post tile slider), not raw px:
  // the auto-fill minmax(size,1fr) grid stretches columns, so changing the min only
  // moves the layout at column-count thresholds. Mapping each detent to one column
  // count makes every step visible (no dead zones). Right = larger = fewer columns.
  function posterGridMetrics() {
    const grid = document.getElementById('posterGrid');
    if (!grid) return null;
    const W = Math.floor(grid.getBoundingClientRect().width);
    if (!W) return null;
    const gv = parseFloat(getComputedStyle(grid).columnGap);
    return { W, g: Number.isFinite(gv) ? gv : 14 };
  }
  const pColsFor = (size, m) => Math.max(1, Math.floor((m.W + m.g) / (size + m.g)));
  const pSizeFor = (n, m) => Math.floor((m.W - (n - 1) * m.g) / n);
  function refreshPosterSlider() {
    const sl = document.getElementById('posterTileSlider');
    const row = document.getElementById('posterTileSizeRow');
    if (!sl) return;
    const st = posterSizeState();
    if (!st) { if (row) row.style.display = 'none'; return; }
    const m = posterGridMetrics();
    if (!m) return;
    const nBig = Math.max(1, Math.ceil((m.W + m.g) / (st.max + m.g)));   // fewest cols whose size stays ≤ max
    const nSmall = Math.max(nBig, pColsFor(st.min, m));                  // most cols (smallest)
    if (row) row.style.display = nBig === nSmall ? 'none' : 'flex';      // single stop conveys nothing → hide
    sl.step = '1'; sl.min = String(nBig); sl.max = String(nSmall);
    const n = Math.min(nSmall, Math.max(nBig, pColsFor(st.get(), m)));
    sl.value = String(nBig + nSmall - n);                               // inverted: right = larger
  }
  // Poster grid density toggle (card / tile / list) — mirrors #densityToggle but
  // writes posterView (separate from currentView) and re-renders the poster grid.
  // Defined here (after PTILE_*/PCARD_*/posterView) so the slider setup doesn't hit a TDZ.
  document.querySelectorAll('#posterDensityToggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.pview === posterView) return;
      document.querySelectorAll('#posterDensityToggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      posterView = btn.dataset.pview;
      positionViewThumb(document.getElementById('posterDensityToggle'));
      const _thumb = document.querySelector('#posterDensityToggle .vt-thumb');
      if (_thumb && !prefersReducedMotion()) { _thumb.classList.remove('vt-sliding'); void _thumb.offsetWidth; _thumb.classList.add('vt-sliding'); }
      window.corpus.setPref('posterViewMode', posterView);
      renderPosters();
    });
  });
  (function setupPosterSizeSlider() {
    const sl = document.getElementById('posterTileSlider');
    if (!sl) return;
    sl.addEventListener('input', () => {
      const st = posterSizeState();
      const m = posterGridMetrics();
      if (!st || !m) return;
      const nBig = parseInt(sl.min, 10), nSmall = parseInt(sl.max, 10);
      const n = nBig + nSmall - parseInt(sl.value, 10);            // un-invert → target column count
      const size = Math.max(st.min, Math.min(st.max, pSizeFor(n, m)));
      st.set(size);
      const g = document.getElementById('posterGrid');
      if (g) g.style.setProperty(st.varName, size + 'px');         // live re-flow, no re-render
      window.corpus.setPref(st.pref, size);
    });
  })();
  // The column counts depend on the grid width — re-derive the track on resize.
  window.addEventListener('resize', () => { if (browseMode === 'posters') refreshPosterSlider(); }, { passive: true });
  let posterWorkGroups = [];         // recent works shown in the poster inspector
  // Per-poster tags (persisted poster-tags.json): { posterKey: [tag, …] }. Shares
  // the post tag vocabulary but is keyed by poster, NOT stored on the posts.
  let posterTags = {};
  // Poster browse filters (platform / tag / instance / folder / date範囲 / workspace) live
  // in the posterQB query tree (createQueryBuilder + posterPredOf), not separate Sets.
  function persistPosterTags() { if (window.corpus.setPosterTags) window.corpus.setPosterTags({ tags: posterTags }).catch(() => { /* best-effort */ }); }
  function posterTagsOf(key) { const t = posterTags[key]; return Array.isArray(t) ? t : []; }
  // Tags actually applied to at least one poster — the vocabulary the filter offers.
  // Kinded (作品/キャラ) tags stay in (種別 dots distinguish them); order is by 種別
  // (作品 → キャラ → 一般) then ja-collation so the flyout reads like the palette.
  function posterFilterVocab() {
    const set = new Set();
    for (const arr of Object.values(posterTags)) for (const t of (Array.isArray(arr) ? arr : [])) set.add(t);
    const rank = (t) => { const k = tagKindOf(t); return k === 'work' ? 0 : k === 'character' ? 1 : 2; };
    return [...set].sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b, 'ja'));
  }

  // --- Named poster folders (poster view) — { id, name, items:[posterKey] } ---
  // Reuses the shared folder-list store (folders.js createFolderStore) so the
  // CRUD/id-minting/toggle logic isn't reimplemented; only the persist target
  // (poster-folders.json) and the view-specific toast/re-render live here.
  function persistPosterFolders() { if (window.corpus.setPosterFolders) window.corpus.setPosterFolders({ folders: pfStore.all() }).catch(() => { /* best-effort */ }); }
  const pfStore = window.corpusFolderStore({ idPrefix: 'pf', persist: persistPosterFolders });
  const posterFolderById = pfStore.byId;
  const posterFolderHas = pfStore.has;
  function createPosterFolder(name) { return pfStore.create(name); }
  function deletePosterFolder(id) {
    pfStore.remove(id);
    posterQB.removeByLeaf('folder', id);   // drop the filter leaf if its folder is gone
  }
  function togglePosterFolderMember(id, key) {
    const res = pfStore.toggleIn(id, key); if (!res) return false;
    const f = posterFolderById(id);
    showToast((res === 'removed' ? MSG.posterFolderRemoved : MSG.posterFolderAdded)(f.name));
    renderPosterFilterRows();   // folder badge count changed
    if (treeLeaves(posterQB.getTree()).some((c) => c.type === 'folder')) renderPosters();   // membership change may add/remove from the filtered grid
    return res === 'added';
  }
  // --- Poster query builder: the SAME drag builder (createQueryBuilder), evaluated
  // against poster (user) objects instead of posts. Leaf types: platform / instance /
  // tag(作品/キャラ含む) / folder / date(範囲) / workspace. The bar lives in
  // #posterActiveBar; sidebar rows are the entry points (like #filterRows for posts). ---
  function posterPredOf(f) {
    switch (f.type) {
      case 'platform': return (u) => u.platform === f.value;
      case 'instance': return (u) => u.instance === f.value;
      case 'tag': return (u) => posterTagsOf(u.key).includes(f.value);   // 作品/キャラも同じ tag 型
      case 'folder': { const fo = posterFolderById(f.value); const set = new Set(fo ? fo.items : []); return (u) => set.has(u.key); }
      case 'workspace': return (u) => !!(CF() && CF().inPosterWorkspace(u.key));
      case 'date': {
        const field = f.dateField || 'latest';   // latest | lastCapture | authorCreatedAt
        const from = f.from ? new Date(f.from + 'T00:00:00') : null;
        let to = null; if (f.to) { to = new Date(f.to + 'T00:00:00'); to.setDate(to.getDate() + 1); }   // exclusive end
        return (u) => { const v = u[field]; if (!v) return false; const d = new Date(v); return (!from || d >= from) && (!to || d < to); };
      }
      default: return () => true;
    }
  }
  // Poster pill label: folder name + date dim are poster-specific; the rest (platform /
  // instance / tag / workspace) reuse the shared filterLabel.
  function posterFilterLabel(f) {
    if (f.type === 'folder') { const fo = posterFolderById(f.value); return fo ? fo.name : f.value; }
    if (f.type === 'date') {
      const dimName = f.dateField === 'lastCapture' ? MSG.posterDateLastCapture
        : f.dateField === 'authorCreatedAt' ? MSG.posterDateCreated : MSG.posterDateLastPost;
      const fromStr = f.from ? formatShortDate(f.from) : '';
      const toStr = f.to ? formatShortDate(f.to) : '';
      return `${dimName}: ${fromStr}〜${toStr}`;
    }
    return filterLabel(f);
  }
  let posterShadow = [];              // flat leaf shadow of the poster tree (sidebar badges / rows)
  let editingPosterDateNode = null;   // the date leaf being edited via the popover (null = new)
  // The poster-side builder instance. transient (no tabs / nav history for posters);
  // onChange → renderPosters (which redraws the rows + bar + grid).
  const posterQB = createQueryBuilder({
    container: document.getElementById('posterQueryChips'),
    barEl: document.getElementById('posterActiveBar'),
    resetBtn: document.getElementById('posterResetBtn'),
    predOf: posterPredOf,
    labelOf: posterFilterLabel,
    glyphOf: qcGlyph,
    getSearchVal: () => { const sb = document.getElementById('searchBox'); return sb ? sb.value : ''; },
    onClearSearch: () => { const sb = document.getElementById('searchBox'); if (sb) sb.value = ''; renderPosters(); },
    onChange: () => { renderPosters(); },
    onShadow: (leaves) => { posterShadow = leaves; },
    openLeafEditor: (n) => { if (n.type === 'date') openPosterDatePopover(n); },
    editableLeafTypes: ['date'],
    singleValueTypes: ['date', 'workspace', 'folder'],   // 択一: 1つ選ぶと既存を置換
    noDupTypes: [],
  });

  // Poster sidebar filter rows (mirror of renderFilterBadges for posters): reveal the
  // 作品/キャラ/タグ/インスタンス rows only when posters actually carry such values
  // (段階的開示), prune selections that no longer have a backing value, then refresh
  // every row badge + the workspace toggle state. The rows themselves are static HTML
  // in #posterFilterRows (stable flyout anchors); this only mutates text/visibility.
  function renderPosterFilterRows() {
    const vocab = posterFilterVocab();
    const present = new Set(vocab);
    // Drop tag leaves whose value no longer exists in any poster's tags (poster removed/edited).
    if (posterQB.removeCondsMatching((c) => c.type === 'tag' && !present.has(c.value))) posterQB.syncShadow();
    const named = namedPosters();
    const instPresent = new Set(named.map((u) => u.instance).filter(Boolean));
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
    show('sbPosterWorkRow', vocab.some((t) => tagKindOf(t) === 'work'));
    show('sbPosterCharRow', vocab.some((t) => tagKindOf(t) === 'character'));
    show('sbPosterTagRow', vocab.some((t) => !tagKindOf(t)));
    show('sbPosterInstRow', instPresent.size > 0);
    // Row badges count the matching leaves in the poster query tree (shadow).
    const leaves = posterQB.shadow();
    const tagLeaves = leaves.filter((f) => f.type === 'tag');
    const counts = {
      'poster-platform': leaves.filter((f) => f.type === 'platform').length,
      'poster-work': tagLeaves.filter((f) => tagKindOf(f.value) === 'work').length,
      'poster-character': tagLeaves.filter((f) => tagKindOf(f.value) === 'character').length,
      'poster-tag': tagLeaves.filter((f) => !tagKindOf(f.value)).length,
      'poster-instance': leaves.filter((f) => f.type === 'instance').length,
      'poster-date': leaves.some((f) => f.type === 'date') ? 1 : 0,
      'poster-folder': leaves.some((f) => f.type === 'folder') ? 1 : 0
    };
    document.querySelectorAll('#posterFilterRows .sb-row-badge').forEach((b) => {
      const n = counts[b.dataset.badge] || 0;
      b.textContent = n || '';
      b.classList.toggle('on', n > 0);
    });
    // Workspace tray row: active when its leaf is in the tree, badge = count present this
    // session, clear button only when non-empty (mirrors the post #wsRow).
    const wsRow = document.getElementById('posterWsRow');
    if (wsRow && CF()) {
      const n = CF().posterWorkspaceCount(new Set(named.map((u) => u.key)));
      wsRow.classList.toggle('active', posterQB.qHasValue('workspace', '*'));
      const wsBadge = document.getElementById('posterWsBadge');
      if (wsBadge) { wsBadge.textContent = n || ''; wsBadge.classList.toggle('on', n > 0); }
      const wsClear = document.getElementById('posterWsClear');
      if (wsClear) wsClear.style.display = n > 0 ? '' : 'none';
    }
  }
  function posterMonogram(u) {
    const s = (u.displayName || u.screenName || '').trim();
    return s ? escapeHtml(s[0].toUpperCase()) : '?';
  }
  // Named posters only — the identity-less ('(unknown)') bucket stays out of the grid.
  function namedPosters() { return buildUsers().filter((u) => u.displayName || u.screenName); }
  function filteredPosters() {
    const q = document.getElementById('searchBox').value.trim().toLowerCase();
    let list = namedPosters();
    // Boolean query tree (platform / instance / tag / folder / date / workspace).
    const root = posterQB.getTree();
    if (root.children.length) list = list.filter((u) => posterQB.eval(u));
    // Search is kept OUT of the tree (same作法 as the post side).
    if (q) list = list.filter((u) => (u.displayName || '').toLowerCase().includes(q) || (u.screenName || '').toLowerCase().includes(q));
    const nameOf = (u) => (u.displayName || u.screenName || '').toLowerCase();
    list = list.slice();
    // Sort: 'count' | 'name' | 'date-desc' | 'date-asc'. The date axis (dim) comes from the
    // query's date leaf (range axis == sort axis), falling back to 最終投稿日 (latest).
    if (posterSort === 'date-desc' || posterSort === 'date-asc') {
      const dl = treeLeaves(root).find((c) => c.type === 'date');
      const field = (dl && dl.dateField) || 'latest', asc = posterSort === 'date-asc';
      list.sort((a, b) => {
        const av = a[field] || '', bv = b[field] || '';
        if (!av && !bv) return b.count - a.count;
        if (!av) return 1;
        if (!bv) return -1;
        const c = av.localeCompare(bv);   // ISO strings compare lexically
        return (asc ? c : -c) || (b.count - a.count);
      });
    } else if (posterSort === 'name') {
      list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || b.count - a.count);
    } else {
      list.sort((a, b) => b.count - a.count || nameOf(a).localeCompare(nameOf(b)));   // 'count' (default)
    }
    return list;
  }
  // Platform display order — shared by the poster-platform flyout (qfValues).
  const PF_ORDER = ['x', 'bluesky', 'misskey', 'mastodon', 'pixiv'];
  function renderPosters(keepLimit) {
    const grid = document.getElementById('posterGrid');
    const empty = document.getElementById('emptyState');
    // 投稿者モードはクエリバー（postCount の常設先）を隠すので、件数は
    // ポスターコントロール側の posterCount に出す（バー右端の件数と役割分担）。
    const countEl = document.getElementById('posterCount');
    renderPosterFilterRows();
    posterQB.render();   // draw the query bar (pills / groups) for the poster tree
    posterList = filteredPosters();
    countEl.textContent = MSG.posterCount(posterList.length);
    syncBrowseBar();
    // Density: toggle the grid layout classes + tile-size axis (tile view only).
    grid.classList.toggle('tile-view', posterView === 'tile');
    grid.classList.toggle('list-view', posterView === 'list');
    grid.style.setProperty('--ptile-size', posterTileSize + 'px');
    grid.style.setProperty('--pcard-size', posterCardSize + 'px');
    positionViewThumb(document.getElementById('posterDensityToggle'));
    // Size slider: card + tile (auto-fill grids) have a size axis; list (full-width stack)
    // doesn't. The track maps to column counts so every step reflows (no dead zones).
    refreshPosterSlider();
    if (posterList.length === 0) {
      grid.innerHTML = '';   // empty .poster-grid collapses to 0 height
      empty.style.display = 'block';
      const q = document.getElementById('searchBox').value.trim();
      if (buildUsers().length === 0 && !q) {
        empty.innerHTML = `<p><strong>${MSG.posterEmptyTitle}</strong></p><p>${MSG.posterEmptyDesc}</p>`;
      } else {
        empty.innerHTML = `<p><strong>${MSG.emptySearchTitle}</strong></p><p>${MSG.emptySearchDesc}</p>` +
          `<button type="button" class="empty-cta" id="emptyResetBtn">${MSG.emptyResetBtn}</button>`;
      }
      return;
    }
    empty.style.display = 'none';
    grid.classList.toggle('anim-in', !keepLimit && !prefersReducedMotion());
    grid.innerHTML = posterList.map((u, i) => {
      const pfName = u.platform ? (PF_NAME[u.platform] || u.platform) : '';
      const avatar = u.avatarFile ? `<img src="${fileSrc(u.avatarFile)}" alt="" loading="lazy">` : posterMonogram(u);
      const hasName = !!u.displayName;
      const name = hasName ? u.displayName : (u.screenName ? '@' + u.screenName : '(unknown)');
      const handleRow = (hasName && u.screenName) ? `<div class="poster-handle">@${escapeHtml(u.screenName)}</div>` : '';
      const pf = u.platform ? `<span class="pf-tag"><span class="pf-dot ${u.platform}"></span>${escapeHtml(pfName)}</span>` : '';
      const inWs = !!(CF() && CF().inPosterWorkspace(u.key));
      // Hover actions mirror the library card (🏷 tag → 🔖 collection → ℹ info, L→R).
      return `<div class="poster-card" data-index="${i}" tabindex="0">`
        + `<div class="poster-av">${avatar}</div>`
        + `<div class="poster-meta">`
        + `<div class="poster-name">${escapeHtml(name)}</div>`
        + handleRow
        + `<div class="poster-foot">${pf}<span class="poster-count">${escapeHtml(MSG.posterPosts(formatCount(u.count)))}</span></div>`
        + `</div>`
        + `<button class="poster-tag" data-ptag="${i}" title="${MSG.tipTagEdit}" aria-label="${MSG.tipTagEdit}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg></button>`
        + `<button class="poster-ws${inWs ? ' in' : ''}" data-pws="${i}" title="${MSG.tipWorkspace}" aria-label="${MSG.tipWorkspace}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>`
        + `<button class="poster-info" data-pinfo="${i}" title="${MSG.tipInfo}" aria-label="${MSG.tipInfo}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.6" x2="12" y2="7.7"/></svg></button>`
        + `</div>`;
    }).join('');
  }
  // Jump from a poster to its posts: posts mode + a single user filter for it.
  // We want ONLY this poster's posts, so drop every post filter carried over from
  // the prior posts view (tags/date/media/search/engagement) — not just a previous
  // user filter — otherwise unrelated leftover filters AND-narrow the result and
  // hide posts the user expects to see.
  function openPosterPosts(u) {
    if (!u) return;
    postQB.resetTree();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('searchBox', ''); set('sbDateFrom', ''); set('sbDateTo', ''); set('sbEngMin', '');
    setBrowseMode('posts');
    addFilter({ type: 'user', value: u.key, label: u.displayName || u.screenName || u.key });
    posterReturn = u.key;   // set LAST (setBrowseMode clears it): reset returns to posters while this user filter is active
  }
  // Jump from a post to its poster (双方向ナビ: posts → posters): switch to the poster
  // view and open that poster's inspector. Only SNS posts have a poster in buildUsers()
  // (url-less Eagle migrations don't), so callers guard on existence before offering it.
  function jumpToPoster(p) {
    if (!p || !p.url) return;
    const u = buildUsers().find((x) => x.key === userKey(p));
    if (!u) return;
    setBrowseMode('posters');   // clears any stale detail, then we open the poster's
    showPosterDetail(u);
  }
  // --- Poster inspector inline tag editor ---
  // Mirrors the post inspector's tag editor (refreshInspectorTags/Picker + the
  // delegated handlers), but the source of truth is posterTags[key] (NOT a post's
  // tags), persisted to poster-tags.json. Posters carry no source (pixiv/SNS) tags,
  // so the picker is fed recordsForSource:[]. The UI shows whenever the poster
  // inspector is open (no tagging-edit gate — there is no poster tagging mode).
  let pdPickQuery = '';
  function refreshPosterTags(key) {
    const host = document.getElementById('pdTagChips');
    if (!host) return;
    const tags = posterTagsOf(key);
    host.innerHTML = tags.length
      ? tags.map((t) => `<span class="tag-chip" data-tag="${escapeAttr(t)}">${escapeHtml(t)} ×</span>`).join('')
      : `<span class="edit-empty">${escapeHtml(MSG.editNoTags)}</span>`;
  }
  function refreshPosterPicker(key) {
    const host = document.getElementById('pdTagPicker');
    if (!host) return;
    const keep = host.scrollTop;
    renderTagPicker({ host, selectedTags: posterTagsOf(key), recordsForSource: [], query: pdPickQuery, scope: 'poster' });
    host.scrollTop = keep;
  }
  // Apply a tag mutation to a poster, persist, and refresh the inspector sub-parts
  // (so the input keeps focus and the picker keeps its scroll). Records the change on
  // the shared undo stack (type 'poster-tags') so Ctrl+Z works the same as for posts.
  function applyPosterTagChange(key, mutate) {
    if (!key) return;
    const prev = posterTagsOf(key);
    const next = mutate(prev.slice());
    if (!next) return;
    const changed = next.length !== prev.length || next.some((t, i) => t !== prev[i]);
    if (!changed) return;
    pushUndo('poster-tags', [{ key, prevTags: prev.slice(), newTags: next.slice() }]);
    if (next.length) posterTags[key] = next; else delete posterTags[key];
    persistPosterTags();
    refreshPosterTags(key);
    refreshPosterPicker(key);
  }
  function showPosterDetail(u) {
    if (!u) return;
    const box = document.getElementById('postDetailBox');
    const row = (k, v) => (v != null && v !== '') ? `<div class="iv-insp-row"><span class="iv-insp-k">${escapeHtml(k)}</span><span class="iv-insp-v">${escapeHtml(v)}</span></div>` : '';
    const pfName = u.platform ? (PF_NAME[u.platform] || u.platform) : '';
    const avatarImg = u.avatarFile ? `<img class="iv-insp-avatar" src="${fileSrc(u.avatarFile)}" alt="">` : '';
    const name = u.displayName || (u.screenName ? '@' + u.screenName : '(unknown)');
    // Recent works: group this poster's posts (newest first) and preview the lead
    // image of each. Click → open that work in the gallery (over the inspector).
    posterWorkGroups = groupRecords(allPosts.filter((p) => userKey(p) === u.key))
      .sort((a, b) => String(b.rep.date || '').localeCompare(String(a.rep.date || '')))
      .slice(0, 6);
    const worksHtml = posterWorkGroups.length
      ? `<div class="iv-poster-works">${posterWorkGroups.map((g, i) => {
          const f = (g.files && g.files[0]) || captureFile(g.rep);
          return f ? `<img class="iv-poster-thumb" data-work="${i}" src="${fileSrc(f, 200)}" alt="" loading="lazy">` : '';
        }).join('')}</div>`
      : '';
    box.innerHTML =
      `<button class="iv-insp-close" id="pdClose" title="×">×</button>` +
      `<div class="iv-poster-head">${avatarImg}<span class="iv-poster-name">${escapeHtml(name)}</span></div>` +
      row(MSG.detailUser, u.screenName ? '@' + u.screenName : '') +
      row(MSG.detailPlatform, pfName) +
      row(MSG.detailPosts, formatCount(u.count)) +
      row(MSG.detailFollowers, u.followers != null ? formatCount(u.followers) : '') +
      row(MSG.detailJoined, u.authorCreatedAt ? new Date(u.authorCreatedAt).toLocaleDateString() : '') +
      worksHtml +
      `<div class="iv-insp-row iv-poster-folders-row"><span class="iv-insp-k">${escapeHtml(MSG.ivPosterFolders)}</span><span class="iv-insp-v"><div class="iv-poster-folder-chips">` +
      pfStore.all().map((f) => `<button class="iv-folder-chip${posterFolderHas(f.id, u.key) ? ' on' : ''}" data-pffid="${escapeAttr(f.id)}">${escapeHtml(f.name)}</button>`).join('') +
      `<button class="iv-folder-chip iv-folder-add" id="pdFolderNew" title="${escapeAttr(MSG.posterFolderNewPlaceholder)}">＋</button>` +
      `</div></span></div>` +
      `<div id="pdTagEdit" class="iv-tag-edit iv-tag-edit-poster"><div class="iv-tag-label">${escapeHtml(MSG.ivPosterTags)}</div><div id="pdTagChips" class="iv-tag-chips"></div><div class="iv-tag-addrow"><input type="text" id="pdTagInput" placeholder="${escapeAttr(MSG.tagNewName)}" autocomplete="off"><button class="btn-outline" id="pdTagAdd">${escapeHtml(MSG.tagAddBtn)}</button></div><div id="pdTagPicker" class="edit-picker iv-tag-picker"></div></div>` +
      `<div class="iv-insp-actions">` +
      `<a class="iv-insp-open" id="pdPosterPosts">${escapeHtml(MSG.posterViewPosts)} →</a>` +
      `</div>`;
    document.getElementById('postDetail').hidden = false;
    inspectedKey = 'poster:' + u.key;
    document.querySelectorAll('.inspected').forEach((el) => el.classList.remove('inspected'));
    const idx = posterList.indexOf(u);
    if (idx >= 0) { const card = document.querySelector('.poster-card[data-index="' + idx + '"]'); if (card) card.classList.add('inspected'); }
    const c = document.getElementById('pdClose'); if (c) c.onclick = closeDetail;
    const pp = document.getElementById('pdPosterPosts'); if (pp) pp.onclick = () => openPosterPosts(u);
    box.querySelectorAll('.iv-folder-chip[data-pffid]').forEach((ch) => {
      ch.onclick = () => { const on = togglePosterFolderMember(ch.dataset.pffid, u.key); ch.classList.toggle('on', on); };
    });
    { const fn = document.getElementById('pdFolderNew');
      if (fn) fn.onclick = () => {
        const name = window.prompt(MSG.posterFolderRenamePrompt, '');
        if (name && name.trim()) { const nf = createPosterFolder(name); if (nf) { togglePosterFolderMember(nf.id, u.key); showPosterDetail(u); } }
      }; }
    box.querySelectorAll('.iv-poster-thumb').forEach((t) => {
      t.onclick = () => { const g = posterWorkGroups[parseInt(t.dataset.work, 10)]; if (g) openGallery(buildGroupGalleryItems(g), 0); };
    });
    pdPickQuery = '';
    refreshPosterTags(u.key);
    refreshPosterPicker(u.key);
  }
  document.getElementById('posterGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.poster-card');
    if (!card) return;
    const u = posterList[parseInt(card.dataset.index, 10)];
    if (!u) return;
    // ℹ opens the inspector (shared idiom with post cards' .info-btn); re-click the
    // inspected poster's ℹ toggles it closed.
    if (e.target.closest('.poster-info')) {
      if (!document.getElementById('postDetail').hidden && inspectedKey === 'poster:' + u.key) { closeDetail(); return; }
      showPosterDetail(u);
      return;
    }
    // 🏷 → open the inspector and focus its tag input (mirrors the library 🏷 button).
    if (e.target.closest('.poster-tag')) {
      showPosterDetail(u);
      const inp = document.getElementById('pdTagInput'); if (inp) inp.focus();
      return;
    }
    // 🔖 → toggle this poster's membership in the active collection (workspace tray).
    if (e.target.closest('.poster-ws')) {
      if (CF()) {
        CF().togglePosterWorkspace([u.key]);
        const btn = e.target.closest('.poster-ws');
        if (btn) btn.classList.toggle('in', CF().inPosterWorkspace(u.key));
        renderPosterFilterRows();
        if (posterQB.qHasValue('workspace', '*')) renderPosters();
      }
      return;
    }
    // A plain card click drills into that poster's posts (posts mode + user filter).
    openPosterPosts(u);
  });
  // Poster context menu (right-click a card): assign to poster folders + quick actions,
  // so folder membership no longer requires opening the inspector. Reuses the shared
  // .fold-menu chrome + clampIntoView; folder rows toggle in place (menu stays open).
  const posterMenu = document.createElement('div');
  posterMenu.className = 'fold-menu';
  document.body.appendChild(posterMenu);
  let posterMenuKey = null;
  function hidePosterMenu() { posterMenu.classList.remove('show'); posterMenuKey = null; }
  function renderPosterMenu(u) {
    posterMenu.innerHTML =
      `<div class="fm-row" data-pm-act="posts"><span class="fm-name">${escapeHtml(MSG.posterViewPosts)}</span></div>` +
      (CF() ? `<div class="fm-row" data-pm-act="ws"><span class="fm-name">${escapeHtml(CF().inPosterWorkspace(u.key) ? MSG.ctxWsRemove : MSG.ctxWsAdd)}</span></div>` : '') +
      '<div class="fm-sep"></div>' +
      pfStore.all().map((f) => `<div class="fm-row" data-pm-fid="${escapeAttr(f.id)}"><span class="fm-name">${escapeHtml(f.name)}</span>${posterFolderHas(f.id, u.key) ? `<span class="fm-check">${CHECK_SVG}</span>` : ''}</div>`).join('') +
      `<div class="fm-row fm-manage" data-pm-act="newfolder">${escapeHtml(MSG.posterMenuNewFolder)}</div>`;
  }
  function showPosterMenu(u, x, y) {
    posterMenuKey = u.key;
    renderPosterMenu(u);
    posterMenu.style.left = x + 'px';
    posterMenu.style.top = y + 'px';
    posterMenu.classList.add('show');
    clampIntoView(posterMenu);
  }
  posterMenu.addEventListener('click', (e) => {
    const u = posterMenuKey ? posterList.find((p) => p.key === posterMenuKey) : null;
    if (!u) { hidePosterMenu(); return; }
    const act = e.target.closest('[data-pm-act]');
    if (act) {
      const a = act.dataset.pmAct;
      if (a === 'posts') { hidePosterMenu(); openPosterPosts(u); return; }
      if (a === 'ws') {
        if (CF()) CF().togglePosterWorkspace([u.key]);
        renderPosterFilterRows();
        if (posterQB.qHasValue('workspace', '*')) renderPosters();
        hidePosterMenu(); return;
      }
      if (a === 'newfolder') {
        const name = window.prompt(MSG.posterFolderRenamePrompt, '');
        if (name && name.trim()) { const nf = createPosterFolder(name); if (nf) togglePosterFolderMember(nf.id, u.key); }
        hidePosterMenu(); return;
      }
    }
    const fr = e.target.closest('.fm-row[data-pm-fid]');
    if (fr) { togglePosterFolderMember(fr.dataset.pmFid, u.key); renderPosterMenu(u); }   // keep open to assign more
  });
  document.addEventListener('click', (e) => { if (posterMenu.classList.contains('show') && !posterMenu.contains(e.target)) hidePosterMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePosterMenu(); });
  document.getElementById('posterGrid').addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.poster-card');
    if (!card) return;
    e.preventDefault();
    const u = posterList[parseInt(card.dataset.index, 10)];
    if (u) showPosterMenu(u, e.clientX, e.clientY);
  });
  // Poster-mode sort (sidebar). The remaining poster filters are rows → flyouts.
  { const ps = document.getElementById('posterSortSelect');
    if (ps) ps.addEventListener('change', () => {
      posterSort = ps.value;   // 'count' | 'name' | 'date-desc' | 'date-asc'
      renderPosters();
    }); }
  // Poster query reset (bar右の「リセット」): empty the poster tree + the shared search box.
  { const pr = document.getElementById('posterResetBtn');
    if (pr) pr.addEventListener('click', () => {
      posterQB.resetTree();
      const sb = document.getElementById('searchBox'); if (sb) sb.value = '';
      renderPosters();
    }); }
  // Poster filter rows (mirror of the #filterRows handler): a data-qfrow row opens its
  // flyout (poster-* categories); the date row opens the date popover; the workspace row
  // is a toggle (no flyout). Selections live in the transient posterXxx state.
  document.getElementById('posterFilterRows').addEventListener('click', (e) => {
    if (e.target.closest('#posterWsClear')) {
      if (!window.confirm(MSG.posterWsEmptyConfirm)) return;
      if (CF()) CF().clearPosterWorkspace();
      renderPosterFilterRows();
      if (posterQB.qHasValue('workspace', '*')) renderPosters();
      return;
    }
    if (e.target.closest('#posterWsRow')) {
      hideQfPop();
      // Workspace tray = a single workspace leaf in the tree (mirrors the post #wsRow).
      if (posterQB.qHasValue('workspace', '*')) posterQB.removeByLeaf('workspace', '*');
      else posterQB.addFilter({ type: 'workspace', value: '*' });
      return;   // addFilter/removeByLeaf refresh rows + bar + grid
    }
    const row = e.target.closest('[data-qfrow]');
    if (!row) return;
    const cat = row.dataset.qfrow;
    const dp = document.getElementById('qfDatePopover');
    if (cat === 'poster-date' && dp.style.display === 'block') { closeAllMenus(); return; }   // re-click closes
    closeAllMenus();   // switching rows closes any open date popover first
    if (cat === 'poster-date') { hideQfPop(); openPosterDatePopover(row); return; }
    showQfPopAt(cat, row);
  });

  // --- Collection view (第3モード) -----------------------------------------
  // Collections (collections.json) as cards: name + count + a 2×2 thumbnail of the
  // first items + a ★ on the active one (the 🔖 tray target). Clicking a card drills
  // into the post view filtered by that collection; the always-present browse toggle
  // is the reliable way back (no fragile back-button bounce — ユーザー要望).
  let collectionSort = 'name';   // 'name' | 'recent' | 'count'
  let collectionList = [];
  // Records backing a collection's cover + count. Static = its explicit items
  // (existing ones only); dynamic = posts matching the saved search (tree + q)
  // against the CURRENT library (= 開けば最新). Memoized per renderCollections pass
  // (_collRecCache) so the sort + the card map don't each re-scan allPosts.
  let _collRecCache = null;
  function dynamicMatches(coll) {
    const tree = (coll.tree && Array.isArray(coll.tree.children)) ? coll.tree : null;
    const matchText = makeTextMatcher(coll.q || '');
    const out = [];
    for (const p of allPosts) {
      if (!(p.image || mediaFilesOf(p).length || p.text || p.title)) continue;   // mirror getFilteredPosts' content gate
      if (!matchText(p)) continue;
      if (tree && tree.children.length && !evalNode(tree, p, postPredOf)) continue;
      out.push(p);
    }
    return out;
  }
  function collectionRecords(coll) {
    if (_collRecCache && _collRecCache.has(coll.id)) return _collRecCache.get(coll.id);
    let recs;
    if (coll.kind === 'dynamic') recs = dynamicMatches(coll);
    else { recs = []; for (const cid of coll.items) { const r = _postsById.get(cid); if (r) recs.push(r); } }
    if (_collRecCache) _collRecCache.set(coll.id, recs);
    return recs;
  }
  function collectionThumbsFrom(recs) {
    const files = [];
    for (const rec of recs) { const f = densityImage(rec, 'card'); if (f) files.push(f); if (files.length >= 4) break; }
    return files;
  }
  function collectionItemCount(coll) { return collectionRecords(coll).length; }
  // Small condition chips under a dynamic card's name (saved tree leaves + the
  // free-text q). Capped; purely informational (the mock's optional 条件チップ).
  function collCondChips(coll) {
    const chips = [];
    try { for (const leaf of treeLeaves(coll.tree)) { chips.push(filterLabel(leaf)); if (chips.length >= 4) break; } } catch { /* ignore malformed tree */ }
    if (coll.q && coll.q.trim() && chips.length < 4) chips.push('“' + coll.q.trim() + '”');
    if (!chips.length) return '';
    return `<div class="collection-cond">${chips.map((s) => `<span class="cc">${escapeHtml(s)}</span>`).join('')}</div>`;
  }
  function filteredCollections() {
    const q = document.getElementById('searchBox').value.trim().toLowerCase();
    let list = (CF() ? CF().allWithActive() : []).slice();
    if (q) list = list.filter((c) => (c.name || '').toLowerCase().includes(q));
    if (collectionSort === 'recent') list.sort((a, b) => (b.created || 0) - (a.created || 0) || (a.name || '').localeCompare(b.name || ''));
    else if (collectionSort === 'count') list.sort((a, b) => collectionItemCount(b) - collectionItemCount(a) || (a.name || '').localeCompare(b.name || ''));
    else list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return list;
  }
  // Placeholder for an empty collection's cover — the same layers glyph as the view toggle.
  const COLL_EMPTY_ICON = '<svg class="ct-empty-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>';
  // ⚡ marks a dynamic collection (saved search) before its name — the only dynamic cue.
  const COLL_BOLT_ICON = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
  function renderCollections() {
    const grid = document.getElementById('collectionGrid'); if (!grid) return;
    _collRecCache = new Map();   // fresh per pass (sort + card map reuse the same scan)
    const activeId = CF() ? CF().activeId() : null;
    collectionList = filteredCollections();
    const countEl = document.getElementById('collectionCount');
    if (countEl) countEl.textContent = MSG.collectionCount(collectionList.length);
    syncBrowseBar();
    const newCard = `<div class="collection-card new" data-cnew="1" tabindex="0"><div class="ct-newinner">＋</div><div class="collection-meta"><div class="collection-name">${escapeHtml(MSG.collNew)}</div></div></div>`;
    if (!collectionList.length) {
      const q = document.getElementById('searchBox').value.trim();
      const body = q
        ? `<p><strong>${escapeHtml(MSG.emptySearchTitle)}</strong></p><p>${escapeHtml(MSG.emptySearchDesc)}</p>`
        : `<p><strong>${escapeHtml(MSG.collEmptyTitle)}</strong></p><p>${escapeHtml(MSG.collEmptyDesc)}</p>`;
      grid.innerHTML = `<div class="empty-state" style="display:block; grid-column:1/-1;">${body}</div>` + newCard;
      return;
    }
    grid.innerHTML = collectionList.map((c, i) => {
      const recs = collectionRecords(c);   // dynamic ⇒ live matches; static ⇒ existing items
      const thumbs = collectionThumbsFrom(recs);   // 0..4 files; tiles pack to fill the square by count
      const n = thumbs.length;
      const cells = n
        ? thumbs.map((f) => `<img src="${fileSrc(f, 200)}" alt="" loading="lazy">`).join('')
        : COLL_EMPTY_ICON;
      const isActive = c.id === activeId;
      const isDyn = c.kind === 'dynamic';
      // ★ (active, static-only) and ⚡ (dynamic) are mutually exclusive cues before the name.
      const badge = isActive ? '<span class="col-star">★</span>'
        : isDyn ? `<span class="col-bolt" title="${escapeAttr(MSG.collDynamicTitle)}">${COLL_BOLT_ICON}</span>` : '';
      return `<div class="collection-card${isActive ? ' active' : ''}${isDyn ? ' dynamic' : ''}" data-index="${i}" data-cid="${escapeAttr(c.id)}" tabindex="0">`
        + `<div class="collection-thumbs ${n ? 'n' + n : 'empty'}">${cells}</div>`
        + `<div class="collection-meta">`
        + `<div class="collection-name">${badge}${escapeHtml(c.name)}</div>`
        + (isDyn ? collCondChips(c) : '')
        + `<div class="collection-count">${escapeHtml(MSG.collItemCount(recs.length))}</div>`
        + `</div></div>`;
    }).join('') + newCard;
  }
  // Drill into a collection. Static: post view + a folder filter (folder leaf evaluates
  // CF().has(cid, captureId)). Dynamic: restore the saved search (tree + free-text) so
  // the result is shown and can be edited / re-saved. Reset other inputs either way.
  function openCollection(cid) {
    const c = CF() && CF().byId(cid); if (!c) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('sbDateFrom', ''); set('sbDateTo', ''); set('sbEngMin', '');
    setBrowseMode('posts');
    if (c.kind === 'dynamic') {
      postQB.setTree((c.tree && Array.isArray(c.tree.children)) ? c.tree : null);
      set('searchBox', c.q || '');
      afterQueryChange();   // re-renders chips + bar + grid from the restored tree + searchBox
    } else {
      postQB.resetTree();
      set('searchBox', '');
      addFilter({ type: 'folder', value: cid });   // re-renders
    }
  }
  function promptNewCollection() {
    const name = window.prompt(MSG.collNewPrompt, '');
    if (name && name.trim() && CF()) CF().createCollection(name);   // notify('list') → onChange → renderCollections
  }
  // Save the current post-view filter (query tree + free-text) as a NEW dynamic collection
  // (= a saved search). The post-view "この検索を保存" button calls this.
  function promptSaveSearch() {
    if (!CF()) return;
    const tree = postQB.getTree();
    const q = document.getElementById('searchBox').value;
    if (!tree.children.length && !q.trim()) { CF().toast(MSG.collSaveEmpty); return; }   // nothing to save
    const name = window.prompt(MSG.collSavePrompt, '');
    if (!name || !name.trim()) return;
    CF().createCollection(name, { kind: 'dynamic', tree: JSON.parse(JSON.stringify(tree)), q });
    CF().toast(MSG.collSaved);
  }
  { const sv = document.getElementById('saveSearchBtn');
    if (sv) sv.addEventListener('click', promptSaveSearch); }
  document.getElementById('collectionGrid').addEventListener('click', (e) => {
    if (e.target.closest('[data-cnew]')) { promptNewCollection(); return; }
    const card = e.target.closest('.collection-card'); if (!card) return;
    if (card.dataset.cid) openCollection(card.dataset.cid);
  });
  // Collection card right-click menu: open / set active / rename / delete (mirrors the
  // poster card menu — fold-menu chrome + clampIntoView). One menu DOM for the view.
  const collMenu = document.createElement('div');
  collMenu.className = 'fold-menu';
  document.body.appendChild(collMenu);
  let collMenuCid = null;
  function hideCollMenu() { collMenu.classList.remove('show'); collMenuCid = null; }
  function showCollMenu(c, x, y) {
    collMenuCid = c.id;
    const isActive = CF() && CF().activeId() === c.id;
    // Dynamic: "アクティブにする" (★ = 🔖 tray target) makes no sense for a saved search,
    // so swap it for "条件を今の絞り込みで更新" (re-save the search from the current filter).
    const secondRow = c.kind === 'dynamic'
      ? `<div class="fm-row" data-cm-act="updateq"><span class="fm-name">${escapeHtml(MSG.collUpdateQuery)}</span></div>`
      : `<div class="fm-row" data-cm-act="active"><span class="fm-name">${escapeHtml(MSG.collSetActive)}</span>${isActive ? `<span class="fm-check">${CHECK_SVG}</span>` : ''}</div>`;
    collMenu.innerHTML =
      `<div class="fm-row" data-cm-act="open"><span class="fm-name">${escapeHtml(MSG.collOpen)}</span></div>` +
      secondRow +
      `<div class="fm-row" data-cm-act="rename"><span class="fm-name">${escapeHtml(MSG.collRename)}</span></div>` +
      '<div class="fm-sep"></div>' +
      `<div class="fm-row fm-danger" data-cm-act="delete"><span class="fm-name">${escapeHtml(MSG.collDelete)}</span></div>`;
    collMenu.style.left = x + 'px'; collMenu.style.top = y + 'px';
    collMenu.classList.add('show');
    clampIntoView(collMenu);
  }
  document.getElementById('collectionGrid').addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.collection-card:not(.new)'); if (!card) return;
    e.preventDefault();
    const c = CF() && CF().byId(card.dataset.cid); if (c) showCollMenu(c, e.clientX, e.clientY);
  });
  collMenu.addEventListener('click', (e) => {
    const c = collMenuCid && CF() && CF().byId(collMenuCid);
    const row = e.target.closest('[data-cm-act]');
    hideCollMenu();
    if (!row || !c) return;
    const a = row.dataset.cmAct;
    if (a === 'open') openCollection(c.id);
    else if (a === 'active') CF().setActive(c.id);   // notify('workspace') → onChange → renderCollections
    else if (a === 'updateq') updateDynamicFromCurrent(c);
    else if (a === 'rename') { const nm = window.prompt(MSG.collRenamePrompt, c.name); if (nm && nm.trim()) CF().renameCollection(c.id, nm); }
    else if (a === 'delete') { if (window.confirm(MSG.collDeleteConfirm(c.name))) CF().removeCollection(c.id); }
  });
  // Overwrite a dynamic collection's saved condition with the post view's CURRENT
  // filter (tree + free-text) — re-save the search after tweaking it.
  function updateDynamicFromCurrent(c) {
    if (!CF() || c.kind !== 'dynamic') return;
    const tree = postQB.getTree();
    const q = document.getElementById('searchBox').value;
    if (!tree.children.length && !q.trim()) { CF().toast(MSG.collSaveEmpty); return; }   // nothing to save
    CF().updateCollection(c.id, { tree: JSON.parse(JSON.stringify(tree)), q });
    CF().toast(MSG.collUpdated);
  }
  document.addEventListener('click', (e) => { if (collMenu.classList.contains('show') && !collMenu.contains(e.target)) hideCollMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCollMenu(); });
  // Collection sidebar: sort select + new button.
  { const cs = document.getElementById('collectionSortSelect');
    if (cs) cs.addEventListener('change', () => { collectionSort = cs.value; renderCollections(); }); }
  { const cn = document.getElementById('collectionNewBtn');
    if (cn) cn.addEventListener('click', promptNewCollection); }

  // View-size slider — every density has one. The auto-fill grids (tile/card)
  // quantize the real width to "how many columns fit", so their track maps to
  // COLUMN COUNTS (one detent = exactly one column, no dead notches). The
  // list is a full-width stack, so its track maps straight to the thumbnail
  // px. Right = larger. While dragging only the CSS
  // vars update; persisting + re-requesting thumbnails happens on release.
  function viewSizeState() {
    if (currentView === 'card') return { get: () => cardSize, set: (v) => { cardSize = v; }, min: CARD_MIN, max: CARD_MAX, pref: 'cardSize', columns: true };
    if (currentView === 'list') return { get: () => listThumb, set: (v) => { listThumb = v; }, min: LIST_MIN, max: LIST_MAX, pref: 'listThumb', columns: false };
    return { get: () => tileSize, set: (v) => { tileSize = v; }, min: TILE_MIN, max: TILE_MAX, pref: 'imageTileSize', columns: true };
  }
  function setViewSize(px, commit = true) {
    const st = viewSizeState();
    st.set(Math.max(st.min, Math.min(st.max, px)));
    applyTileLayout();
    if (!commit) { if (currentView === 'card') scheduleMasonry(); return; }   // drag: re-pack columns live
    window.corpus.setPref(st.pref, st.get());
    renderPosts();   // re-request thumbnails at the new size (re-packs masonry too)
  }
  function tileGridMetrics() {
    const grid = document.getElementById('postGrid');
    if (!grid) return null;
    // floor of the FRACTIONAL width: clientWidth rounds up half-pixels, which
    // makes an exact-fill size 1px too wide and silently drops a column.
    const W = Math.floor(grid.getBoundingClientRect().width);
    if (!W) return null;
    const gv = parseFloat(getComputedStyle(grid).columnGap);
    return { W, g: Number.isFinite(gv) ? gv : 8 };
  }
  const tileColsFor = (s, m) => Math.max(1, Math.floor((m.W + m.g) / (s + m.g)));
  const tileSizeFor = (n, m) => Math.floor((m.W - (n - 1) * m.g) / n);
  function refreshTileSlider() {
    const sl = document.getElementById('tileSlider');
    if (!sl) return;
    const st = viewSizeState();
    if (!st.columns) {            // list: direct px track
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
    // ceil = the FEWEST columns whose exact-fit size still stays ≤ max —
    // floor here would offer a notch whose size clamps and never reflows.
    // Card view: always allow 1 column — CSS auto-fill handles width naturally.
    const nBig = currentView === 'card' ? 1 : Math.max(1, Math.ceil((m.W + m.g) / (st.max + m.g)));
    const nSmall = Math.max(nBig, tileColsFor(st.min, m));   // many columns = small
    // Hide the row when only one column count is geometrically possible — the
    // slider would have a single stop and convey nothing.
    const sizeRow = document.getElementById('tileSizeRow');
    if (sizeRow) sizeRow.style.display = nBig === nSmall ? 'none' : '';
    sl.min = String(nBig);
    sl.max = String(nSmall);
    sl.disabled = false;
    const n = Math.min(nSmall, Math.max(nBig, tileColsFor(st.get(), m)));
    sl.value = String(nBig + nSmall - n);                    // inverted: right = larger
  }
  const tileSlider = document.getElementById('tileSlider');
  function sliderCols() {
    const nBig = parseInt(tileSlider.min, 10), nSmall = parseInt(tileSlider.max, 10);
    return nBig + nSmall - parseInt(tileSlider.value, 10);
  }
  function onSliderMove(commit) {
    if (!viewSizeState().columns) { setViewSize(parseInt(tileSlider.value, 10), commit); return; }
    const m = tileGridMetrics();
    if (m) setViewSize(tileSizeFor(sliderCols(), m), commit);
  }
  tileSlider.addEventListener('input', () => onSliderMove(false));
  tileSlider.addEventListener('change', () => onSliderMove(true));
  // Ctrl+- / Ctrl+= step the content-size slider one notch (works in all three view modes).
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key !== '-' && e.key !== '=' && e.key !== '+') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    if (tileSlider.disabled) return;
    const step = parseInt(tileSlider.step, 10) || 1;
    tileSlider.value = String(Math.max(
      parseInt(tileSlider.min, 10),
      Math.min(parseInt(tileSlider.max, 10),
        parseInt(tileSlider.value, 10) + (e.key === '-' ? -step : step))));
    onSliderMove(true);
  });
  // Window resizes change how many columns fit → re-derive the track range.
  let tileResizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(tileResizeT);
    tileResizeT = setTimeout(refreshTileSlider, 150);
  });

  document.getElementById('tileOverlayToggle').addEventListener('change', (e) => {
    tileOverlay = e.target.checked;
    window.corpus.setPref('tileOverlay', tileOverlay);
    renderPosts(true);   // class toggle only — no history entry, no anim replay
  });

  // Load saved view mode and skipDeleteConfirm
  const resetDeleteConfirmCheckbox = document.getElementById('resetDeleteConfirm');
  window.corpus.getPrefs().then((prefs) => {
    if (['card', 'tile', 'list'].includes(prefs.viewMode)) {
      currentView = prefs.viewMode;
      // Scope to #densityToggle: a bare .view-toggle selector would strip .active
      // from the browse / poster toggles (their buttons carry no data-view).
      document.querySelectorAll('#densityToggle button').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
    }
    if (['card', 'tile', 'list'].includes(prefs.posterViewMode)) {
      posterView = prefs.posterViewMode;
      document.querySelectorAll('#posterDensityToggle button').forEach(b => b.classList.toggle('active', b.dataset.pview === posterView));
    }
    if (Number.isFinite(prefs.posterTileSize)) posterTileSize = Math.max(PTILE_MIN, Math.min(PTILE_MAX, prefs.posterTileSize));
    if (Number.isFinite(prefs.posterCardSize)) posterCardSize = Math.max(PCARD_MIN, Math.min(PCARD_MAX, prefs.posterCardSize));
    positionViewThumb();   // place the glass thumb on the restored active button
    if (Number.isFinite(prefs.imageTileSize)) tileSize = Math.max(TILE_MIN, Math.min(TILE_MAX, prefs.imageTileSize));
    if (Number.isFinite(prefs.cardSize)) cardSize = Math.max(CARD_MIN, Math.min(CARD_MAX, prefs.cardSize));
    if (Number.isFinite(prefs.listThumb)) listThumb = Math.max(LIST_MIN, Math.min(LIST_MAX, prefs.listThumb));
    if (prefs.tileOverlay === false) {
      tileOverlay = false;
      document.getElementById('tileOverlayToggle').checked = false;
    }
    skipDeleteConfirm = !!prefs.skipDeleteConfirm;
    resetDeleteConfirmCheckbox.checked = !skipDeleteConfirm;
    // Re-render once after applying the saved view mode. Sort is NOT read here anymore
    // — it comes from the tab state (applied by initTabs), so the old prefs/initTabs
    // load race on sortSelect.value is gone.
    renderPosts();
  });

  resetDeleteConfirmCheckbox.addEventListener('change', () => {
    skipDeleteConfirm = !resetDeleteConfirmCheckbox.checked;
    window.corpus.setPref('skipDeleteConfirm', skipDeleteConfirm);
  });

  // Search / sort events
  // NOTE: not addEventListener('input', renderPosts) — the Event object would
  // arrive as a truthy keepLimit and skip the history push / fresh-render path.
  // Debounced 150ms: filtering + re-rendering ~9k records on every keystroke
  // stutters; coalesce to the pause after typing.
  let _searchRenderTimer = null;
  document.getElementById('searchBox').addEventListener('input', () => {
    clearTimeout(_searchRenderTimer);
    _searchRenderTimer = setTimeout(() => { if (browseMode === 'posters') renderPosters(); else if (browseMode === 'collections') renderCollections(); else renderPosts(); }, 150);
  });

  // --- リアルタイム検索サジェスト -------------------------------------------
  // タイプのたびに、本文検索と並行してタグ/作者/フォルダの候補を検索ボックス
  // 直下に表示。クリック/Enter でそのままフィルタ化（タイプした文字は消す）。
  const suggestEl = document.createElement('div');
  suggestEl.className = 'search-suggest';
  document.body.appendChild(suggestEl);
  let suggestIdx = -1;
  let suggestItems = [];
  const SUG_ICON = { tag: '\u{1F3F7}', user: '\u{1F464}', folder: '\u{1F4C1}' };
  function hideSuggest() { suggestEl.style.display = 'none'; suggestIdx = -1; suggestItems = []; }
  function buildSuggest(q) {
    const norm = (s) => String(s || '').toLowerCase();
    const fuzzyOn = window.corpusSearch && window.corpusSearch.isFuzzy();
    const matcher = fuzzyOn ? window.corpusSearch.compile(q) : null;
    const hit = (s) => (fuzzyOn ? matcher(String(s || '')) : norm(s).includes(norm(q)));
    const items = [];
    const counts = new Map();
    for (const p of allPosts) if (p.url) for (const t of (p.tags || [])) counts.set(t, (counts.get(t) || 0) + 1);
    [...counts.keys()].filter(hit).sort((a, b) => counts.get(b) - counts.get(a)).slice(0, 6)
      .forEach((t) => items.push({ kind: 'tag', value: t, label: t, note: counts.get(t) }));
    buildUsers().filter((u) => hit(u.displayName) || hit(u.screenName)).slice(0, 4)
      .forEach((u) => items.push({ kind: 'user', value: u.key, label: u.displayName || u.screenName || '(unknown)', note: u.count }));
    (CF() ? CF().all() : []).filter((f) => hit(f.name)).slice(0, 3)
      .forEach((f) => items.push({ kind: 'folder', value: f.id, label: f.name, note: f.items.length }));
    return items;
  }
  function renderSuggest() {
    const sb = document.getElementById('searchBox');
    const q = sb.value.trim();
    if (!q) { hideSuggest(); return; }
    suggestItems = buildSuggest(q);
    if (!suggestItems.length) { hideSuggest(); return; }
    if (suggestIdx >= suggestItems.length) suggestIdx = suggestItems.length - 1;
    suggestEl.innerHTML = suggestItems.map((it, i) =>
      `<div class="sg-row${i === suggestIdx ? ' sel' : ''}" data-sg="${i}"><span class="sg-ic">${SUG_ICON[it.kind]}</span><span class="sg-name">${escapeHtml(it.label)}</span><span class="sg-n">${it.note}</span></div>`
    ).join('');
    const r = sb.getBoundingClientRect();
    suggestEl.style.left = r.left + 'px';
    suggestEl.style.top = (r.bottom + 4) + 'px';
    suggestEl.style.minWidth = r.width + 'px';
    suggestEl.style.display = 'block';
  }
  function applySuggest(it) {
    if (!it) return;
    const sb = document.getElementById('searchBox');
    sb.value = '';   // タイプした文字は「探すため」のもの — 本文検索には残さない
    hideSuggest();
    if (it.kind === 'tag') {
      addFilter({ type: 'tag', value: it.value });
    } else if (it.kind === 'user') {
      addFilter({ type: 'user', value: it.value, label: it.label });
    } else {
      addFilter({ type: 'folder', value: it.value });
      renderPostFolders();
    }
    updateSidebarState();
  }
  suggestEl.addEventListener('mousedown', (e) => {   // mousedown は blur より先に届く
    const row = e.target.closest('.sg-row');
    if (!row) return;
    e.preventDefault();
    applySuggest(suggestItems[parseInt(row.dataset.sg, 10)]);
  });
  {
    const sb = document.getElementById('searchBox');
    // Reset the highlighted row immediately (cheap), but debounce the suggest
    // recompute (scans tags/authors/folders) to match the search debounce.
    let _suggestTimer = null;
    sb.addEventListener('input', () => {
      suggestIdx = -1;
      clearTimeout(_suggestTimer);
      _suggestTimer = setTimeout(renderSuggest, 150);
    });
    sb.addEventListener('focus', renderSuggest);
    sb.addEventListener('blur', () => setTimeout(hideSuggest, 150));
    sb.addEventListener('keydown', (e) => {
      if (suggestEl.style.display === 'none') return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        suggestIdx = (suggestIdx + d + suggestItems.length) % suggestItems.length;
        renderSuggest();
      } else if (e.key === 'Enter' && suggestIdx >= 0) {
        e.preventDefault();
        applySuggest(suggestItems[suggestIdx]);
      } else if (e.key === 'Escape') {
        hideSuggest();
      }
    });
    const scroller = document.querySelector('#controls-posts .sb-scroll');
    if (scroller) scroller.addEventListener('scroll', hideSuggest, { passive: true });
  }
  sortSelect.addEventListener('change', () => {
    // Sort lives in the tab state (persisted per tab via renderPosts→persist), not a
    // separate global pref — that double-storage raced on load. renderPosts captures it.
    renderPosts();
  });

  // 検索方式トグル（通常 / あいまい）。検索バー内に統合（旧・別 select は廃止）。
  // corpusSearch がモードを集約＝メイン検索とフライアウト絞り込みで共有する。
  const searchModeBtn = document.getElementById('searchModeBtn');
  function syncSearchToggle() {
    if (!searchModeBtn || !window.corpusSearch) return;
    const fuzzy = window.corpusSearch.isFuzzy();
    searchModeBtn.textContent = fuzzy ? MSG.searchFuzzy : MSG.searchExact;
    searchModeBtn.classList.toggle('fuzzy', fuzzy);
    searchModeBtn.title = MSG.searchModeTitle;
  }
  if (searchModeBtn && window.corpusSearch) {
    searchModeBtn.addEventListener('click', () => window.corpusSearch.toggle());
    window.corpusSearch.onChange(() => { syncSearchToggle(); renderPosts(); });
    syncSearchToggle();
  }

  // --- Export ZIP ---
  // モード select で切替: full = 完全エクスポート（library/ 丸ごと＋整理情報、
  // そのまま再インポート可能）、images = 画像・動画ファイルだけ。
  document.getElementById('exportZip').addEventListener('click', async () => {
    showToast(MSG.exporting);
    const mode = document.getElementById('exportZipMode').value;
    try {
      const res = await window.corpus.exportComplete(mode);
      if (res && res.saved) showToast(MSG.exported);
      else if (res && res.empty) showToast(MSG.noData);
      else if (res && res.error) showToast(MSG.exportFailed || MSG.importFailed);
    } catch {
      showToast(MSG.exportFailed || MSG.importFailed);
    }
  });

  // --- Import from ZIP ---
  // 新形式（完全エクスポート: library/ + corpus-export.json）は main 側で展開して
  // ライブラリへ復元（整理情報もマージ）。旧形式（metadata.json + images/）は従来どおり
  // レンダラで読んで importPosts。
  document.getElementById('importZip').addEventListener('click', () => {
    document.getElementById('importZipInput').click();
  });

  document.getElementById('importZipInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast(MSG.importing);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const zip = await JSZip.loadAsync(buf);
      const isComplete = !!zip.file('corpus-export.json') || Object.keys(zip.files).some((p) => p.indexOf('library/') === 0);
      if (isComplete) {
        const res = await window.corpus.importComplete(buf);
        await loadPosts();
        e.target.value = '';
        if (!res || !res.ok) { showToast(MSG.importFailed); return; }
        if (res.skipped > 0) showToast(MSG.importSkipped(res.imported, res.skipped));
        else showToast(MSG.imported(res.imported));
        return;
      }
      const metaEntry = zip.file('metadata.json');
      if (!metaEntry) { showToast(MSG.importFailed); e.target.value = ''; return; }
      const meta = JSON.parse(await metaEntry.async('string'));
      const posts = [];
      for (const m of (Array.isArray(meta) ? meta : [])) {
        const f = m.imageFile && zip.file(m.imageFile);
        if (!f) continue;
        const b64 = await f.async('base64');
        posts.push(Object.assign({}, m, { image: 'data:image/jpeg;base64,' + b64 }));
      }
      const { imported, skipped } = await window.corpus.importPosts(posts);
      await loadPosts();
      e.target.value = '';
      if (skipped > 0) showToast(MSG.importSkipped(imported, skipped));
      else showToast(MSG.imported(imported));
    } catch {
      showToast(MSG.importFailed);
      e.target.value = '';
    }
  });

  // --- Import images（任意の画像ファイルをライブラリへ取り込み）---
  document.getElementById('importImages').addEventListener('click', async () => {
    try {
      const res = await window.corpus.importImages();
      if (!res || res.canceled) return;
      await loadPosts();
      if (res.skipped > 0) showToast(MSG.importSkipped(res.imported, res.skipped));
      else showToast(MSG.imported(res.imported));
    } catch {
      showToast(MSG.importFailed);
    }
  });

  // --- ライブラリの保存先（変更＝既存ライブラリを新フォルダへ安全に移動） ---
  (function setupSaveFolder() {
    const pathEl = document.getElementById('saveFolderPath');
    const btn = document.getElementById('chooseSaveFolder');
    if (!pathEl || !btn) return;
    const box = document.getElementById('saveFolderProgress');
    const bar = document.getElementById('saveFolderProgressBar');
    const pctEl = document.getElementById('saveFolderProgressPct');
    const logEl = document.getElementById('saveFolderProgressLog');
    let migrating = false;
    let lastMilestone = 0;

    const errMsg = (code) => {
      switch (code) {
        case 'same': return MSG.saveFolderErrSame;
        case 'nested': return MSG.saveFolderErrNested;
        case 'config-overlap':
        case 'backup-overlap': return MSG.saveFolderErrOverlap;
        case 'collision': return MSG.saveFolderErrCollision;
        case 'copy-failed': return MSG.saveFolderErrCopyFailed;
        case 'not-writable': return MSG.saveFolderErrNotWritable;
        default: return MSG.saveFolderErrGeneric;
      }
    };

    const setPercent = (p) => { if (bar) bar.style.width = p + '%'; if (pctEl) pctEl.textContent = p + '%'; };
    const appendLog = (line) => {
      if (!logEl) return;
      const row = document.createElement('div');
      row.textContent = line;
      logEl.appendChild(row);
      logEl.scrollTop = logEl.scrollHeight;
    };
    const showBox = () => { if (box) box.hidden = false; };
    const hideBox = () => { if (box) box.hidden = true; };
    const resetProgress = () => { if (logEl) logEl.textContent = ''; setPercent(0); lastMilestone = 0; };

    // Live migration progress (shown only while/after a move; hidden by default).
    if (window.corpus.onSaveFolderProgress) {
      window.corpus.onSaveFolderProgress((p) => {
        if (!p) return;
        showBox();
        if (p.phase === 'copy') {
          if (p.done === 0) appendLog(MSG.logCopyStart(p.total));
          setPercent(p.percent);
          if (p.percent >= lastMilestone + 20 && p.percent < 100) {
            lastMilestone = p.percent - (p.percent % 20);
            appendLog(MSG.logCopying(p.percent));
          }
        } else if (p.phase === 'switch') {
          setPercent(100); appendLog(MSG.logSwitch);
        } else if (p.phase === 'cleanup') {
          appendLog(MSG.logCleanup);
        } else if (p.phase === 'done') {
          setPercent(100); appendLog(MSG.logMoveDone(p.moved));
        } else if (p.phase === 'error') {
          appendLog(errMsg(p.error));
        }
      });
    }

    async function load() {
      let cfg = null;
      try { cfg = await window.corpus.getConfig(); } catch { /* ignore */ }
      pathEl.textContent = (cfg && cfg.saveFolder) || '';
      if (!migrating) hideBox();   // 普段は非表示（移行中以外）
    }

    btn.addEventListener('click', async () => {
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = MSG.saveFolderMoving;
      migrating = true;
      resetProgress();   // box stays hidden until the first progress event (after a folder is picked)
      try {
        const res = await window.corpus.pickSaveFolder();
        if (!res || res.canceled) { hideBox(); return; }
        if (res.ok) {
          pathEl.textContent = res.saveFolder;
          showToast(MSG.saveFolderMoved(res.moved));
          await loadPosts();
        } else {
          showToast(errMsg(res.error));
        }
      } catch {
        showToast(MSG.saveFolderErrGeneric);
      } finally {
        migrating = false;
        btn.disabled = false;
        btn.textContent = prev;
      }
    });

    load();
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', load);
  })();

  // --- バックアップ / 指定フォルダへの増分エクスポート ---
  (function setupBackup() {
    const $ = (id) => document.getElementById(id);
    const pathEl = $('backupDirPath');
    const statusEl = $('backupStatus');
    if (!pathEl) return;
    let cfg = null;

    const fmtTime = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    // Compact, natural relative time for the always-visible rail line (今日/昨日/M/D).
    const fmtBackupTime = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const now = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const hhmm = `${p(d.getHours())}:${p(d.getMinutes())}`;
      const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      const yest = new Date(now); yest.setDate(now.getDate() - 1);
      if (sameDay(d, now)) return `${MSG.timeToday} ${hhmm}`;
      if (sameDay(d, yest)) return `${MSG.timeYesterday} ${hhmm}`;
      if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    };
    // Status glyphs: spinning circular-arrows (syncing), a check (done) and a warning
    // triangle (error). Paired with an explicit word so the rail says WHAT it is.
    const MS_ICON_SYNC = '<svg class="ms-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
    const MS_ICON_DONE = '<svg class="ms-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
    const MS_ICON_WARN = '<svg class="ms-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
    let mirrorSyncing = false;
    function updateMirrorStatus() {
      const el = document.getElementById('mirrorStatus');
      if (!el) return;
      // No backup folder configured → nothing in the rail (progressive disclosure).
      if (!cfg || !cfg.dir) { el.innerHTML = ''; el.className = 'mirror-status'; el.title = ''; return; }
      // Syncing now: spinning glyph + "バックアップ中…".
      if (mirrorSyncing) {
        el.innerHTML = MS_ICON_SYNC + `<span class="ms-t">${escapeHtml(MSG.mirrorSyncingShort)}</span>`;
        el.className = 'mirror-status is-syncing'; el.title = MSG.backupSyncing; return;
      }
      const r = cfg.lastResult;
      if (!r) { el.innerHTML = ''; el.className = 'mirror-status'; el.title = ''; return; }
      // Last run failed: warning glyph + "バックアップ失敗", the error as the hint.
      if (r.ok === false && r.error) {
        el.innerHTML = MS_ICON_WARN + `<span class="ms-t">${escapeHtml(MSG.mirrorFailed)}</span>`;
        el.className = 'mirror-status is-error'; el.title = r.error; return;
      }
      // Synced OK: check glyph + "バックアップ済み" with the last-run time always shown
      // on a second line (今日/昨日 20:49). The precise timestamp + count stay in the tooltip.
      el.className = 'mirror-status is-done';
      const ts = fmtBackupTime(r.at);
      el.innerHTML = MS_ICON_DONE + `<span class="ms-body"><span class="ms-t">${escapeHtml(MSG.mirrorDone)}</span>${ts ? `<span class="ms-time">${escapeHtml(ts)}</span>` : ''}</span>`;
      let tip = `${MSG.backupLastLabel} ${fmtTime(r.at)}`;
      if (r.written) tip += `（+${r.written}${MSG.backupItemsUnit}）`;
      else if (r.fileCount) tip += `（${r.fileCount}${MSG.backupItemsUnit}）`;
      el.title = tip;
    }
    function renderStatus() {
      if (!cfg || !cfg.dir) { statusEl.textContent = ''; updateMirrorStatus(); return; }
      const r = cfg.lastResult;
      if (!r) { statusEl.textContent = ''; updateMirrorStatus(); return; }
      if (r.ok === false && r.error) {
        statusEl.textContent = `⚠ ${r.error}`;
        statusEl.style.color = 'var(--danger)';
        updateMirrorStatus(); return;
      }
      statusEl.style.color = '';
      let s = `${MSG.backupLastLabel} ${fmtTime(r.at)}`;
      if (r.written) s += `（+${r.written}${MSG.backupItemsUnit}）`;
      else if (r.fileCount) s += `（${r.fileCount}${MSG.backupItemsUnit}）`;
      statusEl.textContent = s;
      updateMirrorStatus();
    }
    function render() {
      if (!cfg) return;
      pathEl.textContent = cfg.dir || MSG.backupDirNone;
      $('backupInterval').checked = !!cfg.interval;
      $('backupIntervalValue').value = cfg.intervalValue || 1;
      $('backupIntervalUnit').value = cfg.intervalUnit || 'day';
      renderStatus();
    }
    async function load() {
      try { cfg = await window.corpus.getBackup(); } catch { cfg = null; }
      render();
    }
    async function save(patch) {
      try {
        const res = await window.corpus.setBackup(patch);
        if (res && res.ok === false && res.error === 'overlap') showToast(MSG.backupOverlap);
        if (res && res.backup) cfg = res.backup;
      } catch { /* ignore */ }
      render();
    }

    $('chooseBackupDir').addEventListener('click', async () => {
      try {
        const res = await window.corpus.pickBackupDir();
        if (res && res.error === 'overlap') { showToast(MSG.backupOverlap); return; }
        if (res && res.backup) { cfg = res.backup; render(); }
      } catch { /* ignore */ }
    });
    $('clearBackupDir').addEventListener('click', () => save({ dir: null }));
    $('backupInterval').addEventListener('change', (e) => save({ interval: e.target.checked }));
    $('backupIntervalValue').addEventListener('change', (e) => {
      const v = Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1));
      e.target.value = v; save({ intervalValue: v });
    });
    $('backupIntervalUnit').addEventListener('change', (e) => save({ intervalUnit: e.target.value }));

    if (window.corpus.onBackupStart) {
      window.corpus.onBackupStart(() => { mirrorSyncing = true; updateMirrorStatus(); });
    }
    if (window.corpus.onBackupDone) {
      window.corpus.onBackupDone((_e, r) => { mirrorSyncing = false; if (cfg && r) cfg.lastResult = r; renderStatus(); });
    }

    load();
  })();

  // --- ゴミ箱 (soft delete) ---
  (function setupTrash() {
    const statusEl = document.getElementById('trashStatus');
    const listEl = document.getElementById('trashList');
    const emptyBtn = document.getElementById('emptyTrash');
    if (!statusEl || !listEl || !emptyBtn) return;

    const fmtDate = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
    };

    async function load() {
      let records = [];
      try { records = (await window.corpus.listTrash()) || []; } catch { records = []; }
      if (!records.length) {
        statusEl.textContent = MSG.trashEmpty;
        listEl.innerHTML = '';
        emptyBtn.disabled = true;
        return;
      }
      statusEl.textContent = MSG.trashCount(records.length);
      emptyBtn.disabled = false;
      listEl.innerHTML = records.map((r) => {
        const title = r.title || r.screenName || r.captureId || '';
        const platform = r.platform || '';
        const date = fmtDate(r.trashedAt);
        const img = r.image ? `<img src="psimg://${r.image}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0;" loading="lazy">` : '<span style="width:36px;height:36px;border-radius:4px;background:var(--surface-3);flex-shrink:0;display:inline-block;"></span>';
        return `<div class="trash-row" style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--border-subtle);">
          ${img}
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(title)}</div>
            <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(platform)} ${date}</div>
          </div>
          <button class="btn-outline" style="font-size:11px;padding:3px 8px;flex-shrink:0;" data-restore="${escapeAttr(r.image || r.video || r.captureId)}">${MSG.trashRestoreBtn}</button>
          <button class="btn-outline" style="font-size:11px;padding:3px 8px;flex-shrink:0;color:var(--danger);" data-perma="${escapeAttr(r.captureId)}">${MSG.trashDeleteBtn}</button>
        </div>`;
      }).join('');
    }

    listEl.addEventListener('click', async (e) => {
      const restoreBtn = e.target.closest('[data-restore]');
      const permaBtn = e.target.closest('[data-perma]');
      if (restoreBtn) {
        try { await window.corpus.restorePost(restoreBtn.dataset.restore); } catch { }
        await load();
      } else if (permaBtn) {
        try { await window.corpus.deleteFromTrash(permaBtn.dataset.perma); } catch { }
        await load();
      }
    });

    emptyBtn.addEventListener('click', async () => {
      try { await window.corpus.emptyTrash(); } catch { }
      await load();
    });

    // Load when settings opens
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', load);
    load();
  })();

  // --- Clear data ---
  // Destroying the whole library requires typing the keyword (MSG.deleteKeyword)
  // to enable the OK button — a stray click can't wipe everything.
  const confirmKeywordEl = document.getElementById('confirmKeyword');
  function setConfirmKeywordMode(on) {
    confirmKeywordEl.style.display = on ? '' : 'none';
    confirmKeywordEl.value = '';
    document.getElementById('confirmOk').disabled = on;
  }
  confirmKeywordEl.addEventListener('input', () => {
    document.getElementById('confirmOk').disabled = confirmKeywordEl.value.trim() !== MSG.deleteKeyword;
  });
  document.getElementById('clearData').addEventListener('click', () => {
    pendingDeleteGroup = null;
    document.getElementById('confirmMsg').textContent = MSG.confirmClear;
    document.getElementById('confirmSkipLabel').style.display = 'none';
    confirmKeywordEl.placeholder = MSG.confirmKeywordPh;
    setConfirmKeywordMode(true);
    document.getElementById('confirmOverlay').classList.add('show');
    confirmKeywordEl.focus();
  });

  document.getElementById('confirmCancel').addEventListener('click', () => {
    pendingDeleteGroup = null;
    pendingBulkDelete = false;
    setConfirmKeywordMode(false);
    document.getElementById('confirmOverlay').classList.remove('show');
  });

  document.getElementById('confirmOk').addEventListener('click', async () => {
    document.getElementById('confirmOverlay').classList.remove('show');

    if (pendingBulkDelete) {
      // Bulk delete selected groups — every record of each selected group
      const toDelete = [];
      viewGroups.forEach((g) => { if (selectedSet.has(postIdKey(g.rep))) toDelete.push(...g.records); });
      const count = toDelete.length;
      for (const p of toDelete) {
        await window.corpus.deletePost(p.image || p.video);
      }
      selectedSet.clear();
      selectionAnchor = null;
      pendingBulkDelete = false;
      updateSelectionBar();
      await loadPosts(true);
      showToast(MSG.deletedN(count));
    } else if (pendingDeleteGroup) {
      // Individual post (group) delete
      if (document.getElementById('confirmSkip').checked) {
        skipDeleteConfirm = true;
        window.corpus.setPref('skipDeleteConfirm', true);
      }
      await executeDeleteGroup(pendingDeleteGroup);
      pendingDeleteGroup = null;
    } else {
      // Clear all data (deletes every image + sidecar in the save folder).
      // Double-checked: the OK button is disabled until the keyword matches.
      if (confirmKeywordEl.value.trim() !== MSG.deleteKeyword) return;
      setConfirmKeywordMode(false);
      await window.corpus.clearAll();
      _postsById = new Map();   // keep the delta cache in sync with the wipe
      allPosts = [];
      renderPosts();
      showToast(MSG.cleared);
    }
  });

  // Close overlay on background click
  document.getElementById('confirmOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      pendingDeleteGroup = null;
      pendingBulkDelete = false;
      setConfirmKeywordMode(false);
      e.currentTarget.classList.remove('show');
    }
  });

  // --- Utility functions ---
  function formatCount(n) {
    if (n == null) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  // Cached Intl formatters: toLocaleDateString/TimeString build a fresh formatter
  // on every call, which dominated render time (formatDate runs 2×/card for the
  // hover tooltip × 150 cards). Reusing one formatter each is ~10× faster.
  const _dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
  const _timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  function formatDate(isoStr) {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return _dateFmt.format(d) + ' ' + _timeFmt.format(d);
  }

  function escapeHtml(str) { return window.corpusUI.escapeHtml(str); }
  // corpusUI.escapeHtml is quote-safe (escapes " and '), so attribute values are
  // safe through the same call — escapeAttr stays as a named alias to keep the
  // intent ("this value lands in an attribute") legible at the 35 call sites.
  function escapeAttr(str) { return window.corpusUI.escapeHtml(str); }

  // Delegates to the shared glass toast (ui.js). Was a dynamically-created solid
  // #333 #toast; unified to #ivToast so viewer + folders share one look.
  function showToast(msg) { return window.corpusUI.notify(msg); }

  // --- Init ---
  // Shared folder changes: refresh chips on any change; re-render cards (📁 states)
  // when the folder list/default changes.
  if (CF()) CF().onChange((kind) => {
    // 絞り込み中のフォルダが削除されたらそのフィルタを除去（一覧が原因不明に空になるのを防ぐ）。
    if (postQB.removeCondsMatching((c) => c.type === 'folder' && !CF().byId(c.value))) { postQB.syncShadow(); postQB.render(); }
    renderPostFolders();
    if (browseMode === 'collections') { renderCollections(); return; }   // collection view: refresh the grid (covers create/rename/delete/active)
    if (kind === 'list') renderPosts(true);   // folder created/deleted — refresh without anim
  });
  if (window.corpus.onPostsChanged) {
    window.corpus.onPostsChanged(async (names) => {
      await loadPosts(true, names);   // background fs-watch refresh — targeted via the changed-file hint
    });
  }
  renderQueryChips();
  if (CF()) await CF().load();   // load folders before first render so 📁/chips are correct
  // Grouping persistence (shared with the old image-view): manual groups + opt-outs.
  try { const r = window.corpus.getUngrouped ? await window.corpus.getUngrouped() : null; ungrouped = new Set((r && r.keys) || []); } catch { /* default empty */ }
  try { const r = window.corpus.getPosterFolders ? await window.corpus.getPosterFolders() : null; pfStore.setAll((r && r.folders) || []); } catch { /* default empty */ }
  try { const r = window.corpus.getPosterTags ? await window.corpus.getPosterTags() : null; posterTags = (r && r.tags) || {}; } catch { /* default empty */ }
  try { const r = window.corpus.getManualGroups ? await window.corpus.getManualGroups() : null; manualGroups = (r && r.groups) || []; } catch { /* default empty */ }
  try { const r = window.corpus.getTagGroups ? await window.corpus.getTagGroups() : null; tagGroups = (r && r.groups) || []; } catch { /* default empty */ }
  try { const r = window.corpus.getTagTypes ? await window.corpus.getTagTypes() : null; tagTypes = (r && r.types) || {}; } catch { /* default empty */ }
  await initTabs();
  appBooted = true;   // saved view is now applied — the first loadPosts render seeds history
  await loadPosts();
  // Restore the last browse mode (ライブラリ / 投稿者) now that posts are loaded so
  // buildUsers has data for the poster grid. silent = no history/pref echo.
  try {
    const prefs = await window.corpus.getPrefs();
    if (prefs && prefs.browseMode === 'posters') setBrowseMode('posters', { silent: true });
    else if (prefs && prefs.browseMode === 'collections') setBrowseMode('collections', { silent: true });
  } catch { /* stay in library mode */ }
  // First paint done — restore the active tab's renderLimit + scroll (survives restart).
  restoreTabView(tabs.find((t) => t.id === activeTabId));
  // Persist scroll changes too (debounced), not only state/tab-switch changes, so the
  // remembered position is current at restart. persistTabsDebounced captures scrollY.
  let _scrollPersistTimer = null;
  const _contentScroller = contentScrollEl();
  if (_contentScroller) _contentScroller.addEventListener('scroll', () => {
    clearTimeout(_scrollPersistTimer);
    _scrollPersistTimer = setTimeout(persistTabsDebounced, 400);
  }, { passive: true });
})();
