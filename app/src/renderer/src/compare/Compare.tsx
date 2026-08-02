import { useRef } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { Button } from '@/components/ui/button';
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { t } from '../_shared/i18n.ts';
import { PLATE } from '../image-tab/plate.ts';
import { MAX_SCALE, MIN_SCALE } from '../services/image-zoom.ts';
import { close, type CompareItem, type CompareState } from '../services/compare.ts';

// Compare view (#82) — 2-4 selected posts side by side, each independently
// zoomable. Rides on the shadcn Dialog like the lightbox (Esc, backdrop press and
// focus trap/return are all the Dialog's); this only draws the grid of panes and
// the explicit close control. Same full-bleed Portal/Backdrop/Popup composition as
// lightbox/Lightbox.tsx rather than the centered-card DialogContent preset — the
// grid needs the whole viewport, not a small dialog box.

// One pane: independent zoom/pan via react-zoom-pan-pinch's OWN wheel/pinch/
// double-click defaults. This is deliberately not image-tab/ImageTab.tsx's
// Zoomable: that stage's cursor-anchored zoom ladder is driven through a SINGLE
// registered controller (services/image-zoom.ts), built for exactly one active
// image-view slide at a time — it has no way to answer four independently zooming
// panes at once. #82's accepted design only commits to "zoom stays independent per
// image in v1"; reaching for the library's own per-instance defaults here, instead
// of duplicating the single-controller ladder four times over, is what that
// leaves to implementation.
function ComparePane({ item }: { item: CompareItem }) {
  return (
    <div data-slot="compare-pane" className="relative min-h-0 min-w-0 overflow-hidden rounded-lg border bg-black/40">
      {item.video ? (
        <video data-slot="compare-media" className="h-full w-full object-contain" src={item.src} controls playsInline preload="metadata" />
      ) : (
        <TransformWrapper minScale={MIN_SCALE} maxScale={MAX_SCALE} centerOnInit disablePadding>
          <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img data-slot="compare-media" className="max-h-full max-w-full cursor-grab object-contain active:cursor-grabbing" src={item.src} alt={item.alt} decoding="async" draggable={false} />
          </TransformComponent>
        </TransformWrapper>
      )}
    </div>
  );
}

// Layout per #82's accepted design: 2 panes side by side; 3-4 panes in a 2x2
// grid (a 3rd pane simply leaves the 4th cell empty — no filler drawn, no
// special-cased 3-up arrangement).
function paneGridClass(count: number): string {
  return count <= 2 ? 'grid-cols-2 grid-rows-1' : 'grid-cols-2 grid-rows-2';
}

export function Compare({ state }: { state: CompareState }) {
  const { items, open } = state;
  // Hold the last frame across the close animation — same rule Lightbox.tsx
  // uses, since close() clears the store's items in the same write that flips
  // `open`.
  const lastRef = useRef<CompareItem[]>([]);
  if (items.length) lastRef.current = items;
  const shown = items.length ? items : lastRef.current;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      {shown.length > 0 && (
        <DialogPortal>
          <DialogOverlay data-slot="compare-overlay" className="z-[11000] bg-black/80" />
          <DialogPrimitive.Popup className="fixed inset-6 z-[11000] flex flex-col outline-none duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            <DialogTitle className="sr-only">{t('compareTitle')}</DialogTitle>
            <div data-slot="compare-grid" className={`grid flex-1 gap-2 ${paneGridClass(shown.length)}`}>
              {shown.map((item, i) => (
                <ComparePane key={i} item={item} />
              ))}
            </div>
            <DialogPrimitive.Close data-slot="compare-close" render={<Button variant="ghost" size="icon-sm" className={`absolute top-2 right-2 ${PLATE}`} />}>
              <XIcon />
              <span className="sr-only">{t('compareClose')}</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Popup>
        </DialogPortal>
      )}
    </Dialog>
  );
}
