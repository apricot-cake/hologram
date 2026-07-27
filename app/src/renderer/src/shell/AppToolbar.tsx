// Toolbar + filter-chip row — the "predicate" axis of the new IA (redesign §3-2).
// One horizontal bar over the grid: sidebar toggle, tab history back/forward,
// the search input, and (right) the "+ filter" and "display" entry points. The
// active-filter chips sit in a row just below. Anchors: Linear's filter bar /
// VS Code's toolbar.
//
// P1 scope: the FRAME. Search hosts the existing SearchBox component (rewired to
// Autocomplete in P2④). The "+ フィルタ" add-filter flow (P2③) and the 表示 Display
// popover (P2②) are both live now. The chip row below renders the filterbar component's
// Linear-style FilterChips; the hidden #queryChips / #posterQueryChips divs remain only
// as the container ids the legacy query builders resolve at boot (removed in タスク3).
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { AddFilterButton } from '../filterbar/index.tsx';
import { FilterChips } from '../filterbar/FilterChips.tsx';
import { DisplayMenu } from './DisplayMenu.tsx';
import { SearchBox } from '../searchbox/SearchBox.tsx';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';
import { navBack, navForward } from '../services/orchestrator.ts';
import { notify } from '../services/ui.ts';

const subKey = (key: string) => (cb: () => void) => storeSubscribe(key, cb);
const subBack = subKey('navCanBack');
const getBack = (): boolean => !!storeGet('navCanBack');
const subForward = subKey('navCanForward');
const getForward = (): boolean => !!storeGet('navCanForward');

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

export function AppToolbar() {
  const canBack = useSyncExternalStore(subBack, getBack);
  const canForward = useSyncExternalStore(subForward, getForward);
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
        <div className="relative flex min-w-0 items-center">
          <SearchIcon />
          <SearchBox placeholder={t('searchPlaceholder')} />
        </div>
        <div className="flex items-center justify-end gap-1.5">
          <AddFilterButton />
          <DisplayMenu />
        </div>
      </div>
      {/* Active-filter chips (redesign §3-2 / P2③) — Linear型 chips rendered by the
          filterbar component from activeFilters(); a chip click reopens its editor. The
          hidden #queryChips / #posterQueryChips divs remain only as the container ids the
          legacy post/poster query builders resolve at boot — removed in タスク3 with the
          query-chips component. px-8 = #mode-post's 32px content padding, so the chip row sits
          on the same left axis as the cards it filters (Linear's filter row ↔ list gutter). */}
      <div className="px-8">
        <FilterChips />
        <div id="queryChips" hidden />
        <div id="posterQueryChips" hidden />
      </div>
    </div>
  );
}
