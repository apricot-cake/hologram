// The app shell — the single React-owned frame for the whole renderer (redesign
// §3, P1-2..P1-5). Replaces index.html's static shell markup: a flex column of
// [tab bar band] + [SidebarProvider: left nav | content inset | right inspector].
//
// Layout notes:
// - Shell shape (#154, 2026-07-18; right half revised by #518, 2026-07-29): the sidebar
//   spans the full window height and the tab bar starts at its edge rather than above it,
//   which kills the seam where the sidebar's vertical edge met the tab strip and split
//   the connected tab into two tones. From there the band runs to the window's RIGHT edge
//   — over the inspector's column, Chrome-style — so the window buttons always sit on the
//   tab strip. Before #518 the inspector was full-height too and had to hand its top row
//   to the window chrome as an empty strip, which left the buttons floating on blank
//   panel. The band is plain Tailwind now (#621) — the #tabBar/#tabBarInner ids, their
//   legacy CSS and the delegated handlers that needed them are gone; the strip itself is
//   tabs/Tabs.tsx, which wires its own gestures to the exported tab actions.
// - The sidebar's own header row is the window's titlebar drag strip and holds the
//   collapse trigger (moved out of the toolbar). shadcn's fixed sidebar-container now
//   spans inset-y-0 as-is (the --tabbar-h offset hack is gone).
// - The content column is the scroll root (the page itself never scrolls). It and the
//   three grid slots inside it are handed to the modules that measure them through
//   services/content-area.ts — none of the four is looked up by id any more (#618), and
//   which destination is on screen is a `hidden` this file writes, not a body class.
// - The right inspector wears the legacy .inspector CSS, which already implements the
//   #143 model (wide = fixed 320px column, narrow = slide-over). Its id is gone (P2⑦):
//   whether it is on screen is state (inspector-panel.ts), and the element itself reaches
//   the one handler that needs it by ref, so nothing looks it up by id any more.
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SIDEBAR_WIDTH, SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { InspectorRail } from './InspectorRail.tsx';
import { type PanelResize, resolveCssLength, usePanelResize } from './use-panel-resize.ts';
import { LIMITS, type PanelKey, cachedWidth, clampWidth, loadWidth, persistWidth } from '../services/panel-width-pref.ts';
import { isVisible as inspectorIsVisible, load as inspectorLoad, registerPanelEl, subscribeVisible as subscribeInspectorVisible } from '../services/inspector-panel.ts';
import { registerScroller } from '../services/content-area.ts';
import { hologramImageTabSource, isActive as imageViewIsActive } from '../services/image-tab.ts';
import { isWide as isWideLayout, subscribe as layoutSubscribe } from '../services/layout-mode.ts';
import { isHidden as panelsAreHidden, load as panelsLoad, reveal as panelsReveal, subscribe as panelsSubscribe } from '../services/panels.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../services/store.ts';
import { cachedOpen, loadOpen, persistOpen } from '../services/sidebar-pref.ts';
import { signalShellReady } from '../services/shell-ready.ts';
import { AppToolbar } from './AppToolbar.tsx';
import { InspectorToggle } from './InspectorToggle.tsx';
import { LeftSidebar } from './LeftSidebar.tsx';
import { EmptyState } from '../empty/EmptyState.tsx';
import { FloatingBar } from '../selection/FloatingBar.tsx';
import { ImageTabHost } from '../image-tab/index.tsx';
import { Inspector } from '../inspector/Inspector.tsx';
import { PostGrid, PostGridSlot } from '../grid/index.tsx';
import { PosterGrid, PosterGridSlot } from '../posters/index.tsx';
import { TabsHost } from '../tabs/index.tsx';
import { TrashGrid } from '../trash/TrashGrid.tsx';
import { TrashView } from '../trash/TrashView.tsx';
import { WindowControls } from './WindowControls.tsx';

// #149 + #243 + #259: the stored state is purely the user's saved choice (sidebar-pref.ts).
// #243 removed the old width clamp that forced the rail below 1024px, on the grounds that
// desktop apps don't reshape themselves by width. #259 puts a narrower version of it back,
// having found what #243 missed: the products it measured against (Lightroom / VS Code /
// Obsidian) don't auto-reshape BECAUSE they all pair that with a one-key collapse, and
// Hologram shipped the first half without the second. At half-screen widths — Hologram beside
// a browser is a primary way to use it — the two panels take 576px and leave the grid 382.
//
// What came back is narrower than what #243 removed, in two ways. The saved preference is
// never overwritten by width: it is masked while narrow and comes back untouched. And the
// user can still expand over the mask (narrowOpen below) — width picks the starting form,
// it does not lock one in.
function useSidebarOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => cachedOpen() ?? true);
  // A user toggle mid-boot must not lose to the reconcile landing a tick later.
  const toggled = useRef(false);

  // config.json outranks the localStorage cache the initial state was guessed from.
  useEffect(() => {
    loadOpen().then((saved) => {
      if (saved !== null && !toggled.current) setOpen(saved);
    });
  }, []);

  // Only an explicit toggle (SidebarTrigger / Ctrl+B / rail) is a preference.
  const choose = useCallback((v: boolean) => {
    toggled.current = true;
    setOpen(v);
    persistOpen(v);
  }, []);

  return [open, choose];
}

// Which of the three destinations the content column shows (posts / posters / trash).
const subBrowseMode = (cb: () => void) => storeSubscribe('browseMode', cb);
const getBrowseMode = () => (storeGet('browseMode') as string | undefined) ?? 'posts';

// A panel's width, on the same two tiers as the open/closed state above (cache first,
// config.json reconciled a tick later). The default is a thunk rather than a number so
// it can be measured from the component's own token — see resolveCssLength.
function usePanelWidth(key: PanelKey, defaultWidth: () => number): { width: number; fallback: number; commit: (px: number) => void } {
  // Measured once, on first render — before any drag can have written over the token.
  const [fallback] = useState(defaultWidth);
  const [width, setWidth] = useState(() => cachedWidth(key) ?? fallback);
  const resized = useRef(false);

  useEffect(() => {
    loadWidth(key).then((saved) => {
      if (saved !== null && !resized.current) setWidth(saved);
    });
  }, [key]);

  const commit = useCallback(
    (px: number) => {
      resized.current = true;
      setWidth(px);
      persistWidth(key, px);
    },
    [key],
  );

  return { width, fallback, commit };
}

// Wire one panel's width to a handle. `write` is the live channel — the CSS variable
// the panel's width actually reads — and is called on every frame of a drag, so it must
// stay off React state (see use-panel-resize).
function usePanelWidthResize(key: PanelKey, label: string, side: 'left' | 'right', defaultWidth: () => number, write: (px: number) => void, onGesture?: (active: boolean) => void): { width: number; resize: PanelResize } {
  const { width, fallback, commit } = usePanelWidth(key, defaultWidth);
  const clamp = useCallback((px: number) => clampWidth(key, px, window.innerWidth), [key]);
  // The committed width is React's, but the CSS variable is written by hand during a
  // drag — this puts the two back in step afterwards, and applies a width restored
  // from config.json at boot. Layout effect, not an effect: a width read from the cache
  // has to be on the element before the first paint, or boot flashes the default one.
  useLayoutEffect(() => {
    write(width);
  }, [width, write]);
  const resize = usePanelResize({
    side,
    width,
    min: LIMITS[key].min,
    max: LIMITS[key].max,
    label,
    clamp,
    onLive: write,
    onCommit: commit,
    onReset: () => commit(clamp(fallback)),
    onGesture,
  });
  return { width, resize };
}

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen();
  // --sidebar-width is set inline on the provider's wrapper (shadcn puts it there), so
  // that element — not :root — is where a drag writes. --inspector-w is a global token
  // read by the panel AND by the floating bar that keeps clear of it, so that one stays
  // on the document element.
  const shellRef = useRef<HTMLDivElement>(null);
  const writeSidebarWidth = useCallback((px: number) => {
    shellRef.current?.style.setProperty('--sidebar-width', `${px}px`);
  }, []);
  const markResizing = useCallback((active: boolean) => {
    if (shellRef.current) shellRef.current.dataset.resizing = String(active);
  }, []);
  const writeInspectorWidth = useCallback((px: number) => {
    document.documentElement.style.setProperty('--inspector-w', `${px}px`);
  }, []);
  const sidebar = usePanelWidthResize('sidebarWidth', t('resizeSidebar'), 'left', () => resolveCssLength(SIDEBAR_WIDTH), writeSidebarWidth, markResizing);
  // The inspector's default is its token's own value, measured before anything here has
  // had a chance to write over it.
  const inspector = usePanelWidthResize('inspectorWidth', t('resizeInspector'), 'right', () => resolveCssLength(getComputedStyle(document.documentElement).getPropertyValue('--inspector-w')), writeInspectorWidth);
  // #245's bulk hide. A mask over the two panels' own state, not a write to it — see
  // services/panels.ts. Every place below that decides whether a panel is on screen ANDs
  // it in; nothing below changes what the panels themselves think.
  const panelsHidden = useSyncExternalStore(panelsSubscribe, panelsAreHidden);
  const wide = useSyncExternalStore(layoutSubscribe, isWideLayout);
  // Narrow-width sidebar state: transient, so the saved preference survives a trip
  // through a small window untouched. Reset on every crossing — widening restores the
  // preference, narrowing starts from the rail again.
  // Adjusted during render rather than in an effect — React's own pattern for "reset
  // state when an input changes", and the honest shape here: the reset has nothing to
  // do with the DOM, so an effect would only add a render showing the stale value.
  const [narrowOpen, setNarrowOpen] = useState(false);
  const [prevWide, setPrevWide] = useState(wide);
  if (prevWide !== wide) {
    setPrevWide(wide);
    setNarrowOpen(false);
  }
  // At narrow widths the inspector is an overlay that rides on the selection: it appears
  // when a card is inspected and is waved away by a click on the grid (Esc / × too). A
  // floating panel with nothing in it would just be a hole in the view, so the #244
  // placeholder stays a wide-layout affair.
  //
  // The formula itself moved to inspector-panel.ts (P2⑦): the renderer modules outside
  // React ask the same question, and they used to answer it by reading this element's
  // `hidden` back off the DOM. One copy, two readers.
  const inspectorVisible = useSyncExternalStore(subscribeInspectorVisible, inspectorIsVisible);
  // Published rather than re-derived downstream: the floating selection bar has to hold
  // back the panel's width while it overlays the grid (as a docked column the panel
  // narrows the bar's container instead, and the bar needs to do nothing). Deriving this
  // in one place keeps the three inputs — width, toggle, selection — from being read
  // twice and drifting.
  const inspectorOverlay = !wide && inspectorVisible;
  useEffect(() => {
    storeSet('inspectorOverlay', inspectorOverlay);
  }, [inspectorOverlay]);
  // config.json outranks the localStorage cache the panel's first render was guessed from
  // (same two-tier reconcile as the sidebar, but the store owns the state — see
  // inspector-panel.ts for why it has to).
  useEffect(() => {
    inspectorLoad();
    panelsLoad();
  }, []);
  // The sidebar's open/closed state, as the shell actually paints it. The bulk mask wins
  // over both the saved preference and the narrow-width one; a toggle aimed at the sidebar
  // (Ctrl+B / the trigger / the rail) drops the mask first, so the value it computes is a
  // flip of what the user can SEE, and the inspector comes back to whatever it was.
  const sidebarShown = panelsHidden ? false : wide ? sidebarOpen : narrowOpen;
  const chooseSidebar = useCallback(
    (open: boolean) => {
      panelsReveal();
      if (wide) setSidebarOpen(open);
      else setNarrowOpen(open);
    },
    [wide, setSidebarOpen],
  );
  // Tell the orchestrator its shell DOM is now in the document (it awaits shellReady
  // before wiring the delegated #postGrid/#emptyState/etc. listeners — those elements
  // are React-rendered below, not static index.html markup anymore).
  useEffect(() => {
    signalShellReady();
  }, []);
  // Which destination the content column is showing. All three stay mounted (see below),
  // so this only decides which one is `hidden`.
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  // An image tab swaps the browse chrome for the media stage (P2⑫). The swap is a render
  // decision here — a `hidden` on the content column and the stage's own component below —
  // where it used to be `body.image-tab-active` plus three CSS rules in index.html. Same
  // predicate the toolbar swaps its controls on, so the two halves cannot disagree.
  const imageView = useSyncExternalStore(hologramImageTabSource.subscribe, imageViewIsActive);
  // The narrow overlay covers the content area, not the tab bar and toolbar above it, so
  // it needs to know where that area starts. Measured rather than computed: the chip row
  // appears and disappears with the filter, so the toolbar has no fixed height to add up.
  // Observing the scroll root catches that for free — the toolbar growing shrinks it.
  const contentRef = useRef<HTMLDivElement>(null);
  // One ref, two jobs: the measurement below, and handing the element to the modules
  // outside React that read or write its scroll position (services/content-area.ts).
  const setContentEl = useCallback((el: HTMLDivElement | null) => {
    contentRef.current = el;
    registerScroller(el);
  }, []);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const sync = () => document.documentElement.style.setProperty('--content-top', `${Math.round(el.getBoundingClientRect().top)}px`);
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync();
    return () => ro.disconnect();
  }, []);
  return (
    <TooltipProvider delay={0}>
      <div className="flex h-svh flex-col overflow-hidden">
        <SidebarProvider ref={shellRef} open={sidebarShown} onOpenChange={chooseSidebar} className="min-h-0 flex-1" style={{ '--sidebar-width': `${sidebar.width}px` } as CSSProperties}>
          {/* The rail is a resize handle only while the sidebar is a column. Below the
              breakpoint it is a slide-over whose width is the window's, so there is
              nothing to drag (#30 v1) — and the rail would sit over the grid. */}
          <LeftSidebar resize={wide ? sidebar.resize : undefined} />
          {/* Everything right of the sidebar: the tab band across the top, and a
              [content | inspector] row beneath it (#518). */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Electron titlebar band. It starts at the sidebar's edge — so the tab strip
                never crosses that seam (#154) — and runs to the window's right edge, over
                the inspector's column, so the window buttons always have the band under
                them (#518). No bottom divider: the strip already steps in tone from the
                band below it (--tabbar-bg vs --sidebar-bg) and the active tab connects
                into that band — Chrome draws no rule between the strip and the toolbar.
                The right padding reserves the corner the app-drawn window buttons are
                portaled over; the inspector toggle is a normal child and needs none. */}
            <header className="app-drag sticky top-0 z-50 flex h-[var(--tabbar-h)] shrink-0 items-center bg-[var(--tabbar-bg)] pr-[var(--window-controls-w,138px)]">
              <TabsHost />
              {/* Inspector toggle (#243) — mirrors the sidebar trigger at the band's left
                  end. A real child here (not portaled), so it sits just left of the window
                  buttons and is covered by a modal scrim like everything else. */}
              <InspectorToggle />
              {/* The window buttons are ours now (see WindowControls). Mounted here for
                  ownership, but portaled to the window's top-right above the modal scrim —
                  the band reserves --window-controls-w so this row's flow stays clear. */}
              <WindowControls />
            </header>
            <div className="flex min-h-0 flex-1">
              <SidebarInset className="min-w-0">
                <AppToolbar />
                {/* Scroll root for the content area (the page itself never scrolls). */}
                {/* The content area's scroll root. Its element is handed to the modules
                    that measure or move it (services/content-area.ts) instead of being
                    looked up by id — see that file. */}
                {/* scrollbar-gutter:stable keeps the column width from jumping ±10px as
                    the bar toggles (the size slider's column-fit math depends on a stable
                    width); overflow-anchor:none stops the browser compensating for a cell
                    that mounts above the viewport, which reads as the grid jittering. */}
                <div ref={setContentEl} data-slot="content-scroll" hidden={imageView} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-6 [overflow-anchor:none] [scrollbar-gutter:stable]">
                  {/* Three destinations, one scroll root. All three stay MOUNTED and the
                      inactive ones are `hidden` — the virtualized hosts keep their
                      measured layout that way, and "which one is on screen" is one
                      React decision rather than a body class racing an inline style. */}
                  <PostGridSlot hidden={mode !== 'posts'} />
                  <PosterGridSlot hidden={mode === 'posts' || mode === 'trash'} />
                  {mode !== 'trash' && <EmptyState />}
                  {/* ゴミ箱 (#268) — the third destination. */}
                  <div hidden={mode !== 'trash'}>
                    <TrashView />
                  </div>
                </div>
                {/* Image-tab detail view (Eagle 風 fit-to-screen). It draws its own container
                    when there is something to show and nothing at all otherwise (P2⑫), so the
                    "which of the two fills the inset" decision is the `hidden` above and this
                    line — no id, no display rules in index.html. */}
                <ImageTabHost />
                {/* Bottom floating selection bar (redesign §3-4 / P2⑥). Inside the inset (not
                    a body-level overlay) so it centers on the content column and stays clear of
                    the right inspector, which is a flex sibling that narrows the inset when open. */}
                <FloatingBar />
              </SidebarInset>
              {/* Right inspector — a column under the band, like Chrome's side panel (#518).
                  Visibility is the user's own toggle (#243): it is no longer opened/closed as
                  a side effect of selecting a card, and the content (Inspector) shows a
                  placeholder while nothing is selected (#244). */}
              {/* …and an inline column under an image tab at ANY width (Eagle-style detail
                  screen): a slide-over would cover the very picture being inspected. That
                  used to be a `body.image-tab-active .inspector--overlay` override that
                  undid the overlay's own rules one by one; picking the docked form outright
                  is the same result with one decision instead of two. */}
              <aside data-slot="inspector" ref={registerPanelEl} className={wide || imageView ? 'inspector relative' : 'inspector inspector--overlay'} hidden={!inspectorVisible}>
                {/* Drag edge (#30). Wide layout only, for the same reason the sidebar rail
                    is: the narrow form is an overlay pinned to the window edge. */}
                {wide && <InspectorRail resize={inspector.resize} />}
                {/* flex:1 (in .inspector-body) gives this a definite height, so the
                    empty-state placeholder can still center itself in the column; a filled
                    panel just overflows it into the scroll, as before. */}
                <div data-slot="inspector-body" className="inspector-body">
                  <Inspector />
                </div>
              </aside>
            </div>
          </div>
        </SidebarProvider>
      </div>
      {/* Virtual grids attach into the slots above via GridMount's effect — kept out of
          the content column so masonic's host-attach + flushSync path is unchanged. */}
      <PostGrid />
      <PosterGrid />
      <TrashGrid />
    </TooltipProvider>
  );
}
