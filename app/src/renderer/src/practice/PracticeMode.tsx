import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Pause, Play, X } from 'lucide-react';
import { DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { t } from '../_shared/i18n.ts';
import * as practice from '../services/practice.ts';
import type { PracticeDurationMs } from '../services/practice.ts';
import { practiceClosePractice } from '../services/orchestrator.ts';

// Full-screen practice stage (#103): croquis/gesture-drawing practice, a random
// still image from the current filter results, auto-advanced by a countdown. A
// Dialog like every other full-screen mode (triage/lightbox: Esc, outside press
// and focus trap come from Base UI), the Popup IS the page for as long as it is
// open, same z-13000 layer as Settings/Confirm/BulkTagDialog/TriageMode: nothing
// needs to sit under it.
//
// Zoom/pan reuses react-zoom-pan-pinch OWN defaults (wheel/pinch/drag, double
// click to reset) rather than image-tab/ImageTab.tsx bespoke anchored-zoom: that
// machinery exists to keep the main viewer toolbar +/- buttons and wheel exactly
// in sync (image-zoom.ts), which this stage has none of. The library stock
// behavior is exactly the image-tab foundation the Issue asked for without
// re-deriving that sync problem for a surface that never has toolbar buttons.

const DURATIONS: { ms: PracticeDurationMs; key: string }[] = [
  { ms: 30000, key: 'practiceDuration30' },
  { ms: 60000, key: 'practiceDuration60' },
  { ms: 120000, key: 'practiceDuration120' },
  { ms: 300000, key: 'practiceDuration300' },
];

function DurationPicker({ duration }: { duration: PracticeDurationMs }) {
  return (
    <ToggleGroup
      variant="outline"
      spacing={0}
      value={[String(duration)]}
      onValueChange={(v) => {
        if (!v.length) return;
        practice.setDuration(Number(v[0]) as PracticeDurationMs);
      }}
      aria-label={t('practiceDurationTitle')}
    >
      {DURATIONS.map((d) => (
        <ToggleGroupItem key={d.ms} value={String(d.ms)}>
          {t(d.key)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// Countdown ring around the pause/resume button rather than a separate bar: one
// element carries both how much is left (the arc) and whether it is running (the
// icon), so the eye has one spot to check without the drawing hand leaving the
// tablet.
function TimerButton({ state }: { state: practice.PracticeState }) {
  const total = state.duration || 1;
  const fraction = Math.max(0, Math.min(1, state.remaining / total));
  const size = 40;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const viewBoxAttr = '0 0 ' + size + ' ' + size;
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={state.running ? t('practicePause') : t('practiceResume')} title={state.running ? t('practicePause') : t('practiceResume')} onClick={() => practice.togglePause()} className="relative">
      <svg width={size} height={size} viewBox={viewBoxAttr} className="-rotate-90 absolute inset-0 text-muted-foreground" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fraction)} style={{ transition: 'stroke-dashoffset 200ms linear' }} />
      </svg>
      {state.running ? <Pause className="size-4" /> : <Play className="size-4" />}
    </Button>
  );
}

function PracticeStage({ state }: { state: practice.PracticeState }) {
  const item = practice.current();
  const total = state.items.length;

  // Space = pause/resume, arrows = manual step. No typing target to guard against
  // (the duration ToggleGroup is buttons, not a text field) -- same reasoning
  // image-tab/index.tsx own document-level left/right arrow listener gives.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        practice.togglePause();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        practice.prev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        practice.next();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (total === 0) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImageOff />
          </EmptyMedia>
          <EmptyTitle>{t('practiceEmptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('practiceEmptyDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => practiceClosePractice()}>
            {t('practiceClose')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div data-slot="practice-stage" className="flex h-full min-h-0 w-full flex-col">
      {/* pr-[--window-controls-w]: same reserve TriageMode header applies, so the
          close button here does not paint under the WindowControls.tsx portal. */}
      <div className="flex items-center justify-between border-b py-2 pr-[var(--window-controls-w,138px)] pl-4">
        <div className="tabular-nums text-muted-foreground text-sm" data-slot="practice-progress">
          {t('practiceProgress', [state.idx + 1, total])}
        </div>
        <DurationPicker duration={state.duration} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('practiceClose')} title={t('practiceClose')} onClick={() => practiceClosePractice()} className="mr-2">
          <X />
        </Button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {item && (
          <TransformWrapper key={item.src} centerOnInit doubleClick={{ mode: 'reset' }}>
            <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img data-slot="practice-media" className="max-h-full max-w-full object-contain" src={item.src} alt={item.alt || ''} decoding="async" draggable={false} />
            </TransformComponent>
          </TransformWrapper>
        )}
        <div className="-translate-x-1/2 absolute bottom-4 left-1/2 z-2 flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" aria-label={t('practicePrev')} title={t('practicePrev')} onClick={() => practice.prev()}>
            <ChevronLeft />
          </Button>
          <TimerButton state={state} />
          <Button type="button" variant="ghost" size="icon" aria-label={t('practiceNext')} title={t('practiceNext')} onClick={() => practice.next()}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="border-t px-4 py-2 text-center text-muted-foreground text-xs">{t('practiceHint')}</div>
    </div>
  );
}

// The countdown loop: real elapsed time between ticks (performance.now() deltas),
// not a flat assume-100ms-passed -- setInterval nominal delay is a floor, not a
// guarantee, and a delta computed from the actual clock keeps a 5-minute timer
// from drifting slow under any scheduling jitter. Only runs while open (mount-
// scoped to PracticeMode below); practice.tick() itself no-ops while paused, so
// the interval can keep firing through a pause without its own start/stop dance:
// the next real tick after resume is just a normal ~100ms delta, no backlog to
// catch up.
function useCountdown(open: boolean) {
  useEffect(() => {
    if (!open) return undefined;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      practice.tick(delta);
    }, 100);
    return () => clearInterval(id);
  }, [open]);
}

export function PracticeMode() {
  const state = useSyncExternalStore(practice.subscribe, practice.get);
  useCountdown(state.open);
  // Remounts PracticeStage on every fresh open (not every step -- that would
  // reset the drawing timer visuals mid-item for no reason): a new open() call is
  // a new session, so a stale keydown listener or ToggleGroup focus ring from a
  // previous session should not carry forward.
  const [openKey, setOpenKey] = useState(0);
  useEffect(() => {
    if (state.open) setOpenKey((k) => k + 1);
  }, [state.open]);
  return (
    <DialogPrimitive.Root
      open={state.open}
      onOpenChange={(next) => {
        if (!next) practiceClosePractice();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="bg-background" />
        <DialogPrimitive.Popup className="fixed inset-0 z-[13000] flex outline-none duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)] data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0">
          <DialogTitle className="sr-only">{t('practiceToolbarLabel')}</DialogTitle>
          <PracticeStage key={openKey} state={state} />
        </DialogPrimitive.Popup>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
