// Sidebar bridge — the imperative→declarative bridge for the post-mode filter-row
// column (#filterRows: クリップ / フォルダ / プラットフォーム / … / タグ rows, their
// badges, the 作品/キャラ progressive-disclosure rows, and the クリップ/複数画像 toggle
// states). viewer.js keeps EVERY business rule (which filter a click opens, badge
// counts, vocab-driven disclosure, kind labels) and its delegated #filterRows click
// handler; the React island owns rendering the rows. The island emits the SAME DOM
// contract (.sb-row / data-qfrow / data-badge / .on) so viewer's delegation and the
// verify/test scripts that click those selectors keep working unchanged.
//
// Kept SEPARATE from window.corpusStore only for symmetry with the other render
// bridges (inspector/grid): this model carries no callbacks (clicks route through
// viewer's existing #filterRows delegation), so it could have lived on corpusStore,
// but a dedicated bridge keeps the sidebar model out of the shared key space. Plain
// IIFE on window (like store.js); loaded BEFORE viewer.js.
//
// model shape: see viewer.js's buildSidebarModel() for the full field list —
//   { title, openCat, clip:{label,active,count,clearVisible,emptyTip,emptyAria},
//     multi:{label,active}, labels:{<key>}, badges:{<key>:n}, visible:{work,character} }
// A fresh object each render() (viewer rebuilds the whole model); the island diffs it.
(function () {
  'use strict';
  let current = null;
  const subs = new Set();
  const notify = () => {
    for (const cb of [...subs]) {
      try {
        cb();
      } catch (_e) {
        /* ignore */
      }
    }
  };

  function render(model) {
    current = model || null;
    notify();
  }
  function get() {
    return current;
  } // stable ref between changes (useSyncExternalStore)
  function subscribe(cb) {
    subs.add(cb);
    return () => subs.delete(cb);
  }

  window.corpusSidebar = { render, get, subscribe };
})();
