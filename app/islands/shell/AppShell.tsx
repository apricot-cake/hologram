// The app shell — the single React-owned frame for the whole renderer (redesign
// §3, P1-2..P1-5). Replaces index.html's static shell markup: a flex column of
// [tab bar band] + [SidebarProvider: left nav | content inset | right inspector].
//
// Layout notes:
// - Obsidian-type shell (#154, 2026-07-18): the sidebar spans the full window height
//   and the tab bar is scoped INTO the content column (SidebarInset), not a full-width
//   band above everything. That kills the seam where the sidebar's vertical edge met
//   the tab strip and split the connected tab into two tones. The tab bar keeps the
//   legacy #tabBar/#tabBarInner ids + titlebar CSS (drag region) + delegated handlers.
//   TRANSIENT: TabsHost still emits legacy .tab-item DOM; the Tailwind rewrite +
//   delegation teardown is the follow-up (P1-2 rest).
// - The sidebar's own header row is the window's titlebar drag strip and holds the
//   collapse trigger (moved out of the toolbar). shadcn's fixed sidebar-container now
//   spans inset-y-0 as-is (the --tabbar-h offset hack is gone).
// - #mode-post is kept as the scroll root (orchestrator's contentScrollEl + per-tab
//   scroll restore key off this id). #postGrid/#posterGrid keep ids+classes for the
//   masonic host-attach and the body.browse-posters visibility CSS.
// - The right inspector keeps the legacy #postDetail element: its .inspector CSS
//   already implements the #143 model (wide = fixed 320px column, narrow = slide-over),
//   so P1 inherits that behavior; the content is reworked in P2⑦.
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SIDEBAR_WIDTH, SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { InspectorRail } from './InspectorRail.tsx';
import { type PanelResize, resolveCssLength, usePanelResize } from './use-panel-resize.ts';
import { LIMITS, type PanelKey, cachedWidth, clampWidth, loadWidth, persistWidth } from '../../renderer/panel-width-pref.ts';
import { isOpen as inspectorIsOpen, load as inspectorLoad, subscribe as inspectorSubscribe } from '../../renderer/inspector-panel.ts';
import { isWide as isWideLayout, subscribe as layoutSubscribe } from '../../renderer/layout-mode.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import { cachedOpen, loadOpen, persistOpen } from '../../renderer/sidebar-pref.ts';
import { signalShellReady } from '../../renderer/shell-ready.ts';
import { AppToolbar } from './AppToolbar.tsx';
import { InspectorToggle } from './InspectorToggle.tsx';
import { LeftSidebar } from './LeftSidebar.tsx';
import { EmptyState } from '../empty/EmptyState.tsx';
import { FloatingBar } from '../selection/FloatingBar.tsx';
import { ImageTabHost } from '../image-tab/index.tsx';
import { Inspector } from '../inspector/Inspector.tsx';
import { PostGrid } from '../grid/index.tsx';
import { PosterGrid } from '../posters/index.tsx';
import { TabsHost } from '../tabs/index.tsx';
import { WindowControls } from './WindowControls.tsx';

// #149 + #243 + #259: the stored state is purely the user's saved choice (sidebar-pref.ts).
// #243 removed the old width clamp that forced the rail below 1024px, on the grounds that
// desktop apps don't reshape themselves by width. #259 puts a narrower version of it back,
// having found what #243 missed: the products it measured against (Lightroom / VS Code /
// Obsidian) don't auto-reshape BECAUSE they all pair that with a one-key collapse, and
// Corpus shipped the first half without the second. At half-screen widths — Corpus beside
// a browser is a primary way to use it — the two panels take 576px and leave the grid 382.
//
// What came back is narrower than what #243 removed, in two ways. The saved preference is
// never overwritten by width: it is masked while narrow and comes back untouched. And the
// user can still expand over the mask (narrowOpen below) — width picks the starting form,
// it does not lock one in.
// The inspected card, mirrored into the store by orchestrator.ts on every selection.
const subInspected = (cb: () => void) => storeSubscribe('inspectedKey', cb);
const getInspected = () => storeGet('inspectedKey') as string | null | undefined;

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
  const inspectorOpen = useSyncExternalStore(inspectorSubscribe, inspectorIsOpen);
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
  const inspectedKey = useSyncExternalStore(subInspected, getInspected);
  const inspectorVisible = inspectorOpen && (wide || inspectedKey != null);
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
  }, []);
  // Tell the orchestrator its shell DOM is now in the document (it awaits shellReady
  // before wiring the delegated #postGrid/#emptyState/etc. listeners — those elements
  // are React-rendered below, not static index.html markup anymore).
  useEffect(() => {
    signalShellReady();
  }, []);
  // The narrow overlay covers the content area, not the tab bar and toolbar above it, so
  // it needs to know where that area starts. Measured rather than computed: the chip row
  // appears and disappears with the filter, so the toolbar has no fixed height to add up.
  // Observing #mode-post catches that for free — the toolbar growing shrinks it.
  const contentRef = useRef<HTMLDivElement>(null);
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
        <SidebarProvider ref={shellRef} open={wide ? sidebarOpen : narrowOpen} onOpenChange={wide ? setSidebarOpen : setNarrowOpen} className="min-h-0 flex-1" style={{ '--sidebar-width': `${sidebar.width}px` } as CSSProperties}>
          {/* The rail is a resize handle only while the sidebar is a column. Below the
              breakpoint it is a slide-over whose width is the window's, so there is
              nothing to drag (#30 v1) — and the rail would sit over the grid. */}
          <LeftSidebar resize={wide ? sidebar.resize : undefined} />
          <SidebarInset className="min-w-0">
            {/* Electron titlebar band, now scoped INTO the content column (Obsidian-type
                shell, #154): the sidebar spans full height beside it, so the tab strip no
                longer crosses the sidebar seam. Legacy #tabBar CSS styles it; TabsHost
                fills #tabBarInner. */}
            <header id="tabBar" className="shrink-0">
              {/* has-inspector: when the panel is open the band no longer reaches the window
                  edge, so it stops reserving the width of the chrome pinned there. */}
              <div id="tabBarInner" className={inspectorOpen ? 'has-inspector' : undefined}>
                <TabsHost />
              </div>
              {/* Inspector toggle (#243) — mirrors the sidebar trigger at the band's left
                  end. A real child here (not portaled), so it sits just left of the window
                  buttons and is covered by a modal scrim like everything else. */}
              <InspectorToggle />
              {/* The window buttons are ours now (see WindowControls). Mounted here for
                  ownership, but portaled to the window's top-right above the modal scrim —
                  #tabBarInner reserves --window-controls-w so tabs stay clear of them. */}
              <WindowControls />
            </header>
            <AppToolbar />
            {/* Scroll root for the content area (the page itself never scrolls). */}
            <div id="mode-post" ref={contentRef} className="relative min-h-0 flex-1 overflow-y-auto">
              <div id="panelPosts" className="tab-panel active">
                <div id="postGrid" className="post-grid" />
                <div id="posterGrid" className="poster-grid" />
                <div id="emptyState" className="empty-state" hidden>
                  <EmptyState />
                </div>
                {/* Hidden ZIP-import input (empty-state CTA + settings trigger it). */}
                <input type="file" id="importZipInput" className="file-input-hidden" accept=".zip" />
              </div>
            </div>
            {/* Image-tab detail view (Eagle 風 fit-to-screen); body.image-tab-active swaps it in. */}
            <div id="imageTabView">
              <ImageTabHost />
            </div>
            {/* Bottom floating selection bar (redesign §3-4 / P2⑥). Inside the inset (not
                a body-level overlay) so it centers on the content column and stays clear of
                the right inspector, which is a flex sibling that narrows the inset when open. */}
            <FloatingBar />
          </SidebarInset>
          {/* Right inspector. Visibility is the user's own toggle now (#243) — it is no
              longer opened/closed as a side effect of selecting a card, and the content
              (Inspector) shows a placeholder while nothing is selected (#244). */}
          <aside id="postDetail" className={wide ? 'inspector relative' : 'inspector inspector--overlay'} hidden={!inspectorVisible}>
            {/* Drag edge (#30). Wide layout only, for the same reason the sidebar rail
                is: the narrow form is an overlay pinned to the window edge. */}
            {wide && <InspectorRail resize={inspector.resize} />}
            {/* The panel's share of the titlebar. It spans the full window height beside
                the tab band, so its top row is where the pinned inspector toggle and
                window buttons land — without this strip they sat on the panel's content,
                which then scrolled underneath them, and the window had no drag region
                there. Mirrors the sidebar's header row at the opposite corner. */}
            <div className="inspector-titlebar" />
            {/* flex:1 (in .inspector-body) gives this a definite height, so the
                empty-state placeholder can still center itself in what is left of the
                column; a filled panel just overflows it into the scroll, as before.
                No h-full here — 100% would resolve against the whole aside and push the
                body a titlebar's worth past the bottom. */}
            <div id="postDetailBox" className="inspector-body">
              <Inspector />
            </div>
          </aside>
        </SidebarProvider>
      </div>
      {/* Hidden sort value source — orchestrator/tabs read+write #sortSelect.value as the
          post-sort state holder (selectById + a change listener). TRANSIENT: sort moves to
          the display popover + store in P2②, which retires this stub. Poster sort is already
          store-driven, so it needs no stub here. */}
      <select id="sortSelect" className="hidden" aria-hidden="true" tabIndex={-1} defaultValue="date-desc">
        <option value="date-desc" />
        <option value="date-asc" />
        <option value="likes-desc" />
        <option value="reposts-desc" />
        <option value="replies-desc" />
        <option value="captured-desc" />
        <option value="likes-pct" />
        <option value="random" />
      </select>
      {/* Virtual grids attach to #postGrid / #posterGrid via GridMount's effect — kept
          out of the container so masonic's host-attach + flushSync path is unchanged. */}
      <PostGrid />
      <PosterGrid />
    </TooltipProvider>
  );
}
