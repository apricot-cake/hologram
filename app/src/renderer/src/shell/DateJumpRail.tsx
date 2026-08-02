// Year/month jump rail (#47) — the right-edge index into a date-sorted grid.
// Same "overlay inside the inset" placement as ScrollToTop (that file's own
// comment explains why: the inset is what the right inspector narrows, so
// anchoring here keeps the rail clear of it without a width-reservation branch
// of its own). Reads hologramStore's 'postSections' directly (the same value
// services/grid.ts attaches to the grid model as `sections`) rather than
// threading it through the grid — this is a sibling overlay, not a grid cell,
// and the two consumers (the grid host, this rail) share one computation in
// post-grid-builder.ts either way.
import { useSyncExternalStore } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '../_shared/i18n.ts';
import { scrollSectionToTop } from '../services/section-nav.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';

const subSections = (cb: () => void) => storeSubscribe('postSections', cb);
const getSections = () => (storeGet('postSections') as HologramDateSection[] | null) ?? null;
const subInspectorOverlay = (cb: () => void) => storeSubscribe('inspectorOverlay', cb);
const getInspectorOverlay = () => !!storeGet('inspectorOverlay');
const subBrowseMode = (cb: () => void) => storeSubscribe('browseMode', cb);
const getBrowseMode = () => (storeGet('browseMode') as string | undefined) ?? 'posts';

export function DateJumpRail() {
  const sections = useSyncExternalStore(subSections, getSections);
  const inspectorOverlay = useSyncExternalStore(subInspectorOverlay, getInspectorOverlay);
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  // Only worth an index once there is more than one stop to jump between — a
  // single month/one page of results has nothing for the rail to do. Gated on
  // 'posts' too: 'postSections' only updates on a posts-mode render (post-grid-
  // builder.ts's renderPosts), so switching to posters/trash would otherwise
  // leave the rail showing whatever it last had for the post grid.
  const shown = mode === 'posts' && !!sections && sections.length > 1;
  const label = t('dateJumpRailTitle');

  return (
    <div
      inert={!shown}
      style={inspectorOverlay ? { right: 'calc(var(--inspector-w) + 1.5rem)' } : undefined}
      className={cn(
        'absolute top-1/2 right-2 z-40 flex max-h-[70vh] -translate-y-1/2 flex-col gap-0.5 overflow-y-auto rounded-lg border bg-popover/90 p-1 shadow-lg backdrop-blur-sm transition-opacity duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)]',
        shown ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-label={label}
      role="navigation"
    >
      {(sections || []).map((sec) => (
        <Tooltip key={sec.key}>
          <TooltipTrigger
            render={
              <button type="button" data-slot="date-jump-rail-item" className="flex items-baseline justify-between gap-1.5 rounded px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground tabular-nums transition-colors hover:bg-muted hover:text-foreground" onClick={() => scrollSectionToTop(sec.key)}>
                {/* Compact "'26/7" (year/month) rather than the full locale label — this is
                    an index rail, not the section heading, and needs to stay narrow enough
                    for a whole year to fit without wrapping. Unknown-date keeps the same
                    two-column shape so its count lines up with every other row. */}
                <span>{sec.key === 'unknown' ? '—' : `'${String(new Date(sec.ms).getFullYear()).slice(-2)}/${new Date(sec.ms).getMonth() + 1}`}</span>
                <span className="text-muted-foreground/70">{sec.count}</span>
              </button>
            }
          />
          <TooltipContent side="left">{sec.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
