// Virtualized post grid (masonic useMasonry + usePositioner + useResizeObserver
// wired to the app's OWN scroll container #mode-post — masonic's <Masonry> is
// window-scroll only, so the scroller plumbing here is hand-rolled, exactly as
// validated in the runtime PoC). The island owns cell rendering + windowing;
// viewer.js owns the data (model.items = viewGroups), the container classes, and
// every delegated #postGrid handler. Cells emit the long-standing .post-card DOM
// contract (shared PostCard component), so delegation + CSS work unchanged.
//
// PoC trap, honored here: whenever the positioner is recreated (itemsKey change,
// container width change) its position cache resets — if the scrollTop STATE is
// stale at that moment, the visible window is computed wrong and the grid renders
// blank. So scroll state is (a) initialized from the real scroller, (b) updated
// by the scroll listener, and (c) force re-synced on every itemsKey change.
import { useMasonry, usePositioner, useResizeObserver } from 'masonic';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PostCard } from '../_shared/PostCard.jsx';

const ModelCtx = createContext(null);

// One grid cell. modelOf() re-reads live viewer state (selection / clip /
// inspected) on every render, so a bridge repaint() refreshes visible cells.
function Cell({ index, data }) {
  const model = useContext(ModelCtx);
  const ref = useRef(null);
  // Cells (re)mount as the window scrolls; whether .text overflows is only
  // knowable from layout, so re-check on every commit (the old path did this
  // once per render pass via rAF over the whole grid).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const t of el.querySelectorAll('.text')) {
      if (!t.classList.contains('expanded')) t.classList.toggle('truncated', t.scrollHeight > t.clientHeight);
    }
  });
  // Report the natural aspect of images that had NO reserved height (card view:
  // no shotW/H, no cached aspect) so viewer.js can cache it. The cell's own
  // size change is picked up by the resize observer — no explicit re-flow.
  const onImgLoad = model.onAspect
    ? (e) => {
        const img = e.currentTarget;
        if (img.style.aspectRatio && img.style.aspectRatio !== 'auto') return; // height was reserved — nothing to learn
        const cap = img.dataset.cap;
        if (cap && img.naturalWidth && img.naturalHeight) model.onAspect(cap, img.naturalWidth + '/' + img.naturalHeight);
      }
    : undefined;
  return <PostCard m={model.modelOf(data, index)} L={model.labels} cellRef={ref} onImgLoad={onImgLoad} />;
}

export function GridHost({ model }) {
  const scroller = document.getElementById('mode-post'); // the app's scroll container (never the window)
  const containerRef = useRef(null);
  // offset of the masonry container's top inside the scroller's CONTENT (the
  // active-filter bar etc. sit above #postGrid) — subtracted from scrollTop so
  // masonic sees container-relative scroll. A ref, not state: it only changes
  // together with events that already re-render (resize / itemsKey push).
  const offsetRef = useRef(0);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [scrollY, setScrollY] = useState(() => scroller.scrollTop);
  const [isScrolling, setIsScrolling] = useState(false);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el || !el.offsetWidth) return; // hidden (browse-posters) — keep last real dims, don't reset the positioner to width 0
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
    let t = null;
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
      // list: one full-width column. tile: columnWidth is masonic's MINIMUM —
      // real columns stretch to fill, exactly like the old CSS auto-fill
      // minmax(var(--tile-size),1fr). A columnWidth change (size slider drag →
      // bridge patch) recreates the positioner internally, so live re-flow
      // needs no extra wiring here.
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
    itemKey: (data, i) => (data && data.rep ? model.keyOf(data) : i),
    // square cells (tile) are exactly one column wide-and-high — using the real
    // computed column width makes the height estimate exact (accurate container
    // height = precise deep-scroll restore).
    itemHeightEstimate: model.square ? positioner.columnWidth : model.itemHeightEstimate || 120,
    overscanBy: 2,
    height: dims.height || scroller.clientHeight,
    scrollTop: Math.max(0, scrollY - offsetRef.current),
    isScrolling,
    containerRef,
    tabIndex: -1, // the legacy grid was no tab stop; keep it that way
    render: Cell,
  });

  return <ModelCtx.Provider value={model}>{gridEl}</ModelCtx.Provider>;
}
