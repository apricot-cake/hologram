// Shared virtualized-grid plumbing (masonic useMasonry + usePositioner +
// useResizeObserver wired to the app's OWN scroll container #mode-post —
// masonic's <Masonry> is window-scroll only, so the scroller wiring here is
// hand-rolled, exactly as validated in the runtime PoC). Extracted 1:1 from the
// post-grid island when the poster/collection grids joined the same foundation:
// each grid island supplies its cell component; this host owns windowing.
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

// The cell component each grid island supplies (masonic's render component).
export interface GridCellProps {
  index: number;
  data: any;
  width: number;
}

const ModelCtx = createContext<CorpusGridModel | null>(null);
// Cells read the live model through context so a bridge render()/patch() (paint
// bump → re-render) lets modelOf re-derive clip state (selection/inspected are
// corpusStore subscriptions inside Cell, not part of this closure-read model).
// Cells mount only inside the provider, so the null default never escapes.
export const useGridModel = () => useContext(ModelCtx) as CorpusGridModel;

export function VirtualGridHost({ model, cell }: { model: CorpusGridModel; cell: ComponentType<GridCellProps> }) {
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
// (clip via modelOf; selection/inspected are separate corpusStore subscriptions inside
// Cell); itemsKey changes reset the positioner.
export function GridMount({ bridge, containerId, hostId, renderHost }: { bridge: CorpusGridBridge; containerId: string; hostId: string; renderHost: (model: CorpusGridModel) => ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (!hostRef.current) {
    const h = document.createElement('div');
    h.id = hostId;
    h.style.width = '100%';
    hostRef.current = h;
  }
  const host = hostRef.current;
  const [model, setModel] = useState<CorpusGridModel | null>(null);

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
