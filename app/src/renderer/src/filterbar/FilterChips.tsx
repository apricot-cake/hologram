// Active-filter chips (redesign §3-2 / P2③ タスク2) — the "predicate" made visible.
// One chip per active facet (Linear型 1 ファセット 1 チップ): a leading category glyph,
// an optional mode word (すべて/どれか/〜以外), the value list, and a trailing ✕ that
// clears the whole facet. Clicking the chip body reopens THAT facet's editor — the very
// same ValueEditor / FormEditor the "+ フィルタ" flow uses — in a Popover anchored to the
// chip. This replaces the retired query-chips component's cluster pills (改訂④ の
// クラスタ枠＋すべて/どれか seg＋値ごと✕); すべて/どれか and 除外 now live inside the editor.
// Free-text terms (the search box's confirmed leaves) are the one exception: one chip
// per term, ✕ only (no editor) — P2④.
//
// Data: orchestrator.activeFilters() derives the chips from the active query tree; the
// component subscribes to the postQueryTree/posterQueryTree store keys (written on every
// tree mutation) and recomputes. The editor for a click is looked up from
// filterCategories() by the chip's `cat` (a fresh read, like the "+ フィルタ" menu).
import { Bookmark, X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { type ActiveFilter, activeFilters, type FilterCat, filterCategories, saveCurrentSearch } from '../services/orchestrator.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';
import { CatIcon } from './index.tsx';
import { promptName } from '../prompt/Prompt.tsx';
import { FormEditor } from './FormEditor.tsx';
import { InlineFilterInput } from './InlineFilterInput.tsx';
import { ValueEditor } from './ValueEditor.tsx';
import { t } from '../_shared/i18n.ts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// One subscription over browseMode + both query trees; the snapshot is the active
// mode's tree (a stable ref between mutations — store.set only replaces it on a real
// change), so useSyncExternalStore re-renders on a tree edit or a mode switch, and
// ignores edits to the inactive mode's tree.
const TREE_KEYS = ['browseMode', 'postQueryTree', 'posterQueryTree'] as const;
const subActive = (cb: () => void) => {
  const unsubs = TREE_KEYS.map((k) => storeSubscribe(k, cb));
  return () => {
    for (const u of unsubs) u();
  };
};
const getActive = () => storeGet(storeGet('browseMode') === 'posters' ? 'posterQueryTree' : 'postQueryTree');

// The mode word shown inside the chip: 〜以外 for exclusions, すべて for an AND cluster,
// どれか for a 2+-value OR cluster. A lone positive value needs no word (「タグ: 猫」).
function modeWord(f: ActiveFilter): string {
  if (f.mode === 'exclude') return t('fbModeExclude');
  if (f.mode === 'and') return t('qbOptAll');
  if (f.mode === 'or' && f.values.length > 1) return t('qbOptAny');
  return '';
}

function Chip({ f }: { f: ActiveFilter }) {
  const [open, setOpen] = useState(false);
  // Resolve the editor category fresh on each open (counts/vocab/mode change between
  // opens), mirroring the "+ フィルタ" menu. null → the facet has no editor (shouldn't
  // happen for an emitted chip, but keeps the click a no-op rather than a crash).
  const [cat, setCat] = useState<FilterCat | null>(null);
  const handleOpen = (o: boolean) => {
    // No editor category (free-text term chips, P2④) → the click stays a no-op
    // instead of opening an empty popover; the ✕ is the chip's only action.
    if (o && !filterCategories().some((c) => c.cat === f.cat)) return;
    setOpen(o);
    if (o) setCat(filterCategories().find((c) => c.cat === f.cat) ?? null);
  };
  const word = modeWord(f);
  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <span data-slot="filter-chip" className={f.mode === 'exclude' ? 'inline-flex h-7 items-center rounded-md border border-dashed border-border bg-background pr-0.5 pl-1.5 text-sm' : 'inline-flex h-7 items-center rounded-md border border-border bg-background pr-0.5 pl-1.5 text-sm'}>
        <PopoverTrigger render={<button type="button" className="flex min-w-0 items-center gap-1" />}>
          <CatIcon cat={f.type} />
          {word ? <span className="shrink-0 text-xs text-muted-foreground">{word}</span> : null}
          <span className="min-w-0 truncate">{f.values.join('・')}</span>
        </PopoverTrigger>
        <button type="button" className="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label={t('qfDelete')} onClick={() => f.remove()}>
          <X className="size-3.5" />
        </button>
      </span>
      <PopoverContent align="start" sideOffset={6} collisionPadding={8} className="w-max max-w-[min(520px,calc(100vw-24px))] p-0">
        {cat ? (
          cat.editor === 'values' ? (
            <ValueEditor
              cat={cat}
              onManage={(fn) => {
                setOpen(false);
                fn();
              }}
            />
          ) : (
            <FormEditor cat={cat} onClose={() => setOpen(false)} />
          )
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// 検索を保存 (#40) — the trailing action of the chip row, Linear's「保存ビュー」position.
// It rides with the chips: no chips means nothing to save, so the row (and this button)
// is absent. Post-side only — a saved search is a post query.
function SaveSearchButton() {
  // No success toast: the new row appears in the sidebar, and the redesign charter
  // says a change you can see is not a change to announce.
  const onClick = () => promptName(t('saveSearchPrompt'), '', (name) => saveCurrentSearch(name));
  return (
    <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground text-sm hover:bg-accent hover:text-accent-foreground" onClick={onClick}>
      <Bookmark className="size-3.5" />
      {t('saveSearch')}
    </button>
  );
}

export function FilterChips() {
  // Re-render whenever the active query tree (or browse mode) changes; activeFilters()
  // then re-derives the chips from that live tree. The subscription is the whole point
  // of this call — its snapshot isn't read directly. activeFilters is assigned by
  // orchestrator.ts's boot IIFE; guard the first render (pre-boot the tree is empty
  // anyway, so [] is correct).
  useSyncExternalStore(subActive, getActive);
  const chips = activeFilters ? activeFilters() : [];
  // Zero chips = nothing to draw (#674): the band used to stay mounted with a
  // 「＋ 絞り込みを追加」hint filling the empty state, but that duplicated the "+ フィルタ"
  // button's job. The other three entry points (AddFilterButton, the search-box suggest,
  // and Ctrl+K) already cover starting a filter from scratch, so with no active filter
  // the band itself has nothing left to show and is unmounted rather than left as an
  // empty 40px row. The accepted tradeoff is that the grid shifts down when the first
  // chip appears — no transition softens that, per the Issue's decision.
  if (chips.length === 0) return null;
  const posters = storeGet('browseMode') === 'posters';
  return (
    <div data-slot="filter-chips" className="flex flex-wrap items-center gap-1.5 py-1.5">
      {chips.map((f, i) => (
        // values (and the index — duplicate confirmed terms are legal) in the key:
        // free-text chips are one PER term (same cat+mode), and a term edit must
        // remount its chip so the values line stays the chip's identity.
        <Chip key={f.cat + ':' + f.mode + ':' + i + ':' + f.values.join(' ')} f={f} />
      ))}
      <InlineFilterInput posters={posters} />
      {/* Post side only — a saved search is a post query. */}
      {!posters && <SaveSearchButton />}
    </div>
  );
}
