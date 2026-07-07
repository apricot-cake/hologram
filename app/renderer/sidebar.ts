// Sidebar bridge — the imperative→declarative bridge for the two filter-row columns:
// the POST column (#filterRows: クリップ / フォルダ / プラットフォーム / … / タグ rows,
// their badges, the 作品/キャラ progressive-disclosure rows, and the クリップ/複数画像
// toggle states) and the POSTER column (#posterFilterRows: プラットフォーム / 作品 / キャラ
// / タグ / サーバー / 日付 / フォルダ rows + badges + progressive disclosure). viewer.js
// keeps EVERY business rule (which filter a click opens, badge counts, vocab-driven
// disclosure, kind labels) and its delegated click handlers on each container; the React
// islands own rendering the rows. The islands emit the SAME DOM contract (.sb-row /
// data-qfrow / data-badge / .qf-open) so viewer's delegation and the verify/test scripts
// that click those selectors keep working unchanged.
//
// Two independent channels (post / poster) so a change in one column never re-renders the
// other. Kept SEPARATE from window.corpusStore only for symmetry with the other render
// bridges (inspector/grid): these models carry no callbacks (clicks route through viewer's
// existing delegation), so they could have lived on corpusStore, but a dedicated bridge
// keeps the sidebar models out of the shared key space. Plain IIFE on window (like
// store.js); loaded BEFORE viewer.js.
//
// post model:   see viewer.js's buildSidebarModel()      — clip/multi toggles + rows.
// poster model: see viewer.js's buildPosterSidebarModel() — rows + poster-* disclosure.
// A fresh object each render (viewer rebuilds the whole model); the island diffs it.
(function () {
  'use strict';
  // One render channel = a current model + its subscriber set. useSyncExternalStore reads
  // get() (stable ref between changes) and subscribe() (returns an unsubscribe).
  function channel<T>() {
    let current: T | null = null;
    const subs = new Set<() => void>();
    return {
      render(model: T | null) {
        current = model || null;
        for (const cb of [...subs]) {
          try {
            cb();
          } catch (_e) {
            /* ignore */
          }
        }
      },
      get() {
        return current;
      },
      subscribe(cb: () => void) {
        subs.add(cb);
        return () => subs.delete(cb);
      },
    };
  }

  const post = channel<CorpusSidebarModel>();
  const poster = channel<CorpusPosterSidebarModel>();
  window.corpusSidebar = {
    render: post.render,
    get: post.get,
    subscribe: post.subscribe,
    renderPoster: poster.render,
    getPoster: poster.get,
    subscribePoster: poster.subscribe,
  };
})();
