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
import { useCallback, useEffect, useRef, useState } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cachedOpen, loadOpen, persistOpen } from '../../renderer/sidebar-pref.ts';
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
// (useIsMobile). See the trial memory: "幅規律の対称ルール".
const SIDEBAR_EXPANDED_QUERY = '(min-width: 1024px)';

// #149: the state is the user's saved choice (sidebar-pref.ts), clamped by that width
// discipline — a saved "expanded" is only honored once the viewport can afford the
// column, and an unset pref means expanded on a wide screen. Below the breakpoint the
// override is temporary: it is not written back, so widening the window returns to
// whatever the user last chose rather than to a resize artifact.
function resolveOpen(saved: boolean | null): boolean {
  if (!window.matchMedia(SIDEBAR_EXPANDED_QUERY).matches) return false;
  return saved ?? true;
}

function useSidebarOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => resolveOpen(cachedOpen()));
  // A user toggle mid-boot must not lose to the reconcile landing a tick later.
  const toggled = useRef(false);

  // config.json outranks the localStorage cache the initial state was guessed from.
  useEffect(() => {
    loadOpen().then((saved) => {
      if (saved !== null && !toggled.current) setOpen(resolveOpen(saved));
    });
  }, []);

  // Re-apply the width discipline on a breakpoint crossing (cachedOpen() is kept live by
  // persistOpen/loadOpen, so this reads the current choice without re-rendering on it).
  useEffect(() => {
    const mql = window.matchMedia(SIDEBAR_EXPANDED_QUERY);
    const onChange = () => setOpen(resolveOpen(cachedOpen()));
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
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
              <div id="tabBarInner">
                <TabsHost />
              </div>
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
