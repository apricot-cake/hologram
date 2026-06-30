import { useSyncExternalStore, useLayoutEffect, useRef, useCallback } from 'react';
import { t } from './i18n.js';

// View-density toggle (card / tile / list) for the post grid. The active view is
// shared state in window.corpusStore ('view'); viewer.js reads it for layout and
// re-renders the grid on change. React owns this control's rendering AND its
// glass-thumb positioning — viewer.js's positionViewThumb explicitly EXCLUDES
// #densityToggle so there are never two writers on the same .vt-thumb element.
//
// Emits the SAME DOM the old innerHTML did (.vt-thumb + three .view-toggle buttons
// with data-view) so the .view-toggle CSS is unchanged. Icons only (vt-label is
// display:none in CSS) but we keep the labels for accessibility.

const subscribe = (cb) => window.corpusStore.subscribe('view', cb);
const getView = () => window.corpusStore.get('view') || 'card';

const reduceMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function ViewIcon({ v }) {
  if (v === 'card') {
    return <svg className="vt-ico" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5" /></svg>;
  }
  if (v === 'tile') {
    return (
      <svg className="vt-ico" viewBox="0 0 24 24">
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
      </svg>
    );
  }
  return (
    <svg className="vt-ico" viewBox="0 0 24 24" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

const VIEWS = [
  { v: 'card', key: 'viewCard' },
  { v: 'tile', key: 'viewTile' },
  { v: 'list', key: 'viewList' },
];

// `el` is the mount container (#densityToggle); React renders its children here.
export function DensityToggle({ el }) {
  const view = useSyncExternalStore(subscribe, getView);
  const thumbRef = useRef(null);
  const prevView = useRef(view);

  // Same math as viewer's positionViewThumb: width/left of the active button.
  const place = useCallback(() => {
    const thumb = thumbRef.current;
    if (!el || !thumb) return;
    const btn = el.querySelector('button.active');
    if (!btn || !btn.offsetWidth) return; // unmeasurable (font not ready / hidden) — skip
    thumb.style.width = btn.offsetWidth + 'px';
    thumb.style.left = btn.offsetLeft + 'px';
  }, [el]);

  // Position before paint when the view changes; replay the jelly pulse only on an
  // actual change (not on mount / re-measure), mirroring the old click handler.
  useLayoutEffect(() => {
    place();
    const thumb = thumbRef.current;
    if (thumb && prevView.current !== view && !reduceMotion()) {
      thumb.classList.remove('vt-sliding');
      void thumb.offsetWidth; // force reflow so the animation restarts
      thumb.classList.add('vt-sliding');
    }
    prevView.current = view;
  }, [view, place]);

  // Re-measure when the control's own box changes (sidebar scrollbar appears/
  // disappears without a window resize) or the window resizes.
  useLayoutEffect(() => {
    let ro;
    if (window.ResizeObserver && el) { ro = new ResizeObserver(place); ro.observe(el); }
    window.addEventListener('resize', place, { passive: true });
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', place); };
  }, [el, place]);

  return (
    <>
      <i className="vt-thumb" aria-hidden="true" ref={thumbRef} />
      {VIEWS.map(({ v, key }) => (
        <button
          key={v}
          type="button"
          data-view={v}
          className={v === view ? 'active' : undefined}
          onClick={() => window.corpusStore.set('view', v)}
        >
          <ViewIcon v={v} />
          <span className="vt-label">{t(key)}</span>
        </button>
      ))}
    </>
  );
}
