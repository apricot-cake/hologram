import { useSyncExternalStore, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import { TagEditor } from '../_shared/TagEditor.tsx';
import { subscribe, get } from '../../renderer/tag-pop.ts';

// One always-mounted host that renders whatever tag-pop.ts's bridge currently holds
// (or nothing) — same shape as QfPopHost/ContextMenu. Solid material (.fold-menu,
// NOT glass): #136's readability policy reserves glass for icon-only chrome, and
// this pop carries text (chips/labels) throughout — same call qf-popover/fold-menu
// already made. Reusing the .fold-menu.show class also gets tag-pop the existing
// Esc-priority guard for free: DetailDismiss's handleEscDismissDetail (inspector-
// builder.ts) already bails when `.fold-menu.show` is in the DOM, so the inspector's
// own Esc never fires while this pop is open — no separate guard entry needed.

// Right-anchored beside the triggering card/button, flipping to its LEFT when the
// pop would overflow the right edge (unlike qf-pop's sidebar rows, which are always
// flush against the left edge and never need to flip). Vertical: clamp to the
// viewport and cap max-height so the picker's own internal scroll (.edit-picker)
// takes over instead of the pop running off-screen. Measures via offsetWidth/Height,
// NOT getBoundingClientRect — this effect runs mid corpusPopIn scale(.96), which
// would under-measure by ~4% (same trap QfPop.tsx's usePlaceFlyout documents).
function usePlaceTagPop(popRef: RefObject<HTMLDivElement | null>, anchorRect: CorpusAnchorRect | null | undefined) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: popRef is a stable ref — anchorRect is the only reposition trigger
  useLayoutEffect(() => {
    if (!anchorRect) return;
    const pop = popRef.current;
    if (!pop) return;
    pop.style.maxHeight = '';
    const w = pop.offsetWidth;
    let left = anchorRect.right + 8;
    if (left + w > innerWidth - 8) left = Math.max(8, anchorRect.left - 8 - w);
    pop.style.left = left + 'px';
    pop.style.top = anchorRect.top + 'px';
    const h = pop.offsetHeight;
    let top = anchorRect.top;
    if (top + h > innerHeight - 8) {
      top = Math.max(8, innerHeight - h - 8);
      pop.style.top = top + 'px';
    }
    pop.style.maxHeight = innerHeight - top - 8 + 'px';
  }, [anchorRect]);
}

function TagPopBody({ model }: { model: CorpusTagPopModel }) {
  return (
    <>
      <TagEditor
        idPrefix="tp"
        className={null}
        showLabel={false}
        chipsClass="edit-current"
        addrowClass="edit-addrow"
        pickerClass="edit-picker"
        tags={model.tags}
        vocabGroups={model.vocabGroups}
        coocGroups={model.coocGroups}
        srcTags={model.srcTagsForPicker}
        labels={model.tagLabels}
        onAdd={model.onTagAdd}
        onRemove={model.onTagRemove}
        onToggle={model.onTagToggle}
        onContextMenu={model.onTagContextMenu}
        autoFocus
      />
      {model.mode === 'bulk' ? (
        <div className="tag-pop-footer">
          <span className="tag-pop-hint">{model.additiveHint}</span>
          <button type="button" className="btn-outline tag-pop-apply" onClick={model.onApply}>
            {model.applyLabel}
          </button>
        </div>
      ) : null}
    </>
  );
}

export function TagPopHost() {
  const model = useSyncExternalStore(subscribe, get);
  const popRef = useRef<HTMLDivElement | null>(null);
  usePlaceTagPop(popRef, model && model.anchorRect);

  // Dismiss on outside-click (capture) / Escape — the caller's onDismiss decides what
  // closing means (single: just close; bulk: also discard the staging list) and is
  // responsible for calling tag-pop.ts's close() itself, same division of labor as
  // EditOverlay's onCancel. Exempt the buttons that open this same pop (🏷/✎/"タグを
  // 追加"): their own click handlers already do open-or-close-if-already-open (a
  // same-card 🏷 re-click toggles shut), so letting this outside-click handler also
  // fire would double-close-then-reopen — same exemption shape as QfPopHost's .sb-row.
  useEffect(() => {
    if (!model) return;
    const onDoc = (e: MouseEvent) => {
      if (!document.contains(e.target as Node)) return;
      if (popRef.current && popRef.current.contains(e.target as Node)) return;
      if ((e.target as Element).closest('.tag-btn, .iv-tag-edit-btn, [data-act="tag"]')) return;
      model.onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') model.onDismiss();
    };
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [model]);

  if (!model) return null;
  return createPortal(
    <div className="fold-menu tag-pop show" ref={popRef} key={model.openId}>
      <TagPopBody model={model} />
    </div>,
    document.body,
  );
}
