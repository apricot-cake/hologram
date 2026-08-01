import { Combobox } from '@base-ui/react/combobox';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { setSelectOpen } from '../services/open-select-registry.ts';
import { normalizeTagName } from '../../../../../native-host/tag-normalize.mts';

// Inline tag editing, in the inspector (P2⑦). Editing used to live in a popover
// anchored to a ✎ / 🏷 button (Issue #22); it is now part of the panel that
// already shows the card, so tagging is a property edit rather than a mode you
// enter — the same shape Linear/Notion give a multi-value property.
//
// Base UI Combobox drives the input and the popup listbox (standard combobox
// keyboard behaviour, no hand-rolled equivalent). It holds no selection of its
// own — the chips are rendered from the record's tags, which are the single copy.
// See onPick for why the primitive's `multiple` selection is deliberately unused.
//
// Filtering is OURS (`filter={null}`) rather than the built-in one, because the
// three groups do not filter alike: co-occurrence suggestions are context hints,
// not vocabulary, so they disappear as soon as the user starts typing (typing
// means "find me a known tag", not "suggest more"). That rule predates this
// component — it came from the old picker — and the built-in filter cannot
// express it.
export interface TagPickItem {
  tag: string;
  kind?: string | null;
  title?: string;
}
export interface TagPickGroup {
  name: string;
  items: TagPickItem[];
}
interface Group {
  value: string;
  items: TagPickItem[];
}

export interface TagFieldProps {
  tags: string[];
  vocabGroups?: TagPickGroup[] | null;
  coocGroups?: TagPickGroup[] | null;
  srcTags?: TagPickItem[] | null;
  labels: Record<string, string>;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  onContextMenu: (tag: string, x: number, y: number) => void;
  /** Put the caret in the field on mount — the card/poster context menu's "Edit tag". */
  autoFocus?: boolean;
}

export function TagField({ tags, vocabGroups, coocGroups, srcTags, labels, onAdd, onRemove, onContextMenu, autoFocus }: TagFieldProps) {
  const [query, setQuery] = useState('');
  const highlightedRef = useRef<string | undefined>(undefined);
  // The popup lies ON the inspector, so Esc has to close it and stop there. The
  // inspector's own Esc handler (inspector-builder) asks this registry before it
  // dismisses the panel; without registering, the first Esc would close the whole
  // panel out from under an open tag popup.
  const popupId = useRef(Symbol('inspector-tag-field'));
  // The "Edit tag" route has to land the caret in the field. Focus the node itself
  // rather than relying on React's autoFocus reaching the <input> through
  // Combobox.Input — the primitive owns that ref, and whether it forwards the prop
  // is its business, not a thing this component should assume. Queried out of the
  // wrapper for the same reason.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    boxRef.current?.querySelector<HTMLInputElement>('[data-slot="tag-input"]')?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const id = popupId.current;
    return () => setSelectOpen(id, false); // unmounting while open must not leave a phantom
  }, []);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (t: string) => !q || t.toLowerCase().includes(q);
    const out: Group[] = [];
    // Context hints only while the field is untouched — see the note above.
    if (!q) for (const g of coocGroups || []) if (g.items.length) out.push({ value: g.name, items: g.items });
    const src = (srcTags || []).filter((it) => matches(it.tag));
    if (src.length) out.push({ value: labels.adoptSource, items: src });
    for (const g of vocabGroups || []) {
      const items = g.items.filter((it) => matches(it.tag));
      if (items.length) out.push({ value: g.name, items });
    }
    return out;
  }, [query, vocabGroups, coocGroups, srcTags, labels.adoptSource]);

  // Picking a row toggles that tag, matching the old picker. The combobox holds NO
  // selection of its own (`value={null}`): the record's tags are the only copy, and
  // the chips below are rendered from them. An earlier version used the combobox's
  // own `multiple` selection with chips supplied by the primitive; the two copies
  // drifted after an async mutation and a single × then removed two tags.
  const onPick = (picked: string | null) => {
    if (picked == null) return;
    if (tags.includes(picked)) onRemove(picked);
    else onAdd(picked);
    setQuery('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    if (highlightedRef.current) return; // Base UI commits the highlighted item instead
    // NFKC + trim (#197) so a freshly typed glyph variant of an existing tag
    // (full-width vs half-width, stray whitespace) lands as the SAME stored
    // tag instead of forking the vocabulary — normalizing here (not just at
    // the DB layer) also makes the `tags.includes(picked)` dup-check in
    // inspector-builder.ts/poster-grid-builder.ts compare like-for-like.
    const typed = normalizeTagName(query);
    if (!typed) return;
    e.preventDefault();
    onAdd(typed); // free text: a tag that isn't in the vocabulary yet
    setQuery('');
  };

  return (
    <Combobox.Root
      items={groups}
      filter={null}
      value={null}
      onValueChange={onPick}
      inputValue={query}
      onInputValueChange={(v) => setQuery(v)}
      onOpenChange={(open) => setSelectOpen(popupId.current, open)}
      onItemHighlighted={(it) => {
        highlightedRef.current = it as string | undefined;
      }}
    >
      {/* Combobox.InputGroup, not a plain div: it registers itself as the combobox's
          anchor, so the suggestion popup lines up with the WHOLE field instead of the
          bare input left of it — which shifted right and narrowed with every chip
          added. Anchoring the popup to the box that holds the chips is what Base UI
          resolves to by default (inputGroupElement ?? inputElement), and matches MUI
          Autocomplete (popper anchored to inputRoot, width synced) and Ant Design
          Select (popupMatchSelectWidth). It also makes a press on the box's padding
          focus the input.
          The rest of the chips parts (Combobox.Chips/Chip/ChipRemove) stay unused:
          ChipRemove writes to the primitive's own selection, which is the second copy
          of the truth this component deliberately does not keep — see onPick. */}
      <Combobox.InputGroup ref={boxRef} className="flex w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
        {tags.map((tag) => (
          <span
            key={tag}
            data-slot="tag-chip"
            data-tag={tag}
            className="inline-flex h-5 items-center gap-1 rounded-4xl bg-secondary px-2 text-xs font-medium text-secondary-foreground"
            // A press anywhere in the InputGroup focuses the input and opens the
            // suggestions (Base UI's own behaviour, and what you want from a click on
            // the box). A right-click is not that press: it is aimed at this chip's
            // kind menu, and letting it through left the suggestion list hanging open
            // behind that menu. Base UI has no precedent to copy here — its own Chip
            // carries no button guard, because upstream chips have no context menu.
            onMouseDown={(e) => {
              if (e.button !== 0) e.stopPropagation();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(tag, e.clientX, e.clientY);
            }}
          >
            {tag}
            <button type="button" className="-mr-0.5 cursor-pointer rounded-full text-muted-foreground hover:text-foreground" aria-label={labels.removeTag} onClick={() => onRemove(tag)}>
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <Combobox.Input data-slot="tag-input" placeholder={tags.length ? '' : labels.newTagPlaceholder} onKeyDown={onKeyDown} className="h-5 min-w-16 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
      </Combobox.InputGroup>
      <Combobox.Portal>
        {/* z-[13500]: above the legacy overlay z-scale while @layer-legacy coexistence lasts. */}
        <Combobox.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="isolate z-[13500]">
          <Combobox.Popup className="max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 font-sans text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground">{query ? labels.noMatch : labels.noVocab}</Combobox.Empty>
            <Combobox.List>
              {(group: Group) => (
                <Combobox.Group key={group.value} items={group.items} className="mb-1 last:mb-0">
                  <Combobox.GroupLabel className="px-2 py-1 text-[11px] text-muted-foreground">{group.value}</Combobox.GroupLabel>
                  {group.items.map((it) => (
                    <Combobox.Item
                      key={it.tag}
                      value={it.tag}
                      className="flex cursor-default items-center gap-1.5 rounded-sm px-2 py-1 text-xs select-none data-highlighted:bg-muted"
                      // No onClick here: pressing an item is what changes the selected
                      // value, which arrives as onValueChange. Handling the press here
                      // TOO would apply the mutation twice.
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onContextMenu(it.tag, e.clientX, e.clientY);
                      }}
                    >
                      {it.kind ? <span className={'tag-pal-kind tk-' + it.kind} /> : null}
                      <span className="min-w-0 flex-1 truncate" title={it.title}>
                        {it.tag}
                      </span>
                    </Combobox.Item>
                  ))}
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
