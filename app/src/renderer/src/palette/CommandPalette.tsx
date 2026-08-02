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
//
// #29 (full-text search across tabs) rides the SAME shell rather than a second overlay
// (the Issue's design: "画面部品（窓/入力欄/候補一覧）は共用" — the window/input/list are
// shared, only the candidate source and the row shape differ). PaletteBody grows a
// `mode` — 'commands' (the #28 engine, unchanged above) or 'fulltext' (its own debounced
// async search against services/fulltext.ts) — entered via the palette's own footer row
// or Ctrl/Cmd+Shift+F (command-registry.ts's openFulltext()).
import { Autocomplete } from '@base-ui/react/autocomplete';
import { AppWindow, FileSearch, Folder, Tag, Terminal, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '../_shared/i18n.ts';
import { type CommandEntry, type CommandGroup, type CommandSection, close, isOpen, openId, openMode, queryEntries, runEntry, subscribe } from '../services/command-registry.ts';
import { type FullTextMatch, fullTextBridge, runFullTextSearch } from '../services/fulltext.ts';

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

// #29: which field a full-text hit matched, as the label shown next to the
// author name — a tag/hashtag hit must not read as a body hit (the design's
// stated reason: matches coming in through tags/hashtags would otherwise
// surprise a reader expecting "found in the body").
const FIELD_LABEL: Record<FullTextMatch['field'], string> = {
  text: 'ftFieldText',
  title: 'ftFieldTitle',
  description: 'ftFieldDescription',
  seriesTitle: 'ftFieldSeries',
  alt: 'ftFieldAlt',
  quoted: 'ftFieldQuoted',
  displayName: 'ftFieldAuthor',
  screenName: 'ftFieldAuthor',
  eagleName: 'ftFieldEagle',
  tag: 'ftFieldTag',
  hashtag: 'ftFieldHashtag',
};

const FULLTEXT_DEBOUNCE_MS = 150; // #29 design: "150ms デバウンス"
const FULLTEXT_CAP = 50; // #29 design: "上限50件＋「すべて表示」"

const authorLabelOf = (p: HologramPost): string => p.displayName || p.screenName || t('cmdUnknownUser');
const thumbFileOf = (p: HologramPost): string | null => p.image || (Array.isArray(p.media) && p.media[0]?.file) || null;

function CommandsBody({ onEnterFulltext }: { onEnterFulltext: (seedQuery: string) => void }) {
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
      {/* #29's stated entry point: a permanent footer row, not gated on a match (unlike
          the sections above). Deliberately OUTSIDE the Autocomplete tree — it is not a
          scored candidate, it is a mode switch, so Enter on a highlighted row above never
          collides with it; reachable by mouse or Ctrl/Cmd+Shift+F. */}
      <button type="button" onClick={() => onEnterFulltext(query)} className="flex w-full shrink-0 items-center gap-2 border-t px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted">
        <FileSearch className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{query.trim() ? t('paletteFulltextEntryWithQuery', [query.trim()]) : t('paletteFulltextEntry')}</span>
        <span className="shrink-0 text-xs">Ctrl+Shift+F</span>
      </button>
    </DialogContent>
  );
}

// #29: the full-text search face. Owns its own query/results state — the match
// pass runs over the WHOLE library (services/fulltext.ts's matchPost, the same
// matcher the in-tab quick search uses) rather than through queryEntries, and
// it's async (an IPC round-trip for bm25 rank), so it can't ride the
// synchronous engine CommandsBody uses above.
function FulltextBody({ seedQuery, onBack }: { seedQuery: string; onBack: () => void }) {
  const [ftQuery, setFtQuery] = useState(seedQuery);
  const [hits, setHits] = useState<FullTextMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [showAll, setShowAll] = useState(false);
  // Guards a stale response from a fast-typed-over earlier keystroke landing
  // after a newer one — only the latest request's result is ever applied.
  const seqRef = useRef(0);

  useEffect(() => {
    const bridge = fullTextBridge();
    const q = ftQuery.trim();
    if (!q || !bridge) {
      setHits([]);
      setTotal(0);
      return;
    }
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      runFullTextSearch(q, bridge.allPosts(), showAll ? Number.POSITIVE_INFINITY : FULLTEXT_CAP).then((res) => {
        if (seqRef.current !== seq) return;
        setHits(res.hits);
        setTotal(res.total);
      });
    }, FULLTEXT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [ftQuery, showAll]);

  function jumpTo(hit: FullTextMatch) {
    close();
    fullTextBridge()?.openResult(ftQuery, hit.post.captureId);
  }

  const bridge = fullTextBridge();

  return (
    <DialogContent className="top-[15%] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
      <DialogHeader className="sr-only">
        <DialogTitle>{t('paletteFulltextTitle')}</DialogTitle>
        <DialogDescription>{t('paletteFulltextDesc')}</DialogDescription>
      </DialogHeader>
      <Autocomplete.Root inline open mode="none" items={hits} value={ftQuery} onValueChange={setFtQuery} autoHighlight="always" itemToStringValue={(hit: FullTextMatch) => hit.post.captureId}>
        <div className="flex items-center gap-1 border-b p-1">
          {/* Back to the command engine — Backspace-on-empty is not wired (would collide
              with editing the query), a plain button is the least surprising affordance. */}
          <button type="button" onClick={() => onBack()} aria-label={t('paletteFulltextBack')} className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted">
            <FileSearch className="size-4" />
          </button>
          <Autocomplete.Input autoFocus aria-label={t('paletteFulltextTitle')} placeholder={t('paletteFulltextPlaceholder')} className="h-8 w-full min-w-0 border-0 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm" />
        </div>
        <Autocomplete.List className="max-h-80 overflow-y-auto overscroll-contain p-1">
          {(hit: FullTextMatch) => {
            const file = thumbFileOf(hit.post);
            return (
              <Autocomplete.Item key={hit.post.captureId} value={hit} onClick={() => jumpTo(hit)} className="flex cursor-default items-start gap-2 rounded-sm px-2 py-1.5 text-sm select-none data-highlighted:bg-muted">
                {file && bridge ? <img src={bridge.fileSrc(file, 64)} alt="" className="mt-0.5 size-8 shrink-0 rounded object-cover" /> : <div className="mt-0.5 size-8 shrink-0 rounded bg-muted" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <span className="truncate font-medium text-foreground">{authorLabelOf(hit.post)}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">{t(FIELD_LABEL[hit.field])}</span>
                  </div>
                  <div className="truncate">
                    {hit.matchStart >= 0 ? (
                      <>
                        {hit.snippetText.slice(0, hit.matchStart)}
                        <mark className="rounded-none bg-transparent px-0 font-semibold text-foreground">{hit.snippetText.slice(hit.matchStart, hit.matchEnd)}</mark>
                        {hit.snippetText.slice(hit.matchEnd)}
                      </>
                    ) : (
                      hit.snippetText
                    )}
                  </div>
                </div>
              </Autocomplete.Item>
            );
          }}
        </Autocomplete.List>
        <Autocomplete.Empty className="px-3 py-6 text-center text-sm text-muted-foreground empty:hidden">{t('paletteFulltextEmpty')}</Autocomplete.Empty>
      </Autocomplete.Root>
      {total > hits.length && (
        <button type="button" onClick={() => setShowAll(true)} className="w-full shrink-0 border-t px-3 py-2 text-center text-xs text-muted-foreground hover:bg-muted">
          {t('paletteFulltextShowAll', [total])}
        </button>
      )}
    </DialogContent>
  );
}

function PaletteBody({ initialMode }: { initialMode: 'commands' | 'fulltext' }) {
  const [mode, setMode] = useState(initialMode);
  const [ftSeed, setFtSeed] = useState('');
  if (mode === 'fulltext') return <FulltextBody seedQuery={ftSeed} onBack={() => setMode('commands')} />;
  return (
    <CommandsBody
      onEnterFulltext={(seedQuery) => {
        setFtSeed(seedQuery);
        setMode('fulltext');
      }}
    />
  );
}

export function PaletteHost() {
  const open = useSyncExternalStore(subscribe, isOpen);
  // Keyed on openId: even if it's reopened during the closing animation, it reopens
  // without carrying over the half-typed query (same convention as ConfirmHost /
  // BulkTagDialogHost). initialMode is read fresh each render but only matters at
  // mount time for a given key — openMode()/open_/openSeq are all set together
  // synchronously inside open()/openFulltext(), so by the time this re-renders they
  // already agree.
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
      <PaletteBody key={seq} initialMode={openMode()} />
    </Dialog>
  );
}
