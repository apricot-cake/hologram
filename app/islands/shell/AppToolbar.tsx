// Toolbar + filter-chip row — the "predicate" axis of the new IA (redesign §3-2).
// One horizontal bar over the grid: sidebar toggle, tab history back/forward,
// the search input, and (right) the "+ filter" and "display" entry points. The
// active-filter chips sit in a row just below. Anchors: Linear's filter bar /
// VS Code's toolbar.
//
// P1 scope: the FRAME. Search hosts the existing SearchBox island (rewired to
// Autocomplete in P2④); フィルタ (何を出すか) and 表示 (どう見せるか) are a matched
// labeled pair (Linear) that are NOT yet wired — they carry a 準備中 tooltip + toast
// instead of being disabled (a disabled button can't surface a tooltip, so the
// user just hit a dead control). Real editor/popover land in P2③ / P2②. The chip
// row keeps the existing Chips island so remove/reset still work (P2③ rewrites it).
import { ChevronLeft, ChevronRight, ListFilter, SlidersHorizontal } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChipsHost } from '../query-chips/index.tsx';
import { SearchBox } from '../searchbox/SearchBox.tsx';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import { navBack, navForward } from '../../renderer/orchestrator.ts';
import { notify } from '../../renderer/ui.ts';

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
        {/* #searchWrap keeps the id the search-box-builder queries (retired in P2④). */}
        <div id="searchWrap" className="search-wrap relative min-w-0">
          <SearchIcon />
          <SearchBox placeholder={t('searchPlaceholder')} />
        </div>
        {/* フィルタ (何を出すか) + 表示 (どう見せるか): a matched labeled pair (Linear).
            Not yet wired — enabled with a 準備中 tooltip + toast rather than disabled, so
            hovering explains and a click isn't a dead end. Real surfaces land P2③ / P2②. */}
        <div className="flex items-center justify-end gap-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="outline" size="sm" onClick={() => notify('フィルタは準備中です')}>
                  <ListFilter />
                  <span>フィルタ</span>
                </Button>
              }
            />
            <TooltipContent>準備中（もうすぐ）</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="outline" size="sm" onClick={() => notify('表示オプションは準備中です')}>
                  <SlidersHorizontal />
                  <span>表示</span>
                </Button>
              }
            />
            <TooltipContent>準備中（もうすぐ）</TooltipContent>
          </Tooltip>
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
