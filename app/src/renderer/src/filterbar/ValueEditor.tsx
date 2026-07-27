// Value editor for the "+ フィルタ" flow (redesign §3-2 / P2③) — the checklist /
// sectioned-tag two-pane picker for one facet category. Adapted from the retired qf-pop
// island's body: same buildRows/buildGroups/ValueRow rendering and the two-pane for
// sectioned tags (種別: 作品/キャラ/未分類), but driven by a FilterCatValues entry
// (orchestrator's filterCategories) instead of the qf-pop bridge. The picker stays open so several
// values can be toggled in a row; each pick re-reads values() so on/count refresh.
//
// The old ぴったり/おおまか search-mode segment is gone (要決4再改訂 = single smart
// search). The find box is a plain substring filter (with a leading @ scoping to a
// poster's screen name, the one convention worth keeping) — it no longer flips the
// shared search module's mode as a side effect.
import { CheckIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { beginFilterEditSession, endFilterEditSession, type FacetMode, type FilterCatValues, type FilterRow } from '../../renderer/orchestrator.ts';
import { t } from '../_shared/i18n.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

// The facet's operator/exclusion mode (redesign §4-2 B, Linear「is any of / all of /
// is not」). multi-value facets (tag/hashtag/folder) offer the 3-way どれか/すべて/
// 〜以外; every other value facet offers the 2-way どれか/〜以外 (すべて is moot when the
// type never clusters). One vocabulary throughout (どれか/すべて/〜以外) so the segment
// and the chip's mode word read the same. Selecting a side rewrites the facet via setMode.
function ModeSeg({ cat, mode, onPick }: { cat: FilterCatValues; mode: FacetMode; onPick: (m: FacetMode) => void }) {
  const opts: { m: FacetMode; label: string }[] = cat.multi
    ? [
        { m: 'or', label: t('qbOptAny') },
        { m: 'and', label: t('qbOptAll') },
        { m: 'exclude', label: t('fbModeExclude') },
      ]
    : [
        { m: 'or', label: t('qbOptAny') },
        { m: 'exclude', label: t('fbModeExclude') },
      ];
  return (
    <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
      {opts.map((o) => (
        <button key={o.m} type="button" className={cn('flex-1 rounded px-2 py-0.5 text-xs', mode === o.m ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')} onClick={() => onPick(o.m)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Row = { type: 'div' } | { type: 'ghead'; text: string } | { type: 'row'; item: FilterRow };
type Group = { name: string; items: FilterRow[] };

// Flatten items into a render list with group headers / a single present↔absent
// divider inserted (flat facetDim lists only; grouped/fixed lists keep their order).
function buildRows(items: FilterRow[]): Row[] {
  const hasGhead = items.some((it) => it.ghead != null);
  const out: Row[] = [];
  let sawPresent = false;
  let dividerDone = false;
  for (const it of items) {
    if (!hasGhead && !dividerDone && it.facetDim && it.count === 0 && sawPresent) {
      out.push({ type: 'div' });
      dividerDone = true;
    }
    if (it.facetDim && (it.count as number) > 0) sawPresent = true;
    out.push(it.ghead != null ? { type: 'ghead', text: it.ghead } : { type: 'row', item: it });
  }
  return out;
}

// Split the flat items into sections (a ghead opens a section; the rows until the next
// ghead are its members). Returns [] when there are no gheads (→ flat layout).
function buildGroups(items: FilterRow[]): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  for (const it of items) {
    if (it.ghead != null) {
      cur = { name: it.ghead, items: [] };
      groups.push(cur);
    } else if (cur) cur.items.push(it);
  }
  return groups;
}

// One value row, shared by both layouts. 0-count rows stay pickable, muted via color.
function ValueRow({ it, onPick }: { it: FilterRow; onPick: (it: FilterRow) => void }) {
  const sub = !!it.sub;
  const off = !!(it.facetDim && it.count === 0);
  return (
    <div className={cn('flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm select-none hover:bg-accent hover:text-accent-foreground', sub && 'pl-6 text-xs', (sub || off) && 'text-muted-foreground')} onClick={() => onPick(it)}>
      {it.kind ? <span className={'tk-dot tk-' + it.kind} data-tip={(it.dotTitle as string) || ''} /> : null}
      <span className="min-w-0 flex-1 truncate">{it.l as string}</span>
      {it.count != null ? <span className={cn('shrink-0 text-xs tabular-nums', off ? 'text-muted-foreground/60' : 'text-muted-foreground')}>{it.count as number}</span> : null}
      {it.on ? <CheckIcon className="size-4 shrink-0" /> : null}
    </div>
  );
}

export function ValueEditor({ cat, onManage }: { cat: FilterCatValues; onManage: (fn: () => void) => void }) {
  // One mounted editor = one nav-history entry (#144 確定未決2): bracket the mount
  // so every pick in this session coalesces into the entry the first pick pushed.
  // The parent keys this per category, so switching categories restarts the session.
  useEffect(() => {
    beginFilterEditSession();
    return endFilterEditSession;
  }, []);
  // Re-read values() after every pick so on/count reflect the mutated tree in place.
  // The parent remounts this per category (key=cat), so lazy init is the fresh read.
  const [items, setItems] = useState<FilterRow[]>(cat.values);
  // The mode is a UI intent that persists across picks (seeded from the live tree at
  // mount). In 〜以外 mode a fresh pick lands positive, so re-negate the facet to keep
  // the whole thing excluded (setMode is idempotent for already-negated values).
  const [mode, setMode] = useState<FacetMode>(cat.mode());
  const pick = (it: FilterRow) => {
    cat.pick(it);
    if (mode === 'exclude') cat.setMode('exclude');
    setItems(cat.values());
  };
  // Seeded from the live tree at mount, same as the mode above (the editor is keyed
  // per category, so a fresh mount is a fresh read).
  const [only, setOnly] = useState(() => !!cat.only?.get());
  const applyOnly = (v: boolean) => {
    cat.only?.set(v);
    setOnly(v);
    setItems(cat.values());
  };
  const applyMode = (m: FacetMode) => {
    cat.setMode(m);
    setMode(m);
    setItems(cat.values());
  };

  const [query, setQuery] = useState('');
  const [groupSel, setGroupSel] = useState(-1); // -1 = すべて, else index into groups
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!cat.showFind) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [cat.showFind]);

  const groups = useMemo(() => buildGroups(items), [items]);
  const twoPane = groups.length > 0;
  const rows = useMemo(() => buildRows(items), [items]);
  const allTags = useMemo(() => groups.flatMap((g) => g.items).sort((a, b) => ((b.count as number) || 0) - ((a.count as number) || 0) || String(a.l).localeCompare(String(b.l), 'ja')), [groups]);

  // Single smart match: plain substring (a leading @ scopes to screen name, sn).
  const raw = query.trim().toLowerCase();
  const atMode = raw.startsWith('@');
  const q = atMode ? raw.slice(1) : raw;
  const filtering = !!q;
  const hit = (hay: unknown) =>
    String(hay ?? '')
      .toLowerCase()
      .includes(q);
  const matchItem = (it: FilterRow) => !filtering || (atMode ? hit(it.sn) : hit(it.l));
  const visible = rows.filter((r) => (r.type !== 'row' ? !filtering : matchItem(r.item)));
  const paneItems = (groupSel < 0 ? allTags : groups[groupSel] ? groups[groupSel].items : []).filter(matchItem);

  return (
    <div className={cn('flex max-h-(--available-height) flex-col gap-2 p-2', twoPane ? 'w-max max-w-[min(520px,calc(100vw-24px))]' : 'w-64')}>
      <ModeSeg cat={cat} mode={mode} onPick={applyMode} />
      {/* Folder facet only (#41). It sits with the mode segment because it shapes what
          the condition MEANS, not which values are in it — a folder covers its
          subfolders unless this says otherwise. A switch rather than a fourth segment:
          it is orthogonal to どれか/すべて/〜以外, and combines with all three. */}
      {cat.only ? (
        <label className="flex cursor-default items-center justify-between gap-2 px-1 text-xs select-none">
          <span>{t('foldOnly')}</span>
          <Switch checked={only} onCheckedChange={applyOnly} />
        </label>
      ) : null}
      {cat.showFind ? <Input ref={inputRef} type="text" className="h-7 text-xs" placeholder={t('qfFindPh')} autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} /> : null}
      {twoPane ? (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-28 max-w-48 shrink-0 overflow-y-auto border-r border-border pr-1 [scrollbar-gutter:stable]">
            <button type="button" className={cn('flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs', groupSel < 0 ? 'bg-accent font-semibold text-accent-foreground' : 'hover:bg-muted')} onClick={() => setGroupSel(-1)}>
              <span className="min-w-0 flex-1 truncate text-left">{t('qfAllTags')}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{allTags.length}</span>
            </button>
            {groups.map((g, gi) => (
              <button key={gi} type="button" className={cn('flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs', groupSel === gi ? 'bg-accent font-semibold text-accent-foreground' : 'hover:bg-muted')} onClick={() => setGroupSel(gi)}>
                <span className="min-w-0 flex-1 truncate text-left">{g.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{g.items.length}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 min-w-[150px] flex-1 overflow-y-auto pl-1 [scrollbar-gutter:stable]">{paneItems.length === 0 ? <div className="px-2 py-1.5 text-muted-foreground">—</div> : paneItems.map((it, i) => <ValueRow key={i} it={it} onPick={pick} />)}</div>
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
              return <ValueRow key={i} it={r.item} onPick={pick} />;
            })
          )}
        </div>
      )}
      {cat.manage ? (
        <div className="shrink-0 border-t border-border pt-1">
          <Button variant="ghost" size="sm" className="w-full justify-start text-primary" onClick={() => onManage(cat.manage as () => void)}>
            {t('ctxManage')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
