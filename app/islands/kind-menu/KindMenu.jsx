import { useSyncExternalStore, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';

// Glass 種別 (tag-kind) menu — ONE always-mounted instance that renders whatever
// window.corpusKindMenu currently holds (or nothing). viewer.js owns the row model +
// pick/rename actions; this island only draws the glass popup and calls back through
// corpusKindMenu's model callbacks. A DEDICATED component (not the generic
// ContextMenu) because each row carries TWO independent click targets — the row
// itself (pick a kind) and a nested rename button (relabel that kind) — plus a
// header, none of which fit ContextMenu's item shape.
//
// Emits the SAME DOM the old imperative builder did (.fold-menu.kind-menu > .fm-head
// + .fm-row > .fm-ic/.fm-name/.fm-rename/.fm-check) so the existing CSS is unchanged.
// Labels are provided already-localized by viewer (no i18n here).

const Check = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="5 12.5 10 17 19 7" />
  </svg>
);
const Pencil = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

export function KindMenuHost() {
  const menu = useSyncExternalStore(window.corpusKindMenu.subscribe, window.corpusKindMenu.get);
  const popRef = useRef(null);

  // Position at (x, y); clamp into the viewport once the size is known (mirrors
  // viewer.js clampIntoView / the context-menu island). Re-runs whenever the model changes.
  useLayoutEffect(() => {
    if (!menu) return;
    const pop = popRef.current;
    if (!pop) return;
    let left = menu.x,
      top = menu.y;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    const r = pop.getBoundingClientRect();
    if (r.right > innerWidth - 8) left = Math.max(8, innerWidth - r.width - 8);
    if (r.bottom > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }, [menu]);

  // Dismiss on outside-click (capture) / Escape, like the old menu's listeners.
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      window.corpusKindMenu.close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') window.corpusKindMenu.close();
    };
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (!menu) return null;

  const pick = (row) => {
    window.corpusKindMenu.close();
    menu.onPick(row.kind);
  };
  const rename = (e, kind) => {
    e.stopPropagation();
    window.corpusKindMenu.close();
    menu.onRename(kind);
  };

  return createPortal(
    <div className="fold-menu kind-menu show" ref={popRef}>
      <div className="fm-head">{menu.header}</div>
      {menu.rows.map((row, i) =>
        row.sep ? (
          <div key={i} className="fm-sep" />
        ) : (
          <div key={i} className="fm-row" onClick={() => pick(row)}>
            <span className="fm-ic">{row.dot && <span className={'tk-dot tk-' + row.kind} />}</span>
            <span className="fm-name">{row.label}</span>
            {row.renameable && (
              <button type="button" className="fm-rename" title={menu.renameTitle} onClick={(e) => rename(e, row.kind)}>
                <Pencil />
              </button>
            )}
            {row.checked && (
              <span className="fm-check">
                <Check />
              </span>
            )}
          </div>
        ),
      )}
    </div>,
    document.body,
  );
}
