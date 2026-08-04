// Year/month jump rail (#47) — the right-edge index into a date-sorted grid.
// Same "overlay inside the inset" placement as ScrollToTop (that file's own
// comment explains why: the inset is what the right inspector narrows, so
// anchoring here keeps the rail clear of it without a width-reservation branch
// of its own). Reads hologramStore's 'postSections' directly (the same value
// services/grid.ts attaches to the grid model as `sections`) rather than
// threading it through the grid — this is a sibling overlay, not a grid cell,
// and the two consumers (the grid host, this rail) share one computation in
// post-grid-builder.ts either way.
//
// #875: being an overlay, it covers part of the right-hand column of cards for
// as long as it is up. So it stays out of the way until it is wanted — while
// scrolling, while the pointer is out at the right edge, or while focus is
// inside it — which is what Google Photos' web scrubber does as well (absent on
// arrival, present once you start scrolling). Same "stay mounted, cross with
// one CSS transition" shape as ScrollToTop, not a mount/unmount.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '../_shared/i18n.ts';
import { scroller } from '../services/content-area.ts';
import { scrollSectionToTop } from '../services/section-nav.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';

const subSections = (cb: () => void) => storeSubscribe('postSections', cb);
const getSections = () => (storeGet('postSections') as HologramDateSection[] | null) ?? null;
const subInspectorOverlay = (cb: () => void) => storeSubscribe('inspectorOverlay', cb);
const getInspectorOverlay = () => !!storeGet('inspectorOverlay');
const subBrowseMode = (cb: () => void) => storeSubscribe('browseMode', cb);
const getBrowseMode = () => (storeGet('browseMode') as string | undefined) ?? 'posts';

/** How long the rail stays up after the last scroll event. */
const IDLE_MS = 1200;
/** How far left of the rail still counts as reaching for it. */
const EDGE_PAD_PX = 24;

export function DateJumpRail() {
  const sections = useSyncExternalStore(subSections, getSections);
  const inspectorOverlay = useSyncExternalStore(subInspectorOverlay, getInspectorOverlay);
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  // Only worth an index once there is more than one stop to jump between — a
  // single month/one page of results has nothing for the rail to do. Gated on
  // 'posts'/'timeline' too: 'postSections' only updates on a post-grid render
  // (post-grid-builder.ts's renderPosts, which both modes share), so switching
  // to posters/trash would otherwise leave the rail showing whatever it last
  // had for the post grid. #183: the timeline is pinned to a date sort, so it
  // always has sections to index — the rail is explicitly NOT killed for it
  // (the 2026-08-02 design comment: no reason to drop the time axis's own
  // index from the one mode that IS the time axis).
  const shown = (mode === 'posts' || mode === 'timeline') && !!sections && sections.length > 1;

  const railRef = useRef<HTMLDivElement>(null);
  const [scrolling, setScrolling] = useState(false);
  const [nearEdge, setNearEdge] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);

  useEffect(() => {
    // Same timing note as ScrollToTop: refs are attached before effects run, and
    // the scroll column mounts in the same commit as this component.
    const el = scroller();
    if (!el) return;
    let timer: number | undefined;
    const onScroll = () => {
      setScrolling(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setScrolling(false), IDLE_MS);
    };
    // Proximity is measured against the RAIL's own box rather than the scroller's
    // right edge: the rail shifts left by --inspector-w while the inspector is an
    // overlay, and its own rect is the one thing that already knows that. Reading
    // it per move also lets the hit zone follow a resize without an observer of
    // its own. Because the zone contains the rail, a pointer resting ON the rail
    // holds it up with no separate hover state — which is what lets the rail keep
    // `pointer-events: none` while idle, so it can never swallow a click or a
    // marquee drag (#484) aimed at the card behind it.
    const onMove = (e: MouseEvent) => {
      const rail = railRef.current;
      if (!rail) return;
      // Horizontal only: the rail is short when a library spans few months, and
      // "reach for the right edge" should not also require finding its height.
      setNearEdge(e.clientX >= rail.getBoundingClientRect().left - EDGE_PAD_PX);
    };
    // No mousemove arrives once the pointer is outside the window, so the rail
    // would otherwise stay up behind whatever the user switched to. <html> and
    // not `document`: mouseleave does not bubble, and the element is the one
    // that reliably fires it for "left the window".
    const root = document.documentElement;
    const onLeave = () => setNearEdge(false);
    el.addEventListener('scroll', onScroll, { passive: true });
    // On the document rather than the scroller: the rail is a sibling of the
    // scrolling column, so listening on the column alone would report "pointer
    // left" the instant it crossed onto the rail itself.
    document.addEventListener('mousemove', onMove, { passive: true });
    root.addEventListener('mouseleave', onLeave);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('scroll', onScroll);
      document.removeEventListener('mousemove', onMove);
      root.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const visible = shown && (scrolling || nearEdge || focusWithin);
  const label = t('dateJumpRailTitle');

  return (
    <div
      ref={railRef}
      // `inert` still tracks `shown`, not `visible`: an idle rail is still a
      // legitimate Tab stop, and landing on it is one of the ways it comes up.
      inert={!shown}
      onFocus={() => setFocusWithin(true)}
      onBlur={() => setFocusWithin(false)}
      style={inspectorOverlay ? { right: 'calc(var(--inspector-w) + 1.5rem)' } : undefined}
      className={cn(
        'absolute top-1/2 right-2 z-40 flex max-h-[70vh] -translate-y-1/2 flex-col gap-0.5 overflow-y-auto rounded-lg border bg-popover/90 p-1 shadow-lg backdrop-blur-sm transition-opacity duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)]',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
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
