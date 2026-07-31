import { useRef } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { close, type LightboxItem, type LightboxState } from '../services/lightbox.ts';
import { t } from '../_shared/i18n.ts';

// Single-image quick-view (peek) overlay. #143 reduced the lightbox to one item —
// full gallery paging lives in the image view now — so this renders just the item
// services/lightbox.ts holds (the thumbnail, zoomed) plus video playback; no prev/
// next nav or counter. #154 fixed that shape: this is a quick view, not a gallery
// viewer, so nothing here steps between items.
//
// #62: it rides on the shadcn Dialog like every other overlay. Only the picture is
// special about a lightbox — the portal out of the shell's stacking/clipping, the
// scrim, Esc, the outside press and focus (trap + return) are all the Dialog's, and
// were hand-rolled here (or missing: there was no focus management at all) until
// this. What is left of our own is the media itself: its sizing, its decode, and the
// rule that a click on the picture dismisses but a click on video controls does not.
//
// The layout is a full-bleed Popup rather than the shadcn DialogContent box: the peek
// draws no surface, no padding and no close button, and it needs its own scrim depth,
// so it composes Portal/Backdrop/Popup directly instead of overriding a dozen classes
// of the centered-card preset.
//
// Pointer routing: the Popup spans the viewport (that is how the media centres) but is
// pointer-events-none, so a press on the empty area lands on the Backdrop and the
// Dialog's own outside-press dismissal answers it — one path shared with Esc. The
// media takes pointer events back, and only the image carries a click-to-close (a
// click on the scrubber must not dismiss the thing being scrubbed).
export function Lightbox({ state }: { state: LightboxState }) {
  const { item, open } = state;
  // Keep the last item while the dialog animates closed, so the picture doesn't blank
  // out mid-exit (close() clears the store's item in the same write that flips `open`).
  // Same reason PromptHost/ConfirmHost hold one.
  const lastRef = useRef<LightboxItem | null>(null);
  if (item) lastRef.current = item;
  const shown = item ?? lastRef.current;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      {shown && <LightboxContent item={shown} />}
    </Dialog>
  );
}

function LightboxContent({ item }: { item: LightboxItem }) {
  // The media is capped, not fitted to a box: 95vw/95vh with object-contain is the
  // whole layout, and it is the one part of this overlay that isn't the Dialog's.
  const media = 'pointer-events-auto max-h-[95vh] max-w-[95vw] rounded object-contain';
  return (
    <DialogPortal>
      {/* data-slot="lightbox" replaces the wrapper's "dialog-overlay": the window-control
          dim (globals.css .wc-dim) has to composite the SAME black as the scrim it covers,
          and the peek's is deeper than a modal's — one slot name per depth keeps that rule
          unambiguous, and it stays the hook the click-model harness reads for "peek open".
          Flat, no backdrop blur (#240): the modals dropped theirs in the shadcn pass and
          design-tokens.css bans backdrop-filter on floating surfaces. Denser than a modal's
          bg-black/50 because nothing opaque sits on top of it — Bluesky's lightbox settles on
          the same 0.8. z-11000 sits over the content but under the shadcn Dialog/AlertDialog
          layers (13000+), which is the order the Esc cascade assumes. */}
      <DialogOverlay data-slot="lightbox" className="z-[11000] cursor-zoom-out bg-black/80 duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)]" />
      <DialogPrimitive.Popup className="pointer-events-none fixed inset-0 z-[11000] flex items-center justify-center outline-none duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
        {/* The peek draws no heading, so the dialog's accessible name is sr-only —
            same arrangement as the command palette. */}
        <DialogTitle className="sr-only">{t('quickViewTitle')}</DialogTitle>
        {item.video ? (
          // data-slot="lightbox-media" (#88): privacy mode's blur has to reach the
          // peek too — it's the one overlay #88's hotkey guard deliberately does NOT
          // back off from (services/privacy-mode.ts's handler comment).
          <video key={item.src} data-slot="lightbox-media" className={media} src={item.src} controls playsInline preload="metadata" />
        ) : (
          // decoding="async" (#241): the peek has no prev/next, so there is no
          // neighbour to preload here — the attribute is the whole of it. async
          // keeps a multi-megapixel decode from holding up the scrim and its
          // fade-in, which are the parts that have to answer the click at once
          // (they are a separate element from the picture, so they never wait on it).
          <img key={item.src} data-slot="lightbox-media" className={`${media} cursor-zoom-out`} src={item.src} alt={item.alt || ''} decoding="async" onClick={() => close()} />
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}
