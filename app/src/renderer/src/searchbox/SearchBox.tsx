// The toolbar search field — Base UI Autocomplete owning the input + suggest
// popup (P2④: the react-aria ComboBox is retired, and with it the last
// react-aria-components consumer). The value source is hologramStore
// 'searchQuery': typing pushes into the store; programmatic writes (resets /
// tab & history restore) flow back into the controlled input. Focus for the
// `/` shortcut is a registered callback on the searchbox bridge — no
// #searchBox id contract (#153 zero-tolerance: no cross-boundary
// getElementById).
//
// Suggestion DATA comes from the command registry (#28): this box is one of the
// three faces over ONE candidate engine (the others are the palette and #148's
// chip-bar inline input), so the rows, their order and their section labels are
// whatever queryEntries() says. What differs per face is only which sections it
// shows, how many, and what confirming does — here, the same "AND onto the
// current tab" pick the palette's jump entries run, because the entry carries its
// own perform(). Bare Enter (nothing highlighted) still confirms the free text as
// a query-tree leaf, which is this face's own default and stays on the bridge.
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Tag, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';
import { type CommandEntry, type CommandSection, type QueryOptions, queryEntries } from '../services/command-registry.ts';
import { handlers as sbHandlers, registerFocus } from '../services/searchbox.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../services/store.ts';

// This face's顔ぶれ: tags and posters only (the palette adds commands, tabs and
// folders). The counts are the ones the old buildSuggest used — a dropdown under a
// live-filtering input has room for a handful, not a page.
const SUGGEST: QueryOptions = { sections: ['tag', 'user'], limit: { tag: 6, user: 4 } };

const SUG_ICON: Partial<Record<CommandSection, ComponentType<{ className?: string }>>> = { tag: Tag, user: User };
const handlers = () => sbHandlers() || null;

export function SearchBox({ placeholder }: { placeholder?: string }) {
  const subscribe = useCallback((cb: () => void) => storeSubscribe('searchQuery', cb), []);
  const value = useSyncExternalStore(subscribe, () => String(storeGet('searchQuery') || ''));
  // Highlight tracking for bare Enter: with an item highlighted Base UI commits
  // it (the Item's onClick fires), so onKeyDown must only confirm free text when
  // nothing is highlighted. Tracked via onItemHighlighted — state, not DOM
  // sniffing (the old aria-activedescendant probe).
  const highlightedRef = useRef<CommandEntry | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // `/` focuses the search box; the shortcut handler lives in the orchestrator
  // (GlobalShortcuts registration) and calls the bridge's focusSearchBox(), which
  // runs this registered callback. Ctrl+K is the palette's now (#28) — the badge
  // AppToolbar draws at this field's right edge is what teaches the split.
  useEffect(
    () =>
      registerFocus(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      }),
    [],
  );

  // Suggestions are derived synchronously from the value (the registry's providers
  // are fast pure scans; the HEAVY typing side effect — re-filtering the grid —
  // stays debounced in search-box-builder). Deriving instead of setState keeps the
  // popup in lockstep: any path that empties the value empties the collection,
  // and the popup hides itself via data-empty.
  const items = useMemo<CommandEntry[]>(() => {
    const q = value.trim();
    if (!q) return [];
    return queryEntries(q, SUGGEST).flatMap((group) => group.items);
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // IME 変換中の Enter は変換の確定であって検索の確定ではない。Base UI 側は自分の
    // Enter 処理を which=229 で弾いているが、この handler は Base UI より先に走る
    // ので、こちらでも見る必要がある（#28 で足した）。
    if (e.nativeEvent.isComposing) return;
    // A highlighted item means Base UI commits it (→ the Item's onClick). Bare
    // Enter confirms the free-text term as a query-tree leaf (search-editing's
    // confirm path — it also empties the box, closing the popup).
    if (highlightedRef.current) return;
    e.preventDefault();
    const h = handlers();
    if (h) h.onConfirmText();
  };

  return (
    <Autocomplete.Root
      // mode="none": the registry already filtered the rows against the query —
      // Base UI must not re-filter them or write the active item into the input.
      mode="none"
      items={items}
      value={value}
      onValueChange={(v, details) => {
        // An item press echoes the item's label into the input; the pick itself
        // already cleared the value through the store — swallow the echo.
        if (details.reason === 'item-press') return;
        storeSet('searchQuery', v);
      }}
      onItemHighlighted={(it) => {
        highlightedRef.current = it;
      }}
      itemToStringValue={(entry: CommandEntry) => entry.title}
    >
      <Autocomplete.Input
        ref={inputRef}
        aria-label={placeholder}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        // Input field anatomy = components/ui/input.tsx; pl-8 clears the
        // magnifier the toolbar overlays at left-2.5, pr-16 the Ctrl+K badge it
        // overlays at right-1.5.
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pr-16 pl-8 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
      />
      <Autocomplete.Portal>
        {/* z-[13500]: above the legacy overlay z-scale while @layer-legacy coexistence
            lasts (same slot every shadcn portal surface uses — see popover.tsx). */}
        <Autocomplete.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="isolate z-[13500]">
          <Autocomplete.Popup className="w-(--anchor-width) max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 font-sans text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[empty]:hidden">
            <Autocomplete.List>
              {(entry: CommandEntry) => {
                const Icon = SUG_ICON[entry.section] || Tag;
                return (
                  // The entry's own perform() — the palette's jump entries run the
                  // same closure, so a pick means the same thing on both faces.
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
  );
}
