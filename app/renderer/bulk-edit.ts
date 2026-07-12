// Bulk "add tags to selection" staging list — the single owner of the records/
// tags/additive-flag staged while the tag-pop is open in mode:'bulk' (Issue #22;
// P4-B スライス⑭ originally staged this for the now-retired edit-overlay.ts modal
// instead). These were previously plain viewer.js closure variables
// (editingRecords/editTags/editAdditive) reachable only by re-pushing a fresh
// model — now a dedicated module holds them, addressable directly instead of via
// push. bulk-edit-builder.ts still owns everything around a mutation: the
// tag-pop.ts model/labels, picker-data recompute (inspectorTagPickerData closes
// over viewer-local tag vocab, so it stays there), selection lookup, IPC
// persistence, undo, render, and toast on apply. additive is always true today
// (merge into each record's existing tags — no replace UI exists) but stays an
// explicit gettable flag, same as before, so onApply's undo-diff ternary is
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
