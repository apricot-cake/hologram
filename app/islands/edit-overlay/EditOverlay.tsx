import { useSyncExternalStore } from 'react';
import { TagEditor } from '../_shared/TagEditor.tsx';
import { get, subscribe } from '../../renderer/edit-overlay.ts';

// Bulk "add tags to selection" modal body — mirrors the old #editOverlay static
// markup (label, chips, add-row, picker, cancel/save) but React-owned. The outer
// #editOverlay backdrop (show/hide, background-click-to-cancel) stays in viewer.ts;
// this renders into the empty #editOverlayBox inside it.
export function EditOverlay() {
  const m = useSyncExternalStore(subscribe, get);
  if (!m) return null;
  return (
    <>
      <label className="edit-label">{m.titleLabel}</label>
      <TagEditor
        key={m.openId}
        idPrefix="edit"
        className={null}
        showLabel={false}
        chipsClass="edit-current"
        addrowClass="edit-addrow"
        pickerClass="edit-picker"
        tags={m.tags}
        vocabGroups={m.vocabGroups}
        coocGroups={m.coocGroups}
        srcTags={m.srcTagsForPicker}
        labels={m.tagLabels}
        onAdd={m.onTagAdd}
        onRemove={m.onTagRemove}
        onToggle={m.onTagToggle}
        onContextMenu={m.onTagContextMenu}
      />
      <div className="confirm-actions">
        <button type="button" className="btn-outline" onClick={m.onCancel}>
          {m.cancelLabel}
        </button>
        <button type="button" className="btn-outline" style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }} onClick={m.onSave}>
          {m.saveLabel}
        </button>
      </div>
    </>
  );
}
