// 画像のズーム、ウィンドウフィット、左右反転の操作。
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { Crop, Expand, SquareCenterlineDashedHorizontal, Pencil, RotateCw, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { getState, subscribe } from '../services/image-zoom.ts';
import * as editControls from '../services/image-edit-controls.ts';

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
  const edit = useSyncExternalStore(editControls.subscribe, editControls.get);
  const { controller, percent, canZoomIn, canZoomOut } = useSyncExternalStore(subscribe, getState);
  const off = !controller;
  return (
    <div data-slot="viewer-toolbar" className="flex min-w-0 items-center gap-0.5">
      {edit?.editing ? (
        <>
          <ToolButton slot="image-tab-crop" label={t('imgTabCrop')} pressed={edit.cropping} disabled={!!edit.busy} onClick={() => edit.crop?.()}>
            <Crop />
          </ToolButton>
          <ToolButton slot="viewer-rotate" label={t('viewerRotate')} disabled={!!edit.busy} onClick={() => edit.rotate?.()}>
            <RotateCw />
          </ToolButton>
          <ToolButton slot="viewer-flip" label={t('itvFlip')} pressed={edit.flipped} disabled={!!edit.busy} onClick={() => edit.flip?.()}>
            <SquareCenterlineDashedHorizontal />
          </ToolButton>
          <ToolButton slot="viewer-reset-edits" label={t('viewerResetEdits')} disabled={!!edit.busy} onClick={() => edit.reset?.()}>
            <Undo2 />
          </ToolButton>
        </>
      ) : (
        <>
          <ToolButton slot="viewer-zoom-out" label={t('itvZoomOut')} disabled={off || !canZoomOut} onClick={() => controller?.step(-1)}>
            <ZoomOut />
          </ToolButton>
          <span data-slot="viewer-zoom-level" className="min-w-11 text-center text-xs text-muted-foreground tabular-nums">
            {percent == null ? '—' : `${percent}%`}
          </span>
          <ToolButton slot="viewer-zoom-in" label={t('itvZoomIn')} disabled={off || !canZoomIn} onClick={() => controller?.step(1)}>
            <ZoomIn />
          </ToolButton>
          <ToolButton slot="viewer-fit-toggle" label={t('itvFitToWindow')} disabled={off} onClick={() => controller?.fit()}>
            <Expand />
          </ToolButton>
          <Button data-slot="viewer-edit" variant="ghost" size="sm" disabled={!edit} onClick={() => edit?.start()}>
            <Pencil />
            {t('viewerEdit')}
          </Button>
        </>
      )}
    </div>
  );
}
export function ViewerEditActions() {
  const edit = useSyncExternalStore(editControls.subscribe, editControls.get);
  if (!edit?.editing) return null;
  return (
    <div data-slot="viewer-edit-actions" className="flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="sm" disabled={!!edit.saving} onClick={() => edit.cancel?.()}>
        {t('imgTabCropCancel')}
      </Button>
      <Button size="sm" disabled={!!edit.busy} onClick={() => edit.save?.()}>
        {t('viewerSaveEdits')}
      </Button>
    </div>
  );
}
