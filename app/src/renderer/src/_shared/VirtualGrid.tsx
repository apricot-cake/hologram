// Shared virtualized-grid plumbing (masonic useMasonry + usePositioner +
// useResizeObserver wired to the app's OWN scroll container #mode-post —
// masonic's <Masonry> is window-scroll only, so the scroller wiring here is
// hand-rolled, exactly as validated in the runtime PoC). Extracted 1:1 from the
// post-grid component when the poster/collection grids joined the same foundation:
// each grid module supplies its own cell component; this host owns windowing.
//
// PoC trap, honored here: whenever the positioner is recreated (itemsKey change,
// container width change) its position cache resets — if the scrollTop STATE is
// stale at that moment, the visible window is computed wrong and the grid renders
// blank. So scroll state is (a) initialized from the real scroller, (b) updated
// by the scroll listener, and (c) force re-synced on every itemsKey change.
import { createPortal, flushSync } from 'react-dom';
import { useMasonry, usePositioner, useResizeObserver } from 'masonic';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { registerGridNav } from '../services/grid-nav.ts';
import { autoScrollStep, hitIndices, MARQUEE_THRESHOLD, rectFromPoints } from '../services/marquee.ts';
import type { MarqueeCell } from '../services/marquee.ts';

// The cell component each grid module supplies (masonic's render component).
export interface GridCellProps {
  index: number;
  data: any;
  width: number;
}

const ModelCtx = createContext<HologramGridModel | null>(null);
// Cells read the live model through context so a bridge render()/patch() (paint
// bump → re-render) lets modelOf re-derive card state (selection/inspected are
// hologramStore subscriptions inside Cell, not part of this closure-read model).
// Cells mount only inside the provider, so the null default never escapes.
export const useGridModel = () => useContext(ModelCtx) as HologramGridModel;

export function VirtualGridHost({ model, cell, nav, marquee }: { model: HologramGridModel; cell: ComponentType<GridCellProps>; nav?: boolean; marquee?: HologramMarqueeSink }) {
  const scroller = document.getElementById('mode-post') as HTMLElement; // the app's scroll container (never the window); static HTML, always present
  const containerRef = useRef<HTMLElement | null>(null);
  // offset of the masonry container's top inside the scroller's CONTENT (the
  // active-filter bar etc. sit above the grid) — subtracted from scrollTop so
  // masonic sees container-relative scroll. A ref, not state: it only changes
  // together with events that already re-render (resize / itemsKey push).
  const offsetRef = useRef(0);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [scrollY, setScrollY] = useState(() => scroller.scrollTop);
  const [isScrolling, setIsScrolling] = useState(false);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el || !el.offsetWidth) return; // hidden (other browse mode) — keep last real dims, don't reset the positioner to width 0
    offsetRef.current = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const width = el.offsetWidth;
    const height = scroller.clientHeight;
    setDims((d) => (d.width === width && d.height === height ? d : { width, height }));
  }, [scroller]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure, scroller]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      setScrollY(scroller.scrollTop);
      setIsScrolling(true); // masonic: pointer-events off + will-change while moving
      clearTimeout(t);
      t = setTimeout(() => setIsScrolling(false), 100);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      clearTimeout(t);
    };
  }, [scroller]);

  // Fresh item set = the positioner below was just reset — re-sync scroll state
  // with reality (see the PoC trap in the header comment). Also re-measure: the
  // content above the grid (active-filter bar) may have grown/shrunk with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: model.itemsKey IS the trigger (not read inside) — this must run exactly when the item set was rebuilt
  useLayoutEffect(() => {
    setScrollY(scroller.scrollTop);
    measure();
  }, [model.itemsKey, measure, scroller]);

  const positioner = usePositioner(
    {
      width: dims.width || 1, // pre-measure first frame; corrected before paint
      // columnCount pins the layout (list: one full-width column). Otherwise
      // columnWidth is masonic's MINIMUM — real columns stretch to fill, exactly
      // like the old CSS auto-fill minmax(size,1fr). A columnWidth change (size
      // slider drag → bridge patch) recreates the positioner internally, so live
      // re-flow needs no extra wiring here.
      columnCount: model.columnCount,
      columnWidth: model.columnWidth,
      rowGutter: model.rowGutter,
      columnGutter: model.rowGutter,
    },
    [model.itemsKey],
  );
  const resizeObserver = useResizeObserver(positioner); // cell height changes (text expand, late image) re-flow the column

  // Height masonic itself uses for an unmeasured cell — the fallback below reuses it
  // so an estimated scroll lands where the grid will actually put the item.
  const heightEstimate = model.square ? positioner.columnWidth : model.itemHeightEstimate || 120;

  // Publish the geometry keyboard selection movement needs (services/grid-nav.ts).
  // Re-registers whenever the positioner is recreated (itemsKey / width change) so the
  // handle never closes over a stale position cache.
  useEffect(() => {
    if (!nav) return;
    return registerGridNav({
      columnCount: () => positioner.columnCount,
      scrollIntoView: (index: number) => {
        const pos = positioner.get(index);
        const pad = model.rowGutter || 0;
        const viewTop = scroller.scrollTop;
        const viewHeight = scroller.clientHeight;
        if (!pos) {
          // Not measured yet — masonic only measures what it has rendered, so this is
          // the far-away jump (Home/End-sized moves, not a step to a neighbour). Aim at
          // the estimated height of everything above it and center, then let the real
          // position take over once it renders.
          const est = positioner.estimateHeight(index, heightEstimate);
          scroller.scrollTo({ top: Math.max(0, offsetRef.current + est - viewHeight / 2) });
          return;
        }
        const top = offsetRef.current + pos.top;
        const bottom = top + pos.height;
        if (top - pad < viewTop) scroller.scrollTo({ top: Math.max(0, top - pad) });
        else if (bottom + pad > viewTop + viewHeight) scroller.scrollTo({ top: bottom + pad - viewHeight });
      },
    });
  }, [nav, positioner, scroller, heightEstimate, model.rowGutter]);

  // The band's hit test reads the LIVE positioner, but re-running its effect
  // mid-drag would tear the gesture down — so it reaches it through a ref instead
  // of a dependency (the positioner is recreated on every itemsKey / width change).
  const positionerRef = useRef(positioner);
  positionerRef.current = positioner;

  // --- Drag range selection (#484) -----------------------------------------
  // Press on empty space and drag: a rubber band selects every card it touches
  // (交差判定 — Explorer / Finder と同型), Ctrl/Shift adds to the existing
  // selection instead of replacing it, and holding the pointer at an edge scrolls
  // the grid so the band can reach past one screenful.
  //
  // Two things about this grid shape the implementation:
  //  - Cells are absolutely positioned AND recycled, so the hit test runs against
  //    masonic's positioner (the layout model), never against DOM rects. That is
  //    also what lets a band reach cards that are scrolled out of view, and what
  //    keeps the answer stable while auto-scroll changes what is mounted.
  //  - The band moves every animation frame. It is drawn imperatively (a detached
  //    overlay, not React state) because a state write per frame would re-render
  //    the whole masonry for a rectangle that isn't part of it.
  useEffect(() => {
    if (!marquee) return;
    // A fixed clip box the size of the scroller's viewport + the band inside it:
    // the band's origin is the press point, which scrolls away during a long drag,
    // so without the clip it would paint over the toolbar and the sidebar.
    const clip = document.createElement('div');
    clip.className = 'grid-marquee-clip';
    const bandEl = document.createElement('div');
    bandEl.className = 'grid-marquee';
    clip.appendChild(bandEl);

    let drag: {
      anchorX: number; // press point, CONTAINER space — fixed for the whole drag
      anchorY: number;
      startX: number; // press point, client space — only for the movement threshold
      startY: number;
      pointerX: number; // latest pointer, client space
      pointerY: number;
      additive: boolean;
      active: boolean; // threshold crossed = this is a marquee, not a click
      lastHits: string;
      raf: number;
    } | null = null;

    const step = (allowScroll: boolean) => {
      const el = containerRef.current;
      if (!drag || !el) return;
      const sr = scroller.getBoundingClientRect();
      if (allowScroll) {
        const dy = autoScrollStep(drag.pointerY, sr.top, sr.bottom);
        if (dy) scroller.scrollTop += dy;
      }
      const cr = el.getBoundingClientRect();
      // Clamp the moving corner to the visible grid: the pointer can sit past the
      // edge (that is what drives auto-scroll) or leave the window entirely, and
      // neither should stretch the band over chrome that isn't the grid.
      const viewRight = sr.left + scroller.clientWidth; // not sr.right — that includes the scrollbar gutter
      const curX = Math.min(Math.max(drag.pointerX, sr.left), viewRight) - cr.left;
      const curY = Math.min(Math.max(drag.pointerY, sr.top), sr.bottom) - cr.top;
      const rect = rectFromPoints(drag.anchorX, drag.anchorY, curX, curY);

      clip.style.left = `${sr.left}px`;
      clip.style.top = `${sr.top}px`;
      clip.style.width = `${scroller.clientWidth}px`;
      clip.style.height = `${sr.height}px`;
      bandEl.style.transform = `translate(${cr.left + rect.x - sr.left}px, ${cr.top + rect.y - sr.top}px)`;
      bandEl.style.width = `${rect.width}px`;
      bandEl.style.height = `${rect.height}px`;

      // positioner.range() is masonic's own interval-tree lookup over the band's
      // vertical span — O(log n + hits) across the whole library rather than a walk
      // of anything — and it answers for every cell whose height has been measured,
      // mounted or not. hitIndices() then applies the horizontal half.
      const p = positionerRef.current;
      const cells: MarqueeCell[] = [];
      p.range(rect.y, rect.y + rect.height, (index: number) => {
        const pos = p.get(index);
        if (pos) cells.push({ index, left: pos.left, top: pos.top, width: p.columnWidth, height: pos.height });
      });
      const hits = hitIndices(rect, cells);
      const sig = hits.join(',');
      if (sig === drag.lastHits) return; // same cards as last frame — don't churn the store (every cell subscribes to it)
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
      if (!active) return; // never crossed the threshold: a plain click on empty space, selection untouched
      if (mode === 'cancel') marquee.cancel();
      else marquee.end();
    };

    const onMove = (e: MouseEvent) => {
      if (!drag) return;
      drag.pointerX = e.clientX;
      drag.pointerY = e.clientY;
      if (drag.active) return;
      if (Math.abs(e.clientX - drag.startX) < MARQUEE_THRESHOLD && Math.abs(e.clientY - drag.startY) < MARQUEE_THRESHOLD) return;
      drag.active = true;
      marquee.begin(drag.additive);
      document.body.appendChild(clip);
      drag.raf = requestAnimationFrame(frame);
    };

    // One last pass without auto-scroll: the final frame's scroll may have brought
    // cells into the band that masonic only measured after it ran.
    const onUp = () => {
      if (drag?.active) step(false);
      finish('end');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      finish('cancel');
    };
    // The window losing focus mid-drag means no mouseup is coming — keep what the
    // band selected rather than leaving it painted forever.
    const onBlur = () => finish('end');

    const onDown = (e: MouseEvent) => {
      if (drag || e.button !== 0) return;
      const el = containerRef.current;
      if (!el || !el.offsetWidth) return; // grid hidden (other browse mode)
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.post-card')) return; // cards own the click and the OS drag-out (#132)
      if (target.closest('a, button, input, textarea, select, [role="button"], [contenteditable="true"]')) return;
      const sr = scroller.getBoundingClientRect();
      if (e.clientX - sr.left >= scroller.clientWidth) return; // the scrollbar gutter, not the grid
      const cr = el.getBoundingClientRect();
      drag = {
        anchorX: e.clientX - cr.left,
        anchorY: e.clientY - cr.top,
        startX: e.clientX,
        startY: e.clientY,
        // Read at press time, the way Explorer does — a modifier tapped mid-drag
        // must not silently switch the band from replacing to extending.
        additive: e.ctrlKey || e.metaKey || e.shiftKey,
        pointerX: e.clientX,
        pointerY: e.clientY,
        active: false,
        lastHits: ' ', // no real signature equals this, so the first frame always pushes
        raf: 0,
      };
      e.preventDefault(); // otherwise the press starts a native text selection across the cards
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
  }, [marquee, scroller]);

  const gridEl = useMasonry({
    positioner,
    resizeObserver,
    items: model.items,
    itemKey: (data, i) => {
      const k = model.keyOf && data != null ? model.keyOf(data, i) : undefined;
      return k == null ? i : k;
    },
    // square cells are exactly one column wide-and-high — using the real
    // computed column width makes the height estimate exact (accurate container
    // height = precise deep-scroll restore).
    itemHeightEstimate: model.square ? positioner.columnWidth : model.itemHeightEstimate || 120,
    overscanBy: 2,
    height: dims.height || scroller.clientHeight,
    scrollTop: Math.max(0, scrollY - offsetRef.current),
    isScrolling,
    containerRef,
    tabIndex: -1, // the legacy grids were no tab stop; keep it that way
    render: cell,
  });

  return <ModelCtx.Provider value={model}>{gridEl}</ModelCtx.Provider>;
}

// Shared mount for every virtualized grid — a component under the single App root now
// (app/App.tsx renders <PostGrid/> / <PosterGrid/>). React does NOT portal into the
// container itself: viewer.js still blanket-clears it (grid.innerHTML='' on the empty
// push), and React must never watch its managed nodes vanish underneath it. So the grid
// renders into its OWN host <div>, attached/detached as a whole, and React portals the
// masonry into that host.
//
// Renders are flushed SYNCHRONOUSLY (flushSync): viewer.js (outside React) relies on a
// push having fully committed before its next line runs (e.g. restoring scrollTop right
// after a push). flushSync is legal because every bridge push originates outside React.
// The bridge returns a FRESH model ref on each render/patch ({...model, paint:++}),
// so setModel always re-renders — paint bumps make visible cells re-read live viewer state
// via modelOf (selection/inspected are separate hologramStore subscriptions inside
// Cell); itemsKey changes reset the positioner.
// bridge only needs get()/subscribe() (HologramGridSource) — both the post source
// and the poster source satisfy it, plus their own configure()/etc. that GridMount
// never touches.
export function GridMount({ bridge, containerId, hostId, renderHost }: { bridge: HologramGridSource; containerId: string; hostId: string; renderHost: (model: HologramGridModel) => ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (!hostRef.current) {
    const h = document.createElement('div');
    h.id = hostId;
    h.style.width = '100%';
    hostRef.current = h;
  }
  const host = hostRef.current;
  const [model, setModel] = useState<HologramGridModel | null>(null);

  useEffect(() => {
    // Attach the host to the container BEFORE rendering into it — masonic measures
    // offsetWidth on mount, and a detached host measures 0 (the blank-grid trap).
    const attach = () => {
      const c = document.getElementById(containerId);
      if (c && !host.isConnected) c.appendChild(host);
    };
    const sync = () => {
      const m = bridge.get();
      if (m) {
        attach();
        flushSync(() => setModel(m));
      } else {
        flushSync(() => setModel(null));
        host.remove(); // viewer's following grid.innerHTML='' then has nothing of ours to clear
      }
    };
    const unsub = bridge.subscribe(sync);
    // Catch a model pushed before this effect ran — plain setState (effect-safe, no flushSync).
    if (bridge.get()) {
      attach();
      setModel(bridge.get());
    }
    return unsub;
  }, [bridge, containerId, host]);

  return model ? createPortal(renderHost(model), host) : null;
}
