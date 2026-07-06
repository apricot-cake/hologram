import { useSyncExternalStore } from 'react';

// Bulk-action bar (#selectionBar), shown when 1+ cards are selected. Pure presentation:
// labels / count / disabled all arrive already-computed/localized from viewer.js via
// window.corpusSelectionBar (updateSelectionBar). The container (#selectionBar) stays
// viewer's — it owns show/hide and the delegated click handler; React owns only the
// children. Clicks are NOT handled here: each button carries data-act and the click
// bubbles to viewer's #selectionBar delegation. The button IDs match the old static HTML
// so scripts/_verify-select.js (getElementById(...).click() / offsetParent) is unchanged.
export function SelectionBar() {
  const m = useSyncExternalStore(window.corpusSelectionBar.subscribe, window.corpusSelectionBar.get);
  if (!m) return null;
  const L = m.labels || { tag: '', folder: '', group: '', delete: '', cancel: '' };
  return (
    <>
      <span className="post-count" id="selectedCount">
        {m.countLabel}
      </span>
      <button className="btn-outline" id="selectAllBtn" type="button" data-act="selectAll">
        {m.selectAllLabel}
      </button>
      <button className="btn-outline" id="tagSelectedBtn" type="button" data-act="tag">
        {L.tag}
      </button>
      <button className="btn-outline" id="folderSelectedBtn" type="button" data-act="folder">
        {L.folder}
      </button>
      <button className="btn-outline" id="groupSelectedBtn" type="button" data-act="group" disabled={m.groupDisabled}>
        {L.group}
      </button>
      <button className="btn-danger" id="deleteSelectedBtn" type="button" data-act="delete" disabled={m.deleteDisabled}>
        {L.delete}
      </button>
      <button className="btn-outline" id="cancelSelectBtn" type="button" data-act="cancel">
        {L.cancel}
      </button>
    </>
  );
}
