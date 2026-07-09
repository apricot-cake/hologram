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
// unchanged.
let records: CorpusPost[] = [];
let tags: string[] = [];
const additive = true;

export function open(recs: CorpusPost[]) {
  records = recs;
  tags = [];
}
export function close() {
  records = [];
  tags = [];
}
export function getRecords() {
  return records;
}
export function getTags() {
  return tags;
}
export function isAdditive() {
  return additive;
}
export function add(tag: string) {
  if (!tags.includes(tag)) tags.push(tag);
}
export function remove(tag: string) {
  const i = tags.indexOf(tag);
  if (i >= 0) tags.splice(i, 1);
}
export function toggle(tag: string) {
  const i = tags.indexOf(tag);
  if (i >= 0) tags.splice(i, 1);
  else tags.push(tag);
}
