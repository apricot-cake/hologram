import { useSyncExternalStore, useLayoutEffect, useRef, useCallback } from 'react';
import { t } from '../_shared/i18n.js';

// Browse-mode segmented control (ライブラリ / 投稿者 / コレクション). The active mode is
// shared state in window.corpusStore ('browseMode'); viewer.js subscribes and runs the
// heavy orchestration (body class, grid render swap, closeDetail, setPref). React owns
// ONLY this control's rendering AND its glass-thumb positioning — viewer.js's
// positionViewThumb EXCLUDES #browseToggle so there are never two writers on the
// .vt-thumb element. (Same shape as DensityToggle; see its notes.)
//
// Emits the SAME DOM the old innerHTML did (.vt-thumb + three .view-toggle buttons with
// data-mode) so the .view-toggle / .browse-toggle CSS is unchanged. Unlike the density
// toggle, .browse-toggle shows the label on the ACTIVE button (CSS) — so the thumb width
// changes per mode — and keeps a per-button title so the icon-only inactive segments
// still name themselves on hover.

const reduceMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// SVGs transcribed verbatim from the old index.html markup (icon glyphs unchanged).
function BrowseIcon({ v }) {
  if (v === 'posts') {
    return (
      <svg className="vt-ico" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
        <rect width="7" height="7" x="3" y="3" rx="1.4" />
        <rect width="7" height="7" x="14" y="3" rx="1.4" />
        <rect width="7" height="7" x="14" y="14" rx="1.4" />
        <rect width="7" height="7" x="3" y="14" rx="1.4" />
      </svg>
    );
  }
  if (v === 'posters') {
    return (
      <svg className="vt-ico" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  }
  return (
    <svg className="vt-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </svg>
  );
}

const MODES = [
  { v: 'posts', key: 'browsePosts' },
  { v: 'posters', key: 'browsePosters' },
  { v: 'collections', key: 'browseCollections' },
];

const subscribe = (cb) => window.corpusStore.subscribe('browseMode', cb);
const getMode = () => window.corpusStore.get('browseMode') || 'posts';

// `el` is the mount container; React renders its children here.
export function BrowseToggle({ el }) {
  const mode = useSyncExternalStore(subscribe, getMode);
  const thumbRef = useRef(null);
  const prevMode = useRef(mode);

  // Same math as viewer's positionViewThumb: width/left of the active button.
  const place = useCallback(() => {
    const thumb = thumbRef.current;
    if (!el || !thumb) return;
    const btn = el.querySelector('button.active');
    if (!btn || !btn.offsetWidth) return; // unmeasurable (font not ready / hidden) — skip
    thumb.style.width = btn.offsetWidth + 'px';
    thumb.style.left = btn.offsetLeft + 'px';
  }, [el]);

  // Position before paint when the mode changes; replay the jelly pulse only on an
  // actual change (not on mount / re-measure), mirroring the old click handler.
  useLayoutEffect(() => {
    place();
    const thumb = thumbRef.current;
    if (thumb && prevMode.current !== mode && !reduceMotion()) {
      thumb.classList.remove('vt-sliding');
      void thumb.offsetWidth; // force reflow so the animation restarts
      thumb.classList.add('vt-sliding');
    }
    prevMode.current = mode;
  }, [mode, place]);

  // Re-measure when the control's own box changes (the sidebar scrollbar appears/
  // disappears as the grid count changes, without a window resize) or on resize.
  useLayoutEffect(() => {
    let ro;
    if (window.ResizeObserver && el) { ro = new ResizeObserver(place); ro.observe(el); }
    window.addEventListener('resize', place, { passive: true });
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', place); };
  }, [el, place]);

  return (
    <>
      <i className="vt-thumb" aria-hidden="true" ref={thumbRef} />
      {MODES.map(({ v, key }) => (
        <button
          key={v}
          type="button"
          data-mode={v}
          title={t(key)}
          className={v === mode ? 'active' : undefined}
          onClick={() => window.corpusStore.set('browseMode', v)}
        >
          <BrowseIcon v={v} />
          <span className="vt-label">{t(key)}</span>
        </button>
      ))}
    </>
  );
}
