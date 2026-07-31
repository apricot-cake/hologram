// The size axis of both grids, plus the side effects of a display change — extracted
// from the old viewer.ts monolith.
// The post grid and poster grid each carried their own density + size state
// (viewSizeState/posterSizeState, tileGridMetrics/posterGridMetrics) driving the
// SAME geometry.ts math (colsFor/sizeFor/sliderTrack/trackCols) — this module is
// the single owner of both, replacing two near-duplicate copies in viewer.ts.
// The size control itself is the React display popover (#154 P2②): it reads
// computeSizeTrack/computePosterSizeTrack as data and calls the setters back, so
// nothing here touches a slider element.
//
// The post side's display state is NOT here: it is the three orthogonal store keys
// services/display.ts owns (#618). This module only reacts to them — persist, clamp
// the size into the range the new shape allows, re-render.
import { clampGridSize, currentShape, GRID_MAX, gridMin, gutterFor, LIST_MAX, LIST_MIN, shapeSnapshot } from './display.ts';
import { gridWidth, scroller } from './content-area.ts';
import { sizeFor, sliderTrack, trackCols, thumbW } from './geometry.ts';
import { get as storeGet, set as storeSet } from './store.ts';
import { resolveZoomAnchor } from './zoom-anchor.ts';
import type { ZoomAnchor } from './zoom-anchor.ts';
import type { AppPrefs } from '../../../main/ipc-payloads.ts';

export interface GridDensityDeps {
  hologramIpc: { setPref(key: string, value: unknown): void };
  hologramPostGridSource: { setLiveColumnWidth(px: number | null): void; setZoomAnchor(anchor: ZoomAnchor | null): void };
  renderPosts(inPlace?: boolean): void;
  renderPosters(): void;
  getBrowseMode(): string;
}

// The size-slider track, as data for a React-driven control. For the auto-fill views the
// range is COLUMN COUNTS (min = fewest = largest tiles ... max = most = smallest); for the
// list it is raw thumbnail px. `single` = only one stop is geometrically possible, so the
// caller hides the control (it would convey nothing).
export interface HologramSizeTrack {
  min: number;
  max: number;
  value: number;
  step: number;
  single: boolean;
}

export function makeGridDensity(deps: GridDensityDeps) {
  // --- Post grid: size state (the display SHAPE lives in display.ts) ---
  let gridSize = 280; // grid: column width px (pref gridSize)
  let listThumb = 88; // list: thumbnail width px (pref listThumb)

  // Thumbnail width tracks the cell so larger cells stay sharp (60px buckets).
  // Quality follows the SHAPE axis (2026-07-19 確定): a square cell is a cropped
  // still served by the thumbnailer, an original-aspect cell is the card as it has
  // always been (DPR-aware, capped at the thumbnailer's 720px max — main.js
  // getThumbnail). Both floors sit at/below the smallest cell the axis allows; the
  // thumbnailer serves from 64px, so nothing changes on the main side.
  const _dpr = Math.min(2, window.devicePixelRatio || 1);
  const gridThumbW = () => (currentShape().square ? thumbW(gridSize * 1.4, 120, 960) : thumbW(gridSize * 1.3 * _dpr, 240, 720));
  const listThumbW = () => thumbW(listThumb * 1.5 * _dpr, 120, 720);

  // View-size slider — both layouts have one. The grid quantizes the real width to
  // "how many columns fit", so its track maps to COLUMN COUNTS (one detent = exactly
  // one column, no dead notches). The list is a full-width stack, so its track maps
  // straight to the thumbnail px. Right = larger. While dragging only the live column
  // width updates; persisting + re-requesting thumbnails happens on release.
  function viewSizeState() {
    const shape = currentShape();
    if (shape.list)
      return {
        get: () => listThumb,
        set: (v: number) => {
          listThumb = v;
        },
        min: LIST_MIN,
        max: LIST_MAX,
        pref: 'listThumb',
        storeKey: 'listThumb',
        columns: false,
      };
    return {
      get: () => gridSize,
      set: (v: number) => {
        gridSize = v;
      },
      // The floor rides the 情報を表示 switch: bare cells reach down to the overview
      // zoom (#141), cells carrying a metadata block cannot.
      min: gridMin(shape.info),
      max: GRID_MAX,
      pref: 'gridSize',
      storeKey: 'gridSize',
      columns: true,
    };
  }

  function setViewSize(px: number, commit = true) {
    const st = viewSizeState();
    st.set(Math.max(st.min, Math.min(st.max, px)));
    if (!commit) {
      // Live re-flow while dragging (masonic recreates its positioner on columnWidth
      // change) via a deliberate side channel, NOT hologramStore — writing every drag
      // input to the store would recompute+notify on every pointermove for no benefit.
      if (st.columns) deps.hologramPostGridSource.setLiveColumnWidth(st.get());
      return;
    }
    deps.hologramIpc.setPref(st.pref, st.get());
    // The settled size mirrors into hologramStore — the post-grid source derives
    // columnWidth/itemHeightEstimate from it. Clear the live-drag override so a
    // later VIEW change (which reads a different storeKey) can't see a stale value.
    storeSet(st.storeKey, st.get());
    deps.hologramPostGridSource.setLiveColumnWidth(null);
    // In-place: a size change re-lays out the SAME set of posts. That is what the flag
    // means here — reuse the grouped set instead of re-filtering ~9k records, and skip
    // the entrance animation. Without it every notch of the zoom (and every slider
    // release) replayed the cards' intro, which reads as the grid refreshing under you.
    // Thumbnails still come back at the new size: the settled size goes into the store
    // above, and the grid source re-derives each card's model (tileThumbW) from it.
    deps.renderPosts(true);
  }

  // The grid's own box, measured. The gutter is the layout's own constant rather than
  // a computed style: masonic draws the gaps, the container has none.
  function postGridMetrics(): HologramGridMetrics | null {
    const W = gridWidth('post');
    if (!W) return null;
    return { W, g: gutterFor(currentShape()) };
  }

  let _dragMetrics: HologramGridMetrics | null = null; // grid geometry cached for the duration of one size drag

  // Size-slider track as DATA (the React display popover reads this; the old #tileSlider
  // DOM path is gone). A column-count track for the grid (one detent = one column, no
  // dead notches) and raw px for the list.
  function computeSizeTrack(): HologramSizeTrack | null {
    const st = viewSizeState();
    if (!st.columns) return { min: st.min, max: st.max, value: st.get(), step: 8, single: false };
    const m = postGridMetrics();
    if (!m) return null;
    // Original-aspect cells may go as wide as the grid (one column is a legal, if odd,
    // reading width); a square lattice of one giant tile is not a lattice.
    const tr = sliderTrack({ min: st.min, max: st.max, size: st.get() }, m, currentShape().square ? undefined : { minCols: 1 });
    return { min: tr.nBig, max: tr.nSmall, value: tr.value, step: 1, single: tr.single };
  }

  // Apply a slider value (the popover's Slider drives this in place of #tileSlider):
  // mid-drag (commit=false) reuses the cached geometry + updates the live column width;
  // commit persists + re-requests thumbnails. min/max come from the track the caller last
  // read, so the column un-inversion matches.
  function setSizeFromSlider(value: number, min: number, max: number, commit: boolean) {
    const st = viewSizeState();
    if (!st.columns) {
      setViewSize(value, commit);
      return;
    }
    const m = (!commit && _dragMetrics) || postGridMetrics();
    if (!m) return;
    _dragMetrics = commit ? null : m;
    setViewSize(sizeFor(trackCols(value, min, max), m), commit);
  }

  // Ctrl+- / Ctrl+= step the content size one notch, on whichever grid is showing
  // (post densities card/tile/list, or the poster grid). It steps the same track the
  // display popover's Slider reads — there is no slider element to poke anymore.
  // Registration lives in the GlobalShortcuts component (app/App.tsx).
  function handleShortcutSizeKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key !== '-' && e.key !== '=' && e.key !== '+') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    const posters = deps.getBrowseMode() === 'posters';
    const tr = posters ? computePosterSizeTrack() : computeSizeTrack();
    // No size axis here (poster list view), or only one stop is geometrically possible.
    if (!tr || tr.single) return;
    const next = Math.max(tr.min, Math.min(tr.max, tr.value + (e.key === '-' ? -tr.step : tr.step)));
    if (next === tr.value) return;
    if (posters) setPosterSizeFromSlider(next, tr.min, tr.max);
    else setSizeFromSlider(next, tr.min, tr.max, true);
  }

  // Ctrl+wheel steps the same track by one notch (Explorer standard; a trackpad pinch
  // arrives as a synthetic ctrlKey wheel, so it lands here too). Unlike the keyboard
  // step this keeps the post under the cursor put — that is the whole point of a
  // zoom, and without it a pull back to overview sizes throws the user somewhere
  // else in the library. Registration is non-passive (GlobalShortcuts, App.tsx): the
  // preventDefault below is what stops Chromium's own page zoom.
  //
  // Holding that position is NOT done here (#282). This module knows the size axis;
  // it does not know where the new size puts any given post, and everything it used
  // to do to find out — hunt the card in the DOM, wait a frame, push scrollTop back
  // if it had drifted — was guesswork about a layout computed somewhere else. So the
  // zoom only names the post to hold (services/zoom-anchor.ts asks the grid island,
  // which answers from its own layout model) and hands that anchor over with the new
  // size; the island aligns, in the same layer and the same commit as the re-layout.
  let _zoomCommitT: any = null;
  // Resolved ONCE per burst, at its first notch. Re-reading it per notch would let
  // each re-layout's rounding compound; keeping the original means every notch of a
  // long pull targets the same post at the same height on screen.
  let _zoomAnchor: ZoomAnchor | null = null;

  // Applying a size is expensive at overview scale — masonic rebuilds its positioner
  // over the whole window, and the window is hundreds of cells once the tiles are
  // small (measured on a 9k-post library: ~50ms per notch at 200px, ~200ms at 48px).
  // A wheel delivers notches far faster than that, so applying one per event blocks
  // the main thread for as long as the user keeps turning. Notches are accumulated
  // and applied ONCE per frame instead: the size still tracks the wheel, but a fast
  // pull costs a handful of layouts rather than one per click.
  let _zoomNotches = 0;
  let _zoomRaf: any = null;
  // Did this burst actually move the size? At either end of the track every notch is a
  // no-op, but the settle below would still commit — and a commit re-renders the grid
  // and re-requests every thumbnail. That is the visible "refresh" when you keep
  // scrolling past the limit, so the settle is skipped unless something changed.
  let _zoomChanged = false;

  // A FRESH object every time, even when the values repeat: the grid island re-arms
  // on the anchor's identity, and each apply below is a separate re-layout that has
  // to be held through.
  function pushZoomAnchor(a: ZoomAnchor | null) {
    deps.hologramPostGridSource.setZoomAnchor(a && { ...a });
  }

  function applyPendingZoom() {
    _zoomRaf = null;
    const notches = _zoomNotches;
    _zoomNotches = 0;
    if (!notches) return;
    const posters = deps.getBrowseMode() === 'posters';
    const tr = posters ? computePosterSizeTrack() : computeSizeTrack();
    if (!tr || tr.single) return;
    const next = Math.max(tr.min, Math.min(tr.max, tr.value + notches * tr.step));
    if (next === tr.value) return;
    if (posters) {
      setPosterSizeFromSlider(next, tr.min, tr.max);
      return;
    }
    // Anchor first: the size change is what triggers the re-layout, and the island
    // reads the anchor off the very model that re-layout renders from.
    pushZoomAnchor(_zoomAnchor);
    setSizeFromSlider(next, tr.min, tr.max, false);
    _zoomChanged = true;
  }

  function handleZoomWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !e.deltaY) return;
    const el = scroller();
    if (!el || !el.contains(e.target as Node)) return;
    e.preventDefault();
    // Wheel up = zoom in = larger tiles = fewer columns; the track is already
    // inverted that way, so a positive step is simply "bigger".
    _zoomNotches += e.deltaY < 0 ? 1 : -1;
    // At event time whatever is under the cursor is on screen, so the grid island can
    // always answer — no waiting, no re-reading it after the layout has moved.
    if (!_zoomAnchor) _zoomAnchor = resolveZoomAnchor(e.clientX, e.clientY);
    if (_zoomRaf == null) _zoomRaf = requestAnimationFrame(applyPendingZoom);
    // The frames above stay live (CSS var + column width only); the size settles once,
    // after the wheel stops — committing per notch would re-request every thumbnail on
    // every click. Flush any notch still waiting for its frame first, or a burst that
    // ends mid-frame would settle on the size BEFORE its own last notch.
    clearTimeout(_zoomCommitT);
    _zoomCommitT = setTimeout(() => {
      if (_zoomRaf != null) {
        cancelAnimationFrame(_zoomRaf);
        applyPendingZoom();
      }
      const posters = deps.getBrowseMode() === 'posters';
      // Whatever happens below, the burst ends here: the next one resolves its own
      // anchor from wherever the cursor is then.
      const ending = _zoomAnchor;
      _zoomAnchor = null;
      if (posters) return; // the poster path commits on every tick
      if (!_zoomChanged) return; // stuck at an end of the track — nothing to persist or re-render
      _zoomChanged = false;
      const settled = computeSizeTrack();
      if (!settled) return;
      // The commit re-renders the grid (renderPosts), and a fresh item set resets the
      // positioner — a second re-layout the hold has to survive, so the island is
      // handed the same anchor again rather than being left to guess.
      pushZoomAnchor(ending);
      setSizeFromSlider(settled.value, settled.min, settled.max, true);
    }, 150);
  }

  // The display switches live in the display popover, which writes the three
  // services/display.ts store keys and nothing else. This is what a change to any of
  // them costs: persist it, pull the size back into the range the new shape allows,
  // and re-render. React owns the subscribe() registration (StoreSubscriptions,
  // App.tsx), importing this function directly (viewer.ts wires it into the
  // module-scope export). The re-render is deferred past a paint so the pressed
  // control paints its new state before the (heavier) grid regroup runs — the
  // optimistic-press pattern the old density handler used.
  let _shapeSig = shapeSnapshot();
  let _displayRenderT: ReturnType<typeof setTimeout> | undefined;
  let _restoring = false; // restorePrefs pushes the saved shape in; that is not a user change
  function handleDisplayStoreChange() {
    if (_restoring) return;
    const sig = shapeSnapshot();
    if (sig === _shapeSig) return;
    _shapeSig = sig;
    const shape = currentShape();
    deps.hologramIpc.setPref('layoutMode', shape.list ? 'list' : 'grid');
    deps.hologramIpc.setPref('squareThumbs', shape.square);
    deps.hologramIpc.setPref('showInfo', shape.info);
    // 情報を表示 raises the grid's floor, so a grid sitting at overview size has to
    // come up with it — otherwise the metadata block renders into a 48px column.
    if (!shape.list) {
      const clamped = clampGridSize(gridSize, shape.info);
      if (clamped !== gridSize) {
        gridSize = clamped;
        storeSet('gridSize', gridSize);
        deps.hologramIpc.setPref('gridSize', gridSize);
      }
    }
    clearTimeout(_displayRenderT);
    _displayRenderT = setTimeout(() => deps.renderPosts(), 0);
  }

  // --- Poster grid: density + size state (kept SEPARATE from the post-side
  // currentView — its masonry/tile/list layouts are bound to poster-card markup).
  // Tile view leads with avatars. ---
  let posterView = 'card'; // 'card' | 'tile' | 'list'
  let posterTileSize = 132; // tile view: avatar tile edge px
  let posterCardSize = 200; // card view: min column width px
  const PTILE_MIN = 96,
    PTILE_MAX = 220;
  const PCARD_MIN = 150,
    PCARD_MAX = 340;

  // Which size the slider drives, per density (mirrors the post viewSizeState).
  // The size feeds masonic's columnWidth (minimum — columns stretch to fill, the
  // same math as the old CSS auto-fill minmax); list is a full-width stack with
  // no size axis, so it returns null (slider hidden).
  function posterSizeState() {
    if (posterView === 'tile')
      return {
        get: () => posterTileSize,
        set: (v: number) => {
          posterTileSize = v;
        },
        min: PTILE_MIN,
        max: PTILE_MAX,
        pref: 'posterTileSize',
      };
    if (posterView === 'card')
      return {
        get: () => posterCardSize,
        set: (v: number) => {
          posterCardSize = v;
        },
        min: PCARD_MIN,
        max: PCARD_MAX,
        pref: 'posterCardSize',
      };
    return null;
  }

  // The slider track maps to COLUMN COUNTS (like the post tile slider), not raw px:
  // the auto-fill minmax(size,1fr) grid stretches columns, so changing the min only
  // moves the layout at column-count thresholds. Right = larger = fewer columns.
  function posterGridMetrics(): HologramGridMetrics | null {
    const W = gridWidth('poster');
    if (!W) return null;
    // Gutters live in the masonic model now (services/grid.ts), not container CSS —
    // keep this math in lockstep with the rowGutter derived there.
    return { W, g: posterView === 'tile' ? 10 : 14 };
  }

  // Poster size-slider track as data (mirrors computeSizeTrack). Null for the list view
  // (no size axis) → the caller hides the control.
  function computePosterSizeTrack(): HologramSizeTrack | null {
    const st = posterSizeState();
    if (!st) return null;
    const m = posterGridMetrics();
    if (!m) return null;
    const tr = sliderTrack({ min: st.min, max: st.max, size: st.get() }, m);
    return { min: tr.nBig, max: tr.nSmall, value: tr.value, step: 1, single: tr.single };
  }

  // Apply a poster slider value (the popover Slider drives this). The poster grid commits
  // on every tick — no mid-drag/commit split, since masonic recreates its positioner on
  // the columnWidth change either way. `value` is inverted (right = larger), so it goes
  // through trackCols with the min/max of the track the caller last read.
  function setPosterSizeFromSlider(value: number, min: number, max: number) {
    const st = posterSizeState();
    const m = posterGridMetrics();
    if (!st || !m) return;
    const size = Math.max(st.min, Math.min(st.max, sizeFor(trackCols(value, min, max), m)));
    st.set(size);
    // Mirror into hologramStore — the poster grid source derives columnWidth from it,
    // same as the post grid does with cardSize/tileSize.
    storeSet(st.pref, size);
    deps.hologramIpc.setPref(st.pref, size);
  }

  // Poster grid density (card/tile/list) — rendered by the display popover
  // (hologramStore 'posterView'). React owns the active state + glass thumb; this
  // reacts to a change: mirror it into posterView, persist it, and re-render the
  // poster grid. The idempotent guard skips the no-op set from restorePrefs. React owns
  // the subscribe() registration (StoreSubscriptions, App.tsx), importing this
  // function directly. Deferred past a paint like handleDisplayStoreChange above.
  let _posterDensityRenderT: ReturnType<typeof setTimeout> | undefined;
  function handlePosterViewStoreChange() {
    const v = storeGet('posterView');
    if (v === posterView) return;
    posterView = v;
    deps.hologramIpc.setPref('posterViewMode', posterView);
    clearTimeout(_posterDensityRenderT);
    _posterDensityRenderT = setTimeout(() => deps.renderPosters(), 0);
  }

  // Load the saved display shape + sizes (called from viewer.ts's getPrefs().then).
  // The three display keys go straight into the store — that is where the popover and
  // every renderer read them from — with handleDisplayStoreChange muted for the
  // duration: restoring is not a user change, and letting it through would persist
  // the shape back one key at a time and clamp the size against a half-applied one.
  function restorePrefs(prefs: AppPrefs) {
    _restoring = true;
    try {
      storeSet('layout', prefs.layoutMode === 'list' ? 'list' : 'grid');
      storeSet('squareThumbs', prefs.squareThumbs === true);
      storeSet('showInfo', prefs.showInfo !== false);
    } finally {
      _restoring = false;
      _shapeSig = shapeSnapshot();
    }
    if (['card', 'tile', 'list'].includes(prefs.posterViewMode)) {
      posterView = prefs.posterViewMode;
      storeSet('posterView', posterView);
    }
    // Poster-grid view sizes mirror into hologramStore (mirrors the post-side treatment below).
    if (Number.isFinite(prefs.posterTileSize)) {
      posterTileSize = Math.max(PTILE_MIN, Math.min(PTILE_MAX, prefs.posterTileSize as number));
      storeSet('posterTileSize', posterTileSize);
    }
    if (Number.isFinite(prefs.posterCardSize)) {
      posterCardSize = Math.max(PCARD_MIN, Math.min(PCARD_MAX, prefs.posterCardSize as number));
      storeSet('posterCardSize', posterCardSize);
    }
    // Post-grid sizes also mirror into hologramStore (see setViewSize). The grid's
    // saved width is clamped against the CURRENT 情報を表示 switch, which the block
    // above has already restored.
    if (Number.isFinite(prefs.gridSize)) {
      gridSize = clampGridSize(prefs.gridSize as number, currentShape().info);
      storeSet('gridSize', gridSize);
    }
    if (Number.isFinite(prefs.listThumb)) {
      listThumb = Math.max(LIST_MIN, Math.min(LIST_MAX, prefs.listThumb as number));
      storeSet('listThumb', listThumb);
    }
  }

  return {
    gridThumbW,
    listThumbW,
    computeSizeTrack,
    setSizeFromSlider,
    handleShortcutSizeKey,
    handleZoomWheel,
    handleDisplayStoreChange,
    computePosterSizeTrack,
    setPosterSizeFromSlider,
    handlePosterViewStoreChange,
    restorePrefs,
    getPosterView: () => posterView,
  };
}
