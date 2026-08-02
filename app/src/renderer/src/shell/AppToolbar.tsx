// Toolbar + filter-chip row — the "predicate" axis of the new IA (redesign §3-2).
// One horizontal bar over the grid: sidebar toggle, tab history back/forward,
// the search input, and (right) the "+ filter" and "display" entry points. The
// active-filter chips sit in a row just below. Anchors: Linear's filter bar /
// VS Code's toolbar.
//
// P1 scope: the FRAME. Search hosts the existing SearchBox component (rewired to
// Autocomplete in P2④). The "+ Filter" add-filter flow (P2③) and the Display
// popover (P2②) are both live now. The chip row below renders the filterbar component's
// Linear-style FilterChips — the only chip surface (the hidden #queryChips /
// #posterQueryChips containers the legacy builders resolved at boot went with
// their render path in #230).
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AddFilterButton } from '../filterbar/index.tsx';
import { FilterChips } from '../filterbar/FilterChips.tsx';
import { DisplayMenu } from './DisplayMenu.tsx';
import { WebSearchPanel } from '../websearch/WebSearchPanel.tsx';
import { SearchBox } from '../searchbox/SearchBox.tsx';
import { ViewerToolbar } from '../image-tab/ViewerToolbar.tsx';
import { t } from '../_shared/i18n.ts';
import { open as openPalette } from '../services/command-registry.ts';
import { hologramImageTabSource, isActive as imageViewIsActive } from '../services/image-tab.ts';
import { subscribeQueueCount } from '../services/triage-builder.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';
import { navBack, navForward, openTriage, triageQueueCount } from '../services/orchestrator.ts';

const subKey = (key: string) => (cb: () => void) => storeSubscribe(key, cb);
const subBack = subKey('navCanBack');
const getBack = (): boolean => !!storeGet('navCanBack');
const subForward = subKey('navCanForward');
const getForward = (): boolean => !!storeGet('navCanForward');
// An image view is showing — asked of services/image-tab.ts, the module that builds the
// stage, so the toolbar and the shell cannot disagree about which one is on screen (P2⑫).
// The band stays — every browser keeps its toolbar row on every tab — but what it carries
// swaps: the predicate controls are about the grid, which is not on screen, and the zoom
// controls are about the picture, which is (#150).

// Leading magnifier for the search field (SearchBox renders only the input; the
// icon is the field's chrome, same split the old #searchWrap used).
function SearchIcon() {
  return (
    // NO legacy .search-ico class: its transform:translateY(-50%) stacks with the
    // -translate-y-1/2 utility (Tailwind v4 emits the separate `translate` property,
    // so BOTH apply = icon rides 8px high). One positioning system only.
    <svg className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

// Ctrl+K badge at the search field's right edge — one of the palette's two visible
// entry points (#28; the other is the sidebar footer). A palette reachable only by
// shortcut is a palette nobody finds, and this spot does double duty: it is also
// where the two keys explain themselves, since `/` focuses this field and Ctrl+K
// opens the palette. The shortcut hint next to the field it is NOT for is the
// arrangement Slack, Linear and GitHub all use.
//
// A plain button, not the Badge component: Badge is a status chip (non-interactive
// by anatomy), and what this needs is a pressable kbd-looking control.
function PaletteBadge() {
  return (
    <button
      type="button"
      aria-label={t('paletteTitle')}
      title={t('paletteTitle')}
      onClick={() => openPalette()}
      className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded border border-input bg-muted/60 px-1.5 py-0.5 font-sans text-[11px] leading-tight font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      Ctrl+K
    </button>
  );
}

// Fast triage mode's entry point (#46). Placed beside the display/filter pair —
// same "always visible, right cell" spot as those — rather than only living in the
// command palette, since triage is meant to be an often-reached-for workflow
// (photo-culling tools give this its own toolbar affordance, not just a shortcut).
// The count subscribes independently of the rest of the toolbar (services/
// triage-builder.ts's subscribeQueueCount): it has to move on a tag/folder edit
// ANYWHERE in the app, not just from this component's own actions.
function TriageButton() {
  // triageQueueCount/openTriage are orchestrator.ts `export let`s, assigned once its
  // async IIFE finishes constructing triageCtl — AFTER `await hologramI18n` — while
  // React mounts and paints synchronously well before that. Every OTHER export-let
  // in this toolbar is read from inside a click handler (by which point boot has
  // long finished); this one is read as useSyncExternalStore's getSnapshot, which
  // runs on the FIRST render too — so it needs its own guard rather than borrowing
  // theirs (hit this for real: a fresh boot crashed the whole tree with "getSnapshot
  // is not a function" before this guard existed).
  const count = useSyncExternalStore(subscribeQueueCount, () => (triageQueueCount ? triageQueueCount() : 0));
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button data-slot="triage-toolbar-button" variant="ghost" size="icon-sm" aria-label={t('triageToolbarLabel')} onClick={() => openTriage?.()} className="relative">
            <Inbox />
            {count > 0 && (
              <Badge variant="secondary" className="-top-1 -right-1 absolute h-4 min-w-4 justify-center px-1 text-[10px] tabular-nums">
                {count > 99 ? '99+' : count}
              </Badge>
            )}
          </Button>
        }
      />
      <TooltipContent>{count > 0 ? t('triageToolbarHint', [count]) : t('triageToolbarLabel')}</TooltipContent>
    </Tooltip>
  );
}

export function AppToolbar() {
  const canBack = useSyncExternalStore(subBack, getBack);
  const canForward = useSyncExternalStore(subForward, getForward);
  const imageView = useSyncExternalStore(hologramImageTabSource.subscribe, imageViewIsActive);
  return (
    // bg-sidebar, not bg-background: the toolbar and the left sidebar form ONE band
    // under the tab strip, and the active tab connects into that band (its legacy
    // fill --sidebar-bg aliases the same color) — Chrome's strip/toolbar anatomy.
    <div className="flex flex-col border-b bg-sidebar">
      {/* Three-column grid so the search sits CENTERED with symmetric side gutters
          (Slack / Safari / VS Code), not stretched full-width (which just made a wide
          window's empty middle into a wide empty input). The 1fr side cells carry the
          nav (left) and the filter/display pair (right); their leftover space is equal,
          so the search's breathing room is symmetric. Center caps at 40rem and shrinks
          (minmax 0) on narrow windows back into a tight row. */}
      <div className="grid h-12 items-center gap-1.5 px-2" style={{ gridTemplateColumns: '1fr minmax(0, 40rem) 1fr' }}>
        {/* Sidebar toggle lives in the sidebar's own header now (Obsidian-type shell,
            #154); the left cell starts straight into the tab-scoped back/forward. */}
        <div className="flex items-center">
          <Button variant="ghost" size="icon-sm" aria-label="戻る" disabled={!canBack} onClick={() => navBack()}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="進む" disabled={!canForward} onClick={() => navForward()}>
            <ChevronRight />
          </Button>
        </div>
        {/* Hidden rather than unmounted while an image view is up: the field keeps
            typed-but-unapplied text and its Autocomplete state, and display:none
            already takes it out of the tab order. */}
        <div data-slot="toolbar-search" className={`relative flex min-w-0 items-center ${imageView ? 'hidden' : ''}`}>
          <SearchIcon />
          <SearchBox placeholder={t('searchPlaceholder')} />
          <PaletteBadge />
        </div>
        <div className="flex items-center justify-end gap-1.5">
          {/* These two ARE unmounted, on purpose: both are popover triggers, and an
              open popover about the grid has no business surviving into the image
              view. */}
          {imageView ? (
            <ViewerToolbar />
          ) : (
            <>
              <TriageButton />
              <WebSearchPanel />
              <AddFilterButton />
              <DisplayMenu />
            </>
          )}
        </div>
      </div>
      {/* Active-filter chips (redesign §3-2 / P2③) — Linear-style chips rendered by the
          filterbar component from activeFilters(); a chip click reopens its editor.
          px-8 = #mode-post's 32px content padding, so the chip row sits
          on the same left axis as the cards it filters (Linear's filter row ↔ list gutter). */}
      <div className={`px-8 ${imageView ? 'hidden' : ''}`}>
        <FilterChips />
      </div>
    </div>
  );
}
