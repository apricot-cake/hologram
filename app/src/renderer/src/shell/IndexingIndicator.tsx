import { Pause, Play } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { indexQueueStatus, pauseIndexQueue, resumeIndexQueue, subscribeIndexQueue } from '../services/index-queue.ts';

// Background indexing, while it is happening (#834, parent #98's transparency
// principle for "使っている間"). Analysis of the library must be visible and
// stoppable — not something the app does quietly.
//
// Present ONLY while there is work, which is the anchor's own shape: Lightroom
// Classic puts background tasks (preview building, face recognition) in the
// activity area over the identity plate with a progress bar and a cancel
// control, and that area is empty when nothing is running. The permanent
// "how much of the library is indexed" figures are a different thing with a
// different home — Zotero's Preferences → Search keeps Indexed / Partial /
// Unindexed as standing statistics, and here that belongs to #100's health
// dashboard, not to a toolbar.
//
// The bar is INDETERMINATE while the library walk is still running: `total` grows
// as the scan finds more work, so a percentage computed then would visibly go
// backwards. Once the walk is done the total is final and the bar means what it
// looks like.
export function IndexingIndicator() {
  const status = useSyncExternalStore(subscribeIndexQueue, indexQueueStatus);
  if (!status.active) return null;

  const percent = status.total > 0 ? Math.min(100, Math.round((status.done / status.total) * 100)) : 0;
  const label = status.paused ? t('indexingPaused') : t('indexingProgress', [status.done, status.total]);

  return (
    <div data-slot="indexing-indicator" className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="flex w-28 flex-col gap-1" aria-live="polite">
              <span className="truncate text-[11px] leading-none text-muted-foreground tabular-nums">{label}</span>
              {/* An indeterminate Progress takes `value={null}` (Base UI) — the
                  same component either way, so the bar does not jump size when
                  the scan finishes and the number becomes meaningful. */}
              <Progress value={status.scanning ? null : percent} className="w-full" />
            </div>
          }
        />
        <TooltipContent>{status.scanning ? t('indexingScanning') : t('indexingTooltip', [status.done, status.total])}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button data-slot="indexing-pause-button" variant="ghost" size="icon-sm" aria-label={status.paused ? t('indexingResume') : t('indexingPause')} onClick={() => void (status.paused ? resumeIndexQueue() : pauseIndexQueue())}>
              {status.paused ? <Play /> : <Pause />}
            </Button>
          }
        />
        <TooltipContent>{status.paused ? t('indexingResume') : t('indexingPause')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
