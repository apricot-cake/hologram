// Sidebar behaviour for the unified viewer: collapsible filter sections + the
// saved search-mode (通常/あいまい) restore.
//
// The top-level 投稿閲覧/画像閲覧 mode switch and the separate image-view
// (image-viewer.js) were removed — the unified post-view is the only view now
// (grouping, ○ select + manual grouping, and ℹ detail all live in viewer.js).
(function () {
  'use strict';

  // Collapsible sidebar sections (.sb-section.collapsible): click the title to
  // fold its chips. Controls inside the title (管理 link / AND-OR toggle) are ignored.
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.addEventListener('click', (e) => {
    const title = e.target.closest('.sb-title');
    if (!title || e.target.closest('button, a, input, select')) return;
    const section = title.closest('.sb-section.collapsible');
    if (section) section.classList.toggle('collapsed');
  });

  // Restore the saved search mode (通常/あいまい) into the viewer.
  (async () => {
    try {
      const prefs = window.corpus.getPrefs ? await window.corpus.getPrefs() : null;
      if (prefs && window.corpusSearch) window.corpusSearch.applyMode(prefs.searchMode);
    } catch { /* ignore */ }
  })();
})();
