import { subscribeSearch, searchRevision } from '../services/search-results.ts';
import { subscribe as subscribePosts, getGeneration } from '../services/posts-data.ts';
import type { MessageKey } from '../services/translation.ts';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Folder, Plus, Tag, User } from 'lucide-react';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';
import { t } from '../_shared/i18n.ts';
import { type SuggestionSection, type QueryOptions, queryEntries } from '../services/search-suggestions.ts';
import { addFilterToCurrentView } from '../services/orchestrator.ts';

const POST_SECTIONS: QueryOptions = { sections: ['tag', 'user', 'folder'], limit: { tag: 6, user: 4, folder: 4 } };
const POSTER_SECTIONS: QueryOptions = { sections: ['tag', 'folder'], limit: { tag: 6, folder: 4 } };

type RowSection = SuggestionSection;

interface Row {
  id: string;
  section: RowSection;
  title: string;
  hint?: string;
  commit(): void;
}

const ROW_ICON: Partial<Record<RowSection, ComponentType<{ className?: string }>>> = { tag: Tag, user: User, folder: Folder };
// 行の頭に置く種別の語。1つのポップアップが複数の種別を混ぜるので、アイコンだけでは
// 「タグ: 猫」と「投稿者: 猫」を見分けられない（Issue 自身の例そのまま＝「タグ: ハグ」）。
const ROW_LABEL: Partial<Record<RowSection, MessageKey>> = { tag: 'suggestionTag', user: 'suggestionUser', folder: 'suggestionFolder' };

export function InlineFilterInput({ posters }: { posters: boolean }) {
  const searchVersion = useSyncExternalStore(subscribeSearch, searchRevision);
  const generation = useSyncExternalStore(subscribePosts, getGeneration);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 非同期の検索結果が届いた世代で候補を再取得する。
  const rows = useMemo<Row[]>(() => {
    const q = query.trim();
    if (!q) return [];
    const out: Row[] = queryEntries(q, posters ? POSTER_SECTIONS : POST_SECTIONS).flatMap((group) =>
      group.items.map((entry) => ({
        id: entry.id,
        section: entry.section,
        title: entry.title,
        hint: entry.hint,
        commit: () => (entry.filter ? addFilterToCurrentView(entry.filter) : entry.perform()),
      })),
    );
    return out;
  }, [query, posters, searchVersion, generation]);

  const close = () => {
    setQuery('');
    setEditing(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // IME の変換中の Enter と Esc は変換の操作であって、この面に対する操作ではない。
    // Base UI も which=229 で Enter を塞ぐが、このハンドラの方が先に走るので、両方で
    // 見なければならない（#28 と同じ落とし穴）。
    if (e.nativeEvent.isComposing) return;
    // Esc は候補のポップアップだけでなく入力欄ごと閉じ、「+」へ戻す（候補が1つも無いときは
    // ポップアップが開いていない＝Base UI の消去が走らない＝ので、これが唯一の逃げ道）。
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  if (!editing)
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-slot="filter-add-inline"
              // アイコンだけの「+」（帯の末尾に置く小さな追加の入り口）。境界線は持たない＝この帯の
              // 破線の境界線は「除く」チップの印なので、追加の入り口が同じ顔を着ていると、除外の
              // 条件がそこに立っているように読める（隣の検索の保存と同じ ghost のスタイルに揃えて
              // ある）。
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label={t('fbAddFilter')}
              onClick={() => setEditing(true)}
            />
          }
        >
          <Plus className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>{t('fbAddFilter')}</TooltipContent>
      </Tooltip>
    );

  return (
    <Autocomplete.Root
      mode="none"
      autoHighlight
      items={rows}
      value={query}
      onValueChange={(v, details) => {
        // 選んだ項目のラベルは入力欄へ書き戻される。この面は確定した瞬間に閉じるので、
        // それを拾わない。
        if (details.reason === 'item-press') return;
        setQuery(v);
      }}
      onOpenChange={(open, details) => {
        // 外側のクリック、フォーカスを失うこと、Esc は入力欄ごと畳む（空の欄が開きっぱなしで
        // 帯に居残らないように）。判断は Base UI に任せる＝ポップアップは portal の外にいる
        // ので、自前の blur の検査は候補のクリックと競走してしまう。
        if (open) return;
        if (details.reason === 'outside-press' || details.reason === 'focus-out' || details.reason === 'escape-key') close();
      }}
      itemToStringValue={(row: Row) => row.title}
    >
      <Autocomplete.Input ref={inputRef} autoFocus aria-label={t('fbAddFilter')} placeholder={t('fbAddFilterPh')} onKeyDown={onKeyDown} className="h-7 w-44 min-w-0 rounded-md border border-input bg-background px-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring md:text-sm" />
      <Autocomplete.Portal>
        {/* z-[13500]: 旧来の z の段より上（shadcn の portal の画面が共有する層）。 */}
        <Autocomplete.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="isolate z-[13500]">
          <Autocomplete.Popup className="max-h-(--available-height) w-72 max-w-[calc(100vw-24px)] origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 font-sans text-popover-foreground text-sm shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[empty]:hidden data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            <Autocomplete.List>
              {(row: Row) => {
                const Icon = ROW_ICON[row.section] || Tag;
                const label = ROW_LABEL[row.section];
                return (
                  <Autocomplete.Item
                    key={row.id}
                    value={row}
                    onClick={() => {
                      row.commit();
                      close();
                    }}
                    className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 data-highlighted:bg-muted"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    {label ? <span className="shrink-0 text-muted-foreground text-xs">{t(label)}</span> : null}
                    <span className="min-w-0 flex-1 truncate">{row.title}</span>
                    {row.hint ? <span className="shrink-0 text-muted-foreground text-xs">{row.hint}</span> : null}
                  </Autocomplete.Item>
                );
              }}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
