// The image view's toolbar (#150) — ズーム − / % / ＋ と フィット⇄原寸.
//
// Why a toolbar at all: zoom was wheel-only and the fit toggle was double-click-only,
// so neither was visible anywhere. Every image viewer this app measures against
// (Windows フォト / Eagle / IrfanView) keeps zoom and fit on a permanent toolbar; the
// gestures stay, as the shortcuts they always were.
//
// It renders in the app's toolbar band (shell/AppToolbar.tsx), not over the picture:
// the band is already the row under the tab strip, and an image viewer's controls do
// not belong on top of the thing being looked at. It talks to the stage through
// services/image-zoom.ts — the stage's Zoomable is remounted per slide, so there is
// nothing here that could hold a ref to it.
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { Expand, Shrink, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { getState, subscribe } from '../services/image-zoom.ts';

function ToolButton({ label, slot, disabled, onClick, children }: { label: string; slot: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" data-slot={slot} aria-label={label} disabled={disabled} onClick={onClick}>
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
  // No controller ⟺ this slide has no zoom (video plays through its native controls,
  // うごイラ through its own canvas). The cluster stays PUT and goes disabled rather
  // than disappearing — a toolbar that loses buttons as you page through a post reads
  // as breakage, and #80's flip/grayscale toggles will apply to those slides too.
  const off = !controller;
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
      {/* #80 (左右反転 / グリッド / グレースケール) lands here as a second cluster,
          right of this one and behind a separator. Nothing is drawn for it yet —
          this Issue only owed it a place to live. */}
    </div>
  );
}
