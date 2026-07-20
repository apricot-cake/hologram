// The toolbar search field — Base UI Autocomplete owning the input + suggest
// popup (P2④: the react-aria ComboBox is retired, and with it the last
// react-aria-components consumer). The value source is hologramStore
// 'searchQuery': typing pushes into the store; programmatic writes (resets /
// tab & history restore) flow back into the controlled input. Suggestion DATA
// (buildSuggest) and what a pick DOES (search-editing's pick/confirm) stay in
// the orchestrator, pulled lazily through the searchbox bridge. Focus for the
// `/` / Ctrl+K shortcut is a registered callback on the same bridge — no
// #searchBox id contract (#153 zero-tolerance: no cross-boundary
// getElementById).
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Folder, Tag, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';
import { handlers as sbHandlers, registerFocus } from '../../renderer/searchbox.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../../renderer/store.ts';

// Suggestion rows from the orchestrator's buildSuggest (via the searchbox
// bridge), plus the id the list keys on.
interface SugRow {
  id: string;
  kind: string;
  value: string;
  label: string;
  note?: string;
}

const SUG_ICON: Record<string, ComponentType<{ className?: string }>> = { tag: Tag, user: User, folder: Folder };
const handlers = () => sbHandlers() || null;

export function SearchBox({ placeholder }: { placeholder?: string }) {
  const subscribe = useCallback((cb: () => void) => storeSubscribe('searchQuery', cb), []);
  const value = useSyncExternalStore(subscribe, () => String(storeGet('searchQuery') || ''));
  // Highlight tracking for bare Enter: with an item highlighted Base UI commits
  // it (the Item's onClick fires), so onKeyDown must only confirm free text when
  // nothing is highlighted. Tracked via onItemHighlighted — state, not DOM
  // sniffing (the old aria-activedescendant probe).
  const highlightedRef = useRef<SugRow | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // `/` / Ctrl+K focus the search box; the shortcut handler lives in the
  // orchestrator (GlobalShortcuts registration) and calls the bridge's
  // focusSearchBox(), which runs this registered callback.
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

  // Suggestions are derived synchronously from the value (buildSuggest is a fast
  // pure scan; the HEAVY typing side effect — re-filtering the grid — stays
  // debounced in search-box-builder). Deriving instead of setState keeps the
  // popup in lockstep: any path that empties the value empties the collection,
  // and the popup hides itself via data-empty.
  const items = useMemo<SugRow[]>(() => {
    const h = handlers();
    const q = value.trim();
    if (!q || !h) return [];
    return h.getSuggestions(q).map((it) => ({ ...it, id: it.kind + ':' + it.value }));
  }, [value]);

  const pick = (it: SugRow) => {
    const h = handlers();
    if (h) h.onPick({ kind: it.kind, value: it.value, label: it.label }); // orchestrator: drop the editing text leaf + addFilter (clears the value too)
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
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
      // mode="none": buildSuggest already filters against the query — Base UI
      // must not re-filter the rows or write the active item into the input.
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
    >
      <Autocomplete.Input
        ref={inputRef}
        aria-label={placeholder}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        // Input field anatomy = components/ui/input.tsx; pl-8 clears the
        // magnifier the toolbar overlays at left-2.5.
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pr-2.5 pl-8 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
      />
      <Autocomplete.Portal>
        {/* z-[13500]: above the legacy overlay z-scale while @layer-legacy coexistence
            lasts (same slot every shadcn portal surface uses — see popover.tsx). */}
        <Autocomplete.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="isolate z-[13500]">
          <Autocomplete.Popup className="w-(--anchor-width) max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 font-sans text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[empty]:hidden">
            <Autocomplete.List>
              {(it: SugRow) => {
                const Icon = SUG_ICON[it.kind] || Tag;
                return (
                  <Autocomplete.Item key={it.id} value={it} onClick={() => pick(it)} className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 select-none data-highlighted:bg-muted">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{it.note}</span>
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
