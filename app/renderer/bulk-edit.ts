// Bulk "add tags to selection" staging list — the single owner of the records/
// tags/additive-flag staged while #editOverlay is open (P4-B スライス⑭). These
// were previously plain viewer.js closure variables (editingRecords/editTags/
// editAdditive) reachable only by re-pushing a fresh corpusEditOverlay model —
// now a dedicated module holds them, addressable directly instead of via push.
// viewer.js still owns everything around a mutation: the corpusEditOverlay
// model/labels, picker-data recompute (inspectorTagPickerData closes over
// viewer-local tag vocab, so it stays there), selection lookup, IPC
// persistence, undo, render, and toast on save. additive is always true today
// (merge into each record's existing tags — no replace UI exists) but stays an
// explicit gettable flag, same as before, so onSave's undo-diff ternary is
// unchanged. Plain IIFE on window (like selection.ts); loaded BEFORE viewer.js.
(function () {
  'use strict';
  let records: CorpusPost[] = [];
  let tags: string[] = [];
  const additive = true;

  function open(recs: CorpusPost[]) {
    records = recs;
    tags = [];
  }
  function close() {
    records = [];
    tags = [];
  }
  function getRecords() {
    return records;
  }
  function getTags() {
    return tags;
  }
  function isAdditive() {
    return additive;
  }
  function add(tag: string) {
    if (!tags.includes(tag)) tags.push(tag);
  }
  function remove(tag: string) {
    const i = tags.indexOf(tag);
    if (i >= 0) tags.splice(i, 1);
  }
  function toggle(tag: string) {
    const i = tags.indexOf(tag);
    if (i >= 0) tags.splice(i, 1);
    else tags.push(tag);
  }

  const api = { open, close, getRecords, getTags, isAdditive, add, remove, toggle };
  if (typeof window !== 'undefined') window.corpusBulkEdit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
