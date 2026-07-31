// The command palette's (#28) island — holds only the shell. Candidates, ordering, and
// execution all live in services/command-registry.ts; this file only draws the "window,
// input field, candidate list."
//
// Assembled entirely from parts that already exist (zero added dependencies): shadcn
// Dialog (= Base UI Dialog. Background-click / Esc dismiss, focus trap, focus restore on
// close, scroll lock, and even the dimming of window-control buttons via .wc-dim — the
// existing mechanism that watches data-slot='dialog-overlay' just works as-is) + Base UI
// Autocomplete's `inline` mode (draws the List in place without its own popup = the exact
// shape of the palette itself: an input field and a list side by side inside a dialog).
//
// cmdk was not adopted (its Radix dependency would double up the a11y stack, and its
// built-in scorer would also create a second matching semantics alongside ours). A
// custom overlay was not adopted either.
import { Autocomplete } from '@base-ui/react/autocomplete';
import { AppWindow, Folder, Tag, Terminal, User } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '../_shared/i18n.ts';
import { type CommandEntry, type CommandGroup, type CommandSection, close, isOpen, openId, queryEntries, runEntry, subscribe } from '../services/command-registry.ts';

const SECTION_ICON: Record<CommandSection, ComponentType<{ className?: string }>> = {
  command: Terminal,
  tab: AppWindow,
  tag: Tag,
  user: User,
  folder: Folder,
};

const SECTION_LABEL: Record<CommandSection, string> = {
  command: 'paletteSecCommand',
  tab: 'paletteSecTab',
  tag: 'paletteSecTag',
  user: 'paletteSecUser',
  folder: 'paletteSecFolder',
};

function PaletteBody() {
  const [query, setQuery] = useState('');
  // Candidates are derived synchronously from the value (same reason as SearchBox —
  // interposing a setState makes the list and the input drift out of sync for a moment).
  // The provider reads the population fresh each time, so if the library changes while
  // the palette is open, the very next keystroke catches up.
  //
  // No cap on the count — matches the app-wide convention for candidate lists (the
  // "+ filter" bar's list scrolls with no cap, the sidebar facet rows cap at 100). Show
  // everything that matched, and let the user type more to narrow it down or scroll.
  // Only the search box face keeps the old cap of 6 tags / 4 posters, because there it's
  // a dropdown directly under the input field and can't stretch vertically.
  const groups = useMemo<CommandGroup[]>(() => queryEntries(query), [query]);

  return (
    // gap-0 / p-0 / top-aligned: the palette is just two tiers — "input field + list" —
    // and the dialog's default padding and vertical centering (which would make the
    // window grow up and down every time candidates increase) don't fit this shape.
    <DialogContent className="top-[15%] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
      {/* Base UI Dialog requires a Title inside the Popup (the resolution target for
          aria-labelledby). The palette isn't a surface that draws a heading, so it's
          placed sr-only. */}
      <DialogHeader className="sr-only">
        <DialogTitle>{t('paletteTitle')}</DialogTitle>
        <DialogDescription>{t('paletteDesc')}</DialogDescription>
      </DialogHeader>
      <Autocomplete.Root
        // inline + open: draws the List in place instead of using its own popup (per
        // Base UI's rules, pass open unconditionally). mode="none": narrowing is already
        // done by queryEntries — don't let Base UI refilter (i.e. don't double up the
        // matching semantics).
        inline
        open
        mode="none"
        items={groups}
        value={query}
        onValueChange={setQuery}
        // Always highlight the first item — open, type, hit Enter, it runs (same as
        // VS Code / Linear).
        autoHighlight="always"
        itemToStringValue={(entry: CommandEntry) => entry.title}
      >
        <div className="border-b p-1">
          <Autocomplete.Input
            autoFocus
            aria-label={t('paletteTitle')}
            placeholder={t('palettePlaceholder')}
            // Enter while an IME conversion is in progress is blocked by Base UI's own
            // ComboboxInput (Chromium routes keydown during conversion to which=229, so
            // it returns before reaching the Enter handling). Confirmed on real hardware.
            // The border is owned by the container's border-b, so the input itself is border-0.
            className="h-8 w-full min-w-0 border-0 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </div>
        <Autocomplete.List className="max-h-80 overflow-y-auto overscroll-contain p-1">
          {(group: CommandGroup) => (
            <Autocomplete.Group key={group.section} items={group.items} className="pb-1 last:pb-0">
              <Autocomplete.GroupLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t(SECTION_LABEL[group.section])}</Autocomplete.GroupLabel>
              <Autocomplete.Collection>
                {(entry: CommandEntry) => {
                  const Icon = SECTION_ICON[entry.section];
                  return (
                    // close, then perform (see the comment on runEntry for why in this order).
                    <Autocomplete.Item key={entry.id} value={entry} onClick={() => runEntry(entry)} className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none data-highlighted:bg-muted">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                      {entry.hint && <span className="shrink-0 text-xs text-muted-foreground">{entry.hint}</span>}
                    </Autocomplete.Item>
                  );
                }}
              </Autocomplete.Collection>
            </Autocomplete.Group>
          )}
        </Autocomplete.List>
        {/* Empty is a part that "draws its children only when the list is empty" — it
            still stays in the DOM for screen readers, so when there's no content the box
            itself is collapsed (to stop bare padding from being left behind). The action
            entries all match even on an empty query, so this only ever shows up when what
            was typed truly matches nothing at all. */}
        <Autocomplete.Empty className="px-3 py-6 text-center text-sm text-muted-foreground empty:hidden">{t('paletteEmpty')}</Autocomplete.Empty>
      </Autocomplete.Root>
    </DialogContent>
  );
}

export function PaletteHost() {
  const open = useSyncExternalStore(subscribe, isOpen);
  // Keyed on openId: even if it's reopened during the closing animation, it reopens
  // without carrying over the half-typed query (same convention as ConfirmHost /
  // BulkTagDialogHost).
  const seq = useSyncExternalStore(subscribe, openId);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close(); // Esc / background click
      }}
    >
      {/* Always keep it mounted — the closing animation is driven by Base UI Dialog
          (Portal/Popup) watching `open`, so mounting/unmounting it here would make the
          exit animation disappear. */}
      <PaletteBody key={seq} />
    </Dialog>
  );
}
