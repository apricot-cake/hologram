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
    tabPosts: _s('tabPosts'),
    tabTags: _s('tabTags'),
    emptyHashtags: _s('emptyHashtags'),
    tabSettings: _s('tabSettings'),
    searchPlaceholder: _s('searchPlaceholder'),
    searchHashtags: _s('searchHashtags'),
    searchTags: _s('searchTags'),
    tabUsers: _s('tabUsers'),
    searchUsers: _s('searchUsers'),
    emptyUsers: _s('emptyUsers'),
    sidebarAuthors: _s('sidebarAuthors'),
    searchAuthors: _s('searchAuthors'),
    kindTitle: _s('kindTitle'),
    kindPost: _s('kindPost'),
    kindImage: _s('kindImage'),
    userKindTitle: _s('userKindTitle'),
    userKindMedia: _s('userKindMedia'),
    userKindPlain: _s('userKindPlain'),
    multiOnly: _s('multiOnly'),
    expandAll: _s('expandAll'),
    confirmDeleteGroup: _f1('confirmDeleteGroup'),
    tipInfo: _s('tipInfo'),
    tipSelect: _s('tipSelect'),
    tagSelected: _s('tagSelected'),
    folderSelected: _s('folderSelected'),
    tagSelectedTitle: _s('tagSelectedTitle'),
    sbSearchTitle: _s('sbSearchTitle'),
    sbSortTitle: _s('sbSortTitle'),
    sbViewTitle: _s('sbViewTitle'),
    tipTagCycle: _s('tipTagCycle'),
    sbFilterTip: _s('sbFilterTip'),
    sbFilterTitle: _s('sbFilterTitle'),
    engParticle: _s('engParticle'),
    ctxManage: _s('ctxManage'),
    ctxWsAdd: _s('ctxWsAdd'),
    ctxWsRemove: _s('ctxWsRemove'),
    qcAndLabel: _s('qcAndLabel'),
    qcOrLabel: _s('qcOrLabel'),
    qcJoinAnd: _s('qcJoinAnd'),
    qcJoinOr: _s('qcJoinOr'),
    tileOverlay: _s('tileOverlay'),
    qcDropHere: _s('qcDropHere'),
    qcDropMove: _s('qcDropMove'),
    qbHelpTitle: _s('qbHelpTitle'),
    qbHelp1: _s('qbHelp1'),
    qbHelp2: _s('qbHelp2'),
    qbHelp3: _s('qbHelp3'),
    qbHelp4: _s('qbHelp4'),
    qbHelp5: _s('qbHelp5'),
    qbHelp6: _s('qbHelp6'),
    tagGroupsTitle: _s('tagGroupsTitle'),
    qfAdd: _s('qfAdd'),
    qfCatFolder: _s('qfCatFolder'),
    sbTopTip: _s('sbTopTip'),
    ungroupDone: _s('ungroupDone'),
    tagGroupOther: _s('tagGroupOther'),
    tagAllRow: _s('tagAllRow'),
    pinnedTags: _s('pinnedTags'),
    tipPin: _s('tipPin'),
    qfFindPh: _s('qfFindPh'),
    exportModeFull: _s('exportModeFull'),
    exportModeImages: _s('exportModeImages'),
    backupSubTitle: _s('backupSubTitle'),
    deleteKeyword: _s('deleteKeyword'),
    confirmKeywordPh: _s('confirmKeywordPh'),
    detailPlatform: _s('detailPlatform'),
    detailAuthor: _s('detailAuthor'),
    detailUser: _s('detailUser'),
    detailEngagement: _s('detailEngagement'),
    detailPosted: _s('detailPosted'),
    detailSaved: _s('detailSaved'),
    detailUpdated: _s('detailUpdated'),
    detailImages: _s('detailImages'),
    detailImageOf: _s('detailImageOf'),
    imageOf: _f2('imageOf'),
    detailTags: _s('detailTags'),
    detailOpen: _s('detailOpen'),
    detailSauce: _s('detailSauce'),
    detailAscii: _s('detailAscii'),
    tagStart: _s('tagStart'),
    tagBarBadge: _s('tagBarBadge'),
    tagAxisEdit: _s('tagAxisEdit'),
    tagAxisStamp: _s('tagAxisStamp'),
    tagAxisEditHint: _s('tagAxisEditHint'),
    tagAxisStampHint: _s('tagAxisStampHint'),
    tagLoaded: _s('tagLoaded'),
    tagPickToLoad: _s('tagPickToLoad'),
    tagAddBtn: _s('tagAddBtn'),
    tagNewName: _s('tagNewName'),
    tagNoGroup: _s('tagNoGroup'),
    tagNewGroup: _s('tagNewGroup'),
    tagNewGroupName: _s('tagNewGroupName'),
    tagDone: _s('tagDone'),
    tagNoTags: _s('tagNoTags'),
    tagStampedOn: _f1('tagStampedOn'),
    tagStampedOff: _f1('tagStampedOff'),
    imagesCount: _f1('imagesCount'),
    tagsSaved: _s('tagsSaved'),
    tagsSavedN: _f1('tagsSavedN'),
    tipWorkspace: _s('tipWorkspace'),
    tipFolder: _s('tipFolder'),
    workspaceTitle: _s('workspaceTitle'),
    wsEmpty: _s('wsEmpty'),
    wsEmptyTip: _s('wsEmptyTip'),
    wsEmptyConfirm: _s('wsEmptyConfirm'),
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
    langAuto: _s('langAuto'),
    hintLang: _s('hintLang'),
    shortcutTitle: _s('shortcutTitle'),
    shortcutLink: _s('shortcutLink'),
    hintShortcut: _s('hintShortcut'),

    // settings > data / danger
    dataTitle: _s('dataTitle'),
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
    backupTitle: _s('backupTitle'),
    hintBackup: _s('hintBackup'),
    backupDirNone: _s('backupDirNone'),
    backupChoose: _s('backupChoose'),
    backupClear: _s('backupClear'),
    backupContentTitle: _s('backupContentTitle'),
    backupContentMeta: _s('backupContentMeta'),
    backupContentMedia: _s('backupContentMedia'),
    backupScheduleTitle: _s('backupScheduleTitle'),
    backupInterval: _s('backupInterval'),
    backupIntervalUnit: _s('backupIntervalUnit'),
    unitDay: _s('unitDay'),
    unitWeek: _s('unitWeek'),
    unitMonth: _s('unitMonth'),
    backupRunNow: _s('backupRunNow'),
    backupRunning: _s('backupRunning'),
    backupNotSet: _s('backupNotSet'),
    backupOverlap: _s('backupOverlap'),
    backupLastLabel: _s('backupLastLabel'),
    backupItemsUnit: _s('backupItemsUnit'),
    backupSkipLabel: _s('backupSkipLabel'),

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
    engagementLikes: _s('engagementLikes'),
    engagementReposts: _s('engagementReposts'),
    engagementReplies: _s('engagementReplies'),
    engagementBookmarks: _s('engagementBookmarks'),
    engagementViews: _s('engagementViews'),
    engagementSuffix: _s('engagementSuffix'),

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
    dateTypePost: _s('dateTypePost'),
    dateTypeCaptured: _s('dateTypeCaptured'),
    clickToExpand: _s('clickToExpand'),
    tipOpen: _s('tipOpen'),
    lbPrev: _s('lbPrev'),
    lbNext: _s('lbNext'),
    tipEdit: _s('tipEdit'),
    tipDelete: _s('tipDelete'),
    postedOn: _f1('postedOn'),
    captured: _f1('captured'),

    // stats formatters (pure formatting, no translation)
    likes: (n) => n != null ? `${formatCount(n)}` : '',
    reposts: (n) => n != null ? `${formatCount(n)} RT` : '',
    replies: (n) => n != null ? `${formatCount(n)}` : '',
    bookmarks: (n) => n != null ? `${formatCount(n)}` : '',

    // edit overlay
    tagsLabel: _s('tagsLabel'),
    addTag: _s('addTag'),
    tagPlaceholder: _s('tagPlaceholder'),
    applyToSelected: _s('applyToSelected'),

    // query/sidebar filters
    qfPlatform: _s('qfPlatform'),
    qfPostType: _s('qfPostType'),
    qfDate: _s('qfDate'),
    qfEngagement: _s('qfEngagement'),
    qfTag: _s('qfTag'),
    qfMedia: _s('qfMedia'),
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
    qfDateFrom: _s('qfDateFrom'),
    qfDateTo: _s('qfDateTo'),
    qfEngLikes: _s('qfEngLikes'),
    qfEngReposts: _s('qfEngReposts'),
    qfEngReplies: _s('qfEngReplies'),
    qfEngBookmarks: _s('qfEngBookmarks'),
    qfEngViews: _s('qfEngViews'),
    qfEngSuffix: _s('qfEngSuffix'),
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

  // --- Apply i18n to static elements ---
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const setAttr = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };

  setText('settingsViewTitle', MSG.tabSettings);
  setAttr('settingsBtn', 'title', MSG.tabSettings);
  setAttr('settingsBtn', 'aria-label', MSG.tabSettings);
  setText('sbAuthorTitle', MSG.sidebarAuthors);
  setText('sbWorkspaceTitle', MSG.workspaceTitle);
  const wsClearEl = document.getElementById('wsClear');
  if (wsClearEl) { wsClearEl.title = MSG.wsEmptyTip; wsClearEl.setAttribute('aria-label', MSG.wsEmpty); }
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

  // Toolbar section titles (検索 / 並び順 / 表示) + search-mode select options
  setText('sbSearchTitle', MSG.sbSearchTitle);
  setText('sbSortTitle', MSG.sbSortTitle);
  setText('sbViewTitle', MSG.sbViewTitle);
  setText('searchModeOptNormal', MSG.searchExact);
  setText('searchModeOptFuzzy', MSG.searchFuzzy);
  // Engagement sentence particle (「…が 0 以上」); en has none → hide the span
  setText('sbEngParticle', MSG.engParticle);
  const engParticleEl = document.getElementById('sbEngParticle');
  if (engParticleEl && !MSG.engParticle) engParticleEl.style.display = 'none';
  setText('sbFilterTitle', MSG.sbFilterTitle);
  setText('sbTagRowTitle', MSG.qfTag);
  setText('sbHashtagRowTitle', MSG.tabTags);
  setText('sbFolderRowTitle', MSG.qfCatFolder);
  setText('sbPinTitle', MSG.pinnedTags);
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
      case 'userKind':   return f.value === 'media' ? MSG.userKindMedia : MSG.userKindPlain;
      case 'platform':   return ({ x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' })[f.value] || f.value;
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
    userKind: '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>',
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
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  };
  const qcGlyph = (type) => (QC_GLYPH[type]
    ? `<svg class="qc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${QC_GLYPH[type]}</svg>`
    : '');

  function renderQueryChips() {
    const container = document.getElementById('queryChips');
    const prevLabels = new Set(Array.from(container.querySelectorAll('.sb-active-chip')).map(el => el.textContent.trim()));
    const bar = document.getElementById('postActiveBar');
    // クエリビルダ: 「かつ」「または」の2フィールドを常時表示し、全フィルタを
    // 要素（ピル）として配置。ピルはドラッグで他方のフィールドへ移動できる。
    // 式 = (かつフィールド) ⟨かつ/または⟩ (またはフィールド)。
    const sbEl = document.getElementById('searchBox');
    const searchVal = sbEl ? sbEl.value.trim() : '';
    // ビルダは常時表示（＋フィルタの入口を兼ねるため、空でもバーを出す）。
    // リセットは「消すものがある」ときだけ（空のバーにボタンが浮かない）。
    if (bar) bar.style.display = '';
    const resetBtn = document.getElementById('postResetBtn');
    if (resetBtn) resetBtn.style.display = (activeFilters.length || searchVal) ? '' : 'none';
    let special = '';
    if (searchVal) special += `<span class="sb-active-chip qc-search" data-special="search">${qcGlyph('search')}${escapeHtml(searchVal)}</span>`;
    const pill = (i, label, type) => `<span class="sb-active-chip qc-${type}" draggable="true" data-filter-idx="${i}">${qcGlyph(type)}${escapeHtml(label)}</span>`;
    const andPills = [];
    const orPills = [];
    activeFilters.forEach((f, i) => {
      (f.mode === 'or' ? orPills : andPills).push(pill(i, filterLabel(f), f.type));
    });
    // フィールドはラベルを箱の中に持つ（外置きだと束ねている感が出ない）。
    // さらにピルの間に小さく「かつ/または」を挟み、「この箱の中は全部この
    // 演算子で結合」だと一目で読めるようにする。
    // 空フィールド: 反対側にピルがあれば「ここへドラッグで移動」、無ければ（なし）。
    const zone = (name, pills, otherHas) => {
      const word = name === 'and' ? MSG.qcJoinAnd : MSG.qcJoinOr;
      const body = pills.length
        ? pills.join(`<span class="qc-op">${escapeHtml(word)}</span>`)
        : `<span class="qc-zone-empty">${otherHas ? MSG.qcDropMove : MSG.qcDropHere}</span>`;
      // No hover tooltips here — the ⓘ help popover is the single explainer.
      return `<span class="qc-zone" data-zone="${name}">` +
        `<span class="qc-zone-label">${escapeHtml(word)}</span>` + body + `</span>`;
    };
    const joinSel = `<select class="qc-join-sel" id="qcJoinSel">` +
      `<option value="and"${tagJoin !== 'or' ? ' selected' : ''}>${MSG.qcJoinAnd}</option>` +
      `<option value="or"${tagJoin === 'or' ? ' selected' : ''}>${MSG.qcJoinOr}</option></select>`;
    container.innerHTML = special +
      zone('and', andPills, orPills.length > 0) +
      joinSel +
      zone('or', orPills, andPills.length > 0);
    if (!prefersReducedMotion()) {
      container.querySelectorAll('.sb-active-chip').forEach(el => {
        if (!prevLabels.has(el.textContent.trim())) el.classList.add('chip-new');
      });
    }
    // Connector (かつ/または): swap the native <select> for the glass custom
    // dropdown so the OPEN list is glass (cs-pop = glass-frost), matching the
    // sort/search pulldowns. The bar re-renders often, so prune the detached
    // previous select from csHosts before enhancing the fresh one.
    for (let i = csHosts.length - 1; i >= 0; i--) if (!document.contains(csHosts[i])) csHosts.splice(i, 1);
    const jsel = document.getElementById('qcJoinSel');
    if (jsel) { enhanceSelect(jsel); if (jsel.__csBtn) jsel.__csBtn.classList.add('cs-join-btn'); }
  }

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

  // --- Pinned filters (📌 任意の属性の値をサイドバーに常駐) ---
  const PIN_KEY = 'corpus.pinnedFilters';
  const PIN_KEY_LEGACY = 'corpus.pinnedTags';
  function loadPins() {
    const legacy = localStorage.getItem(PIN_KEY_LEGACY);
    if (legacy) {
      try {
        const pins = JSON.parse(legacy).map(t => ({ type: 'tag', value: t }));
        localStorage.setItem(PIN_KEY, JSON.stringify(pins));
        localStorage.removeItem(PIN_KEY_LEGACY);
        return pins;
      } catch {}
    }
    try { return JSON.parse(localStorage.getItem(PIN_KEY)) || []; } catch { return []; }
  }
  function isPinned(type, value) { return loadPins().some(p => p.type === type && p.value === value); }
  function togglePin(type, value) {
    const pins = loadPins();
    const i = pins.findIndex(p => p.type === type && p.value === value);
    if (i >= 0) pins.splice(i, 1); else pins.push({ type, value });
    try { localStorage.setItem(PIN_KEY, JSON.stringify(pins)); } catch {}
    updateSidebarTags();
  }

  function addFilter(filter) {
    // Prevent exact duplicates
    const isDup = activeFilters.some(f => {
      if (f.type !== filter.type) return false;
      if (filter.type === 'date' || filter.type === 'engagement') return false;
      return f.value === filter.value;
    });
    if (isDup) return;
    // date + kind are single-valued (択一): a new one replaces the existing.
    if (filter.type === 'date' || filter.type === 'kind') {
      activeFilters = activeFilters.filter(f => f.type !== filter.type);
    }
    activeFilters.push(filter);
    renderQueryChips();
    renderPosts();
  }

  function removeFilter(index) {
    activeFilters.splice(index, 1);
    renderQueryChips();
    renderPosts();
  }

  // 全フィルタを一括リセット（アクティブフィルタバーの「リセット」）。検索・フォルダ・
  // タグ結合・日付・エンゲージも含めて消す。renderPosts() が sidebar の active 状態も同期。
  function resetAllFilters() {
    activeFilters = [];
    tagJoin = 'and';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('searchBox', ''); set('sbDateFrom', ''); set('sbDateTo', ''); set('sbEngMin', '');
    renderQueryChips();
    renderPostFolders();
    renderPosts();
  }
  document.getElementById('postResetBtn').addEventListener('click', resetAllFilters);

  // Empty-state CTAs (innerHTML rebuilds the buttons each render → delegate)
  document.getElementById('emptyState').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'emptyResetBtn') resetAllFilters();
    else if (btn.id === 'emptyImportBtn') document.getElementById('importZipInput').click();
  });

  // ⟨かつ/または⟩ connector (pulldown, delegated — the bar re-renders often)
  document.getElementById('queryChips').addEventListener('change', (e) => {
    if (e.target && e.target.id === 'qcJoinSel') {
      tagJoin = e.target.value === 'or' ? 'or' : 'and';
      renderPosts();
    }
  });

  // Drag a pill between the かつ/または fields to change how it combines.
  const qcContainer = document.getElementById('queryChips');
  qcContainer.addEventListener('dragstart', (e) => {
    const p = e.target.closest && e.target.closest('.sb-active-chip[data-filter-idx]');
    if (!p) return;
    e.dataTransfer.setData('text/plain', p.dataset.filterIdx);
    e.dataTransfer.effectAllowed = 'move';
  });
  qcContainer.addEventListener('dragover', (e) => {
    const z = e.target.closest && e.target.closest('.qc-zone');
    if (!z) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    z.classList.add('drag-over');
  });
  qcContainer.addEventListener('dragleave', (e) => {
    const z = e.target.closest && e.target.closest('.qc-zone');
    if (z) z.classList.remove('drag-over');
  });
  qcContainer.addEventListener('drop', (e) => {
    const z = e.target.closest && e.target.closest('.qc-zone');
    if (!z) return;
    e.preventDefault();
    z.classList.remove('drag-over');
    const f = activeFilters[parseInt(e.dataTransfer.getData('text/plain'), 10)];
    if (!f) return;
    const mode = z.dataset.zone === 'or' ? 'or' : 'and';
    if ((f.mode === 'or') === (mode === 'or')) return;   // same field
    f.mode = mode;
    renderPostFolders();   // ＋プレフィクス等の同期（タグ側は updateSidebarState 経由）
    renderPosts();
  });

  // --- カテゴリ値フライアウト: サイドバーの行/タググループボタンの横に開く ----
  const qfPop = document.createElement('div');
  qfPop.className = 'fold-menu qf-pop';
  document.body.appendChild(qfPop);
  let qfCat = null;
  let qfAnchor = null;     // 同じ行をもう一度押したら閉じる（トグル）
  let qfTagGroup = null;   // タグサブ行クリック時にセット（グループ絞り込み）
  function hideQfPop() {
    document.querySelectorAll('#filterRows .qf-open').forEach(r => r.classList.remove('qf-open'));
    qfPop.classList.remove('show'); qfCat = null; qfAnchor = null; qfTagGroup = null;
  }
  function qfValues(cat) {
    const act = (type, v) => activeFilters.some(f => f.type === type && f.value === v);
    switch (cat) {
      case 'kind': return [['post', MSG.kindPost], ['image', MSG.kindImage]].map(([v, l]) => ({ v, l, on: act('kind', v) }));
      case 'userKind': return [['media', MSG.userKindMedia], ['plain', MSG.userKindPlain]].map(([v, l]) => ({ v, l, on: act('userKind', v) }));
      case 'platform': {
        // Misskey/Mastodon の直下に各インスタンスをサブ行で展開（独立に選択可）
        const names = { x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' };
        const hostsOf = (plat) => {
          const set = new Set();
          for (const p of allPosts) if (p.platform === plat) { const h = hostOf(p.url); if (h) set.add(h); }
          return [...set].sort();
        };
        const out = [];
        for (const v of ['x', 'bluesky', 'misskey', 'mastodon', 'pixiv']) {
          out.push({ v, l: names[v], on: act('platform', v) });
          if (v === 'misskey' || v === 'mastodon') {
            for (const h of hostsOf(v)) out.push({ v: h, l: h, on: act('instance', h), type: 'instance', sub: true });
          }
        }
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
      case 'tag': {
        const allTags = [...new Set(allPosts.filter(p => p.url).flatMap(p => p.tags || []))].sort();
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
        allPosts.filter(p => p.url).forEach(p => (p.hashtags || []).forEach(h => { counts[h] = (counts[h] || 0) + 1; }));
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
    const PINNABLE = new Set(['tag', 'hashtag', 'user', 'platform', 'instance', 'postType', 'media', 'kind', 'userKind', 'folder']);
    const PIN_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M9 3h6"/><path d="M10 3l-.6 6L7 12v2h10v-2l-2.4-3L14 3"/><path d="M12 14v7"/></svg>';
    const curPins = PINNABLE.has(qfCat) ? loadPins() : null;
    const rowOf = (it) => {
      if (it.ghead != null) return `<div class="qf-ghead">${escapeHtml(it.ghead)}</div>`;
      const vtype = it.type || qfCat;
      const isMulti = qfCat === 'media' && it.v === '__multi';
      const pinHtml = (curPins && !isMulti)
        ? `<span class="qf-pin${curPins.some(p => p.type === vtype && p.value === it.v) ? ' on' : ''}" data-pinval="${escapeAttr(it.v)}" data-pintype="${escapeAttr(vtype)}" title="${MSG.tipPin}">${PIN_SVG}</span>`
        : '';
      return `<div class="fm-row${it.sub ? ' fm-sub' : ''}" data-qfval="${escapeAttr(it.v)}"${it.type ? ` data-qftype="${it.type}"` : ''}${it.sn ? ` data-sn="${escapeAttr(it.sn)}"` : ''}><span class="fm-name">${escapeHtml(it.l)}</span>${it.on ? `<span class="fm-check">${CHECK_SVG}</span>` : ''}${pinHtml}</div>`;
    };
    const listHtml = items.map(rowOf).join('');
    // 長いリスト（タグ/作者など）はその場で絞り込める入力を付ける
    // Find box only for genuinely long, open-ended lists (tags/authors). The
    // platform list is short + fixed (5 PFs + their instances), so no find box.
    const valueCount = items.filter(it => it.ghead == null).length;
    const find = (qfCat !== 'platform' && (qfTagGroup || valueCount > 8)) ? `<input type="text" class="qf-find" id="qfFind" placeholder="${MSG.qfFindPh}" autocomplete="off">` : '';
    // No heading row: the user already clicked the category row, so repeating
    // its name as a (hover-highlighted, seemingly-clickable) row was noise.
    const footer = (qfCat === 'folder' && CF())
      ? `<div class="qf-footer"><button class="qf-footer-link" type="button" id="qfFolderManage">${escapeHtml(MSG.ctxManage)}</button></div>`
      : '';
    qfPop.innerHTML =
      find +
      `<div class="qf-vals">` + (listHtml || `<div class="qf-zone-empty" style="padding:6px 8px;">—</div>`) + `</div>` +
      footer;
    const fi = document.getElementById('qfFind');
    if (fi) setTimeout(() => fi.focus(), 0);
  }
  // 値リストの絞り込み（再描画せず行の表示/非表示だけ切替＝入力フォーカス維持）
  qfPop.addEventListener('input', (e) => {
    if (!e.target.classList.contains('qf-find')) return;
    const raw = e.target.value.trim().toLowerCase();
    const atMode = raw.startsWith('@');
    const q = atMode ? raw.slice(1) : raw;
    qfPop.querySelectorAll('.qf-vals .fm-row').forEach((row) => {
      const match = !q || (atMode
        ? (row.dataset.sn || '').toLowerCase().includes(q)
        : row.textContent.toLowerCase().includes(q));
      row.style.display = match ? '' : 'none';
    });
    qfPop.querySelectorAll('.qf-vals .qf-ghead').forEach((h) => { h.style.display = q ? 'none' : ''; });
  });
  // 行/グループボタンの横にフライアウトを開く（同じアンカー再クリックで閉じる）
  function showQfPopAt(cat, anchorEl, tagGroupId) {
    if (qfPop.classList.contains('show') && qfAnchor === anchorEl) { hideQfPop(); return; }
    document.querySelectorAll('#filterRows .qf-open').forEach(r => r.classList.remove('qf-open'));
    anchorEl.classList.add('qf-open');
    qfCat = cat;
    qfAnchor = anchorEl;
    qfTagGroup = tagGroupId || null;
    renderQfPop();
    const r = anchorEl.getBoundingClientRect();
    qfPop.style.left = (r.right + 8) + 'px';
    qfPop.style.top = r.top + 'px';
    qfPop.classList.add('show');
    const pr = qfPop.getBoundingClientRect();
    if (pr.right > innerWidth - 8) qfPop.style.left = Math.max(8, innerWidth - pr.width - 8) + 'px';
    if (pr.bottom > innerHeight - 8) qfPop.style.top = Math.max(8, innerHeight - pr.height - 8) + 'px';
  }
  qfPop.addEventListener('click', (e) => {
    if (e.target.closest('#qfFolderManage')) { if (CF()) CF().openManager(); hideQfPop(); return; }
    // 📌 ピン留めトグル（行クリックの選択とは独立）
    const pin = e.target.closest('.qf-pin');
    if (pin) {
      togglePin(pin.dataset.pintype || qfCat, pin.dataset.pinval);
      renderQfPop();
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
      const vtype = val.dataset.qftype || qfCat;   // sub-rows (instances) override the type
      const i = activeFilters.findIndex(f => f.type === vtype && f.value === v);
      if (i >= 0) {
        removeFilter(i);
      } else if (vtype === 'tag' || vtype === 'folder' || vtype === 'hashtag') {
        addFilter({ type: vtype, value: v, mode: 'or' });
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
        !e.target.closest('.sb-row') && !e.target.closest('[data-tag-group]')) hideQfPop();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideQfPop(); });

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

  // Chip click handler
  document.getElementById('queryChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.sb-active-chip');
    if (!chip) return;
    // 特殊ピル（検索・フォルダ）はそれぞれの状態を解除して再描画。
    if (chip.dataset.special === 'search') {
      const sb = document.getElementById('searchBox');
      if (sb) sb.value = '';
      renderPosts();   // → updateSidebarState → renderQueryChips
      return;
    }
    const idx = parseInt(chip.dataset.filterIdx, 10);
    const filter = activeFilters[idx];
    if (!filter) return;

    if (filter.type === 'date') {
      openDatePopover(idx);
    } else if (filter.type === 'engagement') {
      openEngPopover(idx);
    } else {
      const wasFolder = filter.type === 'folder';
      removeFilter(idx);
      if (wasFolder) renderPostFolders();   // sync the sidebar folder chips
    }
  });

  // Menu/popover backdrop
  let qfBackdrop = null;

  function closeAllMenus() {
    document.getElementById('qfDatePopover').style.display = 'none';
    document.getElementById('qfEngPopover').style.display = 'none';
    if (qfBackdrop) { qfBackdrop.remove(); qfBackdrop = null; }
  }

  function createBackdrop() {
    closeAllMenus();
    qfBackdrop = document.createElement('div');
    qfBackdrop.className = 'qf-backdrop';
    qfBackdrop.addEventListener('click', closeAllMenus);
    document.body.appendChild(qfBackdrop);
  }

  // Date popover
  let editingDateIdx = null;

  function openDatePopover(idx) {
    createBackdrop();
    editingDateIdx = idx;
    const existing = idx != null ? activeFilters[idx] : null;
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

    document.getElementById('qfDateDelete').style.display = idx != null ? '' : 'none';
    document.getElementById('qfDateDelete').textContent = MSG.qfDelete;
    document.getElementById('qfDateApply').textContent = MSG.qfApply;

    // Open to the RIGHT of the row (same as the category flyouts) — opening
    // straight down covered the rows below and made switching awkward.
    popover.style.display = 'block';
    popover.style.left = (rect.right + 8) + 'px';
    popover.style.top = rect.top + 'px';
    popover.style.right = 'auto';
    const pr = popover.getBoundingClientRect();
    if (pr.right > innerWidth - 8) popover.style.left = Math.max(8, innerWidth - pr.width - 8) + 'px';
    if (pr.bottom > innerHeight - 8) popover.style.top = Math.max(8, innerHeight - pr.height - 8) + 'px';
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
    if (editingDateIdx != null) {
      activeFilters[editingDateIdx] = { type: 'date', dateField, from, to };
    } else {
      // Remove any existing date filter first
      activeFilters = activeFilters.filter(f => f.type !== 'date');
      activeFilters.push({ type: 'date', dateField, from, to });
    }
    closeAllMenus();
    renderQueryChips();
    renderPosts();
  });

  document.getElementById('qfDateDelete').addEventListener('click', () => {
    if (editingDateIdx != null) {
      removeFilter(editingDateIdx);
    }
    closeAllMenus();
  });

  // Engagement popover
  let editingEngIdx = null;

  function openEngPopover(idx) {
    createBackdrop();
    editingEngIdx = idx;
    const existing = idx != null ? activeFilters[idx] : null;
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

    document.getElementById('qfEngDelete').style.display = idx != null ? '' : 'none';
    document.getElementById('qfEngDelete').textContent = MSG.qfDelete;
    document.getElementById('qfEngApply').textContent = MSG.qfApply;

    popover.style.display = 'block';
    popover.style.left = (rect.right + 8) + 'px';
    popover.style.top = rect.top + 'px';
    popover.style.right = 'auto';
    const pr = popover.getBoundingClientRect();
    if (pr.right > innerWidth - 8) popover.style.left = Math.max(8, innerWidth - pr.width - 8) + 'px';
    if (pr.bottom > innerHeight - 8) popover.style.top = Math.max(8, innerHeight - pr.height - 8) + 'px';
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
    const filter = { type: 'engagement', engType, min, op };
    if (editingEngIdx != null) {
      activeFilters[editingEngIdx] = filter;
    } else {
      // Remove existing filter for same engType (prevent gte+lte on same type)
      activeFilters = activeFilters.filter(f => !(f.type === 'engagement' && f.engType === engType));
      activeFilters.push(filter);
    }
    closeAllMenus();
    renderQueryChips();
    renderPosts();
  });

  document.getElementById('qfEngDelete').addEventListener('click', () => {
    if (editingEngIdx != null) {
      removeFilter(editingEngIdx);
    }
    closeAllMenus();
  });

  // --- Sidebar filter controls ---

  // Sidebar i18n
  setText('sbKindTitle', MSG.kindTitle);
  setText('sbUserKindTitle', MSG.userKindTitle);
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
    if (sub) {
      const gid = sub.dataset.tagGroup;
      showQfPopAt('tag', sub, gid === '__all' ? null : gid);
      return;
    }
    const row = e.target.closest('[data-qfrow]');
    if (!row) return;
    const cat = row.dataset.qfrow;
    if (cat === 'tag' && tagGroups.length) { hideQfPop(); toggleTagGroupsCollapsed(); return; }
    if (cat === 'date') { hideQfPop(); openDatePopover(null); return; }
    if (cat === 'engagement') { hideQfPop(); openEngPopover(null); return; }
    showQfPopAt(cat, row);
  });

  // --- Hover-to-open flyouts (experiment): hovering a filter row opens its value
  // flyout after a short intent delay; it stays while the cursor is on the row or
  // the flyout, and closes shortly after leaving both. Click still opens/dismisses.
  // Date/engagement param pops and the tag-row sub-row toggle stay click-only.
  (function setupHoverFlyouts() {
    const rows = document.getElementById('filterRows');
    if (!rows) return;
    const OPEN_MS = 140, CLOSE_MS = 260;
    let openT = null, closeT = null, hoverAnchor = null;
    const flyoutTarget = (el) => {
      const sub = el.closest && el.closest('[data-tag-group]');
      if (sub) return { anchor: sub, open: () => showQfPopAt('tag', sub, sub.dataset.tagGroup === '__all' ? null : sub.dataset.tagGroup) };
      const row = el.closest && el.closest('[data-qfrow]');
      if (!row) return null;
      const cat = row.dataset.qfrow;
      if (cat === 'date' || cat === 'engagement') return null;       // param pops stay click-only
      if (cat === 'tag' && tagGroups.length) return null;            // tag row toggles its sub-rows
      return { anchor: row, open: () => showQfPopAt(cat, row) };
    };
    const cancelClose = () => { if (closeT) { clearTimeout(closeT); closeT = null; } };
    const scheduleClose = () => { cancelClose(); closeT = setTimeout(() => { if (qfPop.classList.contains('show')) hideQfPop(); }, CLOSE_MS); };
    rows.addEventListener('mouseover', (e) => {
      const t = flyoutTarget(e.target);
      if (!t) { hoverAnchor = null; return; }
      cancelClose();
      if (t.anchor === hoverAnchor) return;                          // same row — don't restart the timer
      hoverAnchor = t.anchor;
      if (openT) clearTimeout(openT);
      if (qfAnchor === t.anchor && qfPop.classList.contains('show')) return;
      openT = setTimeout(() => { if (!(qfAnchor === t.anchor && qfPop.classList.contains('show'))) t.open(); }, OPEN_MS);
    });
    rows.addEventListener('mouseleave', () => { hoverAnchor = null; if (openT) { clearTimeout(openT); openT = null; } scheduleClose(); });
    qfPop.addEventListener('mouseenter', cancelClose);
    qfPop.addEventListener('mouseleave', scheduleClose);
  })();

  // Update sidebar state (chip actives, row badges, tag area, active bar)
  function updateSidebarState() {
    document.querySelectorAll('.sb-chip[data-filter-type]').forEach(chip => {
      const type = chip.dataset.filterType;
      const value = chip.dataset.filterValue;
      chip.classList.toggle('active', activeFilters.some(f => f.type === type && f.value === value));
    });
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
  // 3状態サイクルは全廃: チップは単純トグル（追加=「または」/解除）。
  // 「すべて含む（かつ）」にしたいときはビルダのピルを「かつ」へドラッグ。
  // チップの ＋/濃色表示は状態の反映としてだけ残る。
  function toggleTagFilter(value) {
    const existIdx = activeFilters.findIndex(f => f.type === 'tag' && f.value === value);
    if (existIdx < 0) addFilter({ type: 'tag', value, mode: 'or' });
    else removeFilter(existIdx);
    updateSidebarState();
  }
  const _ic = (paths) => `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const TYPE_IC = {
    tag:      _ic('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="0.5" fill="currentColor"/>'),
    hashtag:  _ic('<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>'),
    user:     _ic('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    platform: _ic('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
    instance: _ic('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
    postType: _ic('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    media:    _ic('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M21 7.5h-4"/><path d="M21 16.5h-4"/>'),
    kind:     _ic('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    userKind: _ic('<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>'),
    folder:   _ic('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  };
  // Cached sets — rebuilt only when allPosts changes (tracked by generation counter).
  let _sidebarSetsGen = -1;
  let _cachedTagSet = null, _cachedHtSet = null, _cachedUserSet = null, _cachedInstSet = null;
  function _rebuildSidebarSets() {
    if (_sidebarSetsGen === _allPostsGeneration) return;
    const snPosts = allPosts.filter(p => p.url);
    _cachedTagSet  = new Set(snPosts.flatMap(p => p.tags || []));
    _cachedHtSet   = new Set(snPosts.flatMap(p => p.hashtags || []));
    _cachedUserSet = new Set(snPosts.map(p => userKey(p)));
    _cachedInstSet = new Set(snPosts.filter(p => p.platform === 'misskey' || p.platform === 'mastodon').map(p => hostOf(p.url)).filter(Boolean));
    _sidebarSetsGen = _allPostsGeneration;
  }
  function updateSidebarTags() {
    const pinHost = document.getElementById('sbPinnedTags');
    const section = document.getElementById('pinnedSection');
    if (!pinHost || !section) return;
    _rebuildSidebarSets();
    const allTagSet = _cachedTagSet, allHtSet = _cachedHtSet, allUserSet = _cachedUserSet, allInstSet = _cachedInstSet;
    const allFolderSet = new Set(CF() ? CF().all().map(f => f.id) : []);
    const EXISTS = { tag: v => allTagSet.has(v), hashtag: v => allHtSet.has(v), user: v => allUserSet.has(v), instance: v => allInstSet.has(v), folder: v => allFolderSet.has(v) };
    const pins = loadPins().filter(p => { const fn = EXISTS[p.type]; return fn ? fn(p.value) : true; });
    section.style.display = pins.length ? '' : 'none';
    const activeKey = new Set(activeFilters.map(f => f.type + ':' + f.value));
    pinHost.innerHTML = pins.map(p => {
      const active = activeKey.has(p.type + ':' + p.value);
      const glyph = TYPE_IC[p.type] ? `<span class="pin-ic">${TYPE_IC[p.type]}</span>` : '';
      return `<button class="sb-chip${active ? ' active' : ''}" data-filter-type="${escapeAttr(p.type)}" data-filter-value="${escapeAttr(p.value)}">${glyph}${escapeHtml(filterLabel(p))}</button>`;
    }).join('');
    updateSidebarTagGroups();
  }
  document.getElementById('sbPinnedTags').addEventListener('click', (e) => {
    const chip = e.target.closest('.sb-chip[data-filter-type]');
    if (!chip) return;
    const { filterType: type, filterValue: value } = chip.dataset;
    const existIdx = activeFilters.findIndex(f => f.type === type && f.value === value);
    if (existIdx >= 0) { removeFilter(existIdx); }
    else if (type === 'tag' || type === 'folder' || type === 'hashtag') { addFilter({ type, value, mode: 'or' }); }
    else if (type === 'user') { const u = buildUsers().find(x => x.key === value); addFilter({ type, value, label: u ? (u.displayName || u.screenName) : value }); }
    else { addFilter({ type, value }); }
    if (type === 'folder') renderPostFolders();
    updateSidebarState();
  });
  document.getElementById('sbPinnedTags').addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('.sb-chip[data-filter-type]');
    if (!chip) return;
    e.preventDefault();
    togglePin(chip.dataset.filterType, chip.dataset.filterValue);
  });

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
    const activeTags = new Set(activeFilters.filter(f => f.type === 'tag').map(f => f.value));
    const rows = [];
    if (allTagSet.size) {
      rows.push(`<button class="sb-subrow" type="button" data-tag-group="__all"><span class="sb-subrow-name">${escapeHtml(MSG.tagAllRow)}</span><span class="sb-subrow-count">${allTagSet.size}</span><span class="sb-subrow-arrow">${CHEV_R}</span></button>`);
    }
    for (const g of tagGroups) {
      const count = (g.tags || []).filter(t => allTagSet.has(t)).length;
      if (!count) continue;
      const active = (g.tags || []).some(t => activeTags.has(t));
      rows.push(`<button class="sb-subrow${active ? ' active' : ''}" type="button" data-tag-group="${escapeAttr(g.id)}"><span class="sb-subrow-name">${escapeHtml(g.name || '')}</span><span class="sb-subrow-count">${count}</span><span class="sb-subrow-arrow">${CHEV_R}</span></button>`);
    }
    const grouped = new Set(tagGroups.flatMap(g => g.tags || []));
    const otherCount = [...allTagSet].filter(t => !grouped.has(t)).length;
    if (otherCount) {
      const active = [...activeTags].some(t => !grouped.has(t));
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
    renderPosts(true);
  }

  async function doUndo() {
    const entry = undoStack.pop();
    if (!entry) return;
    const reverse = entry.records.map(r => ({ captureId: r.captureId, image: r.image, tags: r.prevTags }));
    await applyTagUndo(reverse);
    redoStack.push(entry);
    showToast('Undo');
  }

  async function doRedo() {
    const entry = redoStack.pop();
    if (!entry) return;
    const forward = entry.records.map(r => ({ captureId: r.captureId, image: r.image, tags: r.newTags }));
    await applyTagUndo(forward);
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
  let activeFilters = []; // { type, value?, dateField?, from?, to?, engType?, min? }
  let currentView = 'card';   // 'card' | 'tile' | 'list' (display density)
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
  let moreObserver = null;
  // --- Grouping state (persisted via main: manual-groups.json / ungrouped.json) ---
  let manualGroups = [];        // [[captureId,…],…] — user-built groups (win over auto)
  let ungrouped = new Set();    // post keys opted out of auto-grouping
  const stickyRecs = new Set(); // captureIds kept visible after a mutation un-matches the filter
  let inspectedKey = null;      // postIdKey of the group shown in the inspector (ring marker)
  let viewGroups = [];          // current render result: [{ key, records, rep, files }]
  let taggingApi = null;        // tagging mode (2-axis) API; set by setupTagging() below
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
  let tagJoin = 'and';           // connector between the AND group and the OR group (tags+folders)
  const CF = () => window.corpusFolders;   // shared folder module

  // --- Settings overlay (opened by the brand-bar gear; floats above both modes) ---
  // Relocate #panelSettings out of #mode-post (which is display:none in image mode)
  // into the always-available overlay shell so the gear reaches it from anywhere.
  (function setupSettingsView() {
    const view = document.getElementById('settingsView');
    const panel = document.getElementById('panelSettings');
    const inner = view && view.querySelector('.settings-view-inner');
    if (inner && panel) inner.appendChild(panel);
    const close = () => { if (view) view.hidden = true; };
    const open = () => { if (view) view.hidden = false; };
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

  // Back-to-top for the CONTENT area. The post grid grows the document, so the
  // window itself scrolls (html has scrollbar-gutter:stable) — watch window
  // scroll, not an inner container.
  (function setupContentTop() {
    const btn = document.getElementById('contentTop');
    if (!btn) return;
    const onScroll = () => { btn.style.display = window.scrollY > 300 ? 'flex' : 'none'; };
    window.addEventListener('scroll', onScroll, { passive: true });
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
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
        u = { key, platform: p.platform, screenName: p.screenName || '', displayName: p.displayName || '', count: 0 };
        map.set(key, u);
      }
      u.count++;
      if (!u.displayName && p.displayName) u.displayName = p.displayName;
      if (!u.screenName && p.screenName) u.screenName = p.screenName;
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
      renderPosts(keepLimit);
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
  function reconcileFolders() { if (CF()) CF().reconcile(new Set(allPosts.map(p => p.captureId))); }

  function getFilteredPosts() {
    // 統一ビュー: 全アイテム（SNS投稿＋ライブラリ画像）が対象。中身（画像 or 本文）の
    // 無いレコードだけ除外。SNS投稿だけ/画像だけの絞り込みは「種別」フィルタ(kind)で。
    let posts = allPosts.filter(p => p.image || mediaFilesOf(p).length || p.text || p.title);
    const rawQuery = document.getElementById('searchBox').value.trim();
    const query = rawQuery.toLowerCase();
    const sort = sortSelect.value;

    // Text search: 通常＝部分一致 / あいまい＝サブシーケンス一致（corpusSearch が方式を保持）
    if (query) {
      const fuzzy = window.corpusSearch && window.corpusSearch.isFuzzy();
      if (fuzzy) {
        const matchHay = window.corpusSearch.compile(rawQuery);   // クエリは1回だけ正規化・前処理
        posts = posts.filter(p => {
          const hay = [p.text, p.title, p.eagleName, p.screenName, p.displayName]
            .concat(p.tags || [])
            .map(x => (x == null ? '' : String(x))).join(' ');
          return matchHay(hay);
        });
      } else {
        posts = posts.filter(p =>
          (p.text || '').toLowerCase().includes(query) ||
          (p.title || '').toLowerCase().includes(query) ||
          (p.eagleName || '').toLowerCase().includes(query) ||
          (p.screenName || '').toLowerCase().includes(query) ||
          (p.displayName || '').toLowerCase().includes(query) ||
          (p.tags || []).some(t => t.toLowerCase().includes(query))
        );
      }
    }

    // ---- Query-builder evaluation ----
    // Every filter is an element with a predicate. AND field (mode !== 'or'):
    // single-valued attributes (kind/platform/user/instance/postType/media) are
    // OR'd within their type and AND'd across types (classic faceted search);
    // tag/folder/date/engagement elements are individually required.
    // OR field (mode === 'or') matches when ANY element matches.
    // Both fields combine via the user-selected connector (tagJoin).
    const SINGLE_VALUED = ['kind', 'platform', 'user', 'instance', 'postType', 'media', 'userKind'];
    const predOf = (f) => {
      switch (f.type) {
        // 'post' = SNS投稿（リンクあり＝拡張で取得: キャプチャもドラッグも）/
        // 'image' = 取り込み画像（リンクなし＝手動追加）。キャプチャ/ドラッグの別は
        // 区別する価値がないので url の有無を本質的な軸にする。
        case 'kind': return (p) => (f.value === 'post') === !!p.url;
        case 'userKind': return (p) => p.userKind === f.value;
        case 'platform': return (p) => p.platform === f.value;
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
    };
    const andElems = activeFilters.filter(f => f.mode !== 'or');
    const orElems = activeFilters.filter(f => f.mode === 'or');
    let andOk = null;
    if (andElems.length) {
      const groups = [];    // a group passes when SOME of its preds match
      const singles = {};
      for (const f of andElems) {
        if (SINGLE_VALUED.includes(f.type)) (singles[f.type] = singles[f.type] || []).push(predOf(f));
        else groups.push([predOf(f)]);   // individually required
      }
      for (const t of Object.keys(singles)) groups.push(singles[t]);
      andOk = (p) => groups.every(g => g.some(fn => fn(p)));
    }
    let orOk = null;
    if (orElems.length) {
      const preds = orElems.map(predOf);
      orOk = (p) => preds.some(fn => fn(p));
    }
    if (andOk && orOk) posts = posts.filter(tagJoin === 'or' ? (p) => andOk(p) || orOk(p) : (p) => andOk(p) && orOk(p));
    else if (andOk) posts = posts.filter(andOk);
    else if (orOk) posts = posts.filter(orOk);

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
  let restoringState = false;
  let tabs = [];
  let activeTabId = null;
  let _tabPersistTimer = null;
  function snapshotState() {
    return {
      f: JSON.parse(JSON.stringify(activeFilters)),
      join: tagJoin,
      search: document.getElementById('searchBox').value,
      sort: sortSelect.value,
      multi: multiOnly
    };
  }
  // Called from every fresh renderPosts(): keep the tab title + persistence in sync
  // with the current state, and record it for the stickyRecs change-detection below.
  // (The view-history mechanism this used to feed has been removed.)
  function syncTitleAndPersist() {
    const snap = snapshotState();
    lastRenderedState = JSON.stringify(snap);
    if (restoringState) return;
    document.title = tabTitleOf(snap, { allCount: allPosts.length }).text + ' — Corpus';
    updateActiveTabTitle(); persistTabsDebounced();
  }
  function applyState(s) {
    restoringState = true;
    activeFilters = JSON.parse(JSON.stringify(s.f));
    tagJoin = s.join;
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
    workspace:  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/></svg>',
    folder:     '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  };
  function genTabId() { return 'tab_' + Math.random().toString(36).slice(2, 10); }
  function persistTabsDebounced() {
    clearTimeout(_tabPersistTimer);
    _tabPersistTimer = setTimeout(() => {
      if (!window.corpus.setTabs) return;
      const at = tabs.find((t) => t.id === activeTabId);
      if (at) { at.state = snapshotState(); }
      window.corpus.setTabs({ activeTabId, tabs: tabs.map((t) => ({ id: t.id, pinned: t.pinned, title: t.title, state: t.state })) });
    }, 800);
  }
  function saveActiveTabState() {
    const t = tabs.find((t) => t.id === activeTabId);
    if (!t) return;
    t.state = snapshotState();
    t._scrollTop = window.scrollY;   // session-only (not persisted): remember content scroll per tab
  }
  // Restore a tab's remembered content scroll after its state has rendered. rAF so
  // the new content has laid out; tabs with no saved scroll fall back to the top.
  function restoreTabScroll(t) {
    const y = (t && typeof t._scrollTop === 'number') ? t._scrollTop : 0;
    requestAnimationFrame(() => window.scrollTo(0, y));
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
    restoreTabScroll(t);
    renderTabs(); persistTabsDebounced();
  }
  function addTab() {
    saveActiveTabState();
    const id = genTabId();
    tabs.push({ id, pinned: false, title: null, state: { f: [], join: 'or', search: '', sort: 'date-desc', multi: false } });
    activeTabId = id;
    applyState({ f: [], join: 'or', search: '', sort: sortSelect.value, multi: false });
    requestAnimationFrame(() => window.scrollTo(0, 0));   // new tab starts at the top
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
      restoreTabScroll(t);
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
    renderTabs(); persistTabsDebounced();
  }
  async function initTabs() {
    try {
      const saved = window.corpus.getTabs ? await window.corpus.getTabs() : null;
      if (saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
        tabs = saved.tabs.map((t) => ({ id: t.id || genTabId(), pinned: !!t.pinned, title: t.title || null, state: t.state || null }));
        const sid = saved.activeTabId;
        activeTabId = (sid && tabs.find((t) => t.id === sid)) ? sid : tabs[0].id;
      } else {
        const id = genTabId();
        tabs = [{ id, pinned: false, title: null, state: null }];
        activeTabId = id;
      }
      const at = tabs.find((t) => t.id === activeTabId);
      if (at && at.state) {
        activeFilters = JSON.parse(JSON.stringify(at.state.f || []));
        tagJoin = at.state.join || 'or';
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
      menu.classList.add('show');
      const r = menu.getBoundingClientRect();
      const { innerWidth: W, innerHeight: H } = window;
      let x = e.clientX, y = e.clientY + 4;
      if (x + r.width > W - 8) x = W - r.width - 8;
      if (y + r.height > H - 8) y = e.clientY - r.height - 4;
      menu.style.left = x + 'px'; menu.style.top = y + 'px';
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
    // A genuine filter/search/sort change drops the sticky survivors (they only
    // outlive in-place mutations, not user-driven view changes).
    if (!keepLimit && stickyRecs.size && lastRenderedState !== null &&
        JSON.stringify(snapshotState()) !== lastRenderedState) {
      stickyRecs.clear();
    }
    updateSidebarState();
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

    grid.innerHTML = viewGroups.slice(0, renderLimit).map((g, i) => {
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
        <button class="ws-btn${CF() && CF().inWorkspace(p.captureId) ? ' in' : ''}" data-ws="${i}" title="${MSG.tipWorkspace}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/></svg></button>
        <button class="info-btn" data-info="${i}" title="${MSG.tipInfo}" aria-label="${MSG.tipInfo}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.6" x2="12" y2="7.7"/></svg></button>
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
    }).join('');

    // Load-more: render the next page when a bottom sentinel nears the viewport.
    if (moreObserver) { moreObserver.disconnect(); moreObserver = null; }
    if (viewGroups.length > renderLimit) {
      const sentinel = document.createElement('div');
      sentinel.className = 'more-sentinel';
      sentinel.style.cssText = 'grid-column:1/-1;width:100%;height:1px;';
      grid.appendChild(sentinel);
      moreObserver = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { renderLimit += RENDER_PAGE; renderPosts(true); }
      }, { rootMargin: '800px' });
      moreObserver.observe(sentinel);
    }

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
      grid.querySelectorAll('.card-img').forEach((img) => {
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

    if (taggingApi && taggingApi.isActive()) taggingApi.refreshMarks();   // re-apply stamp marks after a rebuild

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
    const r = foldMenu.getBoundingClientRect();   // clamp into the viewport
    if (r.right > innerWidth - 8) foldMenu.style.left = Math.max(8, innerWidth - r.width - 8) + 'px';
    if (r.bottom > innerHeight - 8) foldMenu.style.top = Math.max(8, innerHeight - r.height - 8) + 'px';
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
  // Hover keeps only the two rapid-fire buttons (⚡ workspace / ℹ info);
  // everything else (open, tag edit, folders, delete) lives here.
  const cardMenu = document.createElement('div');
  cardMenu.className = 'fold-menu card-menu';
  document.body.appendChild(cardMenu);
  let cardMenuGroup = null;
  let cardMenuSrcUrl = '';
  function hideCardMenu() { cardMenu.classList.remove('show'); cardMenuGroup = null; cardMenuSrcUrl = ''; }
  const CM_IC = {
    open: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    ws: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.6" x2="12" y2="7.7"/></svg>',
    del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    sauce: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    wizard: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h0"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/></svg>'
  };
  function showCardMenu(g, x, y) {
    cardMenuGroup = g;
    cardMenuSrcUrl = (g.records.flatMap((r) => Array.isArray(r.media) ? r.media : []).find((m) => m && m.url) || {}).url || '';
    const inWs = !!(CF() && CF().inWorkspace(g.rep.captureId));
    const row = (act, ic, label, cls) =>
      `<div class="fm-row${cls ? ' ' + cls : ''}" data-act="${act}"><span class="fm-ic">${ic}</span><span class="fm-name">${label}</span></div>`;
    cardMenu.innerHTML =
      (g.rep.url ? row('open', CM_IC.open, MSG.tipOpen) : '') +
      row('edit', CM_IC.edit, MSG.tipEdit) +
      row('tagmode', CM_IC.wizard, MSG.tagStart) +
      row('folder', CM_IC.folder, MSG.tipFolder) +
      (CF() ? row('ws', CM_IC.ws, inWs ? MSG.ctxWsRemove : MSG.ctxWsAdd) : '') +
      row('info', CM_IC.info, MSG.tipInfo) +
      (cardMenuSrcUrl ? '<div class="fm-sep"></div>' + row('sauce', CM_IC.sauce, MSG.detailSauce) + row('ascii', CM_IC.sauce, MSG.detailAscii) : '') +
      '<div class="fm-sep"></div>' +
      row('delete', CM_IC.del, MSG.tipDelete, 'fm-danger');
    cardMenu.style.left = x + 'px';
    cardMenu.style.top = y + 'px';
    cardMenu.classList.add('show');
    const r = cardMenu.getBoundingClientRect();   // clamp into the viewport
    if (r.right > innerWidth - 8) cardMenu.style.left = Math.max(8, innerWidth - r.width - 8) + 'px';
    if (r.bottom > innerHeight - 8) cardMenu.style.top = Math.max(8, innerHeight - r.height - 8) + 'px';
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
    else if (act === 'edit') openEditOverlay(g.rep, g.records);
    else if (act === 'tagmode') { if (taggingApi) taggingApi.enter(); }
    else if (act === 'folder') showFoldMenu(g, pos.left, pos.top);
    else if (act === 'ws') { const b = document.querySelector(`.ws-btn[data-ws="${viewGroups.indexOf(g)}"]`); if (b) b.click(); }
    else if (act === 'info') showDetail(g);
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
    const state = new Map(activeFilters.filter(f => f.type === 'folder').map(f => [f.value, f.mode === 'and' ? 'and' : 'or']));
    host.innerHTML = list.map(f => {
      const n = f.items.filter(c => existing.has(c)).length;
      const st = state.get(f.id);
      const cls = st ? (st === 'and' ? ' active and' : ' active') : '';
      return `<button class="sb-chip${cls}" data-fid="${escapeAttr(f.id)}" title="${MSG.tipTagCycle}">${st === 'and' ? '＋' : ''}${escapeHtml(f.name)}<span class="iv-tagn">${n}</span></button>`;
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
    if (existIdx < 0) addFilter({ type: 'folder', value: fid, mode: 'or' });
    else removeFilter(existIdx);
    renderPostFolders();
  });
  document.getElementById('postFolderManage')?.addEventListener('click', () => { if (CF()) CF().openManager(); });

  // Workspace: chip toggles a "show only the tray" filter; 空にする empties the
  // tray itself (confirmed — it reads nothing like removing the filter).
  (function setupWorkspaceSidebar() {
    const row = document.getElementById('wsRow');
    const clear = document.getElementById('wsClear');
    if (row) row.addEventListener('click', () => {
      const idx = activeFilters.findIndex(f => f.type === 'workspace');
      if (idx < 0) addFilter({ type: 'workspace', value: '*', mode: 'or' });
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
    renderPosts(true);   // keepLimit: no scroll-window reset, no entrance-anim replay
    updateSelectionBar();
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
    renderPosts(true);
    reconcileFolders();   // 削除した captureId をフォルダから即時掃除
    renderPostFolders();
    showToast(MSG.deleted);
  }

  // === Tagging mode (2-axis: card edit ↔ stamp). Replaces the old wizard.
  // A slim toolbar above the grid toggles between two ways to tag:
  //   • card edit — click a card → edit that ONE card's tags (1 image → many tags)
  //   • stamp     — load ONE tag, then click cards to apply/remove it across many
  //                 (1 tag → many images, Lightroom painter style)
  // Filtering stays live underneath: narrow the set first, then stamp across it. ===
  (function setupTagging() {
    const bar = document.getElementById('tagBar');
    if (!bar) return;
    const postGrid = document.getElementById('postGrid');
    const postActiveBar = document.getElementById('postActiveBar');
    const editBtn = document.getElementById('tagAxisEditBtn');
    const stampBtn = document.getElementById('tagAxisStampBtn');
    const palette = document.getElementById('tagPalette');
    const loadedLabel = document.getElementById('tagLoadedLabel');
    const newForm = document.getElementById('tagNewForm');
    const newToggle = document.getElementById('tagNewToggle');
    const newInput = document.getElementById('tagNewInput');
    const newGroup = document.getElementById('tagNewGroup');
    const newGroupName = document.getElementById('tagNewGroupName');
    const newAdd = document.getElementById('tagNewAdd');
    const doneBtn = document.getElementById('tagDoneBtn');
    const startBtn = document.getElementById('tagStartBtn');

    const AXIS_KEY = 'corpus.tagAxis';
    let active = false;
    let axis = localStorage.getItem(AXIS_KEY) === 'edit' ? 'edit' : 'stamp';
    let loaded = null;   // the loaded stamp tag (stamp axis)

    // --- static labels ---
    const setT = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setT('tagStartLabel', MSG.tagStart);
    setT('tagBarBadgeText', MSG.tagBarBadge);
    setT('tagEditHint', MSG.tagAxisEditHint);
    editBtn.textContent = MSG.tagAxisEdit;
    stampBtn.textContent = MSG.tagAxisStamp;
    editBtn.title = MSG.tagAxisEditHint;
    stampBtn.title = MSG.tagAxisStampHint;
    newAdd.textContent = MSG.tagAddBtn;
    doneBtn.textContent = MSG.tagDone;
    newInput.placeholder = MSG.tagNewName;
    newGroupName.placeholder = MSG.tagNewGroupName;
    newToggle.setAttribute('aria-label', MSG.tagNewName);
    newToggle.title = MSG.tagNewName;

    // The new-tag form takes over the stamp zone (palette + loaded label hide):
    // it's create OR browse, never both — so the row never overflows.
    function setNewForm(show) {
      newForm.style.display = show ? 'flex' : 'none';
      palette.style.display = show ? 'none' : 'flex';
      loadedLabel.style.display = show ? 'none' : '';
      newToggle.classList.toggle('on', show);
      if (show) newInput.focus();
      updateLayout();
    }

    // Every tag in the library (applied to posts + defined in groups), ja-sorted.
    function allTagsSorted() {
      const set = new Set();
      for (const p of allPosts) for (const t of (Array.isArray(p.tags) ? p.tags : [])) set.add(t);
      for (const g of tagGroups) for (const t of (g.tags || [])) set.add(t);
      return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
    }

    function renderPalette() {
      const tags = allTagsSorted();
      palette.innerHTML = tags.length
        ? tags.map((t) => `<button class="tag-pal-chip${t === loaded ? ' loaded' : ''}" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</button>`).join('')
        : `<span class="tag-pal-empty">${escapeHtml(MSG.tagNoTags)}</span>`;
    }
    function renderGroupSelect() {
      newGroup.innerHTML =
        `<option value="">${escapeHtml(MSG.tagNoGroup)}</option>` +
        tagGroups.map((g) => `<option value="${escapeAttr(g.id)}">${escapeHtml(g.name)}</option>`).join('') +
        `<option value="__new">${escapeHtml(MSG.tagNewGroup)}</option>`;
      newGroupName.style.display = 'none';
    }
    function updateLoadedLabel() {
      loadedLabel.innerHTML = loaded
        ? `${escapeHtml(MSG.tagLoaded)} <b>${escapeHtml(loaded)}</b>`
        : escapeHtml(MSG.tagPickToLoad);
    }
    function loadTag(t) { loaded = t || null; updateLoadedLabel(); renderPalette(); refreshMarks(); }

    function applyAxis() {
      document.body.classList.toggle('tagging-stamp', axis === 'stamp');
      document.body.classList.toggle('tagging-edit', axis === 'edit');
      editBtn.classList.toggle('active', axis === 'edit');
      stampBtn.classList.toggle('active', axis === 'stamp');
    }
    function setAxis(a) {
      axis = a === 'edit' ? 'edit' : 'stamp';
      try { localStorage.setItem(AXIS_KEY, axis); } catch { /* ignore */ }
      applyAxis();
      refreshMarks();
    }

    // The tag bar and the active-filter bar are two stacked sticky bands. When
    // no filter is active the filter band is hidden, so THIS band becomes the
    // bottom one (gap before grid + corner fillet via the --solo class).
    function updateLayout() {
      if (!active) return;
      document.documentElement.style.setProperty('--tagbar-h', bar.offsetHeight + 'px');
      const abHidden = getComputedStyle(postActiveBar).display === 'none';
      bar.classList.toggle('tag-bar--solo', abHidden);
    }
    // Ring + ✓ marker on cards that already carry the loaded stamp.
    function refreshMarks() {
      if (!active) return;
      updateLayout();
      postGrid.querySelectorAll('.post-card').forEach((card) => {
        const g = viewGroups[parseInt(card.dataset.index, 10)];
        const on = !!(axis === 'stamp' && loaded && g && g.records.length &&
          g.records.every((r) => (r.tags || []).includes(loaded)));
        card.classList.toggle('stamp-on', on);
      });
    }
    function clearMarks() { postGrid.querySelectorAll('.post-card.stamp-on').forEach((c) => c.classList.remove('stamp-on')); }

    // Refresh just one card's bottom tag chips after a stamp (no full re-render).
    function updateCardTagLabel(cardEl, g) {
      const meta = cardEl.querySelector('.post-meta'); if (!meta) return;
      let label = meta.querySelector('.tags-label');
      const tags = g.rep.tags || [];
      if (!tags.length) { if (label) label.remove(); return; }
      const html = tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');
      if (label) label.innerHTML = html;
      else { label = document.createElement('div'); label.className = 'tags-label'; label.innerHTML = html; meta.appendChild(label); }
    }

    // Toggle the loaded tag on every record of a group (additive: other tags stay).
    async function stampCard(cardEl, g) {
      if (!loaded) { showToast(MSG.tagPickToLoad); return; }
      const recs = g.records;
      const has = recs.length > 0 && recs.every((r) => (r.tags || []).includes(loaded));
      const undoRecords = recs.map((r) => {
        const prev = (r.tags || []).slice();
        const next = has ? prev.filter((t) => t !== loaded) : [...new Set([...prev, loaded])];
        return { captureId: r.captureId, image: r.image || r.video, prevTags: prev, newTags: next };
      });
      for (const u of undoRecords) {
        try { await window.corpus.updateTags(u.image, u.newTags); } catch { /* keep going */ }
        const r = recs.find((x) => x.captureId === u.captureId); if (r) r.tags = u.newTags.slice();
        const i = allPosts.findIndex((p) => p.captureId === u.captureId); if (i >= 0) allPosts[i].tags = u.newTags.slice();
      }
      pushUndo('tags', undoRecords);
      if (cardEl) { cardEl.classList.toggle('stamp-on', !has); updateCardTagLabel(cardEl, g); }
      if (!has && cardEl) { const r = cardEl.getBoundingClientRect(); celebrate(r.left + r.width / 2, r.top + r.height / 2); }
      showToast(has ? MSG.tagStampedOff(loaded) : MSG.tagStampedOn(loaded));
    }

    // Create a tag (optionally into a group / a new group), then load it as the stamp.
    async function createTag() {
      const v = (newInput.value || '').trim(); if (!v) return;
      const choice = newGroup.value;
      let changed = false;
      if (choice === '__new') {
        const name = (newGroupName.value || '').trim();
        if (name) { tagGroups.push({ id: 'g' + Date.now().toString(36), name, tags: [v] }); changed = true; }
      } else if (choice) {
        const grp = tagGroups.find((g) => g.id === choice);
        if (grp) { grp.tags = grp.tags || []; if (!grp.tags.includes(v)) { grp.tags.push(v); changed = true; } }
      }
      if (changed && window.corpus.setTagGroups) { try { await window.corpus.setTagGroups(tagGroups); } catch { /* best-effort */ } }
      newInput.value = ''; newGroupName.value = '';
      renderGroupSelect();
      setNewForm(false);   // collapse back to the palette
      loadTag(v);
      if (typeof updateSidebarTagGroups === 'function') updateSidebarTagGroups();
    }

    function enter(a) {
      if (a === 'edit' || a === 'stamp') setAxis(a); else applyAxis();
      active = true;
      if (selectedSet.size) clearSelection();
      bar.style.display = 'flex';
      document.body.classList.add('tagging');
      setNewForm(false);
      renderPalette();
      renderGroupSelect();
      updateLoadedLabel();
      refreshMarks();
      updateLayout();
    }
    function exit() {
      active = false;
      bar.style.display = 'none';
      document.body.classList.remove('tagging', 'tagging-stamp', 'tagging-edit');
      clearMarks();
      renderPosts(true);   // reconcile filter matching after edits
    }

    // --- events ---
    if (startBtn) startBtn.addEventListener('click', () => { if (active) exit(); else enter(); });
    editBtn.addEventListener('click', () => setAxis('edit'));
    stampBtn.addEventListener('click', () => setAxis('stamp'));
    doneBtn.addEventListener('click', exit);
    palette.addEventListener('click', (e) => {
      const chip = e.target.closest('.tag-pal-chip'); if (!chip) return;
      const t = chip.dataset.tag;
      loadTag(t === loaded ? null : t);   // click the loaded chip again to unload
    });
    newAdd.addEventListener('click', createTag);
    newToggle.addEventListener('click', () => setNewForm(newForm.style.display === 'none'));
    newGroup.addEventListener('change', () => { newGroupName.style.display = newGroup.value === '__new' ? '' : 'none'; });
    [newInput, newGroupName].forEach((el) => el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); createTag(); }
    }));

    // Grid clicks while tagging: capture phase pre-empts gallery/text/select.
    // The corner buttons (ℹ info / ⚡ workspace) still work — we skip them.
    postGrid.addEventListener('click', (e) => {
      if (!active) return;
      if (e.target.closest('.info-btn, .ws-btn')) return;
      const card = e.target.closest('.post-card'); if (!card) return;
      e.preventDefault(); e.stopPropagation();
      const g = viewGroups[parseInt(card.dataset.index, 10)]; if (!g) return;
      if (axis === 'edit') openEditOverlay(g.rep, g.records);
      else stampCard(card, g);
    }, true);

    // Esc leaves tagging mode (unless the gallery / edit overlay is on top).
    document.addEventListener('keydown', (e) => {
      if (!active || e.key !== 'Escape') return;
      if (lightbox.classList.contains('show')) return;
      if (document.getElementById('editOverlay').classList.contains('show')) return;
      exit();
    });

    // Reflect the persisted axis on the (hidden) toggle WITHOUT touching body
    // classes — the tagging-stamp/edit body classes only exist while in the mode
    // (enter() adds them) so grid affordances never leak outside tagging.
    editBtn.classList.toggle('active', axis === 'edit');
    stampBtn.classList.toggle('active', axis === 'stamp');
    taggingApi = { enter, exit, isActive: () => active, getAxis: () => axis, refreshMarks };
  })();

  // === Inspector (ℹ on a card): persistent right column / slide-over ===
  function closeDetail() {
    document.getElementById('postDetail').hidden = true;
    document.getElementById('postDetailBox').innerHTML = '';
    inspectedKey = null;
    document.querySelectorAll('.post-card.inspected').forEach((el) => el.classList.remove('inspected'));
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
    const tags = (Array.isArray(p.hashtags) ? p.hashtags : []).concat(Array.isArray(p.tags) ? p.tags : []);
    const tagsHtml = tags.length
      ? `<div class="iv-insp-row"><span class="iv-insp-k">${escapeHtml(MSG.detailTags)}</span><span class="iv-insp-v"><div class="iv-insp-tags">${tags.map((t) => `<span class="iv-insp-tag">${escapeHtml(t)}</span>`).join('')}</div></span></div>`
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
      row(MSG.detailAuthor, p.displayName || '') +
      row(MSG.detailUser, p.screenName ? '@' + p.screenName : '') +
      row(MSG.detailEngagement, eng.join('   ')) +
      row(MSG.detailPosted, p.date ? new Date(p.date).toLocaleString() : '') +
      row(MSG.detailSaved, p.capturedAt ? new Date(p.capturedAt).toLocaleString() : '') +
      row(MSG.detailUpdated, p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '') +
      row(MSG.detailImages, g.files.length > 1 ? MSG.imagesCount(g.files.length) : '') +
      row(MSG.detailImageOf, (p.imageIndex && p.imageCount) ? MSG.imageOf(p.imageIndex, p.imageCount) : '') +
      tagsHtml +
      `<div class="iv-insp-actions">` +
      (p.url ? `<a class="iv-insp-open" id="pdOpen">${escapeHtml(MSG.detailOpen)} ↗</a>` : '') +
      `<a class="iv-insp-open" id="pdEdit">${escapeHtml(MSG.tipEdit)}</a>` +
      (srcImageUrl ? `<a class="iv-insp-open" id="pdSauce">${escapeHtml(MSG.detailSauce)} ↗</a>` : '') +
      (srcImageUrl ? `<a class="iv-insp-open" id="pdAscii">${escapeHtml(MSG.detailAscii)} ↗</a>` : '') +
      groupBtn +
      `</div>`;
    document.getElementById('postDetail').hidden = false;
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
    const ed = document.getElementById('pdEdit'); if (ed) ed.onclick = () => openEditOverlay(g.rep, g.records);
    const sa = document.getElementById('pdSauce'); if (sa) sa.onclick = () => window.corpus.openExternal('https://saucenao.com/search.php?url=' + encodeURIComponent(srcImageUrl));
    const as = document.getElementById('pdAscii'); if (as) as.onclick = () => window.corpus.openExternal('https://ascii2d.net/search/url/' + encodeURIComponent(srcImageUrl));
    const ug = document.getElementById('pdUngroup'); if (ug) ug.onclick = () => setGroupKey(gkey, true);
    const rg = document.getElementById('pdRegroup'); if (rg) rg.onclick = () => setGroupKey(gkey, false);
    const um = document.getElementById('pdUngroupManual'); if (um) um.onclick = () => ungroupManual(parseInt(String(g.key).split(':')[1], 10));
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
    if (taggingApi && taggingApi.isActive()) return;   // tagging mode owns grid clicks
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
    if (e.target.closest('.info-btn')) return;     // ℹ = swap to that card
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

  // --- Edit overlay logic ---
  // Editing a grouped card edits ALL its records (a group is one post in the UI).
  let editingPost = null;
  let editingRecords = [];
  let editTags = [];
  let editAdditive = false;   // true = bulk "タグを追加": merge into each record's tags

  function openEditOverlay(post, records) {
    editingPost = post;
    editingRecords = (records && records.length) ? records : [post];
    editTags = [...(post.tags || [])];
    editAdditive = false;
    document.getElementById('editTagsLabel').textContent = MSG.tagsLabel;
    document.getElementById('editTagInput').value = '';
    renderEditTags();
    document.getElementById('editOverlay').classList.add('show');
  }

  function renderEditTags() {
    const container = document.getElementById('editTagsList');
    container.innerHTML = editTags.map((t, i) =>
      `<span class="tag-chip" style="cursor:pointer;" data-remove-tag="${i}">${escapeHtml(t)} \u00d7</span>`
    ).join('');
  }

  document.getElementById('editTagsList').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-remove-tag]');
    if (!chip) return;
    editTags.splice(parseInt(chip.dataset.removeTag, 10), 1);
    renderEditTags();
  });

  document.getElementById('editTagAdd').addEventListener('click', () => {
    const input = document.getElementById('editTagInput');
    const tag = input.value.trim();
    if (tag && !editTags.includes(tag)) {
      editTags.push(tag);
      renderEditTags();
    }
    input.value = '';
    input.focus();
  });

  document.getElementById('editTagInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('editTagAdd').click();
    }
  });

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

  // Tasteful "祝祭" burst on tag save (X-like / YouTube-like). Indigo + warm gold +
  // near-white sparkles fly out from (cx,cy) and fade. Skipped for reduced-motion.
  function celebrate(cx, cy) {
    if (prefersReducedMotion()) return;
    const colors = ['var(--accent-soft)', '#e8a13a', 'var(--text-strong)'];
    const N = 12, parts = [];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < N; i++) {
      const p = document.createElement('i');
      p.className = 'celebrate-particle';
      const ang = (Math.PI * 2 * i) / N + Math.random() * 0.45;
      const dist = 30 + Math.random() * 34;
      const sz = (5 + Math.random() * 4).toFixed(1);
      p.style.left = cx + 'px'; p.style.top = cy + 'px';
      p.style.width = p.style.height = sz + 'px';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--tx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      p.style.setProperty('--ty', (Math.sin(ang) * dist).toFixed(1) + 'px');
      p.style.animationDuration = (520 + Math.random() * 200).toFixed(0) + 'ms';
      frag.appendChild(p); parts.push(p);
    }
    document.body.appendChild(frag);
    setTimeout(() => parts.forEach((p) => p.remove()), 900);
  }

  document.getElementById('editSave').addEventListener('click', async () => {
    if (!editingPost) return;
    const _sr = document.getElementById('editSave').getBoundingClientRect();   // burst origin (before overlay closes)
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
    renderPosts(true);   // keepLimit: selection (if any) stays put, no anim replay

    const n = editingRecords.length;
    editingPost = null;
    editingRecords = [];
    editAdditive = false;
    document.getElementById('editOverlay').classList.remove('show');
    showToast(n > 1 ? MSG.tagsSavedN(n) : MSG.tagsSaved);
    celebrate(_sr.left + _sr.width / 2, _sr.top + _sr.height / 2);
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
    renderPosts(true);
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
    clearSelection();   // re-renders the grid (now collapsed) + hides the bar
    showToast(MSG.grouped);
  });

  selectAllBtn.addEventListener('click', () => {
    const allSelected = viewGroups.every(g => selectedSet.has(postIdKey(g.rep)));
    if (allSelected) {
      selectedSet.clear();
    } else {
      viewGroups.forEach(g => selectedSet.add(postIdKey(g.rep)));
    }
    renderPosts(true);
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
    if (taggingApi && taggingApi.isActive()) return;   // tagging mode owns grid clicks
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
    if (taggingApi && taggingApi.isActive()) return;   // tagging mode owns grid clicks
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
  function positionViewThumb() {
    const vt = document.querySelector('.view-toggle');
    const btn = vt && vt.querySelector('button.active');
    const thumb = vt && vt.querySelector('.vt-thumb');
    if (!btn || !thumb || !btn.offsetWidth) return;
    thumb.style.width = btn.offsetWidth + 'px';
    thumb.style.left = btn.offsetLeft + 'px';
  }
  window.addEventListener('resize', positionViewThumb, { passive: true });
  // The sidebar gains/loses a scrollbar as content grows, which changes the
  // view-toggle's width WITHOUT a window resize — the thumb's measured px then
  // overran the now-narrower track (user: list switch "はみ出てる"). Re-measure
  // whenever the control's own box changes.
  { const _vt = document.querySelector('.view-toggle');
    if (_vt && window.ResizeObserver) new ResizeObserver(positionViewThumb).observe(_vt); }
  document.querySelectorAll('.view-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      positionViewThumb();   // slide the glass thumb
      window.corpus.setPref('viewMode', currentView);
      if (document.startViewTransition && !prefersReducedMotion()) {
        document.startViewTransition(() => renderPosts());
      } else {
        renderPosts();
      }
    });
  });

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
      document.querySelectorAll('.view-toggle button').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
    }
    positionViewThumb();   // place the glass thumb on the restored active button
    if (Number.isFinite(prefs.imageTileSize)) tileSize = Math.max(TILE_MIN, Math.min(TILE_MAX, prefs.imageTileSize));
    if (Number.isFinite(prefs.cardSize)) cardSize = Math.max(CARD_MIN, Math.min(CARD_MAX, prefs.cardSize));
    if (Number.isFinite(prefs.listThumb)) listThumb = Math.max(LIST_MIN, Math.min(LIST_MAX, prefs.listThumb));
    if (prefs.tileOverlay === false) {
      tileOverlay = false;
      document.getElementById('tileOverlayToggle').checked = false;
    }
    if (prefs.sortBy) { sortSelect.value = prefs.sortBy; refreshCustomSelects(); }
    skipDeleteConfirm = !!prefs.skipDeleteConfirm;
    resetDeleteConfirmCheckbox.checked = !skipDeleteConfirm;
    // Re-render once after applying the saved view mode + sort, so the initial
    // list reflects the persisted sort regardless of the prefs/loadPosts race.
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
    _searchRenderTimer = setTimeout(() => renderPosts(), 150);
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
      addFilter({ type: 'tag', value: it.value, mode: 'or' });
    } else if (it.kind === 'user') {
      addFilter({ type: 'user', value: it.value, label: it.label });
    } else {
      addFilter({ type: 'folder', value: it.value, mode: 'or' });
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
    window.corpus.setPref('sortBy', sortSelect.value);
    renderPosts();
  });

  // 検索方式トグル（通常 / あいまい）。corpusSearch がモードを集約し、両モードで共有する。
  const searchModeSel = document.getElementById('searchModeSel');
  function syncSearchToggle() {
    if (!searchModeSel || !window.corpusSearch) return;
    searchModeSel.value = window.corpusSearch.isFuzzy() ? 'fuzzy' : 'normal';
    searchModeSel.title = MSG.searchModeTitle;
    refreshCustomSelects();
  }
  if (searchModeSel && window.corpusSearch) {
    enhanceSelect(searchModeSel);
    searchModeSel.addEventListener('change', () => window.corpusSearch.setMode(searchModeSel.value));
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
    const fmtMirrorTime = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const now = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const hhmm = `${p(d.getHours())}:${p(d.getMinutes())}`;
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return hhmm;
      if ((+now - +d) < 2 * 86400000) return `昨 ${hhmm}`;
      return `${d.getMonth() + 1}/${d.getDate()}`;
    };
    function updateMirrorStatus() {
      const el = document.getElementById('mirrorStatus');
      if (!el) return;
      if (!cfg || !cfg.dir) { el.textContent = ''; el.className = 'mirror-status'; el.title = ''; return; }
      const r = cfg.lastResult;
      if (!r) { el.textContent = ''; el.title = ''; return; }
      if (r.ok === false && r.error) {
        el.textContent = '⚠'; el.className = 'mirror-status is-error'; el.title = r.error; return;
      }
      el.className = 'mirror-status';
      const t = fmtMirrorTime(r.at);
      el.textContent = t ? `↑ ${t}` : '';
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

    if (window.corpus.onBackupDone) {
      window.corpus.onBackupDone((_e, r) => { if (cfg && r) { cfg.lastResult = r; renderStatus(); } });
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

  // --- Export HTML builder ---
  function buildExportHtml(postsData) {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>Corpus Export</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.6 -apple-system,'Segoe UI',sans-serif;background:#f5f5f5;color:#333;padding:24px 32px;max-width:960px;margin:0 auto}
h1{font-size:20px;font-weight:600;margin-bottom:16px}
.toolbar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.search-box{flex:1;min-width:200px;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;outline:none}
.search-box:focus{border-color:#1d9bf0}
select{padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:13px;background:#fff;cursor:pointer}
.count{font-size:12px;color:#999;align-self:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);cursor:pointer;transition:box-shadow .15s}
.card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.12)}
.card img{width:100%;display:block;max-height:300px;object-fit:cover}
.meta{padding:12px}
.meta .user{font-weight:600;font-size:13px;margin-bottom:4px;display:flex;align-items:center;gap:6px}
.badge{font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;color:#fff;text-transform:uppercase}
.badge.x{background:#000}.badge.bluesky{background:#0085ff}.badge.misskey{background:#96d04a;color:#333}.badge.mastodon{background:#6364ff}.badge.pixiv{background:#0096fa}
.meta .text{font-size:13px;color:#555;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:6px}
.meta .stats{display:flex;gap:12px;font-size:12px;color:#999}
.meta .date{font-size:11px;color:#bbb;margin-top:4px}
.empty{text-align:center;padding:60px 20px;color:#999}
</style>
</head>
<body>
<h1>Corpus Export</h1>
<div class="toolbar">
<input type="text" class="search-box" id="q" placeholder="Search...">
<select id="sort">
<option value="date-desc">Newest</option>
<option value="date-asc">Oldest</option>
<option value="likes">Likes</option>
</select>
<select id="pf">
<option value="all">All</option>
<option value="x">X</option>
<option value="bluesky">Bluesky</option>
<option value="misskey">Misskey</option>
<option value="mastodon">Mastodon</option>
<option value="pixiv">pixiv</option>
</select>
<span class="count" id="cnt"></span>
</div>
<div class="grid" id="g"></div>
<div class="empty" id="e" style="display:none"></div>
<script id="corpusData" type="application/json">${JSON.stringify(postsData).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))}</script>
<script>
(function(){
var posts=JSON.parse(document.getElementById('corpusData').textContent);
var q=document.getElementById('q'),s=document.getElementById('sort'),pf=document.getElementById('pf');
function esc(t){return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function fmt(n){return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e4?(n/1e3).toFixed(1)+'K':String(n)}
function fmtDate(d){if(!d)return'';var dt=new Date(d);return dt.toLocaleDateString()+' '+dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
function render(){
var fp=posts.slice(),qv=q.value.trim().toLowerCase(),pv=pf.value,sv=s.value;
if(qv)fp=fp.filter(function(p){return(p.text||'').toLowerCase().indexOf(qv)>=0||(p.screenName||'').toLowerCase().indexOf(qv)>=0||(p.displayName||'').toLowerCase().indexOf(qv)>=0});
if(pv!=='all')fp=fp.filter(function(p){return p.platform===pv});
if(sv==='date-desc')fp.sort(function(a,b){return new Date(b.date||0)-new Date(a.date||0)});
else if(sv==='date-asc')fp.sort(function(a,b){return new Date(a.date||0)-new Date(b.date||0)});
else if(sv==='likes')fp.sort(function(a,b){return(b.likes||0)-(a.likes||0)});
document.getElementById('cnt').textContent=fp.length+' posts';
var g=document.getElementById('g'),e=document.getElementById('e');
if(!fp.length){g.innerHTML='';g.style.display='none';e.style.display='block';e.innerHTML='<p>No results</p>';return}
g.style.display='grid';e.style.display='none';
g.innerHTML=fp.map(function(p){
var st=[];
if(p.likes!=null)st.push('\\u2764 '+fmt(p.likes));
if(p.reposts!=null)st.push('\\ud83d\\udd01 '+fmt(p.reposts));
if(p.replies!=null)st.push('\\ud83d\\udcac '+fmt(p.replies));
return '<div class="card" data-url="'+esc(p.url||'')+'">'
+(p.image?'<img src="'+p.image+'" loading="lazy">':'')
+'<div class="meta"><div class="user"><span class="badge '+(p.platform||'')+'">'+(p.platform||'').toUpperCase()+'</span>'+esc(p.displayName||p.screenName||'')
+(p.screenName?' <span style="color:#999;font-weight:400">@'+esc(p.screenName)+'</span>':'')
+'</div>'+((p.text||p.title)?'<div class="text">'+esc(p.text||p.title)+'</div>':'')
+'<div class="stats">'+st.join(' &middot; ')+'</div>'
+'<div class="date">'+fmtDate(p.date)+'</div></div></div>'
}).join('')}
q.addEventListener('input',render);s.addEventListener('change',render);pf.addEventListener('change',render);
document.getElementById('g').addEventListener('click',function(e){var c=e.target.closest('.card');if(!c)return;var u=c.getAttribute('data-url')||'';if(/^https?:\\/\\//i.test(u))window.open(u,'_blank','noopener')});
render()
})();
</script>
</body>
</html>`;
  }

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

  function formatExportDate() {
    const d = new Date();
    return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function buildFilename(post, index) {
    const dateStr = post.date ? formatFilenameDate(post.date) : 'unknown-date';
    return index > 0 ? `${dateStr} (${index})` : dateStr;
  }

  function formatFilenameDate(isoStr) {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return 'unknown-date';
    return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
  }

  function escapeHtml(str) { return window.corpusUI.escapeHtml(str); }

  // escapeHtml (textContent->innerHTML) does NOT escape quotes, so it is unsafe
  // inside a double-quoted attribute (a `"` in API-sourced text would break out).
  // Use this for any attribute value built from post content.
  function escapeAttr(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  // Delegates to the shared glass toast (ui.js). Was a dynamically-created solid
  // #333 #toast; unified to #ivToast so viewer + folders share one look.
  function showToast(msg) { return window.corpusUI.notify(msg); }

  // --- Init ---
  // Shared folder changes: refresh chips on any change; re-render cards (📁 states)
  // when the folder list/default changes.
  if (CF()) CF().onChange((kind) => {
    // 絞り込み中のフォルダが削除されたらそのフィルタを除去（一覧が原因不明に空になるのを防ぐ）。
    const before = activeFilters.length;
    activeFilters = activeFilters.filter((f) => f.type !== 'folder' || CF().byId(f.value));
    if (activeFilters.length !== before) renderQueryChips();
    renderPostFolders();
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
  try { const r = window.corpus.getManualGroups ? await window.corpus.getManualGroups() : null; manualGroups = (r && r.groups) || []; } catch { /* default empty */ }
  try { const r = window.corpus.getTagGroups ? await window.corpus.getTagGroups() : null; tagGroups = (r && r.groups) || []; } catch { /* default empty */ }
  await initTabs();
  loadPosts();
})();
