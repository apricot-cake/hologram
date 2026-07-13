import { CheckIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { close, get, subscribe } from '../../renderer/qf-pop.ts';
import { compile, isFuzzy, setMode, subscribe as subscribeSearch } from '../../renderer/search.ts';
import { tipProps } from '../_shared/tip.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

// Render list entries buildRows() flattens the facet items into.
type QfRow = { type: 'div' } | { type: 'ghead'; text: string } | { type: 'row'; item: CorpusQfPopItem };

// A tag group parsed out of the flat facet items (a ghead marker + the value rows
// that follow it, until the next ghead).
type QfGroup = { name: string; items: CorpusQfPopItem[] };

// Value-flyout (qf-pop) — ONE always-mounted host that renders whatever qf-pop.ts's
// bridge currently holds (or nothing), now on the shadcn Popover. viewer.ts owns the
// bespoke facet logic (qfValues — per-category counting/sorting rules) and pick
// routing; this island owns the find-input's local filter state. Every value pick
// makes viewer recompute items and call open() again — open() bumps openId, but the
// body is keyed on sessionId (bumped only on a fresh open), so a pick re-renders in
// place (selected group + find text survive) while opening a different row remounts
// (fresh group/find/focus). Because the find box's local state lives INSIDE the body
// and typing never touches the bridge, filtering-while-focused never remounts either.
//
// Two layouts: a flat single column (platforms/authors/folders/…), and — when the
// items carry tag-group headings (ghead) — an Eagle-style TWO-PANE (group list on
// the left, the selected group's tags as rows on the right). Labels arrive
// already-localized from viewer.

// Flatten items into a render list with group headers / a single "present vs absent"
// divider inserted. On a FLAT facetDim list, one divider marks where present
// (count>0) gives way to absent (count=0); grouped tag lists rely on their group
// headings, fixed lists keep order — neither gets a divider.
function buildRows(items: CorpusQfPopItem[]) {
  const hasGhead = items.some((it) => it.ghead != null);
  const out: QfRow[] = [];
  let sawPresent = false,
    dividerDone = false;
  for (const it of items) {
    if (!hasGhead && !dividerDone && it.facetDim && it.count === 0 && sawPresent) {
      out.push({ type: 'div' });
      dividerDone = true;
    }
    if (it.facetDim && it.count > 0) sawPresent = true;
    out.push(it.ghead != null ? { type: 'ghead', text: it.ghead } : { type: 'row', item: it });
  }
  return out;
}

// Split the flat facet items into tag groups (a ghead marker opens a group; the value
// rows until the next ghead are its members). Returns [] when there are no gheads.
function buildGroups(items: CorpusQfPopItem[]): QfGroup[] {
  const groups: QfGroup[] = [];
  let cur: QfGroup | null = null;
  for (const it of items) {
    if (it.ghead != null) {
      cur = { name: it.ghead, items: [] };
      groups.push(cur);
    } else if (cur) {
      cur.items.push(it);
    }
  }
  return groups;
}

// One value row, shared by both layouts. 0-count rows stay pickable, muted via color.
function ValueRow({ it, onPick }: { it: CorpusQfPopItem; onPick: (it: CorpusQfPopItem) => void }) {
  const off = it.facetDim && it.count === 0;
  return (
    <div className={cn('flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm select-none hover:bg-accent hover:text-accent-foreground', it.sub && 'pl-6 text-xs', (it.sub || off) && 'text-muted-foreground')} onClick={() => onPick(it)}>
      {it.kind && <span className={'tk-dot tk-' + it.kind} data-tip={it.dotTitle} />}
      <span className="min-w-0 flex-1 truncate">{it.l}</span>
      {it.count != null && <span className={cn('shrink-0 text-xs tabular-nums', off ? 'text-muted-foreground/60' : 'text-muted-foreground')}>{it.count}</span>}
      {it.on && <CheckIcon className="size-4 shrink-0" />}
    </div>
  );
}

function QfBody({ model }: { model: CorpusQfPopModel }) {
  const [query, setQuery] = useState('');
  // Selected tag group in two-pane mode: -1 = すべて (all tags), else index into groups.
  const [groupSel, setGroupSel] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!model.showFind) return;
    const t = setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [model.showFind]);
  const fuzzy = useSyncExternalStore(subscribeSearch, isFuzzy);

  const groups = useMemo(() => buildGroups(model.items), [model.items]);
  const twoPane = groups.length > 0;
  // Flat rows for the single-column layout (non-grouped categories).
  const rows = useMemo(() => buildRows(model.items), [model.items]);
  // All tag rows across every group, count-desc then name — the すべて view.
  const allTags = useMemo(() => groups.flatMap((g) => g.items).sort((a, b) => (b.count || 0) - (a.count || 0) || String(a.l).localeCompare(String(b.l), 'ja')), [groups]);

  // 検索方式（通常=部分一致 / あいまい=corpusSearch）はメイン検索と共有。@ プレフィックス
  // は screen name（sn）を対象にする（旧 applyQfFind と同じ規約）。
  const raw = query.trim().toLowerCase();
  const atMode = raw.startsWith('@');
  const q = atMode ? raw.slice(1) : raw;
  const matcher = q && fuzzy ? compile(q) : null;
  const hit = (hay: unknown) => {
    const s = String(hay || '').toLowerCase();
    return matcher ? matcher(s) : s.includes(q);
  };
  const filtering = !!q;
  const matchItem = (it: CorpusQfPopItem) => !filtering || (atMode ? hit(it.sn || '') : hit(it.l));
  // Flat-layout visible list (keeps dividers / any stray gheads when not filtering).
  const visible = rows.filter((r) => {
    if (r.type !== 'row') return !filtering;
    return matchItem(r.item);
  });
  // Two-pane right column: the selected group's tags (すべて = allTags), filtered.
  const paneItems = (groupSel < 0 ? allTags : groups[groupSel] ? groups[groupSel].items : []).filter(matchItem);

  return (
    <>
      {model.showFind && (
        <div className="flex flex-col gap-1.5">
          <Input ref={inputRef} type="text" className="h-7 text-xs" placeholder={model.findPlaceholder} autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
          <ToggleGroup
            value={[fuzzy ? 'fuzzy' : 'normal']}
            onValueChange={(v) => {
              if (v.length) setMode(v[0] as 'fuzzy' | 'normal');
            }}
            variant="outline"
            size="sm"
            spacing={0}
            className="w-full *:flex-1"
            aria-label={model.searchModeTitle}
          >
            <ToggleGroupItem value="fuzzy" className="text-xs" {...tipProps(model.fuzzyHint || '')}>
              {model.fuzzyLabel}
            </ToggleGroupItem>
            <ToggleGroupItem value="normal" className="text-xs" {...tipProps(model.exactHint || '')}>
              {model.exactLabel}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
      {twoPane ? (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-28 max-w-48 shrink-0 overflow-y-auto border-r border-border pr-1 [scrollbar-gutter:stable]">
            <button type="button" className={cn('flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs', groupSel < 0 ? 'bg-accent font-semibold text-accent-foreground' : 'hover:bg-muted')} onClick={() => setGroupSel(-1)}>
              <span className="min-w-0 flex-1 truncate text-left">{model.allGroupLabel}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{allTags.length}</span>
            </button>
            {groups.map((g, gi) => (
              <button key={gi} type="button" className={cn('flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs', groupSel === gi ? 'bg-accent font-semibold text-accent-foreground' : 'hover:bg-muted')} onClick={() => setGroupSel(gi)}>
                <span className="min-w-0 flex-1 truncate text-left">{g.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{g.items.length}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 min-w-[150px] flex-1 overflow-y-auto pl-1 [scrollbar-gutter:stable]">{paneItems.length === 0 ? <div className="px-2 py-1.5 text-muted-foreground">—</div> : paneItems.map((it, i) => <ValueRow key={i} it={it} onPick={model.onPick} />)}</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {visible.filter((r) => r.type === 'row').length === 0 ? (
            <div className="px-2 py-1.5 text-muted-foreground">—</div>
          ) : (
            visible.map((r, i) => {
              if (r.type === 'div') return <div key={i} className="mx-1.5 my-1 h-px bg-border" />;
              if (r.type === 'ghead')
                return (
                  <div key={i} className="pointer-events-none mt-1 border-t border-border px-1.5 pt-2 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground first:mt-0 first:border-t-0 first:pt-1">
                    {r.text}
                  </div>
                );
              return <ValueRow key={i} it={r.item} onPick={model.onPick} />;
            })
          )}
        </div>
      )}
      {model.footerLabel && (
        <div className="shrink-0 border-t border-border pt-1">
          <Button variant="ghost" size="sm" className="w-full justify-start text-primary" onClick={() => (model.onManage as () => void)()}>
            {model.footerLabel}
          </Button>
        </div>
      )}
    </>
  );
}

export function QfPopHost() {
  const model = useSyncExternalStore(subscribe, get);

  // Virtual anchor over the bridge's anchorRect — the flyout opens programmatically
  // beside a sidebar row, with no trigger element. Base UI positions and
  // viewport-clamps it (the old hand-rolled usePlaceFlyout is gone); the popup caps
  // itself to --available-height so a long value list scrolls internally.
  const anchor = useMemo(() => {
    if (!model) return null;
    const r = model.anchorRect;
    return { getBoundingClientRect: () => new DOMRect(r.left, r.top, r.right - r.left, r.bottom - r.top) };
  }, [model]);

  if (!model) return null;
  const twoPane = model.items.some((it) => it.ghead != null);
  // Key the BODY on sessionId (bumped only on a fresh open), NOT openId (bumped on
  // every pick): a value pick re-renders in place so the selected group + find text
  // survive; opening a different row remounts (fresh group/find/focus). Fall back to
  // openId if unset.
  return (
    <Popover
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === 'outside-press') {
          const t = details.event.target as Element | null;
          if (t && t.closest('.sb-row')) return; // the row handler closes-and-reopens itself (avoids a double-close race)
        }
        close();
      }}
    >
      <PopoverContent anchor={anchor} side="right" align="start" sideOffset={8} collisionPadding={8} className={cn('max-h-(--available-height) gap-2 p-2', twoPane ? 'w-max max-w-[min(520px,calc(100vw-24px))]' : 'w-64')}>
        <QfBody key={model.sessionId ?? model.openId} model={model} />
      </PopoverContent>
    </Popover>
  );
}
