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
    hintShortcut: '拡張機能のショートカット設定ページを開きます。初期値: Alt+S（保存）、Alt+V（ビューア）',
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
    deleteSelected: '選択を削除',
    selectedCount: (n) => `${n} 件選択中`,
    confirmDeleteSelected: (n) => `${n} 件の投稿を削除しますか？`,
    deletedN: (n) => `${n} 件削除しました`,
    confirmDeletePost: 'この投稿を削除しますか？',
    confirmSkip: '今後表示しない',
    deleted: '削除しました',
    dateTypePost: '投稿日',
    dateTypeCaptured: 'キャプチャ日',
    captured: (d) => `${d} にキャプチャ`,
    statsNote: 'エンゲージメントはキャプチャ時点の値です',
    likes: (n) => n != null ? `${formatCount(n)}` : '',
    reposts: (n) => n != null ? `${formatCount(n)} RT` : '',
    replies: (n) => n != null ? `${formatCount(n)}` : '',
    bookmarks: (n) => n != null ? `${formatCount(n)}` : '',
    folderLabel: 'フォルダ',
    tagsLabel: 'タグ',
    addTag: '追加',
    tagPlaceholder: 'タグを入力',
    folderPlaceholder: 'フォルダ名',
    noFolder: '未分類',
    applyToSelected: '選択に適用',
    folderFilter: 'フォルダ'
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
    hintShortcut: 'Opens the extension shortcuts page. Default: Alt+S (capture), Alt+V (viewer)',
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
    deleteSelected: 'Delete selected',
    selectedCount: (n) => `${n} selected`,
    confirmDeleteSelected: (n) => `Delete ${n} posts?`,
    deletedN: (n) => `${n} posts deleted`,
    confirmDeletePost: 'Delete this post?',
    confirmSkip: 'Don\'t ask again',
    deleted: 'Deleted',
    dateTypePost: 'Post date',
    dateTypeCaptured: 'Captured',
    captured: (d) => `Captured ${d}`,
    statsNote: 'Engagement counts are from the time of capture',
    likes: (n) => n != null ? `${formatCount(n)}` : '',
    reposts: (n) => n != null ? `${formatCount(n)} RT` : '',
    replies: (n) => n != null ? `${formatCount(n)}` : '',
    bookmarks: (n) => n != null ? `${formatCount(n)}` : '',
    folderLabel: 'Folder',
    tagsLabel: 'Tags',
    addTag: 'Add',
    tagPlaceholder: 'Enter tag',
    folderPlaceholder: 'Folder name',
    noFolder: 'Unfiled',
    applyToSelected: 'Apply to selected',
    folderFilter: 'Folder'
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
  setText('chipAll', MSG.filterAll);
  setText('confirmSkipText', MSG.confirmSkip);
  setText('engagementSuffix', MSG.engagementSuffix);

  // Edit overlay i18n
  setText('editFolderLabel', MSG.folderLabel);
  setText('editTagsLabel', MSG.tagsLabel);
  document.getElementById('editFolder').placeholder = MSG.folderPlaceholder;
  document.getElementById('editTagInput').placeholder = MSG.tagPlaceholder;
  document.getElementById('editTagAdd').textContent = MSG.addTag;
  document.getElementById('editCancel').textContent = MSG.confirmCancel;
  document.getElementById('editSave').textContent = MSG.save;

  // Engagement type select
  const engagementType = document.getElementById('engagementType');
  engagementType.options[0].textContent = MSG.engagementLikes;
  engagementType.options[1].textContent = MSG.engagementReposts;
  engagementType.options[2].textContent = MSG.engagementReplies;
  engagementType.options[3].textContent = MSG.engagementBookmarks;
  engagementType.options[4].textContent = MSG.engagementViews;

  // Sort select options
  const sortSelect = document.getElementById('sortSelect');
  sortSelect.options[0].textContent = MSG.sortDateDesc;
  sortSelect.options[1].textContent = MSG.sortDateAsc;
  sortSelect.options[2].textContent = MSG.sortLikes;
  sortSelect.options[3].textContent = MSG.sortReposts;
  sortSelect.options[4].textContent = MSG.sortReplies;
  sortSelect.options[5].textContent = MSG.sortCaptured;

  // --- State ---
  let allPosts = [];
  let currentPlatform = 'all';
  let dateFrom = '';
  let dateTo = '';
  let dateField = 'date'; // 'date' or 'capturedAt'
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

    if (query) {
      posts = posts.filter(p =>
        (p.text || '').toLowerCase().includes(query) ||
        (p.screenName || '').toLowerCase().includes(query) ||
        (p.displayName || '').toLowerCase().includes(query) ||
        (p.folder || '').toLowerCase().includes(query) ||
        (p.tags || []).some(t => t.toLowerCase().includes(query))
      );
    }

    if (currentPlatform !== 'all') {
      posts = posts.filter(p => p.platform === currentPlatform);
    }

    if (dateFrom) {
      const from = new Date(dateFrom + 'T00:00:00');
      posts = posts.filter(p => p[dateField] && new Date(p[dateField]) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59');
      posts = posts.filter(p => p[dateField] && new Date(p[dateField]) <= to);
    }

    const engType = engagementType.value;
    const engMin = parseInt(document.getElementById('engagementMin').value, 10);
    if (engMin > 0) {
      posts = posts.filter(p => (p[engType] || 0) >= engMin);
    }

    const folderValue = document.getElementById('folderFilter').value;
    if (folderValue !== 'all') {
      if (folderValue === '__none') {
        posts = posts.filter(p => !p.folder);
      } else {
        posts = posts.filter(p => p.folder === folderValue);
      }
    }

    switch (sort) {
      case 'date-desc':
        posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        break;
      case 'date-asc':
        posts.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
        break;
      case 'likes-desc':
        posts.sort((a, b) => (b.likes || 0) - (a.likes || 0));
        break;
      case 'reposts-desc':
        posts.sort((a, b) => (b.reposts || 0) - (a.reposts || 0));
        break;
      case 'replies-desc':
        posts.sort((a, b) => (b.replies || 0) - (a.replies || 0));
        break;
      case 'captured-desc':
        posts.sort((a, b) => (b.capturedAt || '').localeCompare(a.capturedAt || ''));
        break;
    }

    return posts;
  }

  function updateFolderFilter() {
    const select = document.getElementById('folderFilter');
    const current = select.value;
    const folders = [...new Set(allPosts.map(p => p.folder).filter(Boolean))].sort();
    select.innerHTML = `<option value="all">${MSG.folderFilter}: ${MSG.filterAll}</option>` +
      `<option value="__none">${MSG.noFolder}</option>` +
      folders.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
    select.value = current || 'all';
  }

  function renderPosts() {
    updateFolderFilter();
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

      const dateStr = p.date ? formatDate(p.date) : '';
      const capturedStr = p.capturedAt ? MSG.captured(formatDate(p.capturedAt)) : '';
      const userName = p.displayName || p.screenName || '';
      const handle = p.screenName ? `@${p.screenName}` : '';
      const textPreview = escapeHtml(p.text || '');

      const postKey = (p.url || '') + '|' + (p.capturedAt || '');
      const isSelected = selectedSet.has(postKey);
      return `<div class="post-card${isSelected ? ' selected' : ''}" data-url="${escapeHtml(p.url || '')}" data-index="${i}" data-key="${escapeHtml(postKey)}">
        <div class="select-check">${isSelected ? '✓' : ''}</div>
        <button class="edit-btn" data-edit="${i}" title="Edit">✎</button>
        <button class="delete-btn" data-delete="${i}" title="Delete">&times;</button>
        ${p.image ? `<img src="${p.image}" alt="" loading="lazy">` : ''}
        <div class="post-meta">
          <div class="user">
            <span class="platform-badge ${p.platform || ''}">${(p.platform || '').toUpperCase()}</span>
            ${escapeHtml(userName)}${handle ? ` <span style="color:#999;font-weight:400">${escapeHtml(handle)}</span>` : ''}
          </div>
          ${textPreview ? `<div class="text">${textPreview}</div>` : ''}
          <div class="stats">${statsHtml}</div>
          <div class="date">${dateStr}</div>
          ${p.folder ? `<div class="folder-label">\ud83d\udcc1 ${escapeHtml(p.folder)}</div>` : ''}
          ${p.tags?.length ? `<div class="tags-label">${p.tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          ${capturedStr ? `<div class="date date-captured">${capturedStr}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

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
    if (e.target.closest('.delete-btn') || e.target.closest('.edit-btn')) return;
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
    document.getElementById('editFolder').value = post.folder || '';
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
    const folder = document.getElementById('editFolder').value.trim() || null;
    const tags = [...editTags];

    // Update in allPosts
    const idx = allPosts.findIndex(p => p.url === editingPost.url && p.capturedAt === editingPost.capturedAt);
    if (idx >= 0) {
      allPosts[idx].folder = folder;
      allPosts[idx].tags = tags;
      await chrome.storage.local.set({ posts: allPosts });
      renderPosts();
    }

    editingPost = null;
    document.getElementById('editOverlay').classList.remove('show');
  });

  // Platform chip buttons
  document.querySelectorAll('.chip[data-platform]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-platform]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentPlatform = chip.dataset.platform;
      renderPosts();
    });
  });

  // Date range inputs
  const dateResetBtn = document.getElementById('dateReset');
  function updateDateResetVisibility() {
    dateResetBtn.style.display = (dateFrom || dateTo) ? '' : 'none';
  }
  document.getElementById('dateFrom').addEventListener('change', (e) => {
    dateFrom = e.target.value;
    updateDateResetVisibility();
    renderPosts();
  });
  document.getElementById('dateTo').addEventListener('change', (e) => {
    dateTo = e.target.value;
    updateDateResetVisibility();
    renderPosts();
  });
  dateResetBtn.addEventListener('click', () => {
    dateFrom = ''; dateTo = '';
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    updateDateResetVisibility();
    renderPosts();
  });

  const dateTypeToggle = document.getElementById('dateTypeToggle');
  dateTypeToggle.textContent = MSG.dateTypePost;
  dateTypeToggle.addEventListener('click', () => {
    dateField = dateField === 'date' ? 'capturedAt' : 'date';
    dateTypeToggle.textContent = dateField === 'date' ? MSG.dateTypePost : MSG.dateTypeCaptured;
    dateTypeToggle.classList.toggle('active', dateField === 'capturedAt');
    renderPosts();
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

  // Search / sort / engagement / folder events
  document.getElementById('searchBox').addEventListener('input', renderPosts);
  sortSelect.addEventListener('change', renderPosts);
  engagementType.addEventListener('change', renderPosts);
  document.getElementById('engagementMin').addEventListener('input', renderPosts);
  document.getElementById('folderFilter').addEventListener('change', renderPosts);

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
        date: p.date,
        capturedAt: p.capturedAt,
        folder: p.folder || null,
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
      date: p.date,
      capturedAt: p.capturedAt,
      folder: p.folder || null,
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
          date: exifData.date,
          capturedAt: new Date().toISOString(),
          folder: exifData.folder || null,
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
          date: p.date,
          capturedAt: p.capturedAt || new Date().toISOString(),
          folder: p.folder || null,
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
      injectBtn.textContent = isJa ? 'ダミーデータ投入（8件）' : 'Inject dummy data (8 posts)';
      injectBtn.addEventListener('click', async () => {
        function makeImg(hex, label) {
          const c = document.createElement('canvas');
          c.width = 400; c.height = 300;
          const ctx = c.getContext('2d');
          ctx.fillStyle = hex; ctx.fillRect(0, 0, 400, 300);
          ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(label, 200, 160);
          return c.toDataURL('image/jpeg', 0.8);
        }
        const dummy = [
          { url:'https://x.com/test1/status/1', platform:'x', text:'TypeScriptの型パズル、解けた時の快感がすごい', displayName:'てすと太郎', screenName:'test1', userId:'111', likes:24853, reposts:3210, replies:142, bookmarks:891, date:'2026-04-04T10:30:00Z', capturedAt:'2026-04-04T12:00:00Z', image:makeImg('#14171a','X') },
          { url:'https://x.com/test2/status/2', platform:'x', text:'Good morning! Coffee and code.', displayName:'Dev Jane', screenName:'test2', userId:'222', likes:5, reposts:0, replies:1, bookmarks:0, date:'2026-04-03T01:15:00Z', capturedAt:'2026-04-03T08:00:00Z', image:makeImg('#14171a','X') },
          { url:'https://x.com/test3/status/3', platform:'x', text:'いいねゼロの投稿テスト', displayName:'サンプル花子', screenName:'test3', userId:'333', likes:0, reposts:0, replies:0, bookmarks:null, date:'2026-03-28T15:00:00Z', capturedAt:'2026-03-29T03:00:00Z', image:makeImg('#14171a','X') },
          { url:'https://bsky.app/profile/d.bsky.social/post/a1', platform:'bluesky', text:'Blueskyの空は今日も青い 🦋✨ 分散SNSの未来を感じる', displayName:'あおぞら', screenName:'d.bsky.social', userId:'did:plc:dummy001', likes:347, reposts:28, replies:12, bookmarks:null, date:'2026-04-02T08:45:00Z', capturedAt:'2026-04-02T09:00:00Z', image:makeImg('#0085ff','Bluesky') },
          { url:'https://bsky.app/profile/s.bsky.social/post/a2', platform:'bluesky', text:'This is a longer post to test text truncation. The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet consectetur adipiscing elit.', displayName:'Sky Tester', screenName:'s.bsky.social', userId:'did:plc:dummy002', likes:1, reposts:null, replies:0, bookmarks:null, date:'2026-03-20T22:00:00Z', capturedAt:'2026-03-21T06:30:00Z', image:makeImg('#0085ff','Bluesky') },
          { url:'https://misskey.io/notes/n1', platform:'misskey', text:'Misskeyからこんにちは！リアクション楽しい :blobcat:', displayName:'みすきーテスト', screenName:'mktest', userId:'mk001', likes:89, reposts:5, replies:3, bookmarks:null, date:'2026-04-01T14:20:00Z', capturedAt:'2026-04-01T14:25:00Z', image:makeImg('#96d04a','Misskey') },
          { url:'https://misskey.io/notes/n2', platform:'misskey', text:'MFMテスト ✨キラキラ✨', displayName:'ノート職人', screenName:'notemaster', userId:'mk002', likes:1502, reposts:201, replies:44, bookmarks:null, date:'2026-03-15T06:00:00Z', capturedAt:'2026-03-15T07:00:00Z', image:makeImg('#96d04a','Misskey') },
          { url:'https://x.com/big/status/4', platform:'x', text:'100万いいね目指してます', displayName:'バズりたい', screenName:'big', userId:'444', likes:987654, reposts:123456, replies:45678, bookmarks:12345, date:'2026-04-05T00:00:00Z', capturedAt:'2026-04-05T01:00:00Z', image:makeImg('#14171a','X') },
        ];
        const result = await chrome.storage.local.get('posts');
        const posts = result.posts || [];
        let added = 0;
        for (const d of dummy) {
          if (!posts.find(p => p.url === d.url)) { posts.push(d); added++; }
        }
        await chrome.storage.local.set({ posts });
        allPosts = posts;
        renderPosts();
        showToast(isJa ? `${added} 件追加` : `${added} posts added`);
      });
    }
  }

  // --- Init ---
  loadPosts();
})();
