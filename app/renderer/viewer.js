(async () => {
  // --- i18n ---
  // Messages live in i18n.js (loaded before this script via viewer.html).
  // Manifest-level strings come from _locales/*/messages.json via Chrome.
  const { lang, getMessage } = await window.postSnapI18n;
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
    sortDateDesc: _s('sortDateDesc'),
    sortDateAsc: _s('sortDateAsc'),
    sortLikes: _s('sortLikes'),
    sortReposts: _s('sortReposts'),
    sortReplies: _s('sortReplies'),
    sortCaptured: _s('sortCaptured'),
    filterAll: _s('filterAll'),
    postCount: _f1('postCount'),

    // empty states
    emptyTitle: _s('emptyTitle'),
    emptyDesc: _s('emptyDesc'),
    emptySearchTitle: _s('emptySearchTitle'),
    emptySearchDesc: _s('emptySearchDesc'),

    // settings > download
    downloadTitle: _s('downloadTitle'),
    labelFolder: _s('labelFolder'),
    hintFolder: _s('hintFolder'),
    labelSaveAs: _s('labelSaveAs'),
    hintSaveAs: _s('hintSaveAs'),
    hintBackup: _s('hintBackup'),
    save: _s('save'),
    saved: _s('saved'),
    invalidFolder: _s('invalidFolder'),
    saveFolderTitle: _s('saveFolderTitle'),
    chooseFolder: _s('chooseFolder'),
    hintSaveFolder: _s('hintSaveFolder'),

    // settings > language / shortcut
    langTitle: _s('langTitle'),
    langAuto: _s('langAuto'),
    hintLang: _s('hintLang'),
    shortcutTitle: _s('shortcutTitle'),
    shortcutLink: _s('shortcutLink'),
    hintShortcut: _s('hintShortcut'),

    // settings > data / danger
    dataTitle: _s('dataTitle'),
    exportZip: _s('exportZip'),
    exportHtml: _s('exportHtml'),
    importImages: _s('importImages'),
    importHtml: _s('importHtml'),
    hintExport: _s('hintExport'),
    dangerTitle: _s('dangerTitle'),
    labelResetDeleteConfirm: _s('labelResetDeleteConfirm'),
    hintResetDeleteConfirm: _s('hintResetDeleteConfirm'),
    clearData: _s('clearData'),
    confirmClear: _s('confirmClear'),
    confirmOk: _s('confirmOk'),
    confirmCancel: _s('confirmCancel'),
    cleared: _s('cleared'),

    // export/import toasts
    exporting: _s('exporting'),
    exported: _s('exported'),
    importing: _s('importing'),
    imported: _f1('imported'),
    importSkipped: _f2('importSkipped'),
    noData: _s('noData'),
    importFailed: _s('importFailed'),

    // engagement labels
    engagementLikes: _s('engagementLikes'),
    engagementReposts: _s('engagementReposts'),
    engagementReplies: _s('engagementReplies'),
    engagementBookmarks: _s('engagementBookmarks'),
    engagementViews: _s('engagementViews'),
    engagementSuffix: _s('engagementSuffix'),

    // selection mode
    selectMode: _s('selectMode'),
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
    tipZoom: _s('tipZoom'),
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
    qfEngLte: _s('qfEngLte')
  };

  // --- Apply i18n to static elements ---
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const setAttr = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };

  setText('tabPosts', MSG.tabPosts);
  setText('tabTags', MSG.tabTags);
  setText('tabSettings', MSG.tabSettings);
  setAttr('searchBox', 'placeholder', MSG.searchPlaceholder);
  setText('settingsSaveFolderTitle', MSG.saveFolderTitle);
  setText('chooseFolderBtn', MSG.chooseFolder);
  setText('hintSaveFolder', MSG.hintSaveFolder);
  setText('settingsLangTitle', MSG.langTitle);
  setText('langAuto', MSG.langAuto);
  setText('hintLang', MSG.hintLang);
  document.getElementById('langSelect').value = lang;
  document.getElementById('langSelect').addEventListener('change', async (e) => {
    await window.postSnap.setPref('language', e.target.value);
    location.reload();
  });
  setText('settingsShortcutTitle', MSG.shortcutTitle);
  setText('shortcutLink', MSG.shortcutLink);
  setText('hintShortcut', MSG.hintShortcut);
  setText('settingsDataTitle', MSG.dataTitle);
  setText('exportZip', MSG.exportZip);
  setText('exportHtml', MSG.exportHtml);
  setText('importImages', MSG.importImages);
  setText('importHtml', MSG.importHtml);
  setText('hintExport', MSG.hintExport);
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
    if (activeFilters.length === 0) {
      container.innerHTML = `<span style="color:#999;font-size:12px;padding:2px 4px;">${MSG.filterAll}</span>`;
      return;
    }
    container.innerHTML = activeFilters.map((f, i) => {
      let label = '';
      let cls = `qc-${f.type}`;
      switch (f.type) {
        case 'platform':
          label = f.value === 'x' ? 'X' : f.value === 'bluesky' ? 'Bluesky' : f.value === 'misskey' ? 'Misskey' : 'Mastodon';
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
    // For date: replace existing
    if (filter.type === 'date') {
      activeFilters = activeFilters.filter(f => f.type !== 'date');
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

  // Chip click handler
  document.getElementById('queryChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.sb-active-chip');
    if (!chip) return;
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
        if (type === 'platform' && value === 'misskey') {
          activeFilters = activeFilters.filter(f => f.type !== 'instance');
          renderQueryChips();
          renderPosts();
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
    updateSidebarTags();
    updateSidebarInstances();
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
    const tags = [...new Set(allPosts.flatMap(p => p.tags || []))].sort();
    if (tags.length === 0) {
      container.innerHTML = '';
      return;
    }
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

  // Sidebar: Misskey instances (expands under the Platform section when Misskey is selected)
  function updateSidebarInstances() {
    const wrap = document.getElementById('sbInstanceWrap');
    const container = document.getElementById('sbInstanceChips');
    const misskeyActive = activeFilters.some(f => f.type === 'platform' && f.value === 'misskey');
    const instances = [...new Set(allPosts.filter(p => p.platform === 'misskey').map(p => hostOf(p.url)).filter(Boolean))].sort();
    if (!misskeyActive || instances.length === 0) {
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
  let currentView = 'grid';
  let skipDeleteConfirm = false;
  let selectMode = false;
  const selectedSet = new Set(); // stores post identifiers (url + capturedAt)

  // --- Tabs ---
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel${capitalize(btn.dataset.tab)}`).classList.add('active');
      if (btn.dataset.tab === 'tags') renderHashtags();
    });
  });

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // --- Hashtags (extracted from post text) ---
  function extractHashtags(text) {
    return text ? (text.match(/#[\p{L}\p{N}_]+/gu) || []) : [];
  }

  function renderHashtags() {
    const container = document.getElementById('hashtagList');
    const counts = new Map();
    for (const p of allPosts) {
      const seen = new Set();
      for (const tag of extractHashtags(p.text)) {
        if (seen.has(tag)) continue;
        seen.add(tag);
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!entries.length) {
      container.innerHTML = `<div class="hashtag-empty">${MSG.emptyHashtags}</div>`;
      return;
    }
    container.innerHTML = entries.map(([tag, n]) =>
      `<button class="hashtag-chip" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}<span class="ht-count">${n}</span></button>`
    ).join('');
  }

  document.getElementById('hashtagList').addEventListener('click', (e) => {
    const chip = e.target.closest('.hashtag-chip');
    if (!chip) return;
    document.querySelector('.tab-btn[data-tab="posts"]').click();
    document.getElementById('searchBox').value = chip.dataset.tag;
    renderPosts();
  });

  // --- Image source (served from the save folder via the psimg:// protocol) ---
  const imgSrc = (p) => (p.image ? 'psimg://img/' + encodeURIComponent(p.image) : '');
  const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

  // --- Load posts ---
  async function loadPosts() {
    const { posts } = await window.postSnap.listPosts();
    allPosts = posts || [];
    renderPosts();
  }

  function getFilteredPosts() {
    let posts = [...allPosts];
    const query = document.getElementById('searchBox').value.trim().toLowerCase();
    const sort = sortSelect.value;

    // Text search (unchanged)
    if (query) {
      posts = posts.filter(p =>
        (p.text || '').toLowerCase().includes(query) ||
        (p.screenName || '').toLowerCase().includes(query) ||
        (p.displayName || '').toLowerCase().includes(query) ||
        (p.tags || []).some(t => t.toLowerCase().includes(query))
      );
    }

    // Group filters by type
    const byType = {};
    for (const f of activeFilters) {
      (byType[f.type] = byType[f.type] || []).push(f);
    }

    // Platform: OR within group
    if (byType.platform) {
      const values = byType.platform.map(f => f.value);
      posts = posts.filter(p => values.includes(p.platform));
    }

    // Instance (Misskey): OR within group
    if (byType.instance) {
      const hosts = byType.instance.map(f => f.value);
      posts = posts.filter(p => p.platform === 'misskey' && hosts.includes(hostOf(p.url)));
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

    // Tag: OR within group
    if (byType.tag) {
      const values = byType.tag.map(f => f.value);
      posts = posts.filter(p => (p.tags || []).some(t => values.includes(t)));
    }

    // Media: OR within group
    if (byType.media) {
      const values = byType.media.map(f => f.value);
      posts = posts.filter(p => values.includes(p.mediaType));
    }

    // Sort (unchanged)
    switch (sort) {
      case 'date-desc': posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)); break;
      case 'date-asc': posts.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)); break;
      case 'likes-desc': posts.sort((a, b) => (b.likes || 0) - (a.likes || 0)); break;
      case 'reposts-desc': posts.sort((a, b) => (b.reposts || 0) - (a.reposts || 0)); break;
      case 'replies-desc': posts.sort((a, b) => (b.replies || 0) - (a.replies || 0)); break;
      case 'captured-desc': posts.sort((a, b) => (b.capturedAt || '').localeCompare(a.capturedAt || '')); break;
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
      const userName = p.displayName || p.screenName || '';
      const handle = p.screenName ? `@${p.screenName}` : '';
      const textPreview = escapeHtml(p.text || '');

      const postKey = (p.url || '') + '|' + (p.capturedAt || '');
      const isSelected = selectedSet.has(postKey);
      return `<div class="post-card${isSelected ? ' selected' : ''}" data-url="${escapeHtml(p.url || '')}" data-index="${i}" data-key="${escapeHtml(postKey)}">
        <div class="select-check">${isSelected ? '✓' : ''}</div>
        <button class="edit-btn" data-edit="${i}" title="${MSG.tipEdit}">✎</button>
        <button class="delete-btn" data-delete="${i}" title="${MSG.tipDelete}">&times;</button>
        ${p.image ? `<button class="zoom-btn" title="${MSG.tipZoom}">🔍</button><img src="${imgSrc(p)}" alt="" loading="lazy">` : ''}
        <div class="post-meta">
          <div class="user">
            <span class="platform-badge ${p.platform || ''}">${(p.platform || '').toUpperCase()}</span>
            ${escapeHtml(userName)}${handle ? ` <span style="color:#999;font-weight:400">${escapeHtml(handle)}</span>` : ''}
          </div>
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

  // Image lightbox via zoom button
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  document.getElementById('postGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.zoom-btn');
    if (!btn) return;
    e.stopPropagation();
    const card = btn.closest('.post-card');
    const img = card?.querySelector('img');
    if (!img) return;
    lightboxImg.src = img.src;
    lightbox.classList.add('show');
  });
  lightbox.addEventListener('click', () => {
    lightbox.classList.remove('show');
    lightboxImg.src = '';
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

  // Click on post card -> select or open URL
  document.getElementById('postGrid').addEventListener('click', (e) => {
    if (e.target.closest('.delete-btn') || e.target.closest('.edit-btn') || e.target.closest('.zoom-btn') || e.target.closest('.text')) return;
    const card = e.target.closest('.post-card');
    if (!card) return;

    if (selectMode || e.target.closest('.select-check')) {
      const key = card.dataset.key;
      if (selectedSet.has(key)) {
        selectedSet.delete(key);
        card.classList.remove('selected');
        card.querySelector('.select-check').textContent = '';
      } else {
        selectedSet.add(key);
        card.classList.add('selected');
        card.querySelector('.select-check').textContent = '✓';
      }
      updateSelectionBar();
      return;
    }

    const url = card.dataset.url;
    if (url) window.postSnap.openExternal(url);
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
    await window.postSnap.deletePost(post.image);
    const idx = allPosts.findIndex(p => p.captureId === post.captureId);
    if (idx >= 0) allPosts.splice(idx, 1);
    renderPosts();
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
    await window.postSnap.updateTags(editingPost.image, tags);
    const idx = allPosts.findIndex(p => p.captureId === editingPost.captureId);
    if (idx >= 0) {
      allPosts[idx].tags = tags;
      renderPosts();
    }

    editingPost = null;
    document.getElementById('editOverlay').classList.remove('show');
  });


  // --- Selection mode ---
  const selectModeBtn = document.getElementById('selectModeBtn');
  const selectionBar = document.getElementById('selectionBar');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  const cancelSelectBtn = document.getElementById('cancelSelectBtn');
  const selectedCountEl = document.getElementById('selectedCount');

  selectModeBtn.textContent = MSG.selectMode;
  selectAllBtn.textContent = MSG.selectAll;
  deleteSelectedBtn.textContent = MSG.deleteSelected;
  cancelSelectBtn.textContent = MSG.cancelSelect;

  function enterSelectMode() {
    selectMode = true;
    selectedSet.clear();
    document.getElementById('postGrid').classList.add('select-mode');
    selectionBar.style.display = '';
    selectModeBtn.classList.add('active');
    updateSelectionBar();
  }

  function exitSelectMode() {
    selectMode = false;
    selectedSet.clear();
    document.getElementById('postGrid').classList.remove('select-mode');
    selectionBar.style.display = 'none';
    selectModeBtn.classList.remove('active');
    renderPosts();
  }

  function updateSelectionBar() {
    const count = selectedSet.size;
    selectedCountEl.textContent = MSG.selectedCount(count);
    deleteSelectedBtn.disabled = count === 0;
    const filtered = getFilteredPosts();
    const allSelected = filtered.length > 0 && filtered.every(p => selectedSet.has((p.url || '') + '|' + (p.capturedAt || '')));
    selectAllBtn.textContent = allSelected ? MSG.deselectAll : MSG.selectAll;
  }

  selectModeBtn.addEventListener('click', () => {
    if (selectMode) exitSelectMode();
    else enterSelectMode();
  });

  cancelSelectBtn.addEventListener('click', exitSelectMode);

  selectAllBtn.addEventListener('click', () => {
    const filtered = getFilteredPosts();
    const allSelected = filtered.every(p => selectedSet.has((p.url || '') + '|' + (p.capturedAt || '')));
    if (allSelected) {
      selectedSet.clear();
    } else {
      filtered.forEach(p => selectedSet.add((p.url || '') + '|' + (p.capturedAt || '')));
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
      window.postSnap.setPref('viewMode', currentView);
      renderPosts();
    });
  });

  // Load saved view mode and skipDeleteConfirm
  const resetDeleteConfirmCheckbox = document.getElementById('resetDeleteConfirm');
  window.postSnap.getPrefs().then((prefs) => {
    if (prefs.viewMode === 'list') {
      currentView = 'list';
      document.getElementById('viewGrid').classList.remove('active');
      document.getElementById('viewList').classList.add('active');
      renderPosts();
    }
    skipDeleteConfirm = !!prefs.skipDeleteConfirm;
    resetDeleteConfirmCheckbox.checked = !skipDeleteConfirm;
  });

  resetDeleteConfirmCheckbox.addEventListener('change', () => {
    skipDeleteConfirm = !resetDeleteConfirmCheckbox.checked;
    window.postSnap.setPref('skipDeleteConfirm', skipDeleteConfirm);
  });

  // Search / sort events
  document.getElementById('searchBox').addEventListener('input', renderPosts);
  sortSelect.addEventListener('change', renderPosts);

  // --- Settings: save folder ---
  const saveFolderPath = document.getElementById('saveFolderPath');
  window.postSnap.getConfig().then((cfg) => {
    if (saveFolderPath) saveFolderPath.textContent = cfg.saveFolder || '';
  });

  document.getElementById('chooseFolderBtn').addEventListener('click', async () => {
    const { saveFolder } = await window.postSnap.pickSaveFolder();
    if (saveFolderPath) saveFolderPath.textContent = saveFolder || '';
    loadPosts();
  });

  // --- Export ZIP ---
  document.getElementById('exportZip').addEventListener('click', async () => {
    if (allPosts.length === 0) {
      showToast(MSG.noData);
      return;
    }
    showToast(MSG.exporting);

    const zip = new JSZip();
    const metadata = [];

    for (let i = 0; i < allPosts.length; i++) {
      const p = allPosts[i];
      const filename = `${buildFilename(p, i)}.jpg`;

      if (p.image) {
        const dataUrl = await window.postSnap.imageDataUrl(p.image);
        const base64 = dataUrl ? dataUrl.split(',')[1] : '';
        if (base64) {
          zip.file(`images/${filename}`, base64, { base64: true });
        }
      }

      metadata.push({
        url: p.url,
        platform: p.platform,
        text: p.text,
        displayName: p.displayName,
        screenName: p.screenName,
        userId: p.userId,
        likes: p.likes,
        reposts: p.reposts,
        replies: p.replies,
        bookmarks: p.bookmarks,
        views: p.views ?? null,
        mediaType: p.mediaType || null,
        lang: p.lang || null,
        isReply: p.isReply || null,
        isQuote: p.isQuote || null,
        isThread: p.isThread || null,
        quotedUrl: p.quotedUrl || null,
        date: p.date,
        capturedAt: p.capturedAt,
        tags: p.tags?.length ? p.tags : null,
        imageFile: `images/${filename}`
      });
    }

    zip.file('metadata.json', JSON.stringify(metadata, null, 2));

    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const res = await window.postSnap.exportSave(`post-snap-export-${formatExportDate()}.zip`, bytes);
    if (res.saved) showToast(MSG.exported);
  });

  // --- Export HTML ---
  document.getElementById('exportHtml').addEventListener('click', async () => {
    if (allPosts.length === 0) {
      showToast(MSG.noData);
      return;
    }
    showToast(MSG.exporting);

    const postsData = [];
    for (const p of allPosts) {
      const image = p.image ? await window.postSnap.imageDataUrl(p.image) : null;
      postsData.push({
        url: p.url,
        platform: p.platform,
        text: p.text,
        displayName: p.displayName,
        screenName: p.screenName,
        userId: p.userId,
        likes: p.likes,
        reposts: p.reposts,
        replies: p.replies,
        bookmarks: p.bookmarks,
        views: p.views ?? null,
        mediaType: p.mediaType || null,
        lang: p.lang || null,
        isReply: p.isReply || null,
        isQuote: p.isQuote || null,
        isThread: p.isThread || null,
        quotedUrl: p.quotedUrl || null,
        date: p.date,
        capturedAt: p.capturedAt,
        tags: p.tags?.length ? p.tags : null,
        image
      });
    }

    const html = buildExportHtml(postsData);
    const bytes = new TextEncoder().encode(html);
    const res = await window.postSnap.exportSave(`post-snap-export-${formatExportDate()}.html`, bytes);
    if (res.saved) showToast(MSG.exported);
  });

  // --- Import from HTML ---
  document.getElementById('importHtml').addEventListener('click', () => {
    document.getElementById('importHtmlInput').click();
  });

  document.getElementById('importHtmlInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast(MSG.importing);

    try {
      const text = await readFileAsText(file);
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      const scriptEl = doc.getElementById('postSnapData');
      if (!scriptEl) {
        showToast(MSG.importFailed);
        e.target.value = '';
        return;
      }

      const postsData = JSON.parse(scriptEl.textContent);
      const { imported, skipped } = await window.postSnap.importPosts(postsData);
      await loadPosts();
      e.target.value = '';

      if (skipped > 0) {
        showToast(MSG.importSkipped(imported, skipped));
      } else {
        showToast(MSG.imported(imported));
      }
    } catch {
      showToast(MSG.importFailed);
      e.target.value = '';
    }
  });

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
      const toDelete = allPosts.filter(p => selectedSet.has((p.url || '') + '|' + (p.capturedAt || '')));
      const count = toDelete.length;
      for (const p of toDelete) {
        await window.postSnap.deletePost(p.image);
      }
      selectedSet.clear();
      pendingBulkDelete = false;
      exitSelectMode();
      await loadPosts();
      showToast(MSG.deletedN(count));
    } else if (pendingDeletePost) {
      // Individual post delete
      if (document.getElementById('confirmSkip').checked) {
        skipDeleteConfirm = true;
        window.postSnap.setPref('skipDeleteConfirm', true);
      }
      await executeDeletePost(pendingDeletePost);
      pendingDeletePost = null;
    } else {
      // Clear all data (deletes every image + sidecar in the save folder)
      await window.postSnap.clearAll();
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
<title>Post Snap Export</title>
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
.badge.x{background:#000}.badge.bluesky{background:#0085ff}.badge.misskey{background:#96d04a;color:#333}.badge.mastodon{background:#6364ff}
.meta .text{font-size:13px;color:#555;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:6px}
.meta .stats{display:flex;gap:12px;font-size:12px;color:#999}
.meta .date{font-size:11px;color:#bbb;margin-top:4px}
.empty{text-align:center;padding:60px 20px;color:#999}
</style>
</head>
<body>
<h1>Post Snap Export</h1>
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
</select>
<span class="count" id="cnt"></span>
</div>
<div class="grid" id="g"></div>
<div class="empty" id="e" style="display:none"></div>
<script id="postSnapData" type="application/json">${JSON.stringify(postsData).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))}</script>
<script>
(function(){
var posts=JSON.parse(document.getElementById('postSnapData').textContent);
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
+'</div>'+(p.text?'<div class="text">'+esc(p.text)+'</div>':'')
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
  if (window.postSnap.onPostsChanged) {
    window.postSnap.onPostsChanged(async () => {
      await loadPosts();
      if (document.getElementById('panelTags').classList.contains('active')) renderHashtags();
    });
  }
  renderQueryChips();
  loadPosts();
})();
