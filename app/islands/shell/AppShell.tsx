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
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { isOpen as inspectorIsOpen, load as inspectorLoad, subscribe as inspectorSubscribe } from '../../renderer/inspector-panel.ts';
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

// #149 + #243: the state is purely the user's saved choice (sidebar-pref.ts). It used to
// be clamped by a width discipline — below 1024px the column was forced to the icon rail
// no matter what the user had chosen — but #243 retired automatic reshaping for BOTH side
// panels: a panel's form follows the user's explicit toggle, not the window size. Desktop
// DAMs and editors (Eagle / Lightroom / Bridge / Obsidian / VS Code) all work this way;
// width-driven relayout is the responsive-web idiom, not the desktop one.
//
// The one automatic behavior left is shadcn's mobile Sheet below 768px (useIsMobile),
// which is not a reshape of choice but a retreat where no column can physically fit.
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

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen();
  const inspectorOpen = useSyncExternalStore(inspectorSubscribe, inspectorIsOpen);
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
  return (
    <TooltipProvider delay={0}>
      <div className="flex h-svh flex-col overflow-hidden">
        <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} className="min-h-0 flex-1">
          <LeftSidebar />
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
            <div id="mode-post" className="relative min-h-0 flex-1 overflow-y-auto">
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
          <aside id="postDetail" className="inspector" hidden={!inspectorOpen}>
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
      </select>
      {/* Virtual grids attach to #postGrid / #posterGrid via GridMount's effect — kept
          out of the container so masonic's host-attach + flushSync path is unchanged. */}
      <PostGrid />
      <PosterGrid />
    </TooltipProvider>
  );
}
