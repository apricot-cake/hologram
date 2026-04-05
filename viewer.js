(async () => {
  // --- i18n ---
  const langResult = await chrome.storage.local.get('language');
  const lang = langResult.language || 'auto';
  const isJa = lang === 'auto' ? navigator.language.startsWith('ja') : lang === 'ja';
  const MSG = isJa ? {
    tabPosts: '投稿',
    tabSettings: '設定',
    searchPlaceholder: 'テキスト・ユーザー名で検索',
    sortDateDesc: '新しい順',
    sortDateAsc: '古い順',
    sortLikes: 'いいね順',
    sortReposts: 'リポスト順',
    sortReplies: '返信順',
    sortCaptured: 'キャプチャ日時順',
    filterAll: 'すべて',
    postCount: (n) => `${n} 件`,
    emptyTitle: '投稿がありません',
    emptyDesc: 'SNSで投稿を保存すると、ここに表示されます。',
    emptySearchTitle: '見つかりませんでした',
    emptySearchDesc: '検索条件を変更してください。',
    downloadTitle: 'ダウンロード',
    labelFolder: '保存フォルダ名',
    hintFolder: 'ダウンロードフォルダ内のサブフォルダ',
    labelSaveAs: '毎回保存先を確認する',
    hintSaveAs: 'キャプチャごとに「名前を付けて保存」ダイアログを表示',
    hintBackup: 'ダウンロードフォルダへの画像保存は、拡張機能を削除した場合でもデータを復元するためのバックアップです。',
    save: '保存',
    saved: '保存しました',
    invalidFolder: '無効なフォルダ名',
    langTitle: '言語',
    langAuto: '自動（ブラウザ設定に従う）',
    hintLang: 'バナーとビューアの表示言語を変更します。変更後にページがリロードされます。',
    shortcutTitle: 'キーボードショートカット',
    shortcutLink: 'ショートカットを変更',
    hintShortcut: '拡張機能のショートカット設定ページを開きます。初期値: Alt+S（保存）、Alt+V（ビューア・設定）',
    dataTitle: 'データ',
    exportZip: 'ZIP エクスポート',
    exportHtml: 'HTML エクスポート',
    importImages: 'フォルダから復元',
    importHtml: 'HTML から復元',
    hintExport: 'ZIP: データ取り出し用（画像 + メタデータJSON）。HTML: ブラウザで閲覧用（検索UI付き）。',
    dangerTitle: '危険な操作',
    labelResetDeleteConfirm: '投稿削除時に確認を表示する',
    hintResetDeleteConfirm: '「今後表示しない」を選んだ場合にここで戻せます',
    clearData: '全データを削除',
    confirmClear: '保存済みの投稿データをすべて削除しますか？この操作は元に戻せません。ダウンロード済みの画像ファイルは削除されません。',
    confirmOk: '削除する',
    confirmCancel: 'キャンセル',
    cleared: 'データを削除しました',
    exporting: 'エクスポート中...',
    exported: 'エクスポートしました',
    importing: 'インポート中...',
    imported: (n) => `${n} 件インポートしました`,
    importSkipped: (n, s) => `${n} 件インポート（${s} 件は既存のためスキップ）`,
    noData: 'エクスポートするデータがありません',
    importFailed: 'インポートに失敗しました',
    engagementLikes: 'いいね（全SNS）',
    engagementReposts: 'リポスト（全SNS）',
    engagementReplies: '返信（全SNS）',
    engagementBookmarks: 'ブックマーク（Xのみ）',
    engagementViews: '閲覧数（Xのみ）',
    engagementSuffix: '以上',
    selectMode: '選択',
    selectAll: 'すべて選択',
    deselectAll: '選択解除',
    cancelSelect: 'キャンセル',
    deleteSelected: '投稿を削除',
    selectedCount: (n) => `${n} 件選択中`,
    confirmDeleteSelected: (n) => `${n} 件の投稿を削除しますか？`,
    deletedN: (n) => `${n} 件削除しました`,
    confirmDeletePost: 'この投稿を削除しますか？',
    confirmSkip: '今後表示しない',
    deleted: '削除しました',
    dateTypePost: '投稿日',
    dateTypeCaptured: 'キャプチャ日',
    clickToExpand: 'クリックで全文表示',
    tipZoom: '拡大', tipEdit: '編集', tipDelete: '削除',
    postedOn: (d) => `${d} に投稿`,
    captured: (d) => `${d} にキャプチャ`,
    statsNote: 'エンゲージメントはキャプチャ時点の値です',
    likes: (n) => n != null ? `${formatCount(n)}` : '',
    reposts: (n) => n != null ? `${formatCount(n)} RT` : '',
    replies: (n) => n != null ? `${formatCount(n)}` : '',
    bookmarks: (n) => n != null ? `${formatCount(n)}` : '',
    tagsLabel: 'タグ',
    addTag: '追加',
    tagPlaceholder: 'タグを入力',
    applyToSelected: '選択に適用',
    qfPlatform: 'プラットフォーム',
    qfPostType: '投稿タイプ',
    qfDate: '日付',
    qfEngagement: 'エンゲージメント',
    qfTag: 'タグ',
    qfMedia: 'メディア',
    qfPost: 'ポスト',
    qfReply: 'リプライ',
    qfQuote: '引用',
    qfThread: 'セルフリプ',
    qfImage: '画像',
    qfVideo: '動画',
    qfGif: 'GIF',
    qfApply: '適用',
    qfDelete: '削除',
    qfDatePost: '投稿日',
    qfDateCaptured: 'キャプチャ日',
    qfDateFrom: '開始日',
    qfDateTo: '終了日',
    qfEngLikes: 'いいね（全SNS）',
    qfEngReposts: 'リポスト（全SNS）',
    qfEngReplies: '返信（全SNS）',
    qfEngBookmarks: 'ブックマーク（Xのみ）',
    qfEngViews: '閲覧数（Xのみ）',
    qfEngSuffix: '以上',
    qfEngGte: '以上',
    qfEngLte: '以下'
  } : {
    tabPosts: 'Posts',
    tabSettings: 'Settings',
    searchPlaceholder: 'Search by text or username',
    sortDateDesc: 'Newest first',
    sortDateAsc: 'Oldest first',
    sortLikes: 'Most liked',
    sortReposts: 'Most reposted',
    sortReplies: 'Most replied',
    sortCaptured: 'Captured date',
    filterAll: 'All',
    postCount: (n) => `${n} posts`,
    emptyTitle: 'No posts yet',
    emptyDesc: 'Save a post from SNS and it will appear here.',
    emptySearchTitle: 'No results found',
    emptySearchDesc: 'Try changing your search terms.',
    downloadTitle: 'Download',
    labelFolder: 'Save folder name',
    hintFolder: 'Subfolder inside your Downloads directory',
    labelSaveAs: 'Ask where to save each time',
    hintSaveAs: 'Shows a "Save As" dialog for every capture',
    hintBackup: 'Images saved to the download folder serve as a backup to restore data even if the extension is removed.',
    save: 'Save',
    saved: 'Saved',
    invalidFolder: 'Invalid folder name',
    langTitle: 'Language',
    langAuto: 'Auto (follow browser setting)',
    hintLang: 'Changes the display language for banners and viewer. Page will reload after change.',
    shortcutTitle: 'Keyboard Shortcut',
    shortcutLink: 'Change keyboard shortcut',
    hintShortcut: 'Opens the extension shortcuts page. Default: Alt+S (capture), Alt+V (viewer/settings)',
    dataTitle: 'Data',
    exportZip: 'Export ZIP',
    exportHtml: 'Export HTML',
    importImages: 'Import from folder',
    importHtml: 'Import from HTML',
    hintExport: 'ZIP: for data extraction (images + metadata JSON). HTML: for viewing in browser (with search UI).',
    dangerTitle: 'Danger Zone',
    labelResetDeleteConfirm: 'Show confirmation when deleting posts',
    hintResetDeleteConfirm: 'Re-enables the confirmation dialog if you chose "Don\'t ask again"',
    clearData: 'Delete all data',
    confirmClear: 'Delete all saved post data? This cannot be undone. Downloaded image files will not be affected.',
    confirmOk: 'Delete',
    confirmCancel: 'Cancel',
    cleared: 'Data deleted',
    exporting: 'Exporting...',
    exported: 'Exported',
    importing: 'Importing...',
    imported: (n) => `${n} posts imported`,
    importSkipped: (n, s) => `${n} imported (${s} skipped as duplicates)`,
    noData: 'No data to export',
    importFailed: 'Import failed',
    engagementLikes: 'Likes (all)',
    engagementReposts: 'Reposts (all)',
    engagementReplies: 'Replies (all)',
    engagementBookmarks: 'Bookmarks (X only)',
    engagementViews: 'Views (X only)',
    engagementSuffix: 'or more',
    selectMode: 'Select',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    cancelSelect: 'Cancel',
    deleteSelected: 'Delete posts',
    selectedCount: (n) => `${n} selected`,
    confirmDeleteSelected: (n) => `Delete ${n} posts?`,
    deletedN: (n) => `${n} posts deleted`,
    confirmDeletePost: 'Delete this post?',
    confirmSkip: 'Don\'t ask again',
    deleted: 'Deleted',
    dateTypePost: 'Post date',
    dateTypeCaptured: 'Captured',
    clickToExpand: 'Click to expand',
    tipZoom: 'Zoom', tipEdit: 'Edit', tipDelete: 'Delete',
    postedOn: (d) => `Posted ${d}`,
    captured: (d) => `Captured ${d}`,
    statsNote: 'Engagement counts are from the time of capture',
    likes: (n) => n != null ? `${formatCount(n)}` : '',
    reposts: (n) => n != null ? `${formatCount(n)} RT` : '',
    replies: (n) => n != null ? `${formatCount(n)}` : '',
    bookmarks: (n) => n != null ? `${formatCount(n)}` : '',
    tagsLabel: 'Tags',
    addTag: 'Add',
    tagPlaceholder: 'Enter tag',
    applyToSelected: 'Apply to selected',
    qfPlatform: 'Platform',
    qfPostType: 'Post type',
    qfDate: 'Date',
    qfEngagement: 'Engagement',
    qfTag: 'Tags',
    qfMedia: 'Media',
    qfPost: 'Post',
    qfReply: 'Reply',
    qfQuote: 'Quote',
    qfThread: 'Self-reply',
    qfImage: 'Image',
    qfVideo: 'Video',
    qfGif: 'GIF',
    qfApply: 'Apply',
    qfDelete: 'Delete',
    qfDatePost: 'Post date',
    qfDateCaptured: 'Captured',
    qfDateFrom: 'From',
    qfDateTo: 'To',
    qfEngLikes: 'Likes (all)',
    qfEngReposts: 'Reposts (all)',
    qfEngReplies: 'Replies (all)',
    qfEngBookmarks: 'Bookmarks (X only)',
    qfEngViews: 'Views (X only)',
    qfEngSuffix: 'or more',
    qfEngGte: '≥',
    qfEngLte: '≤'
  };

  // --- Apply i18n to static elements ---
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const setAttr = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };

  setText('tabPosts', MSG.tabPosts);
  setText('tabSettings', MSG.tabSettings);
  setAttr('searchBox', 'placeholder', MSG.searchPlaceholder);
  setText('settingsDownloadTitle', MSG.downloadTitle);
  setText('labelFolder', MSG.labelFolder);
  setText('hintFolder', MSG.hintFolder);
  setText('labelSaveAs', MSG.labelSaveAs);
  setText('hintSaveAs', MSG.hintSaveAs);
  setText('hintBackup', MSG.hintBackup);
  setText('saveSettings', MSG.save);
  setText('settingsLangTitle', MSG.langTitle);
  setText('langAuto', MSG.langAuto);
  setText('hintLang', MSG.hintLang);
  document.getElementById('langSelect').value = lang;
  document.getElementById('langSelect').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ language: e.target.value });
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
          label = f.value === 'x' ? 'X' : f.value === 'bluesky' ? 'Bluesky' : 'Misskey';
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
  setText('sbActiveTitle', isJa ? 'アクティブフィルタ' : 'Active Filters');
  setText('sbPlatformTitle', MSG.qfPlatform);
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
    });
  });

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // --- Load posts ---
  async function loadPosts() {
    const result = await chrome.storage.local.get('posts');
    allPosts = result.posts || [];
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
        const to = new Date(f.to + 'T23:59:59');
        posts = posts.filter(p => p[field] && new Date(p[field]) <= to);
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
        ${p.image ? `<button class="zoom-btn" title="${MSG.tipZoom}">🔍</button><img src="${p.image}" alt="" loading="lazy">` : ''}
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
    if (url) window.open(url, '_blank');
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
    if (post.captureId) {
      chrome.runtime.sendMessage({ type: 'deleteLocalFile', captureId: post.captureId });
    }
    const idx = allPosts.findIndex(p => p.url === post.url && p.capturedAt === post.capturedAt);
    if (idx >= 0) {
      allPosts.splice(idx, 1);
      await chrome.storage.local.set({ posts: allPosts });
      renderPosts();
      showToast(MSG.deleted);
    }
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

    // Update in allPosts
    const idx = allPosts.findIndex(p => p.url === editingPost.url && p.capturedAt === editingPost.capturedAt);
    if (idx >= 0) {
      allPosts[idx].tags = tags;
      await chrome.storage.local.set({ posts: allPosts });
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
      chrome.storage.local.set({ viewMode: currentView });
      renderPosts();
    });
  });

  // Load saved view mode and skipDeleteConfirm
  const resetDeleteConfirmCheckbox = document.getElementById('resetDeleteConfirm');
  chrome.storage.local.get(['viewMode', 'skipDeleteConfirm'], (result) => {
    if (result.viewMode === 'list') {
      currentView = 'list';
      document.getElementById('viewGrid').classList.remove('active');
      document.getElementById('viewList').classList.add('active');
    }
    skipDeleteConfirm = !!result.skipDeleteConfirm;
    resetDeleteConfirmCheckbox.checked = !skipDeleteConfirm;
  });

  resetDeleteConfirmCheckbox.addEventListener('change', () => {
    skipDeleteConfirm = !resetDeleteConfirmCheckbox.checked;
    chrome.storage.local.set({ skipDeleteConfirm });
  });

  // Search / sort events
  document.getElementById('searchBox').addEventListener('input', renderPosts);
  sortSelect.addEventListener('change', renderPosts);

  // --- Settings ---
  const dirInput = document.getElementById('downloadDir');
  const saveAsCheckbox = document.getElementById('saveAs');
  const settingsStatus = document.getElementById('settingsStatus');

  chrome.storage.local.get(['downloadDirectory', 'saveAs'], (result) => {
    dirInput.value = result.downloadDirectory || '';
    saveAsCheckbox.checked = !!result.saveAs;
  });

  document.getElementById('saveSettings').addEventListener('click', () => {
    const value = dirInput.value.trim();
    if (value && /[.]{2}|[/\\]/.test(value)) {
      settingsStatus.textContent = MSG.invalidFolder;
      settingsStatus.style.color = '#f4212e';
      settingsStatus.classList.add('show');
      setTimeout(() => {
        settingsStatus.classList.remove('show');
        settingsStatus.style.color = '';
        settingsStatus.textContent = MSG.saved;
      }, 2000);
      return;
    }
    chrome.storage.local.set({
      downloadDirectory: value || '',
      saveAs: saveAsCheckbox.checked
    }, () => {
      settingsStatus.textContent = MSG.saved;
      settingsStatus.classList.add('show');
      setTimeout(() => settingsStatus.classList.remove('show'), 1500);
    });
  });

  document.getElementById('shortcutLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // Build hash
  chrome.runtime.sendMessage({ type: 'getBuildHash' }, (res) => {
    const el = document.getElementById('buildInfo');
    if (el) el.textContent = `Build: ${res?.hash || 'unknown'}`;
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
        const base64 = p.image.split(',')[1];
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
        isReply: p.isReply || null,
        isQuote: p.isQuote || null,
        isThread: p.isThread || null,
        date: p.date,
        capturedAt: p.capturedAt,
        tags: p.tags?.length ? p.tags : null,
        imageFile: `images/${filename}`
      });
    }

    zip.file('metadata.json', JSON.stringify(metadata, null, 2));

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `post-snap-export-${formatExportDate()}.zip`);
    showToast(MSG.exported);
  });

  // --- Export HTML ---
  document.getElementById('exportHtml').addEventListener('click', async () => {
    if (allPosts.length === 0) {
      showToast(MSG.noData);
      return;
    }
    showToast(MSG.exporting);

    const postsData = allPosts.map(p => ({
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
      isReply: p.isReply || null,
      isQuote: p.isQuote || null,
      isThread: p.isThread || null,
      date: p.date,
      capturedAt: p.capturedAt,
      tags: p.tags?.length ? p.tags : null,
      image: p.image
    }));

    const html = buildExportHtml(postsData);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, `post-snap-export-${formatExportDate()}.html`);
    showToast(MSG.exported);
  });

  // --- Import from images ---
  document.getElementById('importImages').addEventListener('click', () => {
    document.getElementById('importImagesInput').click();
  });

  document.getElementById('importImagesInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).filter(f => /\.jpe?g$/i.test(f.name));
    if (files.length === 0) return;
    showToast(MSG.importing);

    let imported = 0;
    let skipped = 0;

    for (const file of files) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const exifData = readExifJson(dataUrl);
        if (!exifData) continue;

        const existing = allPosts.find(p => p.url === exifData.url);
        if (existing) { skipped++; continue; }

        allPosts.push({
          url: exifData.url,
          platform: exifData.platform,
          text: exifData.text,
          displayName: exifData.displayName,
          screenName: exifData.screenName,
          userId: exifData.userId,
          likes: exifData.likes,
          reposts: exifData.reposts,
          replies: exifData.replies,
          bookmarks: exifData.bookmarks,
          isReply: exifData.isReply || null,
          isQuote: exifData.isQuote || null,
          isThread: exifData.isThread || null,
          date: exifData.date,
          capturedAt: new Date().toISOString(),
          tags: exifData.tags?.length ? exifData.tags : [],
          image: dataUrl
        });
        imported++;
      } catch {
        // skip invalid files
      }
    }

    await chrome.storage.local.set({ posts: allPosts });
    renderPosts();
    e.target.value = '';

    if (skipped > 0) {
      showToast(MSG.importSkipped(imported, skipped));
    } else {
      showToast(MSG.imported(imported));
    }
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
      let imported = 0;
      let skipped = 0;

      for (const p of postsData) {
        const existing = allPosts.find(ep => ep.url === p.url);
        if (existing) { skipped++; continue; }
        allPosts.push({
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
          isReply: p.isReply || null,
          isQuote: p.isQuote || null,
          isThread: p.isThread || null,
          date: p.date,
          capturedAt: p.capturedAt || new Date().toISOString(),
            tags: p.tags?.length ? p.tags : [],
          image: p.image
        });
        imported++;
      }

      await chrome.storage.local.set({ posts: allPosts });
      renderPosts();
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
      // Bulk delete selected posts — also delete local files
      allPosts.forEach(p => {
        if (p.captureId && selectedSet.has((p.url || '') + '|' + (p.capturedAt || ''))) {
          chrome.runtime.sendMessage({ type: 'deleteLocalFile', captureId: p.captureId });
        }
      });
      const count = selectedSet.size;
      allPosts = allPosts.filter(p => !selectedSet.has((p.url || '') + '|' + (p.capturedAt || '')));
      await chrome.storage.local.set({ posts: allPosts });
      selectedSet.clear();
      pendingBulkDelete = false;
      exitSelectMode();
      renderPosts();
      showToast(MSG.deletedN(count));
    } else if (pendingDeletePost) {
      // Individual post delete
      if (document.getElementById('confirmSkip').checked) {
        skipDeleteConfirm = true;
        chrome.storage.local.set({ skipDeleteConfirm: true });
      }
      await executeDeletePost(pendingDeletePost);
      pendingDeletePost = null;
    } else {
      // Clear all data
      await chrome.storage.local.remove('posts');
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

  // --- EXIF reading ---
  function readExifJson(dataUrl) {
    try {
      const exifObj = piexif.load(dataUrl);
      const xpComment = exifObj['0th']?.[piexif.ImageIFD.XPComment];
      if (!xpComment || !Array.isArray(xpComment)) return null;
      const jsonStr = decodeUCS2LE(xpComment);
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  function decodeUCS2LE(bytes) {
    let str = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = bytes[i] | (bytes[i + 1] << 8);
      if (code === 0) break;
      str += String.fromCharCode(code);
    }
    return str;
  }

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
.badge.x{background:#000}.badge.bluesky{background:#0085ff}.badge.misskey{background:#96d04a;color:#333}
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
</select>
<span class="count" id="cnt"></span>
</div>
<div class="grid" id="g"></div>
<div class="empty" id="e" style="display:none"></div>
<script id="postSnapData" type="application/json">${JSON.stringify(postsData)}</script>
<script>
(function(){
var posts=JSON.parse(document.getElementById('postSnapData').textContent);
var q=document.getElementById('q'),s=document.getElementById('sort'),pf=document.getElementById('pf');
function esc(t){var d=document.createElement('div');d.textContent=t;return d.innerHTML}
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
return '<div class="card" onclick="window.open(\\''+esc(p.url||'')+'\\',\\'_blank\\')">'
+(p.image?'<img src="'+p.image+'" loading="lazy">':'')
+'<div class="meta"><div class="user"><span class="badge '+(p.platform||'')+'">'+(p.platform||'').toUpperCase()+'</span>'+esc(p.displayName||p.screenName||'')
+(p.screenName?' <span style="color:#999;font-weight:400">@'+esc(p.screenName)+'</span>':'')
+'</div>'+(p.text?'<div class="text">'+esc(p.text)+'</div>':'')
+'<div class="stats">'+st.join(' &middot; ')+'</div>'
+'<div class="date">'+fmtDate(p.date)+'</div></div></div>'
}).join('')}
q.addEventListener('input',render);s.addEventListener('change',render);pf.addEventListener('change',render);
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

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  // --- Debug: dummy data (unpacked extension only) ---
  if (!('update_url' in chrome.runtime.getManifest())) {
    const debugSection = document.getElementById('debugSection');
    const injectBtn = document.getElementById('injectDummy');
    if (debugSection && injectBtn) {
      debugSection.style.display = '';
      injectBtn.textContent = isJa ? 'ダミーデータ投入（50件）' : 'Inject dummy data (50 posts)';
      injectBtn.addEventListener('click', () => {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('scripts/inject-dummy.js');
        document.head.appendChild(s);
        s.onload = () => s.remove();
      });

      // Verify latest capture
      const verifyBtn = document.getElementById('verifyLatest');
      const verifyResult = document.getElementById('verifyResult');
      verifyBtn.addEventListener('click', async () => {
        const result = await chrome.storage.local.get('posts');
        const posts = result.posts || [];
        if (posts.length === 0) {
          verifyResult.style.display = 'block';
          verifyResult.textContent = 'No posts found.';
          return;
        }
        const p = posts[posts.length - 1];
        const fields = [
          ['url', p.url],
          ['platform', p.platform],
          ['displayName', p.displayName],
          ['screenName', p.screenName],
          ['userId', p.userId],
          ['text', p.text?.substring(0, 120) + (p.text?.length > 120 ? '...' : '')],
          ['likes', p.likes],
          ['reposts', p.reposts],
          ['replies', p.replies],
          ['bookmarks', p.bookmarks],
          ['views', p.views],
          ['date', p.date],
          ['capturedAt', p.capturedAt],
          ['captureId', p.captureId],
          ['mediaType', p.mediaType],
          ['lang', p.lang],
          ['isReply', p.isReply],
          ['isQuote', p.isQuote],
          ['isThread', p.isThread],
          ['quotedUrl', p.quotedUrl],
          ['tags', JSON.stringify(p.tags)],
          ['hasImage', !!p.image],
        ];
        const warnings = [];
        if (!p.url) warnings.push('WARN: url is empty');
        if (!p.platform) warnings.push('WARN: platform is empty');
        if (!p.displayName && !p.screenName) warnings.push('WARN: no user info');
        if (p.likes == null && p.reposts == null) warnings.push('WARN: no engagement data');
        if (!p.date) warnings.push('WARN: date is empty');
        if (!p.captureId) warnings.push('WARN: captureId is empty');
        if (!p.image) warnings.push('WARN: no image data');

        const lines = fields.map(([k, v]) => `${k}: ${v ?? '(null)'}`);
        if (warnings.length) lines.push('', '--- Warnings ---', ...warnings);
        else lines.push('', '✓ All fields look good');

        const text = lines.join('\n');
        verifyResult.style.display = 'block';
        verifyResult.textContent = text;
        // Save to local file
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        await chrome.downloads.download({ url, filename: 'post-snap-verify.txt', conflictAction: 'overwrite' });
        URL.revokeObjectURL(url);
        showToast(isJa ? '検証結果を保存しました' : 'Verification saved');
      });
    }
  }

  // --- Init ---
  renderQueryChips();
  loadPosts();
})();
