import { useSyncExternalStore, useLayoutEffect, useRef, useCallback } from 'react';
import { t } from '../_shared/i18n.ts';
import { tipProps } from '../_shared/tip.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../../renderer/store.ts';

// Browse-mode segmented control (ライブラリ / 投稿者). The active mode is shared state in
// corpusStore ('browseMode'); viewer.js subscribes and runs the heavy
// orchestration (body class, grid render swap, closeDetail, setPref). React owns ONLY
// this control's rendering AND its glass-thumb positioning — viewer.js's
// positionViewThumb EXCLUDES #browseToggle so there are never two writers on the
// .vt-thumb element. (Same shape as DensityToggle; see its notes.)
// Collections are no longer a browse mode — they live as a sidebar folder list in the
// library view now (2026-07-04), so this dropped from 3 segments to 2.
//
// Emits the SAME DOM the old innerHTML did (.vt-thumb + three .view-toggle buttons with
// data-mode) so the .view-toggle CSS is unchanged. Glyph-only in every state (the
// active-label idiom is retired — 2026-07-04); segments name themselves via the
// instant .ui-tip tooltip (native title was delayed + OS-styled) and the glass
// thumb marks the active one.

const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// SVGs transcribed verbatim from the old index.html markup (icon glyphs unchanged).
function BrowseIcon({ v }: { v: string }) {
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
  return (
    <svg className="vt-ico" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

const MODES = [
  { v: 'posts', key: 'browsePosts' },
  { v: 'posters', key: 'browsePosters' },
];

const subscribe = (cb: () => void) => storeSubscribe('browseMode', cb);
const getMode = (): string => storeGet('browseMode') || 'posts';

// `el` is the mount container; React renders its children here.
export function BrowseToggle({ el }: { el: HTMLElement }) {
  const mode = useSyncExternalStore(subscribe, getMode);
  const thumbRef = useRef<HTMLElement | null>(null);
  const prevMode = useRef(mode);

  // Same math as viewer's positionViewThumb: width/left of the active button.
  const place = useCallback(() => {
    const thumb = thumbRef.current;
    if (!el || !thumb) return;
    const btn = el.querySelector<HTMLButtonElement>('button.active');
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
    let ro: ResizeObserver | undefined;
    if (window.ResizeObserver && el) {
      ro = new ResizeObserver(place);
      ro.observe(el);
    }
    window.addEventListener('resize', place, { passive: true });
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [el, place]);

  return (
    <>
      <i className="vt-thumb" aria-hidden="true" ref={thumbRef} />
      {MODES.map(({ v, key }) => (
        <button key={v} type="button" data-mode={v} {...tipProps(t(key))} className={v === mode ? 'active' : undefined} onClick={() => storeSet('browseMode', v)}>
          <BrowseIcon v={v} />
          <span className="vt-label">{t(key)}</span>
        </button>
      ))}
    </>
  );
}
