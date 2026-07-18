// Toolbar + filter-chip row — the "predicate" axis of the new IA (redesign §3-2).
// One horizontal bar over the grid: sidebar toggle, tab history back/forward,
// the search input, and (right) the "+ filter" and "display" entry points. The
// active-filter chips sit in a row just below. Anchors: Linear's filter bar /
// VS Code's toolbar.
//
// P1 scope: the FRAME. Search hosts the existing SearchBox island (rewired to
// Autocomplete in P2④); "+ filter" and "display" are disabled placeholders
// (wired in P2③ / P2②). The chip row keeps the existing Chips island so
// remove/reset still work; adding filters returns with the filter bar (P2③).
import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { AddFilterButton } from '../filterbar/index.tsx';
import { FilterChips } from '../filterbar/FilterChips.tsx';
import { SearchBox } from '../searchbox/SearchBox.tsx';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import { navBack, navForward } from '../../renderer/orchestrator.ts';

const subKey = (key: string) => (cb: () => void) => storeSubscribe(key, cb);
const subBack = subKey('navCanBack');
const getBack = (): boolean => !!storeGet('navCanBack');
const subForward = subKey('navCanForward');
const getForward = (): boolean => !!storeGet('navCanForward');

// Leading magnifier for the search field (SearchBox renders only the input; the
// icon is the field's chrome, same split the old #searchWrap used).
function SearchIcon() {
  return (
    <svg className="search-ico pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

export function AppToolbar() {
  const canBack = useSyncExternalStore(subBack, getBack);
  const canForward = useSyncExternalStore(subForward, getForward);
  return (
    <div className="flex flex-col border-b bg-background">
      <div className="flex h-12 items-center gap-1.5 px-2">
        <SidebarTrigger className="text-muted-foreground" />
        <div className="flex items-center">
          <Button variant="ghost" size="icon-sm" aria-label="戻る" disabled={!canBack} onClick={() => navBack()}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="進む" disabled={!canForward} onClick={() => navForward()}>
            <ChevronRight />
          </Button>
        </div>
        {/* Search field — hosts the SearchBox island; #searchWrap keeps the id the
            search-box-builder queries (retired in P2④ with the Autocomplete swap). */}
        <div id="searchWrap" className="search-wrap relative ml-1 max-w-md flex-1">
          <SearchIcon />
          <SearchBox placeholder={t('searchPlaceholder')} />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {/* "+ フィルタ" (P2③) is live; the display popover (P2②) is still a disabled
              placeholder — disabled so its absence reads as "coming", not broken. */}
          <AddFilterButton />
          <Button variant="ghost" size="icon-sm" aria-label="表示" disabled>
            <SlidersHorizontal />
          </Button>
        </div>
      </div>
      {/* Active-filter chips (redesign §3-2 / P2③ タスク2) — Linear型 chips rendered by
          the filterbar island from activeFilters(); a chip click reopens its editor.
          The #queryChips / #posterQueryChips divs stay only as the container ids the
          legacy post/poster query builders resolve at boot — emptied + hidden until the
          query-chips island + builder are removed (タスク3). */}
      <div className="px-3">
        <FilterChips />
        <div id="queryChips" hidden />
        <div id="posterQueryChips" hidden />
      </div>
    </div>
  );
}
