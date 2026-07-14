// The app shell — the single React-owned frame for the whole renderer (redesign
// §3, P1-2..P1-5). Replaces index.html's static shell markup: a flex column of
// [tab bar band] + [SidebarProvider: left nav | content inset | right inspector].
//
// Layout notes:
// - The tab bar is the Electron titlebar band, OUTSIDE SidebarProvider, full width
//   above everything. It keeps the legacy #tabBar/#tabBarInner ids so the legacy
//   titlebar CSS (height var(--tabbar-h), drag region) + the delegated tab handlers
//   still apply. TRANSIENT: TabsHost still emits the legacy .tab-item DOM; the
//   Tailwind rewrite + delegation teardown is the immediate follow-up (P1-2 rest).
// - shadcn's fixed sidebar-container assumes it owns the full viewport height; a
//   globals.css rule offsets it below the tab bar band (--tabbar-h). SidebarProvider's
//   own min-h-svh is overridden to flex-1 so the row fills the column, not svh+band.
// - #mode-post is kept as the scroll root (orchestrator's contentScrollEl + per-tab
//   scroll restore key off this id). #postGrid/#posterGrid keep ids+classes for the
//   masonic host-attach and the body.browse-posters visibility CSS.
// - The right inspector keeps the legacy #postDetail element: its .inspector CSS
//   already implements the #143 model (wide = fixed 320px column, narrow = slide-over),
//   so P1 inherits that behavior; the content is reworked in P2⑦.
import { useEffect, useRef } from 'react';
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { signalShellReady } from '../../renderer/shell-ready.ts';
import { AppToolbar } from './AppToolbar.tsx';
import { LeftSidebar } from './LeftSidebar.tsx';
import { EmptyState } from '../empty/EmptyState.tsx';
import { ImageTabHost } from '../image-tab/index.tsx';
import { Inspector } from '../inspector/Inspector.tsx';
import { PostGrid } from '../grid/index.tsx';
import { PosterGrid } from '../posters/index.tsx';
import { TabsHost } from '../tabs/index.tsx';

// The sidebar obeys the same width discipline as the inspector: horizontal width is a
// contested resource (the inspector detaches to a slide-over below 1280px), so a sparse
// nav column must not hold persistent width. Below 1024px the sidebar auto-collapses to
// the icon rail (shadcn's collapsible="icon"); below 768px it becomes the mobile Sheet
// (useIsMobile). The manual SidebarTrigger + Ctrl/Cmd+B still override within a band —
// this only re-applies on a breakpoint crossing, so a manual toggle persists until the
// next crossing. See the trial memory: "幅規律の対称ルール".
const SIDEBAR_EXPANDED_QUERY = '(min-width: 1024px)';

function SidebarAutoCollapse() {
  const { setOpen } = useSidebar();
  const setOpenRef = useRef(setOpen);
  useEffect(() => {
    setOpenRef.current = setOpen;
  }, [setOpen]);
  useEffect(() => {
    const mql = window.matchMedia(SIDEBAR_EXPANDED_QUERY);
    setOpenRef.current(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setOpenRef.current(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return null;
}

export function AppShell() {
  // Tell the orchestrator its shell DOM is now in the document (it awaits shellReady
  // before wiring the delegated #postGrid/#emptyState/etc. listeners — those elements
  // are React-rendered below, not static index.html markup anymore).
  useEffect(() => {
    signalShellReady();
  }, []);
  return (
    <TooltipProvider delay={0}>
      <div className="flex h-svh flex-col overflow-hidden">
        {/* Electron titlebar band — legacy #tabBar CSS styles it; TabsHost fills #tabBarInner. */}
        <header id="tabBar" className="shrink-0">
          <div id="tabBarInner">
            <TabsHost />
          </div>
        </header>
        <SidebarProvider defaultOpen={window.innerWidth >= 1024} className="min-h-0 flex-1">
          <SidebarAutoCollapse />
          <LeftSidebar />
          <SidebarInset className="min-w-0">
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
          </SidebarInset>
          {/* Right inspector — legacy element + CSS (already the #143 wide/narrow model). */}
          <aside id="postDetail" className="inspector" hidden>
            <div id="postDetailBox">
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
