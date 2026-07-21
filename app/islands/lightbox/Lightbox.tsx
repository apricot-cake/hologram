import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { close, type LightboxState } from '../../renderer/lightbox.ts';

// Single-image quick-view (peek) overlay. #143 reduced the lightbox to one item —
// full gallery paging lives in the image view now — so this renders just the item
// renderer/lightbox.ts holds (the thumbnail, zoomed) plus video playback; no prev/
// next nav or counter.
//
// P2⑦: the overlay itself is React's now. It used to be a static #lightbox div in
// index.html that this island portaled INTO, with renderer/lightbox.ts toggling a
// `.show` class on it imperatively and registering the backdrop-click and Esc
// listeners at module load. All of that is here: the element exists only while the
// peek is open (visibility IS the conditional render), and both listeners live and
// die with it. The store stayed a store.
//
// Portaled to document.body rather than rendered in place: this is a full-screen
// scrim that must not inherit stacking or clipping from the shell it covers.
//
// The enter animation replays on a new item because `key` remounts the media
// element — no forced-reflow class dance (the old .lb-in trick). When the item
// changes away from a video (or the peek closes) the <video> unmounts, which stops
// playback, so no manual pause/load teardown is needed either.
export function Lightbox({ state }: { state: LightboxState }) {
  const { item, open } = state;

  // Esc closes the peek. Arrow keys no longer step (single item, #143). Mounted only
  // while open, so there is no open-state guard inside the handler. Bubble phase: the
  // capture-phase Esc cascade (inspector-builder's handleEscDismissDetail) yields to
  // the peek by returning early while it is open, so this gets the press.
  useEffect(() => {
    if (!open) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, [open]);

  if (!open || !item) return null;

  return createPortal(
    <div
      data-slot="lightbox"
      // Quick Look-style: lighter dim + blur so the grid ghosts behind the image
      // instead of vanishing — keeps spatial context, image still pops. z-11000 sits
      // over the content but under the shadcn Dialog/AlertDialog layers (13000+), which
      // is the order the Esc cascade assumes.
      className="fixed inset-0 z-[11000] flex cursor-zoom-out items-center justify-center bg-black/70 backdrop-blur-lg duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)] animate-in fade-in reduced-transparency:bg-black/85 reduced-transparency:backdrop-blur-none"
      // The backdrop AND the image close; video controls don't (a click on the
      // scrubber must not dismiss the thing being scrubbed).
      onClick={(e) => {
        if ((e.target as Element).closest('video')) return;
        close();
      }}
    >
      {item.video ? (
        <video key={item.src} className="max-h-[95vh] max-w-[95vw] rounded object-contain duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)] animate-in fade-in zoom-in-95" src={item.src} controls playsInline preload="metadata" />
      ) : (
        <img key={item.src} className="max-h-[95vh] max-w-[95vw] rounded object-contain duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)] animate-in fade-in zoom-in-95" src={item.src} alt={item.alt || ''} />
      )}
    </div>,
    document.body,
  );
}
