// The image view's toolbar (#150) — zoom −/%/+ and fit⇄actual size.
//
// Why a toolbar at all: zoom was wheel-only and the fit toggle was double-click-only,
// so neither was visible anywhere. Every image viewer this app measures against
// (Windows Photos / Eagle / IrfanView) keeps zoom and fit on a permanent toolbar; the
// gestures stay, as the shortcuts they always were.
//
// It renders in the app's toolbar band (shell/AppToolbar.tsx), not over the picture:
// the band is already the row under the tab strip, and an image viewer's controls do
// not belong on top of the thing being looked at. It talks to the stage through
// services/image-zoom.ts — the stage's Zoomable is remounted per slide, so there is
// nothing here that could hold a ref to it.
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { Contrast, Expand, FlipHorizontal, Grid3x3, Pin, Shrink, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { getState, subscribe } from '../services/image-zoom.ts';
import { getState as getOverlayState, subscribe as subscribeOverlay, toggleFlip, toggleGrid, toggleGray } from '../services/image-overlay.ts';
import { hologramImageTabSource } from '../services/image-tab.ts';
import { fileOfSrc } from '../services/asset-src.ts';
import { hologramIpc } from '../services/ipc.ts';

function ToolButton({ label, slot, disabled, pressed, onClick, children }: { label: string; slot: string; disabled: boolean; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" data-slot={slot} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={pressed ? 'bg-muted text-foreground' : undefined}>
            {children}
          </Button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ViewerToolbar() {
  const { controller, percent, atFit, canZoomIn, canZoomOut } = useSyncExternalStore(subscribe, getState);
  // #80's cluster reads its own module (services/image-overlay.ts) — its toggles live
  // above the per-slide remount (they survive paging, unlike the zoom readout above), so
  // they are not part of image-zoom.ts's ImageZoomState at all, just a sibling store.
  const overlay = useSyncExternalStore(subscribeOverlay, getOverlayState);
  // No controller ⟺ this slide has no zoom (video plays through its native controls,
  // ugoira through its own canvas). The cluster stays PUT and goes disabled rather
  // than disappearing — a toolbar that loses buttons as you page through a post reads
  // as breakage, and #80's flip/grayscale toggles will apply to those slides too.
  const off = !controller;
  // #79 導線②: pin exactly what's on screen right now — the currently
  // displayed page of the open tab, not the whole post (that distinction is
  // what separates this from the card menu's "ピン", which pins the post's
  // own cover — see services/pin-items.ts). The model only hands out
  // finished src strings, so the bare filename PinItem needs comes back
  // through fileOfSrc, fileSrc's inverse.
  const pinCurrent = () => {
    const model = hologramImageTabSource.get();
    if (!model || !model.items.length) return;
    const item = model.items[model.idx];
    const file = fileOfSrc(item.src);
    if (!file) return;
    hologramIpc.pinSend([{ captureId: model.tabId, file, video: !!item.video }]);
  };
  return (
    <div data-slot="viewer-toolbar" className="flex items-center gap-0.5">
      <ToolButton slot="viewer-zoom-out" label={t('itvZoomOut')} disabled={off || !canZoomOut} onClick={() => controller?.step(-1)}>
        <ZoomOut />
      </ToolButton>
      {/* tabular-nums + a fixed min width: the readout changes on every animation
          frame of a zoom, and a proportional one would shove the ＋ button around. */}
      <span data-slot="viewer-zoom-level" className={`min-w-11 text-center text-xs tabular-nums ${off ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
        {percent == null ? '—' : `${percent}%`}
      </span>
      <ToolButton slot="viewer-zoom-in" label={t('itvZoomIn')} disabled={off || !canZoomIn} onClick={() => controller?.step(1)}>
        <ZoomIn />
      </ToolButton>
      {/* One button, two states — the label and the icon say what pressing it DOES,
          which is the half the user cannot see (the current state is the picture). */}
      <ToolButton slot="viewer-fit-toggle" label={atFit ? t('itvActualSize') : t('itvFitToWindow')} disabled={off} onClick={() => controller?.toggleFitActual()}>
        {atFit ? <Expand /> : <Shrink />}
      </ToolButton>
      {/* #80's drawing-aid cluster: flip / grid / grayscale. Persistent ON/OFF toggles
          (unlike the momentary zoom buttons above), so each one carries aria-pressed +
          the ghost "pressed = bg-muted" look ToolButton adds for that prop — same visual
          language the app already uses for aria-expanded popover triggers (button.tsx's
          ghost variant), just spelled out locally here rather than folded into that
          shared variant (these are the only aria-pressed ghost buttons in the toolbar
          band; the floating stage buttons that also toggle — ImageTab.tsx's ⓘ — use their
          own PLATE styling instead, since they float over the picture, not this band). */}
      <Separator orientation="vertical" className="mx-0.5 h-5" />
      <ToolButton slot="viewer-flip" label={t('itvFlip')} pressed={overlay.flip} disabled={false} onClick={toggleFlip}>
        <FlipHorizontal />
      </ToolButton>
      {/* Grid is Zoomable-only (v1 design, #80's 2026-07-17 fix #2) — video/ugoira slides
          have no Zoomable to hang the overlay div on, and `off` is already exactly "this
          slide has no Zoomable" (image-zoom.ts's own disabled condition above). */}
      <ToolButton slot="viewer-grid" label={t('itvGrid')} pressed={overlay.grid} disabled={off} onClick={toggleGrid}>
        <Grid3x3 />
      </ToolButton>
      <ToolButton slot="viewer-grayscale" label={t('itvGrayscale')} pressed={overlay.gray} disabled={false} onClick={toggleGray}>
        <Contrast />
      </ToolButton>
      <Separator orientation="vertical" className="mx-0.5 h-5" />
      {/* Not gated on `off` (video/ugoira have no Zoomable but still have a
          file worth pinning) — ViewerToolbar only renders while a tab is
          actually open, so there is always something to send. */}
      <ToolButton slot="viewer-pin" label={t('itvPin')} disabled={false} onClick={pinCurrent}>
        <Pin />
      </ToolButton>
    </div>
  );
}
