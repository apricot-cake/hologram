// Selection-bar bridge — the imperative→declarative bridge for #selectionBar (the bulk-
// action bar shown when 1+ cards are selected: 全選択 / タグ / フォルダ / グループ化 /
// 削除 / 選択解除 + the selected count). viewer.js keeps ALL business logic (the selection
// set, bulk tag/folder/group/delete) plus the container's show/hide and a delegated
// #selectionBar click handler that dispatches by data-act; the React island renders the
// buttons + count from the model. No callbacks (clicks route through viewer's delegation,
// same as the sidebar bridge). The button IDs (selectAllBtn / tagSelectedBtn / … ) are
// reproduced by the island so scripts/_verify-select.js's getElementById(...).click() and
// offsetParent checks keep working unchanged.
//
// model shape: see viewer.js's updateSelectionBar() —
//   { count, countLabel, selectAllLabel, groupDisabled, deleteDisabled,
//     labels:{ tag, folder, group, delete, cancel } }
// Plain IIFE on window (like store.js); loaded BEFORE viewer.js.
(function () {
  'use strict';
  let current: CorpusSelectionBarModel | null = null;
  const subs = new Set<() => void>();
  window.corpusSelectionBar = {
    render(model) {
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
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
})();
