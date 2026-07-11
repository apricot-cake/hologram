// Display density (card/tile/list) + tile/card/list size slider — extracted
// from viewer.ts as the viewer.ts decomposition's V10 slice (see memory
// corpus-react-purity-execution-map, Wave24/V10 "表示密度・タイルサイズスライダー").
// The post grid and poster grid each carried their own density + size-slider
// state (viewSizeState/posterSizeState, refreshTileSlider/refreshPosterSlider,
// tileGridMetrics/posterGridMetrics) driving the SAME geometry.ts math
// (colsFor/sizeFor/sliderTrack/trackCols) — this module is the single owner of
// both, replacing two near-duplicate copies in viewer.ts. Mirrors every other
// builder in this decomposition: DOM event registration (addEventListener on
// #tileSlider/#posterTileSlider/window resize) stays in viewer.ts, which just
// wires the returned handler functions in. #densityToggle/#posterDensityToggle
// themselves (the card/tile/list buttons) are the DensityToggle island —
// unaffected, this module only reacts to the corpusStore 'view'/'posterView'
// keys it writes.
import { colsFor, sizeFor, sliderTrack, trackCols, thumbW } from './geometry.ts';
import { get as storeGet, set as storeSet } from './store.ts';

export interface GridDensityDeps {
  corpusIpc: { setPref(key: string, value: unknown): void };
  corpusPostGridSource: { setLiveColumnWidth(px: number | null): void };
  renderPosts(): void;
  renderPosters(): void;
  getBrowseMode(): string;
}

export function makeGridDensity(deps: GridDensityDeps) {
  const inputById = (id: string) => document.getElementById(id) as HTMLInputElement;
  const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // --- Post grid: density + size state ---
  let currentView = 'card'; // 'card' | 'tile' | 'list' (display density)
  let tileOverlay = true; // tile view: show the author/❤ info overlay (pref)
  let tileSize = 180; // tile view: edge px (pref imageTileSize)
  let cardSize = 280; // card view: min column width px (pref cardSize)
  let listThumb = 88; // list view: thumbnail width px (pref listThumb)
  const TILE_MIN = 120,
    TILE_MAX = 400;
  const CARD_MIN = 240,
    CARD_MAX = 560;
  const LIST_MIN = 56,
    LIST_MAX = 200;

  // Thumbnail width tracks the tile edge so larger tiles stay sharp (60px buckets).
  const tileThumbW = () => thumbW(tileSize * 1.4, 180, 960);
  // card/list serve a thumbnail too (they used to load the full original —
  // multi-MB pixiv/X art decoded on every scroll and stuttered). DPR-aware, 60px
  // buckets, capped at the thumbnailer's 720px max (main.js getThumbnail).
  const _dpr = Math.min(2, window.devicePixelRatio || 1);
  const cardThumbW = () => thumbW(cardSize * 1.3 * _dpr, 240, 720);
  const listThumbW = () => thumbW(listThumb * 1.5 * _dpr, 120, 720);

  function applyTileLayout(syncSlider = true) {
    const grid = document.getElementById('postGrid');
    if (grid) {
      grid.style.setProperty('--tile-size', tileSize + 'px');
      grid.style.setProperty('--card-size', cardSize + 'px');
      grid.style.setProperty('--list-thumb', listThumb + 'px');
    }
    const row = document.getElementById('tileSizeRow');
    if (row) row.style.display = ''; // every density has a size slider now
    // refreshTileSlider reads getBoundingClientRect; calling it right after the
    // CSS-var writes above forces a sync reflow. Skip it during a live drag
    // (syncSlider=false) — the user is already holding the thumb.
    if (syncSlider) refreshTileSlider();
  }

  // View-size slider — every density has one. The auto-fill grids (tile/card)
  // quantize the real width to "how many columns fit", so their track maps to
  // COLUMN COUNTS (one detent = exactly one column, no dead notches). The
  // list is a full-width stack, so its track maps straight to the thumbnail
  // px. Right = larger. While dragging only the CSS vars update; persisting +
  // re-requesting thumbnails happens on release.
  function viewSizeState() {
    if (currentView === 'card')
      return {
        get: () => cardSize,
        set: (v: number) => {
          cardSize = v;
        },
        min: CARD_MIN,
        max: CARD_MAX,
        pref: 'cardSize',
        storeKey: 'cardSize',
        columns: true,
      };
    if (currentView === 'list')
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
      get: () => tileSize,
      set: (v: number) => {
        tileSize = v;
      },
      min: TILE_MIN,
      max: TILE_MAX,
      pref: 'imageTileSize',
      storeKey: 'tileSize',
      columns: true,
    };
  }

  function setViewSize(px: number, commit = true) {
    const st = viewSizeState();
    st.set(Math.max(st.min, Math.min(st.max, px)));
    applyTileLayout(commit); // mid-drag (!commit): skip the slider re-measure to avoid a forced reflow per input
    if (!commit) {
      // Live re-flow while dragging (masonic recreates its positioner on columnWidth
      // change) via a deliberate side channel, NOT corpusStore — writing every drag
      // input to the store would recompute+notify on every pointermove for no benefit.
      if (st.columns) deps.corpusPostGridSource.setLiveColumnWidth(st.get());
      return;
    }
    deps.corpusIpc.setPref(st.pref, st.get());
    // The settled size mirrors into corpusStore — the post-grid source derives
    // columnWidth/itemHeightEstimate from it. Clear the live-drag override so a
    // later VIEW change (which reads a different storeKey) can't see a stale value.
    storeSet(st.storeKey, st.get());
    deps.corpusPostGridSource.setLiveColumnWidth(null);
    deps.renderPosts(); // re-request thumbnails at the new size
  }

  function tileGridMetrics(): CorpusGridMetrics | null {
    const grid = document.getElementById('postGrid');
    if (!grid) return null;
    // floor of the FRACTIONAL width: clientWidth rounds up half-pixels, which
    // makes an exact-fill size 1px too wide and silently drops a column.
    const W = Math.floor(grid.getBoundingClientRect().width);
    if (!W) return null;
    const gv = Number.parseFloat(getComputedStyle(grid).columnGap);
    return { W, g: Number.isFinite(gv) ? gv : 8 };
  }

  function refreshTileSlider() {
    const sl = inputById('tileSlider');
    if (!sl) return;
    const st = viewSizeState();
    if (!st.columns) {
      // list: direct px track
      sl.step = '8';
      sl.min = String(st.min);
      sl.max = String(st.max);
      sl.disabled = false;
      sl.value = String(st.get());
      return;
    }
    const m = tileGridMetrics();
    if (!m) return;
    sl.step = '1';
    // Card view: always allow 1 column — CSS auto-fill handles width naturally.
    const tr = sliderTrack({ min: st.min, max: st.max, size: st.get() }, m, currentView === 'card' ? { minCols: 1 } : undefined);
    // Hide the row when only one column count is geometrically possible — the
    // slider would have a single stop and convey nothing.
    const sizeRow = document.getElementById('tileSizeRow');
    if (sizeRow) sizeRow.style.display = tr.single ? 'none' : '';
    sl.min = String(tr.nBig);
    sl.max = String(tr.nSmall);
    sl.disabled = false;
    sl.value = String(tr.value); // inverted: right = larger
  }

  let _dragMetrics: CorpusGridMetrics | null = null; // grid geometry cached for the duration of one size drag
  function sliderCols() {
    const sl = inputById('tileSlider');
    return trackCols(Number.parseInt(sl.value, 10), Number.parseInt(sl.min, 10), Number.parseInt(sl.max, 10));
  }
  function onSliderMove(commit: boolean) {
    const sl = inputById('tileSlider');
    if (!viewSizeState().columns) {
      setViewSize(Number.parseInt(sl.value, 10), commit);
      return;
    }
    // The grid container width and column gap don't change while only --tile-size
    // does, so measure once at the drag's first input and reuse it. Re-reading
    // getBoundingClientRect each input would force a reflow against the previous
    // input's CSS-var write. Cleared on commit (the slider's change event).
    const m = (!commit && _dragMetrics) || tileGridMetrics();
    if (!m) return;
    _dragMetrics = commit ? null : m;
    setViewSize(sizeFor(sliderCols(), m), commit);
  }

  // Ctrl+- / Ctrl+= step the content-size slider one notch (works in all three view
  // modes). Registration lives in the useGlobalShortcuts hook (app/islands/app/App.tsx).
  function handleShortcutSizeKey(e: KeyboardEvent) {
    const sl = inputById('tileSlider');
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key !== '-' && e.key !== '=' && e.key !== '+') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    if (sl.disabled) return;
    const step = Number.parseInt(sl.step, 10) || 1;
    sl.value = String(Math.max(Number.parseInt(sl.min, 10), Math.min(Number.parseInt(sl.max, 10), Number.parseInt(sl.value, 10) + (e.key === '-' ? -step : step))));
    onSliderMove(true);
  }

  // Tile overlay lives in the React settings island; this is the apply-and-persist
  // bridge it calls (via window.corpusViewer.setTileOverlay, wired in viewer.ts —
  // that bridge itself is V16/Wave30 territory, still viewer.ts's job) so the post
  // grid updates immediately.
  function applyTileOverlay(v: boolean) {
    tileOverlay = v;
    deps.corpusIpc.setPref('tileOverlay', tileOverlay);
    // Class-only: the overlay markup is always in the DOM (.no-overlay just hides it
    // via CSS), so flip the class directly instead of re-grouping + rebuilding the
    // grid (a full renderPosts reloaded every tile image = flicker).
    const grid = document.getElementById('postGrid');
    if (grid) grid.classList.toggle('no-overlay', !tileOverlay);
  }

  // #densityToggle is rendered by the toolbar island (corpusStore 'view'). React
  // owns the active state + glass thumb; this reacts to a view change: mirror it
  // into currentView, persist it, and re-render the grid (deferred past a paint
  // with a view transition, like the old optimistic handler). The idempotent guard
  // skips the no-op set from restorePrefs, so the loop stays one-way. Subscribe
  // registration lives in React (StoreSubscriptions, App.tsx) via window.corpusViewer
  // (viewer.ts wires this function in).
  let _densityRenderT: any = null;
  function handleViewStoreChange() {
    const v = storeGet('view');
    if (v === currentView) return;
    currentView = v;
    deps.corpusIpc.setPref('viewMode', currentView);
    clearTimeout(_densityRenderT);
    _densityRenderT = setTimeout(() => {
      if (document.startViewTransition && !prefersReducedMotion()) document.startViewTransition(() => deps.renderPosts());
      else deps.renderPosts();
    }, 0);
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
  function posterGridMetrics(): CorpusGridMetrics | null {
    const grid = document.getElementById('posterGrid');
    if (!grid) return null;
    const W = Math.floor(grid.getBoundingClientRect().width);
    if (!W) return null;
    // Gutters live in the masonic model now (pushPosterModel), not container CSS —
    // keep this math in lockstep with the rowGutter pushed there.
    return { W, g: posterView === 'tile' ? 10 : 14 };
  }

  function refreshPosterSlider() {
    const sl = inputById('posterTileSlider');
    const row = document.getElementById('posterTileSizeRow');
    if (!sl) return;
    const st = posterSizeState();
    if (!st) {
      if (row) row.style.display = 'none';
      return;
    }
    const m = posterGridMetrics();
    if (!m) return;
    const tr = sliderTrack({ min: st.min, max: st.max, size: st.get() }, m);
    if (row) row.style.display = tr.single ? 'none' : 'flex'; // single stop conveys nothing → hide
    sl.step = '1';
    sl.min = String(tr.nBig);
    sl.max = String(tr.nSmall);
    sl.value = String(tr.value); // inverted: right = larger
  }

  function onPosterSliderInput() {
    const sl = inputById('posterTileSlider');
    const st = posterSizeState();
    const m = posterGridMetrics();
    if (!st || !m) return;
    const n = trackCols(Number.parseInt(sl.value, 10), Number.parseInt(sl.min, 10), Number.parseInt(sl.max, 10)); // un-invert → target column count
    const size = Math.max(st.min, Math.min(st.max, sizeFor(n, m)));
    st.set(size);
    // Mirror into corpusStore — the poster grid source derives columnWidth from it,
    // same as the post grid does with cardSize/tileSize. Unlike the post slider
    // there's no separate mid-drag/commit split here (this handler already commits
    // corpusIpc.setPref on every 'input' tick), so writing the store on every tick
    // too costs nothing extra — masonic still recreates its positioner on the
    // resulting columnWidth change either way.
    storeSet(st.pref, size);
    deps.corpusIpc.setPref(st.pref, size);
  }

  // Poster grid density (card/tile/list) — rendered by the toolbar island
  // (corpusStore 'posterView'). React owns the active state + glass thumb; this
  // reacts to a change: mirror it into posterView, persist it, and re-render the
  // poster grid (deferred past a paint, like the old optimistic handler). The
  // idempotent guard skips the no-op set from restorePrefs. Subscribe registration
  // lives in React (StoreSubscriptions, App.tsx) via window.corpusViewer.
  let _posterDensityRenderT: any = null;
  function handlePosterViewStoreChange() {
    const v = storeGet('posterView');
    if (v === posterView) return;
    posterView = v;
    deps.corpusIpc.setPref('posterViewMode', posterView);
    clearTimeout(_posterDensityRenderT);
    _posterDensityRenderT = setTimeout(() => deps.renderPosters(), 0);
  }

  // The column counts depend on the grid width — re-derive both tracks on resize
  // (poster only while it's the active browse mode, mirroring the original guard).
  let tileResizeT = 0;
  function handleWindowResize() {
    clearTimeout(tileResizeT);
    tileResizeT = setTimeout(refreshTileSlider, 150);
    if (deps.getBrowseMode() === 'posters') refreshPosterSlider();
  }

  // Load saved view modes + sizes (called from viewer.ts's corpusIpc.getPrefs().then).
  function restorePrefs(prefs: { [k: string]: unknown }) {
    if (['card', 'tile', 'list'].includes(prefs.viewMode as string)) {
      currentView = prefs.viewMode as string;
      // Push the restored view into the store so the toolbar island renders the right
      // button active. currentView is already set, so handleViewStoreChange no-ops
      // (idempotent guard) — no double render, no echo.
      storeSet('view', currentView);
    }
    if (['card', 'tile', 'list'].includes(prefs.posterViewMode as string)) {
      posterView = prefs.posterViewMode as string;
      storeSet('posterView', posterView);
    }
    // Poster-grid view sizes mirror into corpusStore (mirrors the post-side treatment below).
    if (Number.isFinite(prefs.posterTileSize)) {
      posterTileSize = Math.max(PTILE_MIN, Math.min(PTILE_MAX, prefs.posterTileSize as number));
      storeSet('posterTileSize', posterTileSize);
    }
    if (Number.isFinite(prefs.posterCardSize)) {
      posterCardSize = Math.max(PCARD_MIN, Math.min(PCARD_MAX, prefs.posterCardSize as number));
      storeSet('posterCardSize', posterCardSize);
    }
    // Post-grid view sizes also mirror into corpusStore (see setViewSize).
    if (Number.isFinite(prefs.imageTileSize)) {
      tileSize = Math.max(TILE_MIN, Math.min(TILE_MAX, prefs.imageTileSize as number));
      storeSet('tileSize', tileSize);
    }
    if (Number.isFinite(prefs.cardSize)) {
      cardSize = Math.max(CARD_MIN, Math.min(CARD_MAX, prefs.cardSize as number));
      storeSet('cardSize', cardSize);
    }
    if (Number.isFinite(prefs.listThumb)) {
      listThumb = Math.max(LIST_MIN, Math.min(LIST_MAX, prefs.listThumb as number));
      storeSet('listThumb', listThumb);
    }
    if (prefs.tileOverlay === false) {
      tileOverlay = false;
    }
  }

  return {
    tileThumbW,
    cardThumbW,
    listThumbW,
    applyTileLayout,
    applyTileOverlay,
    refreshTileSlider,
    onSliderMove,
    handleShortcutSizeKey,
    handleViewStoreChange,
    refreshPosterSlider,
    onPosterSliderInput,
    handlePosterViewStoreChange,
    handleWindowResize,
    restorePrefs,
    getCurrentView: () => currentView,
    getTileOverlay: () => tileOverlay,
    getPosterView: () => posterView,
  };
}
