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
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
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
// Cells read the live model through context so a bridge repaint() (paint bump →
// re-render) lets modelOf re-derive selection / clip / inspected state.
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

// Island wiring shared by every virtualized grid: React does NOT root on the
// container itself — viewer.js may still blanket-clear it (empty state), and
// React must never watch its managed nodes vanish underneath it. So the island
// renders into its OWN host <div> and attaches/detaches that host as a whole.
// Renders are flushed SYNCHRONOUSLY (flushSync): viewer.js relies on a render()
// having fully committed before its next line runs (e.g. restoring scrollTop
// right after a push). Bridge pushes always originate outside React (viewer.js),
// so flushSync is legal here.
export function wireGridIsland({ bridge, containerId, hostId, renderHost }: { bridge: CorpusGridBridge; containerId: string; hostId: string; renderHost: (model: CorpusGridModel) => ReactNode }) {
  const host = document.createElement('div');
  host.id = hostId;
  host.style.width = '100%';
  const root = createRoot(host);

  const sync = () => {
    const model = bridge.get();
    if (model) {
      if (!host.isConnected) (document.getElementById(containerId) as HTMLElement).appendChild(host);
      flushSync(() => root.render(renderHost(model)));
    } else {
      flushSync(() => root.render(null));
      host.remove();
    }
  };
  bridge.subscribe(sync);
  // Catch a model pushed before this island loaded (dev: deferred ES module).
  if (bridge.isActive()) sync();
}
