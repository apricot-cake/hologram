// Sectioned grid host (#47) — month section headers for a date sort. Sibling of
// _shared/VirtualGrid.tsx's VirtualGridHost, not a modification of it: every
// OTHER sort/browse mode keeps using that single-instance path completely
// unchanged (Grid.tsx dispatches on model.sections — see GridHost). This host
// only mounts when a date sort has grouped the grid's items into
// HologramDateSection buckets (services/post-grid-builder.ts / date-sections.ts).
//
// Design constraint that shapes everything below (confirmed on #47's issue,
// 2026-07-11 spike comment): masonic has no concept of a full-width row break,
// so a month header cannot be a pseudo item mixed into ONE shared masonry
// instance — one column would reserve space for it and the others would not,
// which is a broken layout, not a rare edge case. So each month gets its OWN
// masonic instance (its own usePositioner/useResizeObserver/useMasonry), and
// the sections simply stack in normal document flow — the browser lays them
// out top to bottom, exactly like any other block content, so no manual
// cumulative-offset bookkeeping is needed for LAYOUT.
//
// Unlike the issue's spike note, sections are NOT lazily mounted/unmounted via
// an IntersectionObserver. That machinery existed to bound DOM size for a
// library with thousands of posts, but masonic already does that on its own:
// useMasonry only renders the cells inside [scrollTop, scrollTop+height]
// (+overscan) of the positioner it is given — pass it a LOCAL scrollTop that
// is far outside a section's own range (i.e. the section is scrolled well out
// of view) and it renders zero cells for that section, same as the single-
// grid path already does for a 9k-item library today. Splitting into N
// instances costs N small position caches and N (mostly-empty, off-screen)
// container divs — negligible next to the card count it already handles.
// This also sidesteps the "placeholder height differs from measured height"
// scroll-correction trap the issue's spike flagged: nothing is ever swapped
// from a placeholder to real content, so there is no jump to correct for.
//
// nav (keyboard arrow movement) / marquee (drag range-select) / the Ctrl+wheel
// zoom anchor are all SINGLE, app-wide registries (services/grid-nav.ts /
// zoom-anchor.ts) built for one grid backed by one positioner. Rather than
// touch those registries or their many callers (selection-builder.ts,
// grid-density-builder.ts), this host still registers exactly ONE handle for
// each — it just answers by finding which section a global index/point falls
// into and delegating to THAT section's positioner, translating indices with
// +/- section.startIndex. Every existing caller keeps working unmodified.
import { useMasonry, usePositioner, useResizeObserver } from 'masonic';
import type { Positioner } from 'masonic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { scroller as contentScroller } from '../services/content-area.ts';
import { registerGridNav } from '../services/grid-nav.ts';
import { registerSectionNav } from '../services/section-nav.ts';
import { autoScrollStep, clearsSelection, exceedsThreshold, hitIndices, rectFromPoints } from '../services/marquee.ts';
import type { MarqueeCell } from '../services/marquee.ts';
import { anchorScrollTop, anchorViewportOffset, pickAnchorIndex, registerZoomAnchorSource } from '../services/zoom-anchor.ts';
import type { ZoomAnchor, ZoomAnchorCell } from '../services/zoom-anchor.ts';
import { ModelCtx } from './VirtualGrid.tsx';
import type { GridCellProps } from './VirtualGrid.tsx';

// What the parent keeps on file for one mounted section — read on demand by
// nav/marquee/zoom (never cached across frames; getBoundingClientRect is cheap
// and this way it is always correct, no staleness bookkeeping needed).
interface SectionHandle {
  bodyEl: HTMLElement | null;
  headerEl: HTMLElement | null;
  positioner: Positioner;
  startIndex: number;
  count: number;
}

// Content-relative offset of `el`'s top within `scroller`'s scrollable
// content — the scrollTop term cancels scrolling out, so unlike a plain
// getBoundingClientRect diff this stays correct regardless of how far the
// scroller has moved (same formula VirtualGridHost's own offsetRef uses).
function contentOffsetOf(el: HTMLElement, scroller: HTMLElement): number {
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

export function SectionedGridHost({ model, cell, nav, anchor, marquee, onBackgroundClick }: { model: HologramGridModel; cell: ComponentType<GridCellProps>; nav?: boolean; anchor?: boolean; marquee?: HologramMarqueeSink; onBackgroundClick?: () => void }) {
  const sections = model.sections || [];
  const scroller = contentScroller() as HTMLElement;
  const containerRef = useRef<HTMLElement | null>(null); // outer wrapper, spans every section
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [scrollY, setScrollY] = useState(() => scroller.scrollTop);
  const [isScrolling, setIsScrolling] = useState(false);
  // Bumped whenever the outer wrapper's OWN size changes — which fires for a
  // resize of any child too (auto-height block content), so it doubles as
  // "some section's real height just settled, everyone below it may have
  // moved". Section bodies re-measure their own scroll-relative offset off it.
  const [layoutTick, setLayoutTick] = useState(0);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el || !el.offsetWidth) return; // hidden (other browse mode)
    const width = el.offsetWidth;
    const height = scroller.clientHeight;
    setDims((d) => (d.width === width && d.height === height ? d : { width, height }));
    setLayoutTick((t) => t + 1);
  }, [scroller]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure, scroller]);

  // Zoom's hold on the view (#282) — same shape as VirtualGridHost's own,
  // scoped to this host's instance.
  const heldAnchorRef = useRef<ZoomAnchor | null>(null);
  const seenAnchorRef = useRef<ZoomAnchor | null | undefined>(undefined);
  const anchorScrollRef = useRef(0);
  const anchorItemsKeyRef = useRef(model.itemsKey);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (heldAnchorRef.current && Math.abs(scroller.scrollTop - anchorScrollRef.current) > 1) heldAnchorRef.current = null;
      setScrollY(scroller.scrollTop);
      setIsScrolling(true);
      clearTimeout(t);
      t = setTimeout(() => setIsScrolling(false), 100);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      clearTimeout(t);
    };
  }, [scroller]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: model.itemsKey IS the trigger (not read inside) — this must run exactly when the item set was rebuilt
  useLayoutEffect(() => {
    setScrollY(scroller.scrollTop);
    measure();
  }, [model.itemsKey, measure, scroller]);

  // Registry of currently-mounted sections (every section, always — see the
  // header comment on why nothing here is lazily mounted/unmounted).
  const sectionHandles = useRef(new Map<string, SectionHandle>()).current;
  const registerSection = useCallback(
    (key: string, handle: SectionHandle | null) => {
      if (handle) sectionHandles.set(key, handle);
      else sectionHandles.delete(key);
    },
    [sectionHandles],
  );
  // Shared column count — every section lays out from the same model.columnWidth/
  // container width, so whichever section last reported one speaks for all of them.
  const columnCountRef = useRef(1);

  const sectionFor = useCallback(
    (globalIndex: number) => {
      for (const s of sections) if (globalIndex >= s.startIndex && globalIndex < s.startIndex + s.count) return s;
      return null;
    },
    [sections],
  );

  // --- Keyboard nav (arrow movement) — one registration for the whole host ---
  useEffect(() => {
    if (!nav) return;
    return registerGridNav({
      columnCount: () => columnCountRef.current,
      scrollIntoView: (index: number) => {
        const sec = sectionFor(index);
        const h = sec && sectionHandles.get(sec.key);
        if (!sec || !h || !h.bodyEl) return;
        const localIndex = index - sec.startIndex;
        const pad = model.rowGutter || 0;
        const viewTop = scroller.scrollTop;
        const viewHeight = scroller.clientHeight;
        const off = contentOffsetOf(h.bodyEl, scroller);
        const pos = h.positioner.get(localIndex);
        if (!pos) {
          const estimate = model.square ? h.positioner.columnWidth : model.itemHeightEstimate || 120;
          const est = h.positioner.estimateHeight(localIndex, estimate);
          scroller.scrollTo({ top: Math.max(0, off + est - viewHeight / 2) });
          return;
        }
        const top = off + pos.top;
        const bottom = top + pos.height;
        if (top - pad < viewTop) scroller.scrollTo({ top: Math.max(0, top - pad) });
        else if (bottom + pad > viewTop + viewHeight) scroller.scrollTo({ top: bottom + pad - viewHeight });
      },
    });
    // sections/model identity changes (sort/filter) invalidate any stale closure over them.
  }, [nav, sectionFor, sectionHandles, scroller, model.rowGutter, model.square, model.itemHeightEstimate]);

  // --- Jump rail (#47) — scroll a given month's header to the top ---
  useEffect(() => {
    return registerSectionNav({
      scrollToTop: (key: string) => {
        const h = sectionHandles.get(key);
        if (!h?.headerEl) return;
        const top = contentOffsetOf(h.headerEl, scroller);
        scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      },
    });
  }, [sectionHandles, scroller]);

  // --- Ctrl+wheel zoom anchor (#282) — resolve a point to whichever section it's over ---
  useEffect(() => {
    if (!anchor) return;
    return registerZoomAnchorSource({
      resolve: (clientX: number, clientY: number) => {
        for (const sec of sections) {
          const h = sectionHandles.get(sec.key);
          if (!h?.bodyEl || !h.bodyEl.offsetWidth) continue;
          const cr = h.bodyEl.getBoundingClientRect();
          if (clientY < cr.top || clientY > cr.bottom) continue; // sections stack vertically — pick the one the pointer is actually over
          const off = contentOffsetOf(h.bodyEl, scroller);
          const top = Math.max(0, scroller.scrollTop - off);
          const cells: ZoomAnchorCell[] = [];
          h.positioner.range(top, top + scroller.clientHeight, (index: number) => {
            const pos = h.positioner.get(index);
            if (pos) cells.push({ index: index + sec.startIndex, left: pos.left, top: pos.top, width: h.positioner.columnWidth, height: pos.height });
          });
          const idx = pickAnchorIndex(cells, clientX - cr.left, clientY - cr.top);
          if (idx == null) return null;
          const pos = h.positioner.get(idx - sec.startIndex);
          if (!pos) return null;
          return { index: idx, viewportOffset: anchorViewportOffset(pos.top, off, scroller.scrollTop) };
        }
        return null;
      },
    });
  }, [anchor, sections, sectionHandles, scroller]);

  // Honor a held anchor across the multi-commit settle a re-layout takes — same
  // no-dependency-array shape as VirtualGridHost's own (re-applied every commit
  // until the target section reports a measured position).
  useLayoutEffect(() => {
    const incoming = (model.zoomAnchor as ZoomAnchor | null | undefined) ?? null;
    const fresh = seenAnchorRef.current !== undefined && incoming !== null && incoming !== seenAnchorRef.current;
    if (fresh) heldAnchorRef.current = incoming;
    seenAnchorRef.current = incoming;
    if (model.itemsKey !== anchorItemsKeyRef.current) {
      anchorItemsKeyRef.current = model.itemsKey;
      if (!fresh) heldAnchorRef.current = null;
    }
    const held = heldAnchorRef.current;
    if (!held) return;
    const sec = sectionFor(held.index);
    const h = sec && sectionHandles.get(sec.key);
    if (!sec || !h || !h.bodyEl) return;
    const localIndex = held.index - sec.startIndex;
    const off = contentOffsetOf(h.bodyEl, scroller);
    const pos = h.positioner.get(localIndex);
    const estimate = model.square ? h.positioner.columnWidth : model.itemHeightEstimate || 120;
    const top = pos ? pos.top : h.positioner.estimateHeight(localIndex, estimate);
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const target = anchorScrollTop(top, off, held.viewportOffset, max);
    if (Math.abs(target - scroller.scrollTop) > 0.5) scroller.scrollTop = target;
    anchorScrollRef.current = scroller.scrollTop;
    setScrollY(scroller.scrollTop);
  });

  // --- Marquee drag range-select (#484) + background click (#242) ------------
  // Same gesture recognizer as VirtualGridHost's (one press, two outcomes); the
  // only difference is the hit test loops every mounted section, translating
  // the shared drag rectangle into each one's own container space before
  // calling ITS positioner.range(), and translating hits back with
  // + section.startIndex before they reach marquee.update() (which indexes
  // into the flat, ungrouped viewGroups array — see selection.ts).
  useEffect(() => {
    if (!marquee && !onBackgroundClick) return;
    const clip = document.createElement('div');
    clip.dataset.slot = 'grid-marquee-clip';
    clip.className = 'pointer-events-none fixed z-45 overflow-hidden [contain:strict]';
    const bandEl = document.createElement('div');
    bandEl.dataset.slot = 'grid-marquee';
    bandEl.className = 'absolute top-0 left-0 border border-[color-mix(in_oklch,var(--color-selected)_70%,transparent)] bg-[color-mix(in_oklch,var(--color-selected)_16%,transparent)] [will-change:transform,width,height]';
    clip.appendChild(bandEl);

    let drag: {
      anchorX: number;
      anchorY: number;
      startX: number;
      startY: number;
      pointerX: number;
      pointerY: number;
      additive: boolean;
      active: boolean;
      lastHits: string;
      raf: number;
    } | null = null;

    const step = (allowScroll: boolean) => {
      const el = containerRef.current;
      if (!drag || !el || !marquee) return;
      const sr = scroller.getBoundingClientRect();
      if (allowScroll) {
        const dy = autoScrollStep(drag.pointerY, sr.top, sr.bottom);
        if (dy) scroller.scrollTop += dy;
      }
      const cr = el.getBoundingClientRect();
      const viewRight = sr.left + scroller.clientWidth;
      const curX = Math.min(Math.max(drag.pointerX, sr.left), viewRight) - cr.left;
      const curY = Math.min(Math.max(drag.pointerY, sr.top), sr.bottom) - cr.top;
      const rect = rectFromPoints(drag.anchorX, drag.anchorY, curX, curY); // outer-container space

      clip.style.left = `${sr.left}px`;
      clip.style.top = `${sr.top}px`;
      clip.style.width = `${scroller.clientWidth}px`;
      clip.style.height = `${sr.height}px`;
      bandEl.style.transform = `translate(${cr.left + rect.x - sr.left}px, ${cr.top + rect.y - sr.top}px)`;
      bandEl.style.width = `${rect.width}px`;
      bandEl.style.height = `${rect.height}px`;

      const hits: number[] = [];
      for (const [, h] of sectionHandles) {
        if (!h.bodyEl) continue;
        const sectionTop = h.bodyEl.getBoundingClientRect().top - cr.top; // this section's top WITHIN the outer container
        const localRect = { x: rect.x, y: rect.y - sectionTop, width: rect.width, height: rect.height };
        const cells: MarqueeCell[] = [];
        h.positioner.range(localRect.y, localRect.y + localRect.height, (index: number) => {
          const pos = h.positioner.get(index);
          if (pos) cells.push({ index: index + h.startIndex, left: pos.left, top: pos.top, width: h.positioner.columnWidth, height: pos.height });
        });
        hits.push(...hitIndices(localRect, cells));
      }
      hits.sort((a, b) => a - b);
      const sig = hits.join(',');
      if (sig === drag.lastHits) return;
      drag.lastHits = sig;
      marquee.update(hits);
    };

    const frame = () => {
      if (!drag?.active) return;
      step(true);
      drag.raf = requestAnimationFrame(frame);
    };

    const finish = (mode: 'end' | 'cancel') => {
      if (!drag) return;
      if (drag.raf) cancelAnimationFrame(drag.raf);
      clip.remove();
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      const active = drag.active;
      drag = null;
      if (!active || !marquee) return;
      if (mode === 'cancel') marquee.cancel();
      else marquee.end();
    };

    const onMove = (e: MouseEvent) => {
      if (!drag) return;
      drag.pointerX = e.clientX;
      drag.pointerY = e.clientY;
      if (drag.active) return;
      if (!exceedsThreshold(e.clientX - drag.startX, e.clientY - drag.startY)) return;
      drag.active = true;
      if (!marquee) return;
      marquee.begin(drag.additive);
      document.body.appendChild(clip);
      drag.raf = requestAnimationFrame(frame);
    };

    const onUp = () => {
      const clearing = !!drag && clearsSelection(drag.active, drag.additive);
      if (drag?.active) step(false);
      finish('end');
      if (clearing) onBackgroundClick?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      finish('cancel');
    };
    const onBlur = () => finish('end');

    const onDown = (e: MouseEvent) => {
      if (drag || e.button !== 0) return;
      const el = containerRef.current;
      if (!el || !el.offsetWidth) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-slot="post-card"], [data-slot="poster-card"]')) return;
      if (target.closest('a, button, input, textarea, select, [role="button"], [contenteditable="true"]')) return;
      const sr = scroller.getBoundingClientRect();
      if (e.clientX - sr.left >= scroller.clientWidth) return;
      const cr = el.getBoundingClientRect();
      drag = {
        anchorX: e.clientX - cr.left,
        anchorY: e.clientY - cr.top,
        startX: e.clientX,
        startY: e.clientY,
        additive: e.ctrlKey || e.metaKey || e.shiftKey,
        pointerX: e.clientX,
        pointerY: e.clientY,
        active: false,
        lastHits: ' ',
        raf: 0,
      };
      e.preventDefault();
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('blur', onBlur);
    };

    scroller.addEventListener('mousedown', onDown);
    return () => {
      scroller.removeEventListener('mousedown', onDown);
      finish('end');
    };
  }, [marquee, onBackgroundClick, scroller, sectionHandles]);

  return (
    <ModelCtx.Provider value={model}>
      <div ref={containerRef as React.Ref<HTMLDivElement>} data-slot="sectioned-grid" style={{ width: '100%' }}>
        {sections.map((sec) => (
          <SectionBlock
            key={sec.key}
            sec={sec}
            model={model}
            cell={cell}
            scroller={scroller}
            dims={dims}
            scrollY={scrollY}
            isScrolling={isScrolling}
            layoutTick={layoutTick}
            onRegister={registerSection}
            onColumnCount={(n) => {
              columnCountRef.current = n;
            }}
          />
        ))}
      </div>
    </ModelCtx.Provider>
  );
}

// One month's own masonic instance. Items are a SLICE of model.items (the flat
// viewGroups array); the local index masonic hands to `cell` is never
// translated to a global one — cardModel/keyOf both derive entirely from the
// group object itself (never their index argument, see records.ts's
// cardModel/postIdKey), and selection/nav resolve their OWN index by identity
// (Array#indexOf on the canonical viewGroups) rather than trusting whatever
// index a cell rendered with. Only the coordinator above (marquee hits, nav's
// scrollIntoView, the zoom anchor) ever needs the +startIndex translation.
function SectionBlock({
  sec,
  model,
  cell: Cell,
  scroller,
  dims,
  scrollY,
  isScrolling,
  layoutTick,
  onRegister,
  onColumnCount,
}: {
  sec: HologramDateSection;
  model: HologramGridModel;
  cell: ComponentType<GridCellProps>;
  scroller: HTMLElement;
  dims: { width: number; height: number };
  scrollY: number;
  isScrolling: boolean;
  layoutTick: number;
  onRegister(key: string, handle: SectionHandle | null): void;
  onColumnCount(n: number): void;
}) {
  const bodyRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0); // this section's content-relative top (see contentOffsetOf) — lags one commit behind a resize, corrected on the next (same trade-off VirtualGridHost's own offsetRef accepts)
  const items = model.items.slice(sec.startIndex, sec.startIndex + sec.count);

  const positioner = usePositioner(
    {
      width: dims.width || 1,
      columnCount: model.columnCount,
      columnWidth: model.columnWidth,
      rowGutter: model.rowGutter,
      columnGutter: model.rowGutter,
    },
    [model.itemsKey, sec.key],
  );
  const resizeObserver = useResizeObserver(positioner);

  useEffect(() => {
    onColumnCount(positioner.columnCount);
  }, [positioner.columnCount, onColumnCount]);

  useEffect(() => {
    onRegister(sec.key, { bodyEl: bodyRef.current, headerEl: headerRef.current, positioner, startIndex: sec.startIndex, count: sec.count });
    return () => onRegister(sec.key, null);
  }, [sec.key, sec.startIndex, sec.count, positioner, onRegister]);

  // Re-measure this section's own scroll-relative offset whenever the overall
  // layout could have shifted it (a resize, or any section settling its real
  // height — see layoutTick's own comment) or the item set changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutTick/model.itemsKey are triggers (not read inside) — this must re-measure exactly when the overall layout could have shifted
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) offsetRef.current = contentOffsetOf(el, scroller);
  }, [layoutTick, model.itemsKey, scroller]);

  const heightEstimate = model.square ? positioner.columnWidth : model.itemHeightEstimate || 120;

  const gridEl = useMasonry({
    positioner,
    resizeObserver,
    items,
    itemKey: (data, i) => {
      const k = model.keyOf && data != null ? model.keyOf(data, i) : undefined;
      return k == null ? sec.startIndex + i : k;
    },
    itemHeightEstimate: heightEstimate,
    overscanBy: 2,
    height: dims.height || scroller.clientHeight,
    scrollTop: Math.max(0, scrollY - offsetRef.current),
    isScrolling,
    containerRef: bodyRef as React.MutableRefObject<HTMLElement | null>,
    tabIndex: -1,
    render: Cell,
  });

  return (
    <div data-slot="grid-section">
      <div ref={headerRef} data-slot="grid-section-header" className="sticky top-0 z-10 -mx-8 flex items-baseline gap-2 bg-[var(--color-background)]/85 px-8 py-2 text-sm font-medium text-foreground backdrop-blur-sm first:pt-0">
        {sec.label}
      </div>
      {gridEl}
    </div>
  );
}
