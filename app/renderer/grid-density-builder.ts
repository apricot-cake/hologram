// Display density (card/tile/list) + tile/card/list size slider — extracted
// from the old viewer.ts monolith.
// The post grid and poster grid each carried their own density + size state
// (viewSizeState/posterSizeState, tileGridMetrics/posterGridMetrics) driving the
// SAME geometry.ts math (colsFor/sizeFor/sliderTrack/trackCols) — this module is
// the single owner of both, replacing two near-duplicate copies in viewer.ts.
// The size control itself is the React display popover (#154 P2②): it reads
// computeSizeTrack/computePosterSizeTrack as data and calls the setters back, so
// nothing here touches a slider element. Density (card/tile/list) likewise comes
// in through the hologramStore 'view'/'posterView' keys.
import { colsFor, sizeFor, sliderTrack, trackCols, thumbW } from './geometry.ts';
import { get as storeGet, set as storeSet } from './store.ts';

export interface GridDensityDeps {
  hologramIpc: { setPref(key: string, value: unknown): void };
  hologramPostGridSource: { setLiveColumnWidth(px: number | null): void };
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
  const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // --- Post grid: density + size state ---
  let currentView = 'card'; // 'card' | 'tile' | 'list' (display density)
  let tileOverlay = true; // tile view: show the author/❤ info overlay (pref)
  let tileSize = 180; // tile view: edge px (pref imageTileSize)
  let cardSize = 280; // card view: min column width px (pref cardSize)
  let listThumb = 88; // list view: thumbnail width px (pref listThumb)
  // The tile floor is the OVERVIEW zoom (#141): pulled all the way back, a few
  // hundred thumbnails fit on one screen for visual scanning. It is the end of the
  // ordinary size axis, not a mode of its own (Explorer / Lightroom / Eagle all put
  // "smaller" on the same control).
  const TILE_MIN = 48,
    TILE_MAX = 400;
  // Below this edge a tile has no room for chrome, so the grid drops to pure
  // thumbnails (CSS class, see applyTileLayout).
  const OVERVIEW_MAX = 96;
  const CARD_MIN = 240,
    CARD_MAX = 560;
  const LIST_MIN = 56,
    LIST_MAX = 200;

  // Thumbnail width tracks the tile edge so larger tiles stay sharp (60px buckets).
  // The floor follows the tile floor down (48*1.4 ≈ 67 → 120 after bucketing); the
  // thumbnailer serves from 64px, so nothing changes on the main side.
  const tileThumbW = () => thumbW(tileSize * 1.4, 120, 960);
  // card/list serve a thumbnail too (they used to load the full original —
  // multi-MB pixiv/X art decoded on every scroll and stuttered). DPR-aware, 60px
  // buckets, capped at the thumbnailer's 720px max (main.js getThumbnail).
  const _dpr = Math.min(2, window.devicePixelRatio || 1);
  const cardThumbW = () => thumbW(cardSize * 1.3 * _dpr, 240, 720);
  const listThumbW = () => thumbW(listThumb * 1.5 * _dpr, 120, 720);

  function applyTileLayout() {
    const grid = document.getElementById('postGrid');
    if (grid) {
      grid.style.setProperty('--tile-size', tileSize + 'px');
      grid.style.setProperty('--card-size', cardSize + 'px');
      grid.style.setProperty('--list-thumb', listThumb + 'px');
      // Overview zoom: hide the per-tile chrome below OVERVIEW_MAX. A class of its
      // own, ANDed with .no-overlay in CSS — the 「タイルに情報を表示」 pref keeps
      // whatever the user set, and comes back when they zoom out of the overview.
      grid.classList.toggle('overview', currentView === 'tile' && tileSize < OVERVIEW_MAX);
    }
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
    applyTileLayout();
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

  function tileGridMetrics(): HologramGridMetrics | null {
    const grid = document.getElementById('postGrid');
    if (!grid) return null;
    // floor of the FRACTIONAL width: clientWidth rounds up half-pixels, which
    // makes an exact-fill size 1px too wide and silently drops a column.
    const W = Math.floor(grid.getBoundingClientRect().width);
    if (!W) return null;
    const gv = Number.parseFloat(getComputedStyle(grid).columnGap);
    return { W, g: Number.isFinite(gv) ? gv : 8 };
  }

  let _dragMetrics: HologramGridMetrics | null = null; // grid geometry cached for the duration of one size drag

  // Size-slider track as DATA (the React display popover reads this; the old #tileSlider
  // DOM path is gone). A column-count track for the auto-fill views (one detent = one
  // column, no dead notches) and raw px for the list.
  function computeSizeTrack(): HologramSizeTrack | null {
    const st = viewSizeState();
    if (!st.columns) return { min: st.min, max: st.max, value: st.get(), step: 8, single: false };
    const m = tileGridMetrics();
    if (!m) return null;
    const tr = sliderTrack({ min: st.min, max: st.max, size: st.get() }, m, currentView === 'card' ? { minCols: 1 } : undefined);
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
    const m = (!commit && _dragMetrics) || tileGridMetrics();
    if (!m) return;
    _dragMetrics = commit ? null : m;
    setViewSize(sizeFor(trackCols(value, min, max), m), commit);
  }

  // Ctrl+- / Ctrl+= step the content size one notch, on whichever grid is showing
  // (post densities card/tile/list, or the poster grid). It steps the same track the
  // display popover's Slider reads — there is no slider element to poke anymore.
  // Registration lives in the GlobalShortcuts component (app/islands/app/App.tsx).
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
  interface ZoomAnchor {
    key: string | null;
    top: number;
    scrollTop: number;
    scrollHeight: number;
  }
  let _zoomCommitT: any = null;

  // What the view should still be looking at after the size changes. Two things,
  // because one is not enough at library scale:
  //   - where in the LIBRARY we are (scroll position as a fraction of the content).
  //     A pixel scrollTop means nothing across a size change: shrinking the tiles
  //     shrinks the content, so the same pixel lands hundreds of posts further down
  //     (measured on 9k posts: 97px→76px moved the view ~900 items away).
  //   - which CARD the cursor is on, to land the zoom exactly. Over a gutter (or past
  //     the last row) the row in the middle of the viewport stands in; if there is no
  //     card at all, the fraction alone still keeps the place.
  function zoomAnchorAt(scroller: HTMLElement, x: number, y: number): ZoomAnchor {
    const pick = (px: number, py: number) => (document.elementFromPoint(px, py) as HTMLElement | null)?.closest('.post-card') as HTMLElement | null;
    const r = scroller.getBoundingClientRect();
    const card = pick(x, y) || pick(r.left + r.width / 2, r.top + r.height / 2);
    return {
      key: card?.dataset.key || null,
      top: card ? card.getBoundingClientRect().top : 0,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
    };
  }

  // Restore the anchor, coarse first then exact. Not before the next frame: the size
  // change re-flows through the store → grid island → masonic positioner, so the new
  // geometry only exists after that paints.
  //
  // The fraction MUST come first. The grid is virtualized, so a card that is now far
  // outside the window is not in the DOM at all — before the coarse step the exact one
  // could not even find its card (it silently did nothing, and the view kept the old
  // pixel offset = the ~900-item jump above). Landing in the right neighbourhood first
  // puts the card back in the window, and only then can the cursor be honored.
  //
  // Two passes, because one is not enough at settle time: the commit re-renders the grid
  // (renderPosts) and that lands a frame later still, shifting the card again — measured
  // at 132px on a 9k-post library, i.e. the live correction held and the settle undid it.
  // The target is always the ORIGINAL top, so a second pass is idempotent when the first
  // already landed it.
  function restoreZoomAnchor(scroller: HTMLElement, a: ZoomAnchor | null, passes = 2) {
    if (!a) return;
    requestAnimationFrame(() => {
      const h = scroller.scrollHeight;
      if (a.scrollHeight && h && h !== a.scrollHeight) scroller.scrollTop = (a.scrollTop * h) / a.scrollHeight;
      if (a.key) {
        const el = document.querySelector(`.post-card[data-key="${CSS.escape(a.key)}"]`) as HTMLElement | null;
        if (el) {
          const drift = el.getBoundingClientRect().top - a.top;
          if (drift) scroller.scrollTop += drift;
        }
      }
      if (passes > 1) restoreZoomAnchor(scroller, { ...a, scrollTop: scroller.scrollTop, scrollHeight: h }, passes - 1);
    });
  }

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
  let _zoomCursorX = 0;
  let _zoomCursorY = 0;

  function applyPendingZoom() {
    _zoomRaf = null;
    const notches = _zoomNotches;
    _zoomNotches = 0;
    if (!notches) return;
    const scroller = document.getElementById('mode-post');
    if (!scroller) return;
    const posters = deps.getBrowseMode() === 'posters';
    const tr = posters ? computePosterSizeTrack() : computeSizeTrack();
    if (!tr || tr.single) return;
    const next = Math.max(tr.min, Math.min(tr.max, tr.value + notches * tr.step));
    if (next === tr.value) return;
    if (posters) {
      setPosterSizeFromSlider(next, tr.min, tr.max);
      return;
    }
    const anchor = zoomAnchorAt(scroller, _zoomCursorX, _zoomCursorY);
    setSizeFromSlider(next, tr.min, tr.max, false);
    restoreZoomAnchor(scroller, anchor);
    _zoomChanged = true;
  }

  function handleZoomWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !e.deltaY) return;
    const scroller = document.getElementById('mode-post');
    if (!scroller || !scroller.contains(e.target as Node)) return;
    e.preventDefault();
    // Wheel up = zoom in = larger tiles = fewer columns; the track is already
    // inverted that way, so a positive step is simply "bigger".
    _zoomNotches += e.deltaY < 0 ? 1 : -1;
    _zoomCursorX = e.clientX;
    _zoomCursorY = e.clientY;
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
      if (deps.getBrowseMode() === 'posters') return; // the poster path commits on every tick
      if (!_zoomChanged) return; // stuck at an end of the track — nothing to persist or re-render
      _zoomChanged = false;
      const settled = computeSizeTrack();
      if (!settled) return;
      // The commit re-renders the grid, which moves the anchor card again — so it needs
      // the same treatment the live frames got, or the zoom lands somewhere else 150ms
      // after the user stopped turning.
      const scroller = document.getElementById('mode-post');
      const anchor = scroller && zoomAnchorAt(scroller, _zoomCursorX, _zoomCursorY);
      setSizeFromSlider(settled.value, settled.min, settled.max, true);
      if (scroller) restoreZoomAnchor(scroller, anchor || null);
    }, 150);
  }

  // Tile overlay lives in the React settings island; this is the apply-and-persist
  // function it calls (islands/settings/ipc.ts's setTileOverlay imports the
  // `applyTileOverlay` live binding below directly — no shared-bridge detour) so
  // the post grid updates immediately.
  function applyTileOverlay(v: boolean) {
    tileOverlay = v;
    deps.hologramIpc.setPref('tileOverlay', tileOverlay);
    // Class-only: the overlay markup is always in the DOM (.no-overlay just hides it
    // via CSS), so flip the class directly instead of re-grouping + rebuilding the
    // grid (a full renderPosts reloaded every tile image = flicker).
    const grid = document.getElementById('postGrid');
    if (grid) grid.classList.toggle('no-overlay', !tileOverlay);
  }

  // The density buttons live in the display popover (hologramStore 'view'). React
  // owns the active state + glass thumb; this reacts to a view change: mirror it
  // into currentView, persist it, and re-render the grid (deferred past a paint
  // with a view transition, like the old optimistic handler). The idempotent guard
  // skips the no-op set from restorePrefs, so the loop stays one-way. React owns the
  // subscribe() registration (StoreSubscriptions, App.tsx), importing this function
  // directly (viewer.ts wires it into the module-scope export).
  let _densityRenderT: any = null;
  function handleViewStoreChange() {
    const v = storeGet('view');
    if (v === currentView) return;
    currentView = v;
    deps.hologramIpc.setPref('viewMode', currentView);
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
  function posterGridMetrics(): HologramGridMetrics | null {
    const grid = document.getElementById('posterGrid');
    if (!grid) return null;
    const W = Math.floor(grid.getBoundingClientRect().width);
    if (!W) return null;
    // Gutters live in the masonic model now (pushPosterModel), not container CSS —
    // keep this math in lockstep with the rowGutter pushed there.
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
  // poster grid (deferred past a paint, like the old optimistic handler). The
  // idempotent guard skips the no-op set from restorePrefs. React owns the
  // subscribe() registration (StoreSubscriptions, App.tsx), importing this
  // function directly.
  let _posterDensityRenderT: any = null;
  function handlePosterViewStoreChange() {
    const v = storeGet('posterView');
    if (v === posterView) return;
    posterView = v;
    deps.hologramIpc.setPref('posterViewMode', posterView);
    clearTimeout(_posterDensityRenderT);
    _posterDensityRenderT = setTimeout(() => deps.renderPosters(), 0);
  }

  // Load saved view modes + sizes (called from viewer.ts's hologramIpc.getPrefs().then).
  function restorePrefs(prefs: { [k: string]: unknown }) {
    if (['card', 'tile', 'list'].includes(prefs.viewMode as string)) {
      currentView = prefs.viewMode as string;
      // Push the restored view into the store so the display popover renders the right
      // button active. currentView is already set, so handleViewStoreChange no-ops
      // (idempotent guard) — no double render, no echo.
      storeSet('view', currentView);
    }
    if (['card', 'tile', 'list'].includes(prefs.posterViewMode as string)) {
      posterView = prefs.posterViewMode as string;
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
    // Post-grid view sizes also mirror into hologramStore (see setViewSize).
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
    computeSizeTrack,
    setSizeFromSlider,
    handleShortcutSizeKey,
    handleZoomWheel,
    handleViewStoreChange,
    computePosterSizeTrack,
    setPosterSizeFromSlider,
    handlePosterViewStoreChange,
    restorePrefs,
    getCurrentView: () => currentView,
    getTileOverlay: () => tileOverlay,
    getPosterView: () => posterView,
  };
}

// applyTileOverlay is bound once at boot (viewer.ts, right after constructing
// gridDensity) so the settings island (islands/settings/ipc.ts) can flip the
// tile-overlay pref directly — no shared-bridge detour.
export let applyTileOverlay: ((v: boolean) => void) | null = null;
export function bindApplyTileOverlay(fn: (v: boolean) => void): void {
  applyTileOverlay = fn;
}
