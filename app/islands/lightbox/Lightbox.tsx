import { useRef, useLayoutEffect } from 'react';
import type { Ref } from 'react';
import type { LightboxState } from '../../renderer/lightbox.ts';

// Single-image quick-view (peek) overlay. #143 reduced the lightbox to one item —
// full gallery paging lives in the image view now — so this renders just the item
// renderer/lightbox.ts holds (the thumbnail, zoomed) plus video playback; no prev/
// next nav or counter. The enter animation restarts whenever the shown item changes
// by toggling .lb-in after a forced reflow (mirrors the old showGallerySlide()).
// When the item changes away from a video (or the peek closes) the <video> unmounts,
// which stops playback, so no manual pause/load teardown is needed here.
export function Lightbox({ state }: { state: LightboxState }) {
  const { item, open } = state;
  const mediaRef = useRef<HTMLElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: [item] is the replay trigger (not read inside) — re-run the enter animation whenever the shown item changes
  useLayoutEffect(() => {
    const visEl = mediaRef.current;
    if (!visEl) return;
    visEl.classList.remove('lb-in');
    void visEl.offsetWidth; // force a reflow so the animation can replay
    visEl.classList.add('lb-in');
  }, [item]);

  if (!open || !item) return null;

  return item.video ? <video ref={mediaRef as Ref<HTMLVideoElement>} src={item.src} controls playsInline preload="metadata" /> : <img ref={mediaRef as Ref<HTMLImageElement>} src={item.src} alt={item.alt || ''} />;
}
