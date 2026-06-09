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
    hintExport: _s('hintExport'),
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
    backupOnStart: _s('backupOnStart'),
    backupInterval: _s('backupInterval'),
    backupIntervalUnit: _s('backupIntervalUnit'),
    backupOnChange: _s('backupOnChange'),
    backupRunNow: _s('backupRunNow'),
    backupRestore: _s('backupRestore'),
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
  setText('settingsSaveFolderTitle', MSG.saveFolderTitle);
  setText('chooseFolderBtn', MSG.chooseFolder);
  setText('hintSaveFolder', MSG.hintSaveFolder);
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
  setText('hintExport', MSG.hintExport);
  setText('settingsBackupTitle', MSG.backupTitle);
  setText('hintBackup', MSG.hintBackup);
  setText('chooseBackupDir', MSG.backupChoose);
  setText('clearBackupDir', MSG.backupClear);
  setText('backupContentLabel', MSG.backupContentTitle);
  setText('backupContentMetaLabel', MSG.backupContentMeta);
  setText('backupContentMediaLabel', MSG.backupContentMedia);
  setText('backupScheduleLabel', MSG.backupScheduleTitle);
  setText('backupOnStartLabel', MSG.backupOnStart);
  setText('backupIntervalLabel', MSG.backupInterval);
  setText('backupIntervalUnit', MSG.backupIntervalUnit);
  setText('backupOnChangeLabel', MSG.backupOnChange);
  setText('runBackupBtn', MSG.backupRunNow);
  setText('importFolderBtn', MSG.backupRestore);
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
    const tagModeBtn = document.getElementById('sbTagMode');
    // 検索語・フォルダもアクティブフィルタとして扱う（画像モードと同様にピル化）。
    const sbEl = document.getElementById('searchBox');
    const searchVal = sbEl ? sbEl.value.trim() : '';
    const folderObj = (folderFilter && CF()) ? CF().byId(folderFilter) : null;
    // バーは「アクティブなフィルタ（検索・フォルダ含む）が1つでもあれば」だけ出す（無ければ非表示）。
    if (activeFilters.length === 0 && !searchVal && !folderObj) {
      container.innerHTML = '';
      if (bar) bar.style.display = 'none';
      return;
    }
    if (bar) bar.style.display = '';
    if (tagModeBtn) tagModeBtn.style.display = activeFilters.some((f) => f.type === 'tag') ? '' : 'none';   // タグ絞り込み中のみ AND/OR
    // 検索・フォルダの特殊ピルを先頭に置き、続けて activeFilters のピルを並べる。
    let special = '';
    if (searchVal) special += `<span class="sb-active-chip qc-search" data-special="search">\u{1F50D} ${escapeHtml(searchVal)}</span>`;
    if (folderObj) special += `<span class="sb-active-chip qc-folder" data-special="folder">${escapeHtml(folderObj.name)}</span>`;
    container.innerHTML = special + activeFilters.map((f, i) => {
      let label = '';
      let cls = `qc-${f.type}`;
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
      return `<span class="sb-active-chip ${cls}" data-filter-idx="${i}">${escapeHtml(label)}</span>`;
    }).join('');
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    const thisYear = new Date().getFullYear().toString();
    return y === thisYear ? `${parseInt(m)}/${parseInt(d)}` : `${y}/${parseInt(m)}/${parseInt(d)}`;
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
    tagMode = 'or';
    folderFilter = '';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('searchBox', ''); set('sbDateFrom', ''); set('sbDateTo', ''); set('sbEngMin', '');
    const tb = document.getElementById('sbTagMode'); if (tb) { tb.textContent = 'いずれか'; tb.classList.add('or'); }
    renderQueryChips();
    renderPostFolders();
    renderPosts();
  }
  document.getElementById('postResetBtn').addEventListener('click', resetAllFilters);

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
    if (chip.dataset.special === 'folder') {
      folderFilter = '';
      renderPostFolders();
      renderPosts();
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
      removeFilter(idx);
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
  setText('sbActiveTitle', getMessage('sbActiveTitle'));
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
  document.querySelectorAll('.sb-chip[data-filter-type]').forEach(chip => {
    chip.addEventListener('click', () => {
      const type = chip.dataset.filterType;
      const value = chip.dataset.filterValue;
      const existIdx = activeFilters.findIndex(f => f.type === type && f.value === value);
      if (existIdx >= 0) {
        removeFilter(existIdx);
        // Deselecting a host-based platform can orphan instance filters; keep only
        // those whose host still belongs to a selected host-based platform.
        if (type === 'platform' && ['misskey', 'mastodon'].includes(value)) {
          const activeIP = activeFilters.filter(f => f.type === 'platform' && ['misskey', 'mastodon'].includes(f.value)).map(f => f.value);
          const validHosts = new Set(allPosts.filter(p => activeIP.includes(p.platform)).map(p => hostOf(p.url)));
          const before = activeFilters.length;
          activeFilters = activeFilters.filter(f => f.type !== 'instance' || validHosts.has(f.value));
          if (activeFilters.length !== before) { renderQueryChips(); renderPosts(); }
        }
      } else {
        addFilter({ type, value });
      }
      updateSidebarState();
    });
  });

  // Update sidebar chip active states
  function updateSidebarState() {
    document.querySelectorAll('.sb-chip[data-filter-type]').forEach(chip => {
      const type = chip.dataset.filterType;
      const value = chip.dataset.filterValue;
      const isActive = activeFilters.some(f => f.type === type && f.value === value);
      chip.classList.toggle('active', isActive);
    });
    // Sync sidebar date controls with active date filter
    const dateFilter = activeFilters.find(f => f.type === 'date');
    if (dateFilter) {
      sbDateFrom.value = dateFilter.from || '';
      sbDateTo.value = dateFilter.to || '';
      sbDateFieldSel.value = dateFilter.dateField || 'date';
    } else {
      sbDateFrom.value = '';
      sbDateTo.value = '';
    }
    // Sync sidebar engagement controls — show first engagement filter if any
    const engFilter = activeFilters.find(f => f.type === 'engagement');
    if (engFilter) {
      sbEngType.value = engFilter.engType || 'likes';
      sbEngMin.value = engFilter.min || '';
      sbEngOp.dataset.op = engFilter.op || 'gte';
      sbEngOp.textContent = engFilter.op === 'lte' ? MSG.qfEngLte : MSG.qfEngGte;
      sbEngOp.classList.toggle('active', engFilter.op === 'lte');
    } else {
      sbEngMin.value = '';
    }
    // 値が入っているフィルタ欄をハイライト（検索 / 日付 from・to / 最低エンゲージ）
    const hl = (el, on) => { if (el) el.classList.toggle('has-value', !!on); };
    const sb = document.getElementById('searchBox');
    hl(sb, sb && sb.value.trim());
    hl(sbDateFrom, sbDateFrom.value);
    hl(sbDateTo, sbDateTo.value);
    hl(sbEngMin, sbEngMin.value && parseInt(sbEngMin.value, 10) > 0);
    updateSidebarTags();
    updateSidebarAuthors();
    updateSidebarInstances();
    renderQueryChips();   // 検索/フォルダ等の変化を下部アクティブバーへ即時反映
  }

  // Sidebar date controls
  const sbDateFieldSel = document.getElementById('sbDateField');
  const sbDateFrom = document.getElementById('sbDateFrom');
  const sbDateTo = document.getElementById('sbDateTo');

  document.getElementById('sbDateOptPost').textContent = MSG.qfDatePost;
  document.getElementById('sbDateOptCapture').textContent = MSG.qfDateCaptured;
  document.getElementById('sbDateFromLabel').textContent = MSG.qfDateFrom;
  document.getElementById('sbDateToLabel').textContent = MSG.qfDateTo;

  sbDateFieldSel.addEventListener('change', applySidebarDateFilter);

  sbDateFrom.addEventListener('change', applySidebarDateFilter);
  sbDateTo.addEventListener('change', applySidebarDateFilter);

  function applySidebarDateFilter() {
    const from = sbDateFrom.value;
    const to = sbDateTo.value;
    const dateField = sbDateFieldSel.value;
    // Remove existing date filter
    activeFilters = activeFilters.filter(f => f.type !== 'date');
    if (from || to) {
      activeFilters.push({ type: 'date', dateField, from, to });
    }
    renderQueryChips();
    renderPosts();
    updateSidebarState();
  }

  // Sidebar engagement controls
  const sbEngType = document.getElementById('sbEngType');
  const sbEngMin = document.getElementById('sbEngMin');
  const sbEngOp = document.getElementById('sbEngOp');

  sbEngType.innerHTML = Object.entries(ENG_TYPE_LABELS).map(([k, v]) =>
    `<option value="${k}">${escapeHtml(v)}</option>`
  ).join('');
  sbEngOp.textContent = MSG.qfEngGte;
  sbEngOp.dataset.op = 'gte';

  sbEngOp.addEventListener('click', function() {
    const next = this.dataset.op === 'gte' ? 'lte' : 'gte';
    this.dataset.op = next;
    this.textContent = next === 'lte' ? MSG.qfEngLte : MSG.qfEngGte;
    this.classList.toggle('active', next === 'lte');
    applySidebarEngFilter();
  });

  sbEngType.addEventListener('change', applySidebarEngFilter);
  sbEngMin.addEventListener('input', applySidebarEngFilter);

  function applySidebarEngFilter() {
    const engType = sbEngType.value;
    const min = parseInt(sbEngMin.value, 10);
    const op = sbEngOp.dataset.op;
    // Remove existing filter for same engType
    activeFilters = activeFilters.filter(f => !(f.type === 'engagement' && f.engType === engType));
    if (min > 0) {
      activeFilters.push({ type: 'engagement', engType, min, op });
    }
    renderQueryChips();
    renderPosts();
    updateSidebarState();
  }

  // Sidebar tag chips (dynamic)
  function updateSidebarTags() {
    const container = document.getElementById('sbTagChips');
    const searchInput = document.getElementById('sbTagSearch');
    // 投稿閲覧は url ありの投稿のみ対象。画像ライブラリ（url無し）のEagleタグを混ぜない。
    const allTags = [...new Set(allPosts.filter(p => p.url).flatMap(p => p.tags || []))].sort();
    // Show the filter input only once the list is long enough to benefit.
    searchInput.style.display = allTags.length > 6 ? '' : 'none';
    if (allTags.length === 0) {
      container.innerHTML = '';
      return;
    }
    const filter = (searchInput.value || '').trim().toLowerCase();
    const tags = filter ? allTags.filter(t => t.toLowerCase().includes(filter)) : allTags;
    const activeValues = activeFilters.filter(f => f.type === 'tag').map(f => f.value);
    container.innerHTML = tags.map(t =>
      `<button class="sb-chip${activeValues.includes(t) ? ' active' : ''}" data-filter-type="tag" data-filter-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`
    ).join('');
    container.querySelectorAll('.sb-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const value = chip.dataset.filterValue;
        const existIdx = activeFilters.findIndex(f => f.type === 'tag' && f.value === value);
        if (existIdx >= 0) {
          removeFilter(existIdx);
        } else {
          addFilter({ type: 'tag', value });
        }
        updateSidebarState();
      });
    });
  }

  // Sidebar: instances/servers for Misskey + Mastodon (expands under the Platform
  // section when one of those host-based platforms is selected).
  function updateSidebarInstances() {
    const wrap = document.getElementById('sbInstanceWrap');
    const container = document.getElementById('sbInstanceChips');
    const activePlatforms = activeFilters
      .filter(f => f.type === 'platform' && ['misskey', 'mastodon'].includes(f.value))
      .map(f => f.value);
    const instances = [...new Set(allPosts.filter(p => activePlatforms.includes(p.platform)).map(p => hostOf(p.url)).filter(Boolean))].sort();
    if (activePlatforms.length === 0 || instances.length === 0) {
      wrap.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    wrap.style.display = '';
    const activeValues = activeFilters.filter(f => f.type === 'instance').map(f => f.value);
    container.innerHTML = instances.map(h =>
      `<button class="sb-chip${activeValues.includes(h) ? ' active' : ''}" data-filter-type="instance" data-filter-value="${escapeHtml(h)}">${escapeHtml(h)}</button>`
    ).join('');
    container.querySelectorAll('.sb-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const value = chip.dataset.filterValue;
        const idx = activeFilters.findIndex(f => f.type === 'instance' && f.value === value);
        if (idx >= 0) removeFilter(idx); else addFilter({ type: 'instance', value });
        updateSidebarState();
      });
    });
  }

  // --- State ---
  let allPosts = [];
  let activeFilters = []; // { type, value?, dateField?, from?, to?, engType?, min? }
  let currentView = 'card';   // 'card' | 'tile' | 'list' (display density)
  let multiOnly = false;      // show only items with more than one image
  let tileSize = 180;         // tile density: edge px (±), persisted as imageTileSize
  const TILE_MIN = 120, TILE_MAX = 400, TILE_STEP = 40;
  // Thumbnail width tracks the tile edge so larger tiles stay sharp (60px buckets).
  const tileThumbW = () => Math.min(960, Math.max(180, Math.ceil((tileSize * 1.4) / 60) * 60));
  function applyTileLayout() {
    const grid = document.getElementById('postGrid');
    if (grid) grid.style.setProperty('--tile-size', tileSize + 'px');
    const row = document.getElementById('tileSizeRow');
    if (row) row.style.display = currentView === 'tile' ? '' : 'none';
  }
  let skipDeleteConfirm = false;
  const selectedSet = new Set(); // stores post identifiers (url + capturedAt)
  let selectionAnchor = null;    // index in the filtered list, for shift-range select
  let folderFilter = '';         // active folder id (shared folders.json); '' = no folder filter
  let tagMode = 'or';            // tag multi-select combine: 'or' (any) | 'and' (all)
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
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view && !view.hidden) close(); });
  })();

  // Hashtag browsing is now covered by the sidebar タグ section + the search box
  // (typing "#tag" matches post text), so the dedicated hashtag tab was removed.
  document.getElementById('sbTagSearch').addEventListener('input', updateSidebarTags);
  document.getElementById('sbTagMode').addEventListener('click', () => {
    tagMode = tagMode === 'or' ? 'and' : 'or';
    const b = document.getElementById('sbTagMode');
    b.textContent = tagMode === 'or' ? 'いずれか' : 'すべて含む';
    b.classList.toggle('or', tagMode === 'or');
    renderPosts();
  });

  // --- Authors (sidebar 作者 section; derived from post author fields, no fetching) ---
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

  // Sidebar 作者 chips: top creators by post count; click toggles a `user` filter
  // (reuses the existing filter machinery + pill). A search box appears once the
  // list is long; without a query the chip list is capped so the sidebar stays
  // compact (search reaches the long tail).
  const AUTHOR_LIMIT = 40;
  function updateSidebarAuthors() {
    const container = document.getElementById('sbAuthorChips');
    const searchInput = document.getElementById('sbAuthorSearch');
    if (!container || !searchInput) return;
    let users = buildUsers();
    users.sort((a, b) => b.count - a.count ||
      (a.displayName || a.screenName || '').localeCompare(b.displayName || b.screenName || ''));
    searchInput.style.display = users.length > 8 ? '' : 'none';
    const q = (searchInput.value || '').trim().toLowerCase().replace(/^@+/, '');
    if (q) users = users.filter(u =>
      (u.displayName || '').toLowerCase().includes(q) || (u.screenName || '').toLowerCase().includes(q));
    const shown = q ? users : users.slice(0, AUTHOR_LIMIT);
    const activeKeys = activeFilters.filter(f => f.type === 'user').map(f => f.value);
    container.innerHTML = shown.map(u => {
      const name = u.displayName || u.screenName || '(unknown)';
      const tip = u.screenName ? '@' + u.screenName : name;
      return `<button class="sb-chip${activeKeys.includes(u.key) ? ' active' : ''}" data-user-key="${escapeHtml(u.key)}" data-user-label="${escapeHtml(name)}" title="${escapeHtml(tip)}">${escapeHtml(name)}</button>`;
    }).join('');
    container.querySelectorAll('.sb-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const key = chip.dataset.userKey;
        const idx = activeFilters.findIndex(f => f.type === 'user' && f.value === key);
        if (idx >= 0) removeFilter(idx);
        else addFilter({ type: 'user', value: key, label: chip.dataset.userLabel });
        updateSidebarState();
      });
    });
  }
  document.getElementById('sbAuthorSearch').addEventListener('input', updateSidebarAuthors);


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
    renderPosts();
    reconcileFolders();
    renderPostFolders();
  }
  function reconcileFolders() { if (CF()) CF().reconcile(new Set(allPosts.map(p => p.captureId))); }

  function getFilteredPosts() {
    // 統一ビュー: 全アイテム（SNS投稿＋ライブラリ画像）が対象。中身（画像 or 本文）の
    // 無いレコードだけ除外。SNS投稿だけ/画像だけの絞り込みは「種別」フィルタ(kind)で。
    let posts = allPosts.filter(p => p.image || mediaFilesOf(p).length || p.text || p.title);
    // Folder filter (shared folders.json, keyed by captureId)
    if (folderFilter && CF()) {
      const f = CF().byId(folderFilter);
      const set = new Set(f ? f.items : []);
      posts = posts.filter(p => set.has(p.captureId));
    }
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

    // Group filters by type
    const byType = {};
    for (const f of activeFilters) {
      (byType[f.type] = byType[f.type] || []).push(f);
    }

    // Kind: SNS投稿（スクショあり）/ 画像（ライブラリ）。OR within group.
    if (byType.kind) {
      const kinds = byType.kind.map(f => f.value);
      posts = posts.filter(p => {
        const isPost = isScreenshot(p);
        return (kinds.includes('post') && isPost) || (kinds.includes('image') && !isPost);
      });
    }

    // Platform: OR within group
    if (byType.platform) {
      const values = byType.platform.map(f => f.value);
      posts = posts.filter(p => values.includes(p.platform));
    }

    // User: OR within group (value is the userKey "platform:userId")
    if (byType.user) {
      const keys = byType.user.map(f => f.value);
      posts = posts.filter(p => keys.includes(userKey(p)));
    }

    // Instance/server (Misskey + Mastodon): OR within group
    if (byType.instance) {
      const hosts = byType.instance.map(f => f.value);
      posts = posts.filter(p => (p.platform === 'misskey' || p.platform === 'mastodon') && hosts.includes(hostOf(p.url)));
    }

    // Post type: OR within group
    if (byType.postType) {
      const values = byType.postType.map(f => f.value);
      posts = posts.filter(p =>
        (values.includes('post') && !p.isReply && !p.isQuote && !p.isThread) ||
        (values.includes('reply') && p.isReply) ||
        (values.includes('quote') && p.isQuote) ||
        (values.includes('thread') && p.isThread)
      );
    }

    // Date: use first date filter
    if (byType.date) {
      const f = byType.date[0];
      const field = f.dateField || 'date';
      if (f.from) {
        const from = new Date(f.from + 'T00:00:00');
        posts = posts.filter(p => p[field] && new Date(p[field]) >= from);
      }
      if (f.to) {
        // Exclusive next-day bound so the whole selected end day is included
        // regardless of the stored timestamps' sub-second precision.
        const to = new Date(f.to + 'T00:00:00');
        to.setDate(to.getDate() + 1);
        posts = posts.filter(p => p[field] && new Date(p[field]) < to);
      }
    }

    // Engagement: each filter applies independently (AND)
    if (byType.engagement) {
      for (const f of byType.engagement) {
        if (f.min > 0) {
          if (f.op === 'lte') {
            posts = posts.filter(p => (p[f.engType] || 0) <= f.min);
          } else {
            posts = posts.filter(p => (p[f.engType] || 0) >= f.min);
          }
        }
      }
    }

    // Tag: AND (all selected) or OR (any selected), per the sbTagMode toggle
    if (byType.tag) {
      const values = byType.tag.map(f => f.value);
      if (tagMode === 'and') posts = posts.filter(p => values.every(v => (p.tags || []).includes(v)));
      else posts = posts.filter(p => (p.tags || []).some(t => values.includes(t)));
    }

    // Media: OR within group
    if (byType.media) {
      const values = byType.media.map(f => f.value);
      posts = posts.filter(p => values.includes(p.mediaType));
    }

    // Multi-image only (items carrying more than one original image)
    if (multiOnly) posts = posts.filter(p => mediaFilesOf(p).length > 1);

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

  function renderPosts() {
    updateSidebarState();
    const grid = document.getElementById('postGrid');
    const empty = document.getElementById('emptyState');
    const countEl = document.getElementById('postCount');
    const posts = getFilteredPosts();
    const query = document.getElementById('searchBox').value.trim();

    countEl.textContent = MSG.postCount(posts.length);

    const noteEl = document.getElementById('statsNote');
    if (posts.length === 0) {
      grid.innerHTML = '';
      grid.style.display = 'none';
      empty.style.display = 'block';
      if (noteEl) noteEl.style.display = 'none';
      if (allPosts.length === 0 && !query) {
        empty.innerHTML = `<p><strong>${MSG.emptyTitle}</strong></p><p>${MSG.emptyDesc}</p>`;
      } else {
        empty.innerHTML = `<p><strong>${MSG.emptySearchTitle}</strong></p><p>${MSG.emptySearchDesc}</p>`;
      }
      return;
    }

    grid.style.display = currentView === 'list' ? 'flex' : 'grid';
    grid.classList.toggle('list-view', currentView === 'list');
    grid.classList.toggle('tile-view', currentView === 'tile');
    applyTileLayout();
    empty.style.display = 'none';
    if (noteEl) noteEl.style.display = 'block';

    grid.innerHTML = posts.map((p, i) => {
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
      const nImg = mediaFilesOf(p).length;            // ×N badge (tile) when a post has multiple images
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

      const postKey = (p.captureId || ((p.url || '') + '|' + (p.capturedAt || '')));
      const isSelected = selectedSet.has(postKey);
      return `<div class="post-card${isSelected ? ' selected' : ''}" data-url="${escapeAttr(p.url || '')}" data-index="${i}" data-key="${escapeAttr(postKey)}">
        <div class="select-check"></div>
        <button class="fold-btn${CF() && CF().inDefault(p.captureId) ? ' in' : ''}" data-fold="${i}" title="${CF() && CF().defaultId() ? 'デフォルトフォルダに追加/解除' : 'フォルダを作成して追加'}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
        <button class="edit-btn" data-edit="${i}" title="${MSG.tipEdit}" aria-label="${MSG.tipEdit}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>
        <button class="delete-btn" data-delete="${i}" title="${MSG.tipDelete}">&times;</button>
        ${p.url ? `<button class="open-btn" title="${MSG.tipOpen}" aria-label="${MSG.tipOpen}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>` : ''}
        ${imgFile ? `<img class="card-img" src="${fileSrc(imgFile, currentView === 'tile' ? tileThumbW() : 0)}" alt="" loading="lazy">` : ''}
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

    // Mark truncated text elements
    requestAnimationFrame(() => {
      grid.querySelectorAll('.text').forEach(el => {
        el.classList.toggle('truncated', el.scrollHeight > el.clientHeight);
      });
    });
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
  const lbCounter = document.getElementById('lbCounter');
  const lbPrev = document.getElementById('lbPrev');
  const lbNext = document.getElementById('lbNext');
  lbPrev.setAttribute('aria-label', MSG.lbPrev);
  lbNext.setAttribute('aria-label', MSG.lbNext);
  let galleryItems = [];
  let galleryIndex = 0;

  // Gallery items for a post: the screenshot first, then each original image.
  function buildGalleryItems(p) {
    const items = [];
    if (p.image) items.push({ src: imgSrc(p), alt: '' });
    if (Array.isArray(p.media)) {
      for (const m of p.media) {
        if (m && m.file) items.push({ src: 'psimg://img/' + encodeURIComponent(m.file), alt: m.alt || '' });
      }
    }
    return items;
  }

  function showGallerySlide() {
    const item = galleryItems[galleryIndex];
    if (!item) return;
    lightboxImg.src = item.src;
    lightboxImg.alt = item.alt || ''; // DOM property assignment — XSS-safe
    lbCounter.textContent = (galleryIndex + 1) + ' / ' + galleryItems.length;
    lightbox.classList.toggle('multi', galleryItems.length > 1);
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
    // Image -> open the gallery (screenshot + originals).
    const img = e.target.closest('.card-img');
    if (img) {
      e.stopPropagation();
      const p = getFilteredPosts()[parseInt(img.closest('.post-card')?.dataset.index, 10)];
      if (p) openGallery(buildGalleryItems(p), 0);
    }
  });

  lbPrev.addEventListener('click', (e) => { e.stopPropagation(); galleryStep(-1); });
  lbNext.addEventListener('click', (e) => { e.stopPropagation(); galleryStep(1); });
  lightbox.addEventListener('click', (e) => {
    if (e.target.closest('.lb-nav')) return; // nav clicks don't close
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
    const idx = parseInt(btn.dataset.edit, 10);
    const filtered = getFilteredPosts();
    const post = filtered[idx];
    if (!post) return;
    openEditOverlay(post);
  });

  // 📁 button on card: one-click add/remove this post to the default folder.
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.fold-btn');
    if (!btn) return;
    e.stopPropagation();
    if (!CF()) return;
    const post = getFilteredPosts()[parseInt(btn.dataset.fold, 10)];
    if (!post || !post.captureId) return;
    const res = CF().toggleDefault([post.captureId], post.captureId);   // persists + toast + notify; null=no default→manager
    if (!res) return;
    btn.classList.toggle('in', res === 'added');
    if (res === 'added') { btn.classList.add('added'); setTimeout(() => btn.classList.remove('added'), 500); }
    // If filtering by the default folder and we removed it, re-render so EVERY card's
    // data-index stays in sync with getFilteredPosts() (other handlers read by index).
    if (res === 'removed' && folderFilter === CF().defaultId()) {
      renderPosts();
    }
  });

  // Sidebar folder chips (shared folders.json): count + ★default + single-select filter.
  function renderPostFolders() {
    const host = document.getElementById('postFolderChips');
    if (!host || !CF()) return;
    const list = CF().all();
    const def = CF().defaultId();
    const existing = new Set(allPosts.filter(p => p.url).map(p => p.captureId));
    if (!list.length) { host.innerHTML = '<span class="iv-folder-empty">なし</span>'; return; }
    host.innerHTML = list.map(f => {
      const n = f.items.filter(c => existing.has(c)).length;
      const star = f.id === def ? '<span class="iv-foldstar" title="デフォルトフォルダ">★</span>' : '';
      return `<button class="sb-chip${folderFilter === f.id ? ' active' : ''}" data-fid="${escapeAttr(f.id)}">${star}${escapeHtml(f.name)}<span class="iv-tagn">${n}</span></button>`;
    }).join('');
  }
  document.getElementById('postFolderChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.sb-chip');
    if (!chip) return;
    const fid = chip.dataset.fid;
    folderFilter = folderFilter === fid ? '' : fid;
    renderPostFolders();
    renderPosts();
  });
  document.getElementById('postFolderManage').addEventListener('click', () => { if (CF()) CF().openManager(); });

  // Click the card body (anything but the image, the post/edit/delete buttons,
  // or the expandable text) to select it. Plain click selects only that card;
  // Ctrl/Cmd-click toggles one; Shift-click selects the range from the anchor.
  document.getElementById('postGrid').addEventListener('click', (e) => {
    if (e.target.closest('.delete-btn') || e.target.closest('.edit-btn') ||
        e.target.closest('.open-btn') || e.target.closest('.card-img') ||
        e.target.closest('.fold-btn') || e.target.closest('.text')) return;
    const card = e.target.closest('.post-card');
    if (!card) return;
    const filtered = getFilteredPosts();
    const keyOf = (p) => (p.captureId || ((p.url || '') + '|' + (p.capturedAt || '')));
    const idx = parseInt(card.dataset.index, 10);
    const key = card.dataset.key;

    if (e.shiftKey && selectionAnchor !== null) {
      const lo = Math.min(selectionAnchor, idx);
      const hi = Math.max(selectionAnchor, idx);
      selectedSet.clear();
      for (let i = lo; i <= hi; i++) { if (filtered[i]) selectedSet.add(keyOf(filtered[i])); }
    } else if (e.ctrlKey || e.metaKey) {
      if (selectedSet.has(key)) selectedSet.delete(key); else selectedSet.add(key);
      selectionAnchor = idx;
    } else {
      // Plain click: select only this (clicking the sole selection clears it).
      const only = selectedSet.size === 1 && selectedSet.has(key);
      selectedSet.clear();
      if (!only) selectedSet.add(key);
      selectionAnchor = only ? null : idx;
    }
    renderPosts();
    updateSelectionBar();
  });

  // Delete button on card
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.delete-btn');
    if (!btn) return;
    e.stopPropagation();
    const idx = parseInt(btn.dataset.delete, 10);
    const filtered = getFilteredPosts();
    const post = filtered[idx];
    if (!post) return;

    if (skipDeleteConfirm) {
      executeDeletePost(post);
    } else {
      pendingDeletePost = post;
      document.getElementById('confirmMsg').textContent = MSG.confirmDeletePost;
      document.getElementById('confirmSkipLabel').style.display = 'flex';
      document.getElementById('confirmSkip').checked = false;
      document.getElementById('confirmOverlay').classList.add('show');
    }
  });

  let pendingDeletePost = null;

  async function executeDeletePost(post) {
    await window.corpus.deletePost(post.image || post.video);
    const idx = allPosts.findIndex(p => p.captureId === post.captureId);
    if (idx >= 0) allPosts.splice(idx, 1);
    renderPosts();
    reconcileFolders();   // 削除した captureId をフォルダから即時掃除
    renderPostFolders();
    showToast(MSG.deleted);
  }

  // --- Edit overlay logic ---
  let editingPost = null;
  let editTags = [];

  function openEditOverlay(post) {
    editingPost = post;
    editTags = [...(post.tags || [])];
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
    document.getElementById('editOverlay').classList.remove('show');
  });

  document.getElementById('editOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      editingPost = null;
      e.currentTarget.classList.remove('show');
    }
  });

  document.getElementById('editSave').addEventListener('click', async () => {
    if (!editingPost) return;
    const tags = [...editTags];

    // Persist to the sidecar, then update in memory
    await window.corpus.updateTags(editingPost.image || editingPost.video, tags);
    const idx = allPosts.findIndex(p => p.captureId === editingPost.captureId);
    if (idx >= 0) {
      allPosts[idx].tags = tags;
      renderPosts();
    }

    editingPost = null;
    document.getElementById('editOverlay').classList.remove('show');
  });


  // --- Selection (click a card to select; the bar appears when 1+ are selected) ---
  const selectionBar = document.getElementById('selectionBar');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  const cancelSelectBtn = document.getElementById('cancelSelectBtn');
  const selectedCountEl = document.getElementById('selectedCount');

  selectAllBtn.textContent = MSG.selectAll;
  deleteSelectedBtn.textContent = MSG.deleteSelected;
  cancelSelectBtn.textContent = MSG.cancelSelect;

  function clearSelection() {
    selectedSet.clear();
    selectionAnchor = null;
    renderPosts();
    updateSelectionBar();
  }

  function updateSelectionBar() {
    const count = selectedSet.size;
    selectionBar.style.display = count > 0 ? '' : 'none';
    selectedCountEl.textContent = MSG.selectedCount(count);
    deleteSelectedBtn.disabled = count === 0;
    const filtered = getFilteredPosts();
    const allSelected = filtered.length > 0 && filtered.every(p => selectedSet.has((p.captureId || ((p.url || '') + '|' + (p.capturedAt || '')))));
    selectAllBtn.textContent = allSelected ? MSG.deselectAll : MSG.selectAll;
  }

  cancelSelectBtn.addEventListener('click', clearSelection);

  selectAllBtn.addEventListener('click', () => {
    const filtered = getFilteredPosts();
    const allSelected = filtered.every(p => selectedSet.has((p.captureId || ((p.url || '') + '|' + (p.capturedAt || '')))));
    if (allSelected) {
      selectedSet.clear();
    } else {
      filtered.forEach(p => selectedSet.add((p.captureId || ((p.url || '') + '|' + (p.capturedAt || '')))));
    }
    renderPosts();
    updateSelectionBar();
  });

  deleteSelectedBtn.addEventListener('click', () => {
    if (selectedSet.size === 0) return;
    pendingDeletePost = null;
    document.getElementById('confirmMsg').textContent = MSG.confirmDeleteSelected(selectedSet.size);
    document.getElementById('confirmSkipLabel').style.display = 'none';
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

  // Tile size ± (tile density only)
  function setTileSize(px) {
    tileSize = Math.max(TILE_MIN, Math.min(TILE_MAX, px));
    window.corpus.setPref('imageTileSize', tileSize);
    applyTileLayout();
    if (currentView === 'tile') renderPosts();   // re-request thumbnails at the new size
  }
  document.getElementById('tileMinus').addEventListener('click', () => setTileSize(tileSize - TILE_STEP));
  document.getElementById('tilePlus').addEventListener('click', () => setTileSize(tileSize + TILE_STEP));

  document.getElementById('multiOnly').addEventListener('change', (e) => { multiOnly = e.target.checked; renderPosts(); });

  // Load saved view mode and skipDeleteConfirm
  const resetDeleteConfirmCheckbox = document.getElementById('resetDeleteConfirm');
  window.corpus.getPrefs().then((prefs) => {
    if (['card', 'tile', 'list'].includes(prefs.viewMode)) {
      currentView = prefs.viewMode;
      document.querySelectorAll('.view-toggle button').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
    }
    if (Number.isFinite(prefs.imageTileSize)) tileSize = Math.max(TILE_MIN, Math.min(TILE_MAX, prefs.imageTileSize));
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
  document.getElementById('searchBox').addEventListener('input', renderPosts);
  sortSelect.addEventListener('change', () => {
    window.corpus.setPref('sortBy', sortSelect.value);
    renderPosts();
  });

  // 検索方式トグル（通常 / あいまい）。corpusSearch がモードを集約し、両モードで共有する。
  const searchModeBtn = document.getElementById('searchModeToggle');
  function syncSearchToggle() {
    if (!searchModeBtn || !window.corpusSearch) return;
    const fuzzy = window.corpusSearch.isFuzzy();
    searchModeBtn.textContent = fuzzy ? MSG.searchFuzzy : MSG.searchExact;
    searchModeBtn.classList.toggle('active', fuzzy);
    searchModeBtn.title = MSG.searchModeTitle;
  }
  if (searchModeBtn && window.corpusSearch) {
    searchModeBtn.addEventListener('click', () => window.corpusSearch.toggle());
    window.corpusSearch.onChange(() => { syncSearchToggle(); renderPosts(); });
    syncSearchToggle();
  }

  // --- Settings: save folder ---
  const saveFolderPath = document.getElementById('saveFolderPath');
  window.corpus.getConfig().then((cfg) => {
    if (saveFolderPath) saveFolderPath.textContent = cfg.saveFolder || '';
  });

  document.getElementById('chooseFolderBtn').addEventListener('click', async () => {
    const { saveFolder } = await window.corpus.pickSaveFolder();
    if (saveFolderPath) saveFolderPath.textContent = saveFolder || '';
    loadPosts();
  });

  // --- Export (complete, directly re-importable) ---
  // Built in main: a ZIP mirroring the whole library (captures + media + 整理情報)
  // under library/. Re-importable via importZip below to fully restore.
  document.getElementById('exportZip').addEventListener('click', async () => {
    showToast(MSG.exporting);
    try {
      const res = await window.corpus.exportComplete();
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
      let s = `${MSG.backupLastLabel} ${fmtTime(r.at)}（+${r.copied}${MSG.backupItemsUnit}`;
      if (r.skipped) s += ` / ${MSG.backupSkipLabel}${r.skipped}`;
      if (r.failed) s += ` / ✗${r.failed}`;
      statusEl.textContent = s + '）';
    }
    function render() {
      if (!cfg) return;
      pathEl.textContent = cfg.dir || MSG.backupDirNone;
      if (cfg.content === 'media') $('backupContentMedia').checked = true; else $('backupContentMeta').checked = true;
      $('backupOnStart').checked = !!cfg.onStart;
      $('backupInterval').checked = !!cfg.interval;
      $('backupIntervalHours').value = cfg.intervalHours || 24;
      $('backupOnChange').checked = !!cfg.onChange;
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
    document.querySelectorAll('input[name="backupContent"]').forEach((r) => {
      r.addEventListener('change', () => { if (r.checked) save({ content: r.value }); });
    });
    $('backupOnStart').addEventListener('change', (e) => save({ onStart: e.target.checked }));
    $('backupInterval').addEventListener('change', (e) => save({ interval: e.target.checked }));
    $('backupIntervalHours').addEventListener('change', (e) => {
      const v = Math.max(1, Math.min(720, parseInt(e.target.value, 10) || 24));
      e.target.value = v; save({ intervalHours: v });
    });
    $('backupOnChange').addEventListener('change', (e) => save({ onChange: e.target.checked }));

    $('runBackupBtn').addEventListener('click', async () => {
      if (!cfg || !cfg.dir) { showToast(MSG.backupNotSet); return; }
      showToast(MSG.backupRunning);
      try {
        const r = await window.corpus.runBackup();
        if (r && r.ok) {
          cfg.lastResult = { copied: r.copied, skipped: r.skipped, failed: r.failed, total: r.total, at: r.at };
          renderStatus();
          showToast(MSG.imported(r.copied));
        } else {
          showToast(MSG.importFailed);
        }
      } catch { showToast(MSG.importFailed); }
    });

    $('importFolderBtn').addEventListener('click', async () => {
      try {
        const pick = await window.corpus.pickImportFolder();
        if (!pick || !pick.ok || !pick.dir) return;
        showToast(MSG.importing);
        const { imported, skipped } = await window.corpus.importFromFolder(pick.dir);
        await loadPosts();
        if (skipped > 0) showToast(MSG.importSkipped(imported, skipped));
        else showToast(MSG.imported(imported));
      } catch { showToast(MSG.importFailed); }
    });

    if (window.corpus.onBackupDone) {
      window.corpus.onBackupDone((_e, r) => { if (cfg && r) { cfg.lastResult = r; renderStatus(); } });
    }

    load();
  })();

  // --- Clear data ---
  document.getElementById('clearData').addEventListener('click', () => {
    pendingDeletePost = null;
    document.getElementById('confirmMsg').textContent = MSG.confirmClear;
    document.getElementById('confirmSkipLabel').style.display = 'none';
    document.getElementById('confirmOverlay').classList.add('show');
  });

  document.getElementById('confirmCancel').addEventListener('click', () => {
    pendingDeletePost = null;
    pendingBulkDelete = false;
    document.getElementById('confirmOverlay').classList.remove('show');
  });

  document.getElementById('confirmOk').addEventListener('click', async () => {
    document.getElementById('confirmOverlay').classList.remove('show');

    if (pendingBulkDelete) {
      // Bulk delete selected posts — remove the files on disk
      const toDelete = allPosts.filter(p => selectedSet.has((p.captureId || ((p.url || '') + '|' + (p.capturedAt || '')))));
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
    } else if (pendingDeletePost) {
      // Individual post delete
      if (document.getElementById('confirmSkip').checked) {
        skipDeleteConfirm = true;
        window.corpus.setPref('skipDeleteConfirm', true);
      }
      await executeDeletePost(pendingDeletePost);
      pendingDeletePost = null;
    } else {
      // Clear all data (deletes every image + sidecar in the save folder)
      await window.corpus.clearAll();
      allPosts = [];
      renderPosts();
      showToast(MSG.cleared);
    }
  });

  // Close overlay on background click
  document.getElementById('confirmOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      pendingDeletePost = null;
      pendingBulkDelete = false;
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
    // 絞り込み中のフォルダが削除されたらフィルタを解除（一覧が原因不明に空になるのを防ぐ）。
    if (folderFilter && !CF().byId(folderFilter)) folderFilter = '';
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
  loadPosts();
})();
