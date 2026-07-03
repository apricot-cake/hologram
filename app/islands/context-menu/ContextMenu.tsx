import { useSyncExternalStore, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';

// Glass context-menu host — ONE always-mounted instance that renders whatever
// window.corpusContextMenu currently holds (or nothing). viewer.js owns the menu's
// data + actions; this island only draws the glass popup and dispatches clicks back
// through corpusContextMenu.pick(). Replaces the per-menu hand-rolled builders in
// viewer.js (innerHTML template + show/hide/clamp/outside-click/Escape), which were
// duplicated across the collection / poster / … context menus.
//
// Emits the SAME DOM the old builders did (.fold-menu > .fm-row/.fm-sep, with
// .fm-name + optional .fm-check, and .fm-danger / .fm-manage modifiers) so the menu
// CSS is unchanged. Labels are provided already-localized by viewer (no i18n here).

// Geometric check, matching viewer.js CHECK_SVG (used for toggle/assignment rows).
const Check = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="5 12.5 10 17 19 7" />
  </svg>
);

export function ContextMenuHost() {
  const menu = useSyncExternalStore(window.corpusContextMenu.subscribe, window.corpusContextMenu.get);
  const popRef = useRef<HTMLDivElement | null>(null);

  // Position at (x, y); clamp into the viewport once the size is known (mirrors
  // viewer.js clampIntoView). Re-runs whenever the menu model changes.
  useLayoutEffect(() => {
    if (!menu) return;
    const pop = popRef.current;
    if (!pop) return;
    let left = menu.x,
      top = menu.y;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    // offsetWidth/Height, not the rect — measured mid-corpusPopIn the rect is scaled .96
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    if (left + w > innerWidth - 8) left = Math.max(8, innerWidth - w - 8);
    if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }, [menu]);

  // Dismiss on outside-click (capture) / Escape, like the old per-menu listeners.
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && popRef.current.contains(e.target as Node)) return;
      window.corpusContextMenu.close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.corpusContextMenu.close();
    };
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (!menu) return null;
  return createPortal(
    <div className="fold-menu show" ref={popRef}>
      {menu.items.map((it, i) =>
        it.sep ? (
          <div key={i} className="fm-sep" />
        ) : (
          <div key={i} className={'fm-row' + (it.danger ? ' fm-danger' : '') + (it.manage ? ' fm-manage' : '')} onClick={() => window.corpusContextMenu.pick(it)}>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: established SVG-glyph pattern — icon strings are app-defined constants from viewer.js, never user content */}
            {it.icon && <span className="fm-ic" dangerouslySetInnerHTML={{ __html: it.icon }} />}
            <span className="fm-name">{it.label}</span>
            {it.checked && (
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
