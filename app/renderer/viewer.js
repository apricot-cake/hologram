(async () => {
  // --- i18n ---
  // Messages live in i18n.js (loaded before this script via viewer.html).
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
    ctxSetDefault: _s('ctxSetDefault'),
    ctxManage: _s('ctxManage'),
    qcAndLabel: _s('qcAndLabel'),
    qcOrLabel: _s('qcOrLabel'),
    qcJoinAnd: _s('qcJoinAnd'),
    qcJoinOr: _s('qcJoinOr'),
    tipJoin: _s('tipJoin'),
    tileOverlay: _s('tileOverlay'),
    histBack: _s('histBack'),
    histFwd: _s('histFwd'),
    qcDropHere: _s('qcDropHere'),
    qcDropMove: _s('qcDropMove'),
    qbHelpTitle: _s('qbHelpTitle'),
    qbHelp1: _s('qbHelp1'),
    qbHelp2: _s('qbHelp2'),
    qbHelp3: _s('qbHelp3'),
    qbHelp4: _s('qbHelp4'),
    qbHelp5: _s('qbHelp5'),
    tagGroupsTitle: _s('tagGroupsTitle'),
    tipZone: _s('tipZone'),
    qfAdd: _s('qfAdd'),
    qfCatFolder: _s('qfCatFolder'),
    sbTopTip: _s('sbTopTip'),
    ungroupDone: _s('ungroupDone'),
    tagGroupOther: _s('tagGroupOther'),
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
    imagesCount: _f1('imagesCount'),
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
    saveFolderTitle: _s('saveFolderTitle'),
    chooseFolder: _s('chooseFolder'),
    hintSaveFolder: _s('hintSaveFolder'),

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
    unitYear: _s('unitYear'),
    backupRunNow: _s('backupRunNow'),
    backupRunning: _s('backupRunning'),
    backupNotSet: _s('backupNotSet'),
    backupOverlap: _s('backupOverlap'),
    backupLastLabel: _s('backupLastLabel'),
    backupItemsUnit: _s('backupItemsUnit'),
    backupSkipLabel: _s('backupSkipLabel'),

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
    statsNote: _s('statsNote'),

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
    qfInstance: _s('qfInstance'),
    qfPost: _s('qfPost'),
    qfReply: _s('qfReply'),
    qfQuote: _s('qfQuote'),
    qfThread: _s('qfThread'),
    qfImage: _s('qfImage'),
    qfVideo: _s('qfVideo'),
    qfGif: _s('qfGif'),
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
    searchModeTitle: _s('searchModeTitle')
  };

  // --- Apply i18n to static elements ---
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const setAttr = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };

  setText('settingsViewTitle', MSG.tabSettings);
  setAttr('settingsBtn', 'title', MSG.tabSettings);
  setAttr('settingsBtn', 'aria-label', MSG.tabSettings);
  setText('sbAuthorTitle', MSG.sidebarAuthors);
  setAttr('searchBox', 'placeholder', MSG.searchPlaceholder);
  setAttr('sbTagSearch', 'placeholder', MSG.searchTags);
  setAttr('sbAuthorSearch', 'placeholder', MSG.searchAuthors);
  setText('viewCard', MSG.viewCard);
  setText('viewTile', MSG.viewTile);
  setText('viewList', MSG.viewList);
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
  setText('unitYear', MSG.unitYear);
  setText('settingsDangerTitle', MSG.dangerTitle);
  setText('labelResetDeleteConfirm', MSG.labelResetDeleteConfirm);
  setText('hintResetDeleteConfirm', MSG.hintResetDeleteConfirm);
  setText('clearData', MSG.clearData);
  setText('confirmCancel', MSG.confirmCancel);
  setText('confirmOk', MSG.confirmOk);
  setText('settingsStatus', MSG.saved);
  setText('statsNote', MSG.statsNote);
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
  setText('sbPinTitle', MSG.pinnedTags);
  setText('sbGroupTitle', MSG.tagGroupsTitle);
  setText('tileOverlayLabel', MSG.tileOverlay);
  document.getElementById('histBack').title = MSG.histBack;
  document.getElementById('histFwd').title = MSG.histFwd;
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

  // --- Query Field ---
  const ENG_TYPE_LABELS = {
    likes: MSG.qfEngLikes,
    reposts: MSG.qfEngReposts,
    replies: MSG.qfEngReplies,
    bookmarks: MSG.qfEngBookmarks,
    views: MSG.qfEngViews
  };

  function renderQueryChips() {
    const container = document.getElementById('queryChips');
    const bar = document.getElementById('postActiveBar');
    // クエリビルダ: 「かつ」「または」の2フィールドを常時表示し、全フィルタを
    // 要素（ピル）として配置。ピルはドラッグで他方のフィールドへ移動できる。
    // 式 = (かつフィールド) ⟨かつ/または⟩ (またはフィールド)。
    const sbEl = document.getElementById('searchBox');
    const searchVal = sbEl ? sbEl.value.trim() : '';
    // ビルダは常時表示（＋フィルタの入口を兼ねるため、空でもバーを出す）
    if (bar) bar.style.display = '';
    let special = '';
    if (searchVal) special += `<span class="sb-active-chip qc-search" data-special="search">\u{1F50D} ${escapeHtml(searchVal)}</span>`;
    const pill = (i, label, cls) => `<span class="sb-active-chip ${cls}" draggable="true" data-filter-idx="${i}">${escapeHtml(label)}</span>`;
    const andPills = [];
    const orPills = [];
    activeFilters.forEach((f, i) => {
      let label = '';
      const cls = `qc-${f.type}`;
      switch (f.type) {
        case 'kind':
          label = f.value === 'post' ? MSG.kindPost : MSG.kindImage;
          break;
        case 'platform':
          label = ({ x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' })[f.value] || f.value;
          break;
        case 'postType':
          label = f.value === 'post' ? MSG.qfPost : f.value === 'reply' ? MSG.qfReply : f.value === 'quote' ? MSG.qfQuote : MSG.qfThread;
          break;
        case 'date': {
          const typeName = f.dateField === 'capturedAt' ? MSG.qfDateCaptured : MSG.qfDatePost;
          const fromStr = f.from ? formatShortDate(f.from) : '';
          const toStr = f.to ? formatShortDate(f.to) : '';
          label = `${typeName}: ${fromStr}\u301C${toStr}`;
          break;
        }
        case 'engagement':
          label = `${ENG_TYPE_LABELS[f.engType] || f.engType} ${f.op === 'lte' ? '\u2264' : '\u2265'} ${formatCount(f.min)}`;
          break;
        case 'tag':
          label = `#${f.value}`;
          break;
        case 'folder': {
          const fobj = CF() && CF().byId(f.value);
          label = fobj ? fobj.name : f.value;
          break;
        }
        case 'media':
          label = f.value === 'image' ? MSG.qfImage : f.value === 'video' ? MSG.qfVideo : MSG.qfGif;
          break;
        case 'instance':
          label = f.value;
          break;
        case 'user':
          label = f.label || f.value;
          break;
      }
      (f.mode === 'or' ? orPills : andPills).push(pill(i, label, cls));
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
      return `<span class="qc-zone" data-zone="${name}" title="${MSG.tipZone}">` +
        `<span class="qc-zone-label">${escapeHtml(word)}</span>` + body + `</span>`;
    };
    const joinSel = `<select class="qc-join-sel" id="qcJoinSel" title="${MSG.tipJoin}">` +
      `<option value="and"${tagJoin !== 'or' ? ' selected' : ''}>${MSG.qcJoinAnd}</option>` +
      `<option value="or"${tagJoin === 'or' ? ' selected' : ''}>${MSG.qcJoinOr}</option></select>`;
    container.innerHTML = special +
      zone('and', andPills, orPills.length > 0) +
      joinSel +
      zone('or', orPills, andPills.length > 0);
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    const thisYear = new Date().getFullYear().toString();
    return y === thisYear ? `${parseInt(m)}/${parseInt(d)}` : `${y}/${parseInt(m)}/${parseInt(d)}`;
  }

  // --- Pinned tags (📌 ユーザーが明示的に選んだタグだけサイドバーに常駐) -------
  // 自動の「よく使うタグ」は中身が予測できず認知負荷が高い、という判断で
  // ピン留め式に置換。ピンが無ければセクションごと出ない。
  const PIN_KEY = 'corpus.pinnedTags';
  function loadPins() { try { return JSON.parse(localStorage.getItem(PIN_KEY)) || []; } catch { return []; } }
  function togglePin(tag) {
    const pins = loadPins();
    const i = pins.indexOf(tag);
    if (i >= 0) pins.splice(i, 1); else pins.push(tag);
    try { localStorage.setItem(PIN_KEY, JSON.stringify(pins)); } catch { /* quota — non-fatal */ }
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
  let qfTagGroup = null;   // tag flyout を特定グループに限定（'__other' = 未所属）
  let qfAnchor = null;     // 同じ行をもう一度押したら閉じる（トグル）
  function hideQfPop() { qfPop.classList.remove('show'); qfCat = null; qfTagGroup = null; qfAnchor = null; }
  const qfCatLabel = (id, fallback) => {
    const el = document.getElementById(id);
    return (el && el.textContent.trim()) || fallback;
  };
  function qfValues(cat) {
    const act = (type, v) => activeFilters.some(f => f.type === type && f.value === v);
    switch (cat) {
      case 'kind': return [['post', MSG.kindPost], ['image', MSG.kindImage]].map(([v, l]) => ({ v, l, on: act('kind', v) }));
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
      case 'media': return [['image', MSG.qfImage], ['video', MSG.qfVideo], ['gif', MSG.qfGif]].map(([v, l]) => ({ v, l, on: act('media', v) }));
      case 'tag': {
        let tags = [...new Set(allPosts.filter(p => p.url).flatMap(p => p.tags || []))].sort();
        if (qfTagGroup === '__other') {
          const grouped = new Set(tagGroups.flatMap(g => g.tags || []));
          tags = tags.filter(t => !grouped.has(t));
        } else if (qfTagGroup) {
          const g = tagGroups.find(g2 => g2.id === qfTagGroup);
          const own = new Set((g && g.tags) || []);
          tags = tags.filter(t => own.has(t));
        }
        return tags.map(t => ({ v: t, l: t, on: act('tag', t) }));
      }
      case 'folder': return (CF() ? CF().all() : []).map(f => ({ v: f.id, l: f.name, on: act('folder', f.id) }));
      case 'user': return buildUsers().sort((a, b) => b.count - a.count).slice(0, 100)
        .map(u => ({ v: u.key, l: u.displayName || u.screenName || '(unknown)', on: act('user', u.key) }));
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
  function qfHeading() {
    if (qfCat !== 'tag' || !qfTagGroup) {
      const ids = { kind: 'sbKindTitle', platform: 'sbPlatformTitle', postType: 'sbPostTypeTitle', media: 'sbMediaTitle', tag: 'sbTagTitle', user: 'sbAuthorTitle', instance: 'sbInstanceTitle' };
      if (qfCat === 'folder') return MSG.qfCatFolder;
      return qfCatLabel(ids[qfCat] || '', qfCat);
    }
    if (qfTagGroup === '__other') return MSG.tagGroupOther;
    const g = tagGroups.find(g2 => g2.id === qfTagGroup);
    return (g && g.name) || '';
  }
  function renderQfPop() {
    if (!qfCat) return;
    const items = qfValues(qfCat);
    // タグ行にはピン（留め/解除）を付ける — ピン済みは塗り・他はホバーで輪郭
    const pinned = qfCat === 'tag' ? new Set(loadPins()) : null;
    const PIN_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M9 3h6"/><path d="M10 3l-.6 6L7 12v2h10v-2l-2.4-3L14 3"/><path d="M12 14v7"/></svg>';
    const rowOf = (it) => `<div class="fm-row${it.sub ? ' fm-sub' : ''}" data-qfval="${escapeAttr(it.v)}"${it.type ? ` data-qftype="${it.type}"` : ''}><span class="fm-name">${escapeHtml(it.l)}</span>${it.on ? '<span class="fm-check">✓</span>' : ''}${pinned ? `<span class="qf-pin${pinned.has(it.v) ? ' on' : ''}" data-pinval="${escapeAttr(it.v)}" title="${MSG.tipPin}">${PIN_SVG}</span>` : ''}</div>`;
    const listHtml = items.map(rowOf).join('');
    // 長いリスト（タグ/作者など）はその場で絞り込める入力を付ける
    const find = items.length > 8 ? `<input type="text" class="qf-find" id="qfFind" placeholder="${MSG.qfFindPh}" autocomplete="off">` : '';
    qfPop.innerHTML = `<div class="fm-row qf-back">${escapeHtml(qfHeading())}</div>` +
      find +
      `<div class="qf-vals">` + (listHtml || `<div class="qf-zone-empty" style="padding:6px 8px;">—</div>`) + `</div>`;
    const fi = document.getElementById('qfFind');
    if (fi) setTimeout(() => fi.focus(), 0);
  }
  // 値リストの絞り込み（再描画せず行の表示/非表示だけ切替＝入力フォーカス維持）
  qfPop.addEventListener('input', (e) => {
    if (!e.target.classList.contains('qf-find')) return;
    const q = e.target.value.trim().toLowerCase();
    qfPop.querySelectorAll('.qf-vals .fm-row').forEach((row) => {
      row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
    qfPop.querySelectorAll('.qf-vals .qf-ghead').forEach((h) => { h.style.display = q ? 'none' : ''; });
  });
  // 行/グループボタンの横にフライアウトを開く（同じアンカー再クリックで閉じる）
  function showQfPopAt(cat, anchorEl, tagGroupId) {
    if (qfPop.classList.contains('show') && qfAnchor === anchorEl) { hideQfPop(); return; }
    qfCat = cat;
    qfTagGroup = tagGroupId || null;
    qfAnchor = anchorEl;
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
    // 📌 ピン留めトグル（行クリックの選択とは独立）
    const pin = e.target.closest('.qf-pin');
    if (pin) {
      togglePin(pin.dataset.pinval);
      renderQfPop();
      return;
    }
    const val = e.target.closest('[data-qfval]');
    if (val && qfCat) {
      const v = val.dataset.qfval;
      const vtype = val.dataset.qftype || qfCat;   // sub-rows (instances) override the type
      const i = activeFilters.findIndex(f => f.type === vtype && f.value === v);
      if (i >= 0) {
        removeFilter(i);
      } else if (vtype === 'tag' || vtype === 'folder') {
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
  document.getElementById('qbHelpBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (qbHelpPop.classList.contains('show')) { hideQbHelp(); return; }
    qbHelpPop.innerHTML = `<div class="qh-title">${escapeHtml(MSG.qbHelpTitle)}</div>` +
      [MSG.qbHelp1, MSG.qbHelp2, MSG.qbHelp3, MSG.qbHelp4, MSG.qbHelp5]
        .map((t) => `<div class="qh-row">${escapeHtml(t)}</div>`).join('');
    const r = e.currentTarget.getBoundingClientRect();
    qbHelpPop.style.left = r.left + 'px';
    qbHelpPop.style.top = (r.bottom + 6) + 'px';
    qbHelpPop.classList.add('show');
    const pr = qbHelpPop.getBoundingClientRect();
    if (pr.right > innerWidth - 8) qbHelpPop.style.left = Math.max(8, innerWidth - pr.width - 8) + 'px';
  });
  document.addEventListener('click', (e) => {
    if (qbHelpPop.classList.contains('show') && !qbHelpPop.contains(e.target) && !e.target.closest('#qbHelpBtn')) hideQbHelp();
  });
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
    const anchor = document.getElementById('sbDateTitle');
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

    popover.style.display = 'block';
    popover.style.top = (rect.bottom + 4) + 'px';
    popover.style.left = (rect.left) + 'px';
    popover.style.right = 'auto';
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
    const anchor = document.getElementById('sbEngTitle');
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
    popover.style.top = (rect.bottom + 4) + 'px';
    popover.style.left = (rect.left) + 'px';
    popover.style.right = 'auto';
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
  setText('sbKindPost', MSG.kindPost);
  setText('sbKindImage', MSG.kindImage);
  setText('multiOnlyLabel', MSG.multiOnly);
  setText('sbPlatformTitle', MSG.qfPlatform);
  setText('sbInstanceTitle', MSG.qfInstance);
  setText('sbPostTypeTitle', MSG.qfPostType);
  setText('sbMediaTitle', MSG.qfMedia);
  setText('sbDateTitle', MSG.qfDate);
  setText('sbEngTitle', MSG.qfEngagement);
  setText('sbTagTitle', MSG.qfTag);
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
    const row = e.target.closest('[data-qfrow]');
    if (!row) return;
    const cat = row.dataset.qfrow;
    if (cat === 'date') { hideQfPop(); openDatePopover(null); return; }
    if (cat === 'engagement') { hideQfPop(); openEngPopover(null); return; }
    showQfPopAt(cat, row);
  });

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
  function updateSidebarTags() {
    const pinHost = document.getElementById('sbPinnedTags');
    const groupHost = document.getElementById('sbTagGroupRows');
    if (!pinHost || !groupHost) return;
    // 投稿閲覧は url ありの投稿のみ対象。画像ライブラリ（url無し）のEagleタグを混ぜない。
    const allTags = [...new Set(allPosts.filter(p => p.url).flatMap(p => p.tags || []))].sort();
    if (!allTags.length) { pinHost.innerHTML = ''; groupHost.innerHTML = ''; return; }
    const tagState = new Map(activeFilters.filter(f => f.type === 'tag').map(f => [f.value, f.mode === 'and' ? 'and' : 'or']));
    const chip = (t) => {
      const st = tagState.get(t);
      const cls = st ? (st === 'and' ? ' active and' : ' active') : '';
      return `<button class="sb-chip${cls}" data-filter-type="tag" data-filter-value="${escapeHtml(t)}" title="${MSG.tipTagCycle}">${st === 'and' ? '＋' : ''}${escapeHtml(t)}</button>`;
    };
    // 📌 ピン留めタグ: ユーザーが明示的に選んだものだけ（無ければ見出しごと非表示）
    const pins = loadPins().filter((t) => allTags.includes(t));
    const pinTitle = document.getElementById('sbPinTitle');
    if (pinTitle) pinTitle.style.display = pins.length ? '' : 'none';
    pinHost.innerHTML = pins.map(chip).join('');
    // タググループ行: グループ内に存在するタグ数 ＋ 適用中なら active。
    const grouped = new Set();
    const rows = [];
    for (const g of tagGroups) {
      const own = (g.tags || []).filter((t) => allTags.includes(t));
      if (!own.length) continue;
      own.forEach((t) => grouped.add(t));
      const activeN = own.filter((t) => tagState.has(t)).length;
      rows.push(`<button class="sb-chip${activeN ? ' active' : ''}" data-tag-group="${escapeAttr(g.id)}">${escapeHtml(g.name || '')}<span class="iv-tagn">${own.length}</span><span class="sb-chip-arrow">▸</span></button>`);
    }
    const rest = allTags.filter((t) => !grouped.has(t));
    if (rest.length) {
      const activeN = rest.filter((t) => tagState.has(t)).length;
      rows.push(`<button class="sb-chip${activeN ? ' active' : ''}" data-tag-group="__other">${escapeHtml(MSG.tagGroupOther)}<span class="iv-tagn">${rest.length}</span><span class="sb-chip-arrow">▸</span></button>`);
    }
    groupHost.innerHTML = rows.join('');
    const groupTitle = document.getElementById('sbGroupTitle');
    if (groupTitle) groupTitle.style.display = rows.length ? '' : 'none';
  }
  document.getElementById('sbPinnedTags').addEventListener('click', (e) => {
    const chip = e.target.closest('.sb-chip[data-filter-value]');
    if (chip) toggleTagFilter(chip.dataset.filterValue);
  });
  // 右クリックでピン解除
  document.getElementById('sbPinnedTags').addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('.sb-chip[data-filter-value]');
    if (!chip) return;
    e.preventDefault();
    togglePin(chip.dataset.filterValue);
  });
  document.getElementById('sbTagGroupRows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag-group]');
    if (b) showQfPopAt('tag', b, b.dataset.tagGroup);
  });

  // --- State ---
  let allPosts = [];
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
  // Thumbnail width tracks the tile edge so larger tiles stay sharp (60px buckets).
  const tileThumbW = () => Math.min(960, Math.max(180, Math.ceil((tileSize * 1.4) / 60) * 60));
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
    scroller.addEventListener('scroll', () => {
      btn.style.display = scroller.scrollTop > 300 ? 'flex' : 'none';
    }, { passive: true });
    btn.addEventListener('click', () => scroller.scrollTo({ top: 0, behavior: 'smooth' }));
  })();

  // --- Authors (作者 row → flyout; derived from post author fields, no fetching) ---
  // Group posts by author. Posts arrive newest-first, so the first occurrence
  // carries the latest display name / handle for that user.
  function buildUsers() {
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
    return [...map.values()];
  }

  // --- Image source (served from the save folder via the psimg:// protocol) ---
  const imgSrc = (p) => (p.image ? 'psimg://img/' + encodeURIComponent(p.image) : '');
  // psimg URL for a bare filename; w>0 asks main for a downscaled thumbnail (tiles).
  const fileSrc = (file, w) => (file ? 'psimg://img/' + encodeURIComponent(file) + (w ? ('?w=' + w) : '') : '');

  // Per-density image source. A post may carry both a capture (screenshot) and
  // real media/artwork; the density decides which leads:
  //   tile → artwork preferred (clean image grid), capture as fallback
  //   card / list → capture preferred (the post as it looked), artwork as fallback
  const SS_EXT = /\.jpe?g$/i;
  const mediaFilesOf = (p) => (Array.isArray(p.media) ? p.media.filter((m) => m && m.file).map((m) => m.file) : []);
  // p.image is a screenshot unless it's a dragged/migrated artwork or a non-JPEG original.
  const isScreenshot = (p) => !!p.image && SS_EXT.test(p.image) && p.source !== 'drag' && p.source !== 'eagle-migration';
  const captureFile = (p) => (isScreenshot(p) ? p.image : '');
  const artworkFile = (p) => { const m = mediaFilesOf(p); if (m.length) return m[0]; return (p.image && !isScreenshot(p)) ? p.image : ''; };
  function densityImage(p, density) {
    const cap = captureFile(p), art = artworkFile(p);
    return density === 'tile' ? (art || cap) : (cap || art);
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
    const manualOf = new Map();   // captureId → 'manual:idx' (manual groups win)
    manualGroups.forEach((members, idx) => members.forEach((cid) => manualOf.set(cid, 'manual:' + idx)));
    let solo = 0;
    const base = list.map((p) => {
      let key;
      const mg = manualOf.get(p.captureId);
      if (mg) key = mg;
      else {
        const k = postKeyOf(p.url);
        key = (k && !ungrouped.has(k)) ? k : ('__solo' + (solo++));
      }
      return { p, key };
    });
    // Self-reply chains: a record replying (replyToId) to another record IN THE
    // LIBRARY by the SAME author joins that record's group, so リプ元＋セルフリプ
    // render as one card. The platform-local own-id is the last segment of the
    // post key (tweet id / rkey / note id / status id). Opt-outs (ungrouped)
    // suppress the merge for either side.
    const pidOf = (p) => { const k = postKeyOf(p.url); return k ? k.split(/[/:]/).pop() : null; };
    const idIndex = new Map();    // userId + '|' + ownPostId → entry
    for (const e of base) {
      const id = pidOf(e.p);
      if (id && e.p.userId) idIndex.set(e.p.userId + '|' + id, e);
    }
    const alias = new Map();      // child group key → parent group key
    for (const e of base) {
      const p = e.p;
      if (!p.replyToId || !p.userId) continue;
      const ownKey = postKeyOf(p.url);
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
  async function loadPosts() {
    const { posts } = await window.corpus.listPosts();
    allPosts = posts || [];
    stickyRecs.clear();   // 画面更新（再読込）でミューテーション生存分を整理
    renderPosts();
    reconcileFolders();
    renderPostFolders();
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
    const SINGLE_VALUED = ['kind', 'platform', 'user', 'instance', 'postType', 'media'];
    const predOf = (f) => {
      switch (f.type) {
        case 'kind': return (p) => (f.value === 'post') === isScreenshot(p);
        case 'platform': return (p) => p.platform === f.value;
        case 'user': return (p) => userKey(p) === f.value;
        case 'instance': return (p) => (p.platform === 'misskey' || p.platform === 'mastodon') && hostOf(p.url) === f.value;
        case 'postType': return (p) =>
          f.value === 'post' ? (!p.isReply && !p.isQuote && !p.isThread) :
          f.value === 'reply' ? !!p.isReply :
          f.value === 'quote' ? !!p.isQuote : !!p.isThread;
        case 'media': return (p) => p.mediaType === f.value;
        case 'tag': return (p) => (p.tags || []).includes(f.value);
        case 'folder': return (p) => !!(CF() && CF().has(f.value, p.captureId));
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


    // Sort (unchanged)
    switch (sort) {
      case 'date-desc': posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)); break;
      case 'date-asc': posts.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)); break;
      case 'likes-desc': posts.sort((a, b) => (b.likes || 0) - (a.likes || 0)); break;
      case 'reposts-desc': posts.sort((a, b) => (b.reposts || 0) - (a.reposts || 0)); break;
      case 'replies-desc': posts.sort((a, b) => (b.replies || 0) - (a.replies || 0)); break;
      case 'captured-desc': posts.sort((a, b) => (b.capturedAt || '').localeCompare(a.capturedAt || '')); break;
      case 'likes-pct': { const pct = percentileFn(posts); posts.sort((a, b) => pct(b) - pct(a)); break; }
    }

    return posts;
  }

  // --- Browser-style history over the filter & view state (back/forward) ---
  const histBackBtn = document.getElementById('histBack');
  const histFwdBtn = document.getElementById('histFwd');
  let viewHistory = [];
  let histIdx = -1;
  let restoringState = false;
  let lastHistPush = 0;
  function snapshotState() {
    return {
      f: JSON.parse(JSON.stringify(activeFilters)),
      join: tagJoin,
      search: document.getElementById('searchBox').value,
      sort: sortSelect.value,
      multi: multiOnly
    };
  }
  function updateHistButtons() {
    if (histBackBtn) histBackBtn.disabled = histIdx <= 0;
    if (histFwdBtn) histFwdBtn.disabled = histIdx >= viewHistory.length - 1;
  }
  // Called from every fresh renderPosts(). Captures the state AFTER the change;
  // rapid search typing coalesces into one entry instead of one per keystroke.
  function pushHistory() {
    if (restoringState) return;
    const snap = snapshotState();
    const ser = JSON.stringify(snap);
    if (histIdx >= 0 && JSON.stringify(viewHistory[histIdx]) === ser) return;
    const now = Date.now();
    // typing continuation (both entries already searching) replaces in place;
    // the FIRST keystroke still gets its own entry (so ← returns to no-search)
    if (histIdx >= 0 && now - lastHistPush < 900) {
      const prev = viewHistory[histIdx];
      if (prev.search && snap.search &&
          JSON.stringify({ ...prev, search: '' }) === JSON.stringify({ ...snap, search: '' })) {
        viewHistory[histIdx] = snap; lastHistPush = now; return;
      }
    }
    viewHistory = viewHistory.slice(0, histIdx + 1);
    viewHistory.push(snap);
    if (viewHistory.length > 100) viewHistory.shift();
    histIdx = viewHistory.length - 1;
    lastHistPush = now;
    updateHistButtons();
  }
  function applyState(s) {
    restoringState = true;
    activeFilters = JSON.parse(JSON.stringify(s.f));
    tagJoin = s.join;
    document.getElementById('searchBox').value = s.search;
    sortSelect.value = s.sort;
    multiOnly = !!s.multi;
    document.getElementById('multiOnly').checked = multiOnly;
    renderPostFolders();
    renderQueryChips();
    renderPosts();
    restoringState = false;
    updateHistButtons();
  }
  // Mutations (untag, unfold, ungroup) can make a visible card stop matching the
  // active filter. Instead of vanishing instantly, the card stays until the next
  // filter change / data refresh — call this BEFORE the mutation re-render.
  function keepCurrentVisible() {
    viewGroups.forEach((g) => g.records.forEach((r) => { if (r.captureId) stickyRecs.add(r.captureId); }));
  }

  function histGo(d) {
    const ni = histIdx + d;
    if (ni < 0 || ni >= viewHistory.length) return;
    histIdx = ni;
    applyState(viewHistory[histIdx]);
  }
  if (histBackBtn) histBackBtn.addEventListener('click', () => histGo(-1));
  if (histFwdBtn) histFwdBtn.addEventListener('click', () => histGo(1));
  // Alt+←/→ mirror the buttons (skipped while typing in a field)
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    histGo(e.key === 'ArrowLeft' ? -1 : 1);
  });

  const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function renderPosts(keepLimit) {
    if (!keepLimit) renderLimit = RENDER_PAGE;
    // A genuine filter/search/sort change drops the sticky survivors (they only
    // outlive in-place mutations, not user-driven view changes).
    if (!keepLimit && stickyRecs.size && histIdx >= 0 &&
        JSON.stringify(snapshotState()) !== JSON.stringify(viewHistory[histIdx])) {
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

    const noteEl = document.getElementById('statsNote');
    if (viewGroups.length === 0) {
      grid.innerHTML = '';
      grid.style.display = 'none';
      empty.style.display = 'block';
      if (noteEl) noteEl.style.display = 'none';
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
      if (!keepLimit) pushHistory();   // 0件の状態も履歴対象
      return;
    }

    grid.style.display = currentView === 'list' ? 'flex' : 'grid';
    grid.classList.toggle('list-view', currentView === 'list');
    grid.classList.toggle('tile-view', currentView === 'tile');
    applyTileLayout();
    empty.style.display = 'none';
    if (noteEl) noteEl.style.display = 'block';

    // Card entrance plays only on a fresh build (filter/sort/search), never on
    // load-more (keepLimit) — otherwise every already-visible card re-animates
    // on each scroll page. Skipped under prefers-reduced-motion.
    grid.classList.toggle('anim-in', !keepLimit && !prefersReducedMotion());
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
      const statsHtml = [
        p.likes != null ? `<span>\u2764 ${MSG.likes(p.likes)}</span>` : '',
        p.reposts != null ? `<span>\ud83d\udd01 ${MSG.reposts(p.reposts)}</span>` : '',
        p.replies != null ? `<span>\ud83d\udcac ${MSG.replies(p.replies)}</span>` : '',
        p.bookmarks != null ? `<span>\ud83d\udd16 ${MSG.bookmarks(p.bookmarks)}</span>` : ''
      ].filter(Boolean).join('');

      const dateStr = p.date ? MSG.postedOn(formatDate(p.date)) : '';
      const capturedStr = p.capturedAt ? MSG.captured(formatDate(p.capturedAt)) : '';
      const userName = p.displayName || p.screenName || p.title || '';
      const handle = p.screenName ? `@${p.screenName}` : '';
      const textPreview = escapeHtml(p.text || p.title || '');
      const imgFile = densityImage(p, currentView);   // tile: artwork→capture; card/list: capture→artwork
      const nImg = g.files.length;                    // ×N badge: total images across the group
      const likesOv = p.likes != null ? `<span class="ov-likes">❤ ${MSG.likes(p.likes)}</span>` : '';

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
      return `<div class="post-card${isSelected ? ' selected' : ''}" data-url="${escapeAttr(p.url || '')}" data-index="${i}" data-key="${escapeAttr(postKey)}">
        <div class="select-check" title="${MSG.tipSelect}"></div>
        <button class="fold-btn${CF() && CF().inDefault(p.captureId) ? ' in' : ''}" data-fold="${i}" title="${CF() && CF().defaultId() ? 'デフォルトフォルダに追加/解除（右クリックでフォルダ選択）' : 'フォルダを作成して追加（右クリックでフォルダ選択）'}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
        <button class="info-btn" data-info="${i}" title="${MSG.tipInfo}" aria-label="${MSG.tipInfo}">ℹ</button>
        <button class="edit-btn" data-edit="${i}" title="${MSG.tipEdit}" aria-label="${MSG.tipEdit}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>
        <button class="delete-btn" data-delete="${i}" title="${MSG.tipDelete}">&times;</button>
        ${p.url ? `<button class="open-btn" title="${MSG.tipOpen}" aria-label="${MSG.tipOpen}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>` : ''}
        ${imgFile ? `<img class="card-img" src="${fileSrc(imgFile, currentView === 'tile' ? tileThumbW() : 0)}" alt="" loading="lazy">` : (p.video ? '<div class="card-img card-video">▶</div>' : '')}
        ${nImg > 1 ? `<div class="card-ntag">×${nImg}</div>` : ''}
        <div class="card-overlay"><span class="ov-author">${escapeHtml(userName)}</span>${likesOv}</div>
        <div class="post-meta">
          <div class="user">
            <span class="platform-badge ${p.platform || ''}">${(p.platform || '').toUpperCase()}</span>
            ${escapeHtml(userName)}${handle ? ` <span style="color:#999;font-weight:400">${escapeHtml(handle)}</span>` : ''}
          </div>
          ${flagsHtml}
          ${textPreview ? `<div class="text">${textPreview}<span class="text-hint">${MSG.clickToExpand}</span></div>` : ''}
          <div class="stats">${statsHtml}</div>
          <div class="date">${dateStr}</div>
          ${capturedStr ? `<div class="date date-captured">${capturedStr}</div>` : ''}
          ${p.tags?.length ? `<div class="tags-label">${p.tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    // Load-more: render the next page when a bottom sentinel nears the viewport.
    if (moreObserver) { moreObserver.disconnect(); moreObserver = null; }
    if (viewGroups.length > renderLimit) {
      const sentinel = document.createElement('div');
      sentinel.style.cssText = 'grid-column:1/-1;width:100%;height:1px;';
      grid.appendChild(sentinel);
      moreObserver = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { renderLimit += RENDER_PAGE; renderPosts(true); }
      }, { rootMargin: '800px' });
      moreObserver.observe(sentinel);
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

    if (!keepLimit) pushHistory();   // capture the filter/view state for ←/→
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
    // Dedicated button -> jump to the source post.
    const openBtn = e.target.closest('.open-btn');
    if (openBtn) {
      e.stopPropagation();
      const url = openBtn.closest('.post-card')?.dataset.url;
      if (url) window.corpus.openExternal(url);
      return;
    }
    // Image -> open the gallery (screenshot + originals, whole group).
    // While the inspector is open, a single click swaps its content instead
    // (Eagle-style browsing); the gallery is then reached by double-click.
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

  // Edit button on card
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.edit-btn');
    if (!btn) return;
    e.stopPropagation();
    const g = viewGroups[parseInt(btn.dataset.edit, 10)];
    if (!g) return;
    openEditOverlay(g.rep, g.records);
  });

  // 📁 button on card: one-click add/remove this post to the default folder.
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.fold-btn');
    if (!btn) return;
    e.stopPropagation();
    if (!CF()) return;
    const g = viewGroups[parseInt(btn.dataset.fold, 10)];
    if (!g || !g.rep.captureId) return;
    keepCurrentVisible();   // removal can un-match an active folder filter
    const res = CF().toggleDefault(g.records.map((r) => r.captureId), g.rep.captureId);   // whole group; persists + toast + notify; null=no default→manager
    if (!res) return;
    btn.classList.toggle('in', res === 'added');
    if (res === 'added') { btn.classList.add('added'); setTimeout(() => btn.classList.remove('added'), 500); }
    // If any folder filter is active, membership changes can drop cards out of
    // the view — re-render so every card's data-index stays in sync.
    if (activeFilters.some((f) => f.type === 'folder')) {
      renderPosts();
    }
  });

  // Right-click on a card's 📁: context menu listing every folder — click a row
  // to add/remove THIS post (group) to that folder, ★ to make it the default.
  const foldMenu = document.createElement('div');
  foldMenu.className = 'fold-menu';
  document.body.appendChild(foldMenu);
  let foldMenuGroup = null;
  function hideFoldMenu() { foldMenu.classList.remove('show'); foldMenuGroup = null; }
  function showFoldMenu(g, x, y) {
    if (!CF()) return;
    foldMenuGroup = g;
    const list = CF().all();
    const def = CF().defaultId();
    const rep = g.rep.captureId;
    foldMenu.innerHTML = list.map((f) => {
      const inF = CF().has(f.id, rep);
      return `<div class="fm-row" data-fid="${escapeAttr(f.id)}">` +
        `<button class="fm-star${f.id === def ? ' on' : ''}" data-star="${escapeAttr(f.id)}" title="${MSG.ctxSetDefault}">★</button>` +
        `<span class="fm-name">${escapeHtml(f.name)}</span>` +
        (inF ? '<span class="fm-check">✓</span>' : '') +
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
  document.getElementById('postGrid').addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('.fold-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const g = viewGroups[parseInt(btn.dataset.fold, 10)];
    if (g) showFoldMenu(g, e.clientX, e.clientY);
  });
  foldMenu.addEventListener('click', (e) => {
    if (!CF()) { hideFoldMenu(); return; }
    const star = e.target.closest('.fm-star');
    if (star) {
      e.stopPropagation();
      CF().setDefault(star.dataset.star);
      renderPosts(true);   // 📁 'in' states reflect the new default
      hideFoldMenu();
      return;
    }
    if (e.target.closest('[data-manage]')) { hideFoldMenu(); CF().openManager(); return; }
    const row = e.target.closest('.fm-row[data-fid]');
    if (row && foldMenuGroup) {
      keepCurrentVisible();
      CF().toggleIn(row.dataset.fid, foldMenuGroup.records.map((r2) => r2.captureId), foldMenuGroup.rep.captureId);
      renderPosts(true);
    }
    hideFoldMenu();
  });
  document.addEventListener('click', (e) => { if (foldMenu.classList.contains('show') && !foldMenu.contains(e.target)) hideFoldMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideFoldMenu(); });

  // Sidebar folder chips (shared folders.json): count + ★default. Like tag chips
  // they cycle 解除→いずれか(OR)→＋すべて含む(AND)→解除 and join the same
  // かつ/または expression as the tags.
  function renderPostFolders() {
    const host = document.getElementById('postFolderChips');
    if (!host || !CF()) return;
    const list = CF().all();
    const def = CF().defaultId();
    const existing = new Set(allPosts.filter(p => p.url).map(p => p.captureId));
    if (!list.length) { host.innerHTML = '<span class="iv-folder-empty">なし</span>'; return; }
    const state = new Map(activeFilters.filter(f => f.type === 'folder').map(f => [f.value, f.mode === 'and' ? 'and' : 'or']));
    host.innerHTML = list.map(f => {
      const n = f.items.filter(c => existing.has(c)).length;
      const star = f.id === def ? '<span class="iv-foldstar" title="デフォルトフォルダ">★</span>' : '';
      const st = state.get(f.id);
      const cls = st ? (st === 'and' ? ' active and' : ' active') : '';
      return `<button class="sb-chip${cls}" data-fid="${escapeAttr(f.id)}" title="${MSG.tipTagCycle}">${st === 'and' ? '＋' : ''}${star}${escapeHtml(f.name)}<span class="iv-tagn">${n}</span></button>`;
    }).join('');
  }
  document.getElementById('postFolderChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.sb-chip');
    if (!chip) return;
    const fid = chip.dataset.fid;
    const existIdx = activeFilters.findIndex(f => f.type === 'folder' && f.value === fid);
    if (existIdx < 0) addFilter({ type: 'folder', value: fid, mode: 'or' });
    else removeFilter(existIdx);
    renderPostFolders();
  });
  document.getElementById('postFolderManage').addEventListener('click', () => { if (CF()) CF().openManager(); });

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

  // Delete button on card
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.delete-btn');
    if (!btn) return;
    e.stopPropagation();
    const g = viewGroups[parseInt(btn.dataset.delete, 10)];
    if (!g) return;

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
  });

  let pendingDeleteGroup = null;

  // Delete every record of the group (a group IS one post in the UI).
  async function executeDeleteGroup(g) {
    if (inspectedKey && g.records.some((r) => postIdKey(r) === inspectedKey)) closeDetail();
    for (const r of g.records) {
      try { await window.corpus.deletePost(r.image || r.video); } catch { /* keep going */ }
      const idx = allPosts.findIndex(p => p.captureId === r.captureId);
      if (idx >= 0) allPosts.splice(idx, 1);
    }
    renderPosts();
    reconcileFolders();   // 削除した captureId をフォルダから即時掃除
    renderPostFolders();
    showToast(MSG.deleted);
  }

  // === Inspector (ℹ on a card): persistent right column / slide-over ===
  function closeDetail() {
    document.getElementById('postDetail').hidden = true;
    document.getElementById('postDetailBox').innerHTML = '';
    inspectedKey = null;
    document.querySelectorAll('.post-card.inspected').forEach((el) => el.classList.remove('inspected'));
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
    renderPosts();
    if (ungroup) showToast(MSG.ungroupDone);
  }
  function ungroupManual(idx) {
    if (!(idx >= 0 && idx < manualGroups.length)) return;
    keepCurrentVisible();
    manualGroups.splice(idx, 1);
    persistManual();
    closeDetail();
    renderPosts();
    showToast(MSG.ungroupDone);
  }
  function showDetail(g) {
    if (!g) return;
    const p = g.rep;
    const box = document.getElementById('postDetailBox');
    const row = (k, v) => (v != null && v !== '') ? `<div class="iv-insp-row"><span class="iv-insp-k">${escapeHtml(k)}</span><span class="iv-insp-v">${escapeHtml(v)}</span></div>` : '';
    const eng = [];
    if (p.likes != null) eng.push('❤ ' + formatCount(p.likes));
    if (p.reposts != null) eng.push('🔁 ' + formatCount(p.reposts));
    if (p.replies != null) eng.push('💬 ' + formatCount(p.replies));
    if (p.bookmarks != null) eng.push('🔖 ' + formatCount(p.bookmarks));
    if (p.views != null) eng.push('👁 ' + formatCount(p.views));
    const tags = (Array.isArray(p.hashtags) ? p.hashtags : []).concat(Array.isArray(p.tags) ? p.tags : []);
    const tagsHtml = tags.length
      ? `<div class="iv-insp-row"><span class="iv-insp-k">${escapeHtml(MSG.detailTags)}</span><span class="iv-insp-v"><div class="iv-insp-tags">${tags.map((t) => `<span class="iv-insp-tag">${escapeHtml(t)}</span>`).join('')}</div></span></div>`
      : '';
    const heading = p.title || p.text || '';
    const thumbFile = g.files[0] || captureFile(p);
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
      groupBtn +
      `</div>`;
    document.getElementById('postDetail').hidden = false;
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
    if (document.querySelector('.confirm-overlay.show')) return;
    if (document.querySelector('.fold-menu.show')) return;
    const dp = document.getElementById('qfDatePopover');
    const ep = document.getElementById('qfEngPopover');
    if ((dp && dp.style.display === 'block') || (ep && ep.style.display === 'block')) return;
    closeDetail();
  }, true);
  // ℹ button on card → detail popup
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.info-btn');
    if (!btn) return;
    e.stopPropagation();
    showDetail(viewGroups[parseInt(btn.dataset.info, 10)]);
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

  document.getElementById('editSave').addEventListener('click', async () => {
    if (!editingPost) return;
    keepCurrentVisible();   // removing a tag can un-match an active tag filter
    const tags = [...editTags];

    // Persist to every record's sidecar, then update in memory.
    // Additive (bulk タグを追加): union with each record's existing tags;
    // normal edit: the list replaces the record's tags.
    for (const r of editingRecords) {
      const next = editAdditive ? [...new Set([...(r.tags || []), ...tags])] : tags;
      try { await window.corpus.updateTags(r.image || r.video, next); } catch { /* keep going */ }
      const idx = allPosts.findIndex(p => p.captureId === r.captureId);
      if (idx >= 0) allPosts[idx].tags = next;
    }
    renderPosts(true);   // keepLimit: selection (if any) stays put, no anim replay

    editingPost = null;
    editingRecords = [];
    editAdditive = false;
    document.getElementById('editOverlay').classList.remove('show');
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

  // フォルダに追加: add every selected record to the default folder (pure add,
  // no toggle). Without a default folder the manager opens, same as the 📁 button.
  folderSelectedBtn.addEventListener('click', () => {
    if (!CF()) return;
    const ids = selectedRecords().map((r) => r.captureId).filter(Boolean);
    if (!ids.length) return;
    if (CF().addToDefault(ids) == null) return;   // no default → manager opened
    renderPosts(true);                            // refresh 📁 'in' states
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
  document.querySelectorAll('.view-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      window.corpus.setPref('viewMode', currentView);
      renderPosts();
    });
  });

  // View-size slider — every density has one. The auto-fill grids (tile/card)
  // quantize the real width to "how many columns fit", so their track maps to
  // COLUMN COUNTS (one detent = exactly one column, no dead notches). The
  // list is a full-width stack, so its track maps straight to the thumbnail
  // px. Right = larger, Eagle/Lightroom style. While dragging only the CSS
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
    if (!commit) return;
    window.corpus.setPref(st.pref, st.get());
    renderPosts();   // re-request thumbnails at the new size
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
    const nBig = Math.max(1, Math.ceil((m.W + m.g) / (st.max + m.g)));
    const nSmall = Math.max(nBig, tileColsFor(st.min, m));   // many columns = small
    sl.min = String(nBig);
    sl.max = String(nSmall);
    sl.disabled = nBig === nSmall;
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
  // Window resizes change how many columns fit → re-derive the track range.
  let tileResizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(tileResizeT);
    tileResizeT = setTimeout(refreshTileSlider, 150);
  });

  document.getElementById('multiOnly').addEventListener('change', (e) => { multiOnly = e.target.checked; renderPosts(); });
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
    if (Number.isFinite(prefs.imageTileSize)) tileSize = Math.max(TILE_MIN, Math.min(TILE_MAX, prefs.imageTileSize));
    if (Number.isFinite(prefs.cardSize)) cardSize = Math.max(CARD_MIN, Math.min(CARD_MAX, prefs.cardSize));
    if (Number.isFinite(prefs.listThumb)) listThumb = Math.max(LIST_MIN, Math.min(LIST_MAX, prefs.listThumb));
    if (prefs.tileOverlay === false) {
      tileOverlay = false;
      document.getElementById('tileOverlayToggle').checked = false;
    }
    if (prefs.sortBy) sortSelect.value = prefs.sortBy;
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
  document.getElementById('searchBox').addEventListener('input', () => renderPosts());

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
    sb.addEventListener('input', () => { suggestIdx = -1; renderSuggest(); });
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
  }
  if (searchModeSel && window.corpusSearch) {
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
    function renderStatus() {
      if (!cfg || !cfg.dir) { statusEl.textContent = ''; return; }
      const r = cfg.lastResult;
      if (!r) { statusEl.textContent = ''; return; }
      let s = `${MSG.backupLastLabel} ${fmtTime(r.at)}`;
      if (r.written) s += `（${r.fileCount}${MSG.backupItemsUnit}）`;
      statusEl.textContent = s;
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
      await loadPosts();
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

  function formatDate(isoStr) {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

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

  function showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 24px;border-radius:8px;font-size:14px;z-index:99999;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
  }

  // --- Init ---
  // Shared folder changes: refresh chips on any change; re-render cards (📁 states)
  // when the folder list/default changes.
  if (CF()) CF().onChange((kind) => {
    // 絞り込み中のフォルダが削除されたらそのフィルタを除去（一覧が原因不明に空になるのを防ぐ）。
    const before = activeFilters.length;
    activeFilters = activeFilters.filter((f) => f.type !== 'folder' || CF().byId(f.value));
    if (activeFilters.length !== before) renderQueryChips();
    renderPostFolders();
    if (kind === 'list') renderPosts();
  });
  if (window.corpus.onPostsChanged) {
    window.corpus.onPostsChanged(async () => {
      await loadPosts();
    });
  }
  renderQueryChips();
  if (CF()) await CF().load();   // load folders before first render so 📁/chips are correct
  // Grouping persistence (shared with the old image-view): manual groups + opt-outs.
  try { const r = window.corpus.getUngrouped ? await window.corpus.getUngrouped() : null; ungrouped = new Set((r && r.keys) || []); } catch { /* default empty */ }
  try { const r = window.corpus.getManualGroups ? await window.corpus.getManualGroups() : null; manualGroups = (r && r.groups) || []; } catch { /* default empty */ }
  try { const r = window.corpus.getTagGroups ? await window.corpus.getTagGroups() : null; tagGroups = (r && r.groups) || []; } catch { /* default empty */ }
  loadPosts();
})();
