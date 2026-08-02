// Shared virtualized-grid plumbing (masonic useMasonry + usePositioner +
// useResizeObserver wired to the app's OWN scroll container — masonic's <Masonry> is
// window-scroll only, so the scroller wiring here is hand-rolled, exactly as validated
// in the runtime PoC). Extracted 1:1 from the
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
import { scroller as contentScroller } from '../services/content-area.ts';
import { registerGridNav } from '../services/grid-nav.ts';
import { autoScrollStep, clearsSelection, exceedsThreshold, hitIndices, rectFromPoints } from '../services/marquee.ts';
import type { MarqueeCell } from '../services/marquee.ts';
import { anchorScrollTop, anchorViewportOffset, pickAnchorIndex, registerZoomAnchorSource } from '../services/zoom-anchor.ts';
import type { ZoomAnchor, ZoomAnchorCell } from '../services/zoom-anchor.ts';

// The cell component each grid module supplies (masonic's render component).
export interface GridCellProps {
  index: number;
  data: any;
  width: number;
}

// Exported (not module-private) so _shared/SectionedGrid.tsx's per-month host
// (#47) can provide the SAME context — a cell doesn't know or care whether one
// shared positioner or several per-month ones sit behind it.
export const ModelCtx = createContext<HologramGridModel | null>(null);
// Cells read the live model through context so a bridge render()/patch() (paint
// bump → re-render) lets modelOf re-derive card state (selection/inspected are
// hologramStore subscriptions inside Cell, not part of this closure-read model).
// Cells mount only inside the provider, so the null default never escapes.
export const useGridModel = () => useContext(ModelCtx) as HologramGridModel;

export function VirtualGridHost({ model, cell, nav, anchor, marquee, onBackgroundClick }: { model: HologramGridModel; cell: ComponentType<GridCellProps>; nav?: boolean; anchor?: boolean; marquee?: HologramMarqueeSink; onBackgroundClick?: () => void }) {
  // The app's scroll container (never the window). The shell registers it on mount and
  // this host only ever renders from inside a portal attached later, so it is there.
  const scroller = contentScroller() as HTMLElement;
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

  // A zoom's hold on the view (#282), while it is still being honored. Refs, not
  // state: the alignment below runs in a layout effect and must not re-render to
  // remember where it got to.
  const heldAnchorRef = useRef<ZoomAnchor | null>(null); // what we are still aligning to
  const seenAnchorRef = useRef<ZoomAnchor | null | undefined>(undefined); // last anchor read off a model (undefined = not mounted yet)
  const anchorScrollRef = useRef(0); // the scrollTop WE last wrote for it
  const anchorItemsKeyRef = useRef(model.itemsKey);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      // Someone else moved the view, so the zoom's hold is over. Without this a
      // hold would outlive its gesture and yank the user back on the next
      // unrelated re-render. Our own writes land on anchorScrollRef first, so
      // they never look like someone else's.
      if (heldAnchorRef.current && Math.abs(scroller.scrollTop - anchorScrollRef.current) > 1) heldAnchorRef.current = null;
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

  // --- Zoom anchor (#282) --------------------------------------------------
  // Sibling of the itemsKey re-sync above: both are "the layout underneath just
  // changed, put the scroll position back where it belongs", and both can only
  // be answered here because this is where the layout is.
  //
  // Ctrl+wheel zoom (#141) re-lays out the whole masonry. The zoom side names the
  // item it wants held still (services/zoom-anchor.ts's registry, resolved from
  // the layout model below — no card is looked up in the DOM), and this is the
  // half that knows where that item ENDED UP.

  // The zoom asks through the registry; answering means reading our positioner.
  useEffect(() => {
    if (!anchor) return;
    return registerZoomAnchorSource({
      resolve: (clientX: number, clientY: number) => {
        const el = containerRef.current;
        if (!el || !el.offsetWidth) return null; // hidden (other browse mode)
        const cr = el.getBoundingClientRect();
        // Candidates = the cells of the VISIBLE window, in container space. The
        // pointer is inside that window by construction (a wheel event over the
        // scroller), so the nearest of these is always something on screen.
        const top = Math.max(0, scroller.scrollTop - offsetRef.current);
        const cells: ZoomAnchorCell[] = [];
        positioner.range(top, top + scroller.clientHeight, (index: number) => {
          const pos = positioner.get(index);
          if (pos) cells.push({ index, left: pos.left, top: pos.top, width: positioner.columnWidth, height: pos.height });
        });
        const index = pickAnchorIndex(cells, clientX - cr.left, clientY - cr.top);
        if (index == null) return null;
        const pos = positioner.get(index);
        if (!pos) return null;
        return { index, viewportOffset: anchorViewportOffset(pos.top, offsetRef.current, scroller.scrollTop) };
      },
    });
  }, [anchor, positioner, scroller]);

  // Honor a held anchor. No dependency array on purpose: the re-layout a zoom
  // triggers lands over SEVERAL commits (the positioner is rebuilt first, then
  // masonic's resize observer feeds it the real cell heights and forces another
  // render), and the anchor has to be re-applied on each of them — that two-stage
  // approximate→exact settle is what the old rAF/timeout guesswork outside this
  // layer was standing in for. The work is a couple of number reads when no
  // anchor is held, which is every ordinary commit.
  useLayoutEffect(() => {
    const incoming = (model.zoomAnchor as ZoomAnchor | null | undefined) ?? null;
    // Identity, not value: the zoom hands over a fresh object every time it wants
    // the hold (re-)armed, and the model carries the same one through the repeat
    // gets in between. On mount we only take a baseline — a stale anchor left over
    // from an earlier burst must not scroll a freshly mounted grid.
    const fresh = seenAnchorRef.current !== undefined && incoming !== null && incoming !== seenAnchorRef.current;
    if (fresh) heldAnchorRef.current = incoming;
    seenAnchorRef.current = incoming;
    // A different item SET is a different question — whatever the zoom was
    // holding is gone (filter / sort / search), unless this very commit is the
    // zoom's own re-render and brought a new anchor with it.
    if (model.itemsKey !== anchorItemsKeyRef.current) {
      anchorItemsKeyRef.current = model.itemsKey;
      if (!fresh) heldAnchorRef.current = null;
    }
    const held = heldAnchorRef.current;
    if (!held) return;
    const pos = positioner.get(held.index);
    // Not laid out yet — a fresh positioner has an empty cache, and masonic only
    // measures what it has rendered. Aim at its own estimate for everything above
    // the item (the same estimate the container height is built from, so the two
    // agree), and let the exact position take over on the commit that measures it.
    const top = pos ? pos.top : positioner.estimateHeight(held.index, heightEstimate);
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const target = anchorScrollTop(top, offsetRef.current, held.viewportOffset, max);
    if (Math.abs(target - scroller.scrollTop) > 0.5) scroller.scrollTop = target;
    // Read back rather than trusting the write: the browser clamps to the real
    // content, and the scroll listener compares against this to tell our own
    // move from the user's.
    anchorScrollRef.current = scroller.scrollTop;
    setScrollY(scroller.scrollTop);
  });

  // The band's hit test reads the LIVE positioner, but re-running its effect
  // mid-drag would tear the gesture down — so it reaches it through a ref instead
  // of a dependency (the positioner is recreated on every itemsKey / width change).
  const positionerRef = useRef(positioner);
  positionerRef.current = positioner;

  // --- The empty-space gesture (#484 drag, #242 click) ----------------------
  // One press on the grid background, two outcomes, so one recognizer owns both:
  //  - drag it → a rubber band selects every card it touches (交差判定 —
  //    Explorer / Finder と同型), Ctrl/Shift adds to the existing selection
  //    instead of replacing it, and holding the pointer at an edge scrolls the
  //    grid so the band can reach past one screenful (#484).
  //  - release without dragging → a plain click on the background, which clears
  //    the selection and sends the inspector back to its placeholder (#242).
  // Splitting these across two listeners is what a `click` handler would force,
  // and a click fires after a drag too — only the recognizer that owns the
  // movement threshold can tell the two apart.
  //
  // `marquee` is the drag half's sink; a grid without a selection (posters)
  // passes only onBackgroundClick and gets the click half alone.
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
    if (!marquee && !onBackgroundClick) return;
    // A fixed clip box the size of the scroller's viewport + the band inside it:
    // the band's origin is the press point, which scrolls away during a long drag,
    // so without the clip it would paint over the toolbar and the sidebar.
    // contain:strict keeps a band that is repositioned every frame from invalidating
    // layout outside its own box. The band's tone is --color-selected at the
    // translucent-fill + hairline-border weight Explorer/Finder give a rubber band.
    const clip = document.createElement('div');
    clip.dataset.slot = 'grid-marquee-clip';
    clip.className = 'pointer-events-none fixed z-45 overflow-hidden [contain:strict]';
    const bandEl = document.createElement('div');
    bandEl.dataset.slot = 'grid-marquee';
    bandEl.className = 'absolute top-0 left-0 border border-[color-mix(in_oklch,var(--color-selected)_70%,transparent)] bg-[color-mix(in_oklch,var(--color-selected)_16%,transparent)] [will-change:transform,width,height]';
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
      if (!drag || !el || !marquee) return; // no band on a grid without a selection
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
      // Never crossed the threshold: the press was a click, and onUp — the only
      // place a click can be COMPLETED — owns what happens next (#242). Tearing
      // down here for any other reason (unmount, Esc) must not act on it.
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
      drag.active = true; // the press is a drag now — no longer a click, band or not
      if (!marquee) return;
      marquee.begin(drag.additive);
      document.body.appendChild(clip);
      drag.raf = requestAnimationFrame(frame);
    };

    // One last pass without auto-scroll: the final frame's scroll may have brought
    // cells into the band that masonic only measured after it ran. A release that
    // never became a drag is the click half instead (#242) — read before finish()
    // clears the gesture, applied after it, so the handler sees no drag in flight.
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
    // The window losing focus mid-drag means no mouseup is coming — keep what the
    // band selected rather than leaving it painted forever.
    const onBlur = () => finish('end');

    const onDown = (e: MouseEvent) => {
      if (drag || e.button !== 0) return;
      const el = containerRef.current;
      if (!el || !el.offsetWidth) return; // grid hidden (other browse mode)
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-slot="post-card"], [data-slot="poster-card"]')) return; // cells own the click and the OS drag-out (#132)
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
        lastHits: '\0', // no real signature equals this, so the first frame always pushes
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
  }, [marquee, onBackgroundClick, scroller]);

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
// (AppShell renders <PostGrid/> / <PosterGrid/> / <TrashGrid/>). The grid renders into
// its OWN host <div>, attached to the shell's grid slot as a whole, and React portals
// the masonry into that host: attaching and detaching one node is what lets an empty
// push unmount every cell synchronously without React ever watching nodes it manages
// vanish underneath it.
//
// `container` is a getter, not an element id: the shell hands its slot over through
// services/content-area.ts (#153 category 2 — nothing looks the grid up by id).
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
export function GridMount({ bridge, container, renderHost }: { bridge: HologramGridSource; container: () => HTMLElement | null; renderHost: (model: HologramGridModel) => ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (!hostRef.current) {
    const h = document.createElement('div');
    h.style.width = '100%';
    hostRef.current = h;
  }
  const host = hostRef.current;
  const [model, setModel] = useState<HologramGridModel | null>(null);

  useEffect(() => {
    // Attach the host to the container BEFORE rendering into it — masonic measures
    // offsetWidth on mount, and a detached host measures 0 (the blank-grid trap).
    const attach = () => {
      const c = container();
      if (c && !host.isConnected) c.appendChild(host);
    };
    const sync = () => {
      const m = bridge.get();
      if (m) {
        attach();
        flushSync(() => setModel(m));
      } else {
        flushSync(() => setModel(null));
        host.remove(); // the slot is empty again — the empty state takes the space
      }
    };
    const unsub = bridge.subscribe(sync);
    // Catch a model pushed before this effect ran — plain setState (effect-safe, no flushSync).
    if (bridge.get()) {
      attach();
      setModel(bridge.get());
    }
    return unsub;
  }, [bridge, container, host]);

  return model ? createPortal(renderHost(model), host) : null;
}
