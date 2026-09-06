import { Autocomplete } from '@base-ui/react/autocomplete';
import { Search, Tag, User, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { t } from '../_shared/i18n.ts';
import { type SearchSuggestion, type SuggestionSection, type QueryOptions, queryEntries } from '../services/search-suggestions.ts';
import { registerFocus } from '../services/searchbox.ts';
import { store, subscribeKey } from '../services/store.ts';

const SUGGEST: QueryOptions = { sections: ['tag', 'user'], limit: { tag: 6, user: 4 } };

const SUG_ICON: Partial<Record<SuggestionSection, ComponentType<{ className?: string }>>> = { tag: Tag, user: User };

export function SearchBox({ placeholder }: { placeholder?: string }) {
  const subscribe = useCallback((cb: () => void) => subscribeKey('searchQuery', cb), []);
  const value = useSyncExternalStore(subscribe, () => store.getState().searchQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const focus = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => registerFocus(focus), [focus]);

  // 候補は確定済みの入力から導く。IME変換中の値はAutocompleteが保持する。
  const items = useMemo<SearchSuggestion[]>(() => {
    const q = value.trim();
    if (!q) return [];
    return queryEntries(q, SUGGEST).flatMap((group) => group.items);
  }, [value]);

  return (
    <div className="relative w-full min-w-0">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Autocomplete.Root
        // mode="none": レジストリが問い合わせに対して行を絞り込み済み＝Base UI がそれを絞り
        // 込み直したり、選択中の項目を入力欄へ書き込んだりしてはいけない。
        mode="none"
        items={items}
        value={value}
        onValueChange={(v, details) => {
          // 項目を押すと、その項目のラベルが入力欄へ反響する。選択そのものはストアを通して
          // 既に値を空にしているので、この反響は飲み込む。
          if (details.reason === 'item-press') return;
          store.setState({ searchQuery: v });
        }}
        itemToStringValue={(entry: SearchSuggestion) => entry.title}
      >
        <Autocomplete.Input
          ref={inputRef}
          aria-label={placeholder}
          placeholder={placeholder}
          className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pr-9 pl-8 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        />
        <Autocomplete.Portal>
          {/* z-[13500]: @layer-legacy との同居が続く間、旧オーバーレイの z 尺より上に置く
            （shadcn のポータルの面がどれも使うのと同じ場所＝popover.tsx を参照）。 */}
          <Autocomplete.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="isolate z-[13500]">
            <Autocomplete.Popup className="w-(--anchor-width) max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 font-sans text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[empty]:hidden">
              <Autocomplete.List>
                {(entry: SearchSuggestion) => {
                  const Icon = SUG_ICON[entry.section] || Tag;
                  return (
                    <Autocomplete.Item key={entry.id} value={entry} onClick={() => entry.perform()} className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 select-none data-highlighted:bg-muted">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{entry.hint}</span>
                    </Autocomplete.Item>
                  );
                }}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
      {value ? (
        <button
          type="button"
          aria-label={t('searchClear')}
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            store.setState({ searchQuery: '' });
            inputRef.current?.focus();
          }}
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
