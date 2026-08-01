// Inline input for the chip band (#148) = the third face of "type → kind candidates →
// chip it".
//
// Pressing the "+" at the end of the band opens a one-line input field right there, and
// candidates matching what's typed (tag / poster / folder) pop up below, along with the
// permanent bottom-row escape hatch "Search body text: "…"". Picking one adds a chip and
// closes the input field, returning to "+" — the band stays one line. The band itself only
// exists when it has one or more chips (#674), so this face has no face other than the
// icon-only "+" — the empty-state guidance is handled by the "+ Filter" button, the search
// box's suggestions, and Ctrl+K.
//
// Candidates are pulled from services/command-registry.ts's queryEntries — **the same one
// engine** as the search box's suggestions and the command palette (ADR 0016). The only two
// things this face decides for itself are ① which sections to show how many of, and ② what
// happens on commit; it owns none of the candidate generation, ordering, or kind labels.
//
// Commit is entry.filter → the orchestrator's addFilterToCurrentView (= the addFilter of
// whichever view is currently showing). It doesn't go through the search box's pick,
// because that one empties the input field and discards the half-typed body-text term on
// the assumption that "what's typed is meant to narrow a search" — the chip band's input is
// not a body-text-search field, so it must not get caught up in that. Candidates with no
// filter (jumping to a folder) fall through to the entry's own perform().
//
// The shell is the same Base UI Autocomplete as SearchBox (input field + portal popup).
// It's not the palette's `inline` mode, because that one is a face that lays the whole
// list out across the full window, while this one is a face that drops a dropdown below a
// one-line input field.
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Folder, Plus, Search, Tag, User } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';
import { t } from '../_shared/i18n.ts';
import { type CommandSection, type QueryOptions, queryEntries } from '../services/command-registry.ts';
import { addFilterToCurrentView } from '../services/orchestrator.ts';

// This face's lineup. The count follows the same thinking as the search box (a dropdown
// directly under the input field can't stretch vertically — the palette's convention of
// showing everything that matched can't be taken here). The poster view has no "poster"
// candidate kind (a poster is the row itself), so it's just tag / folder.
const POST_SECTIONS: QueryOptions = { sections: ['tag', 'user', 'folder'], limit: { tag: 6, user: 4, folder: 4 } };
const POSTER_SECTIONS: QueryOptions = { sections: ['tag', 'folder'], limit: { tag: 6, folder: 4 } };

// "Search body text" is not a registry candidate — it's this face's default action turned
// into a row, an escape hatch you can always pick even for a term that matches nothing in
// the population. The poster view has no body text (poster's predicates have no text
// type), so it's not shown there.
type RowSection = CommandSection | 'text';

interface Row {
  id: string;
  section: RowSection;
  title: string;
  hint?: string;
  commit(): void;
}

const ROW_ICON: Partial<Record<RowSection, ComponentType<{ className?: string }>>> = { tag: Tag, user: User, folder: Folder, text: Search };
// The kind word at the head of a row. A single popup mixes multiple kinds, so an icon
// alone can't distinguish "tag: cat" from "poster: cat" (straight from the Issue's own
// example — "tag: hug").
const ROW_LABEL: Partial<Record<RowSection, string>> = { tag: 'paletteSecTag', user: 'paletteSecUser', folder: 'paletteSecFolder' };

export function InlineFilterInput({ posters }: { posters: boolean }) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Candidates are derived synchronously from the value (same reason as SearchBox /
  // palette — interposing a setState makes the list and the input drift by one frame).
  // This face does no live filtering (nothing is applied while you're typing), so it
  // needs no debounce either.
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
    if (!posters) out.push({ id: `text:${q}`, section: 'text', title: t('fbInlineText', [q]), commit: () => addFilterToCurrentView({ type: 'text', value: q }) });
    return out;
  }, [query, posters]);

  const close = () => {
    setQuery('');
    setEditing(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter / Esc while an IME conversion is in progress are conversion operations, not
    // operations on this face. Base UI also blocks Enter via which=229, but this handler
    // runs before it does, so both need to check for it (same trap as #28).
    if (e.nativeEvent.isComposing) return;
    // Esc closes not just the candidate popup but the whole input field, returning to
    // "+" (when there isn't a single candidate, the popup isn't open — Base UI's dismiss
    // never runs — so this is the only way out).
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  if (!editing)
    return (
      <button
        type="button"
        data-slot="filter-add-inline"
        // An icon-only "+" (a small add entry point placed at the end of the band). It
        // has no border — this band's dashed border is the mark of an "except" chip, so
        // if the add entry point wore the same face it would read as an exclusion
        // condition standing there (matched to the same ghost styling as the neighboring
        // Save search).
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        aria-label={t('fbAddFilter')}
        title={t('fbAddFilter')}
        onClick={() => setEditing(true)}
      >
        <Plus className="size-3.5" />
      </button>
    );

  return (
    <Autocomplete.Root
      // mode="none": narrowing is already done by queryEntries — don't let Base UI
      // refilter (so the matching semantics don't double up). autoHighlight: an Enter
      // right after typing runs the first item (same as the palette) — since "Search
      // body text" is always present, Enter never comes up empty.
      mode="none"
      autoHighlight
      items={rows}
      value={query}
      onValueChange={(v, details) => {
        // The label of the picked item gets echoed into the input field. This face closes
        // the instant it commits, so it doesn't pick that up.
        if (details.reason === 'item-press') return;
        setQuery(v);
      }}
      onOpenChange={(open, details) => {
        // An outside click, losing focus, or Esc collapse the whole input field (so an
        // empty field left hanging open isn't left in the band). The decision is left to
        // Base UI — the popup lives outside the portal, so a homegrown blur check would
        // race against clicking a candidate.
        if (open) return;
        if (details.reason === 'outside-press' || details.reason === 'focus-out' || details.reason === 'escape-key') close();
      }}
      itemToStringValue={(row: Row) => row.title}
    >
      <Autocomplete.Input
        ref={inputRef}
        autoFocus
        aria-label={t('fbAddFilter')}
        placeholder={t('fbAddFilterPh')}
        onKeyDown={onKeyDown}
        className="h-7 w-44 min-w-0 rounded-md border border-input bg-background px-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
      />
      <Autocomplete.Portal>
        {/* z-[13500]: above the legacy z scale (the tier shadcn's portal surfaces share). */}
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
