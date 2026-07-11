import { useRef, useLayoutEffect } from 'react';
import type { Ref } from 'react';
import type { LightboxState } from '../../renderer/lightbox.ts';

// Gallery slide list orchestrator.ts builds (buildGroupGalleryItems) and the open
// state renderer/lightbox.ts owns.

// One gallery slide (image or video) plus prev/next nav and the counter. The
// slide-in animation restarts on every slide change by toggling .lb-in after a
// forced reflow — this mirrors the old showGallerySlide() in viewer.js. When the
// slide changes away from a video the <video> element unmounts, which stops
// playback, so no manual pause/load teardown is needed here.
export function Lightbox({ state, labels, onPrev, onNext }: { state: LightboxState; labels: Record<string, string>; onPrev: () => void; onNext: () => void }) {
  const { items, index, open } = state;
  const item = open ? items[index] : null;
  const mediaRef = useRef<HTMLElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: [item] is the replay trigger (not read inside) — re-run the enter animation whenever the shown item changes
  useLayoutEffect(() => {
    const visEl = mediaRef.current;
    if (!visEl) return;
    visEl.classList.remove('lb-in');
    void visEl.offsetWidth; // force a reflow so the animation can replay
    visEl.classList.add('lb-in');
  }, [item]);

  if (!item) return null;

  return (
    <>
      <button
        className="lb-nav lb-prev"
        type="button"
        aria-label={labels.lbPrev}
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
      >
        {'‹'}
      </button>
      {item.video ? <video ref={mediaRef as Ref<HTMLVideoElement>} src={item.src} controls playsInline preload="metadata" /> : <img ref={mediaRef as Ref<HTMLImageElement>} src={item.src} alt={item.alt || ''} />}
      <button
        className="lb-nav lb-next"
        type="button"
        aria-label={labels.lbNext}
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
      >
        {'›'}
      </button>
      <div className="lb-counter">{index + 1 + ' / ' + items.length}</div>
    </>
  );
}
