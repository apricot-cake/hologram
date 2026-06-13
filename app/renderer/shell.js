// Sidebar behaviour for the unified viewer: restore the saved search-mode
// (通常/あいまい).
//
// The top-level 投稿閲覧/画像閲覧 mode switch and the separate image-view
// (image-viewer.js) were removed — the unified post-view is the only view now
// (grouping, ○ select + manual grouping, and ℹ detail all live in viewer.js).
// Collapsible sidebar sections were dropped in the row→flyout restructure; the
// only remaining collapse (tag-group subrows) lives in viewer.js.
(function () {
  'use strict';

  // Restore the saved search mode (通常/あいまい) into the viewer.
  (async () => {
    try {
      const prefs = window.corpus.getPrefs ? await window.corpus.getPrefs() : null;
      if (prefs && window.corpusSearch) window.corpusSearch.applyMode(prefs.searchMode);
    } catch { /* ignore */ }
  })();
})();
