import { useSyncExternalStore, useCallback, useState, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../_shared/i18n.js';

// Glass dropdown for the sidebar sort selects (post / poster / collection). Replaces
// viewer.js's hand-rolled enhanceSelect machinery (custom button + body-level glass
// popup), now React-owned. One component, three mounts — the options/storeKey props
// parameterize it (mirrors DensityToggle's storeKey sharing). A native <select> popup
// is OS-drawn and can't be glassed, so the native element stays hidden (.cs-host) as
// viewer's value source: on pick we drive it (set value + dispatch 'change') so the
// existing change handlers (renderPosts / renderPosters / renderCollections, and the
// per-tab sort persistence) fire UNCHANGED. The active value is mirrored into
// window.corpusStore so the trigger label updates without reading the hidden select.
//
// Emits the SAME DOM the old enhanceSelect did (.cs-btn trigger + a .fold-menu.cs-pop
// glass popup with .fm-row.cs-opt rows) so the CSS is unchanged. Option LABELS come
// from i18n keys here (not the native <select>'s textContent), so the component never
// races viewer's option-text setup and survives a language reload by re-mounting.

const ChevDown = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 3.5l4 4 4-4" />
  </svg>
);

// Geometric check (matches viewer.js CHECK_SVG used in the flyout menus).
const Check = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="5 12.5 10 17 19 7" />
  </svg>
);

// `sel` = the (now hidden) native <select> value source. `options` = [{ value, key }]
// where key is the i18n message key for the label.
export function GlassSelect({ sel, storeKey, options }) {
  const subscribe = useCallback((cb) => window.corpusStore.subscribe(storeKey, cb), [storeKey]);
  const getVal = useCallback(() => {
    const v = window.corpusStore.get(storeKey);
    return v != null ? v : sel.value; // store wins; fall back to the native select's initial value
  }, [storeKey, sel]);
  const value = useSyncExternalStore(subscribe, getVal);
  const current = options.find((o) => o.value === value) || options[0];

  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  const choose = useCallback(
    (next) => {
      // Drive the native select so viewer's existing change handlers fire, then mirror
      // into the store so the trigger label updates immediately (idempotent set => no echo).
      if (sel.value !== next) {
        sel.value = next;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      window.corpusStore.set(storeKey, next);
      setOpen(false);
    },
    [sel, storeKey],
  );

  // Position the popup under the trigger; flip up / clamp into the viewport
  // (mirrors viewer.js openCsPop).
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current,
      pop = popRef.current;
    if (!btn || !pop) return;
    const r = btn.getBoundingClientRect();
    pop.style.left = r.left + 'px';
    pop.style.top = r.bottom + 4 + 'px';
    pop.style.minWidth = r.width + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.bottom > innerHeight - 8) pop.style.top = Math.max(8, r.top - pr.height - 4) + 'px';
    if (pr.right > innerWidth - 8) pop.style.left = Math.max(8, innerWidth - pr.width - 8) + 'px';
  }, [open]);

  // Outside-click (capture) + Escape close, matching the old document listeners.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="cs-btn"
        ref={btnRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span className="cs-label">{t(current.key)}</span>
        <span className="cs-arrow">
          <ChevDown />
        </span>
      </button>
      {open &&
        createPortal(
          <div className="fold-menu cs-pop glass-frost show" ref={popRef}>
            {options.map((o) => {
              const on = o.value === current.value;
              return (
                <div key={o.value} className={'fm-row cs-opt' + (on ? ' cs-on' : '')} onClick={() => choose(o.value)}>
                  <span className="fm-name">{t(o.key)}</span>
                  {on && (
                    <span className="fm-check">
                      <Check />
                    </span>
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
