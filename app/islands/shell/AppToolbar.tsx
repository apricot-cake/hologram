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
import { ChevronLeft, ChevronRight, ListFilter, SlidersHorizontal } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ChipsHost } from '../query-chips/index.tsx';
import { SearchBox } from '../searchbox/SearchBox.tsx';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import { navBack, navForward } from '../../renderer/orchestrator.ts';

const subKey = (key: string) => (cb: () => void) => storeSubscribe(key, cb);
const subBrowse = subKey('browseMode');
const getBrowse = (): string => (storeGet('browseMode') as string) || 'posts';
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
  const mode = useSyncExternalStore(subBrowse, getBrowse);
  const canBack = useSyncExternalStore(subBack, getBack);
  const canForward = useSyncExternalStore(subForward, getForward);
  const isPosters = mode === 'posters';
  return (
    // bg-sidebar, not bg-background: the toolbar and the left sidebar form ONE band
    // under the tab strip, and the active tab connects into that band (its legacy
    // fill --sidebar-bg aliases the same color) — Chrome's strip/toolbar anatomy.
    <div className="flex flex-col border-b bg-sidebar">
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
          {/* Placeholders: the real filter bar (P2③) and display popover (P2②)
              replace these — disabled so their absence reads as "coming", not broken. */}
          <Button variant="outline" size="sm" disabled>
            <ListFilter />
            <span>フィルタ</span>
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="表示" disabled>
            <SlidersHorizontal />
          </Button>
        </div>
      </div>
      {/* Active-filter chips. BOTH containers stay mounted (the post/poster query-chips
          builders each resolve their container id once at boot — a conditionally-rendered
          container would be null for the inactive mode and crash render()). The inactive
          one is just hidden. The Chips island renders into each (null when empty). The
          .sb-chips class keeps the legacy chip layout/CSS until the filter bar rewrite (P2③). */}
      {/* px-8 = #mode-post's 32px content padding: the chip row sits on the same
          left axis as the cards it filters (Linear's filter row ↔ list gutter). */}
      <div className="px-8">
        <div id="queryChips" className="sb-chips" hidden={isPosters}>
          <ChipsHost id="queryChips" />
        </div>
        <div id="posterQueryChips" className="sb-chips" hidden={!isPosters}>
          <ChipsHost id="posterQueryChips" />
        </div>
      </div>
    </div>
  );
}
