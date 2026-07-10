import { useSyncExternalStore } from 'react';
import { t } from '../_shared/i18n.ts';
import { postIdKey } from '../../renderer/records.ts';
import { isAllSelected, selectedGroups } from '../../renderer/selection.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../../renderer/store.ts';

// Bulk-action bar (#selectionBar), shown when 1+ cards are selected. Self-derived (P4-B
// slice⑱): count/allSelected/groupDisabled come straight from corpusStore's 'selectedSet'
// (the single source of truth since slice⑬) + 'postGroups' (slice⑩), reusing
// renderer/selection.ts's own isAllSelected/selectedGroups instead of re-deriving the
// same logic here — no more viewer-pushed model. The container (#selectionBar) stays
// viewer's — it owns show/hide and the delegated click handler; React owns only the
// children. Clicks are NOT handled here: each button carries data-act and the click
// bubbles to viewer's #selectionBar delegation. The button IDs match the old static HTML
// so scripts/_verify-select.js (getElementById(...).click() / offsetParent) is unchanged.
const subSelectedSet = (cb: () => void) => storeSubscribe('selectedSet', cb);
const getSelectedSet = () => storeGet('selectedSet') as Set<string> | undefined;
const subPostGroups = (cb: () => void) => storeSubscribe('postGroups', cb);
const getPostGroups = () => storeGet('postGroups') as any[] | null | undefined;

export function SelectionBar() {
  const selectedSet = useSyncExternalStore(subSelectedSet, getSelectedSet);
  const postGroups = useSyncExternalStore(subPostGroups, getPostGroups);
  const count = selectedSet ? selectedSet.size : 0;
  if (count === 0) return null;
  const groups = postGroups || [];
  const allSelected = isAllSelected(groups, postIdKey);
  // Manual grouping needs at least two selected cards (groups).
  const groupDisabled = selectedGroups(groups, postIdKey).length < 2;
  return (
    <>
      <span className="post-count" id="selectedCount">
        {t('selectedCount', [count])}
      </span>
      <button className="btn-outline" id="selectAllBtn" type="button" data-act="selectAll">
        {allSelected ? t('deselectAll') : t('selectAll')}
      </button>
      <button className="btn-outline" id="tagSelectedBtn" type="button" data-act="tag">
        {t('tagSelected')}
      </button>
      <button className="btn-outline" id="folderSelectedBtn" type="button" data-act="folder">
        {t('folderSelected')}
      </button>
      <button className="btn-outline" id="groupSelectedBtn" type="button" data-act="group" disabled={groupDisabled}>
        {t('groupSelected')}
      </button>
      <button className="btn-danger" id="deleteSelectedBtn" type="button" data-act="delete">
        {t('deleteSelected')}
      </button>
      <button className="btn-outline" id="cancelSelectBtn" type="button" data-act="cancel">
        {t('cancelSelect')}
      </button>
    </>
  );
}
