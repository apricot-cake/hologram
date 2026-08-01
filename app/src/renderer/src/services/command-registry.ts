// Command palette (#28)'s supply source — the single registry of candidates.
//
// The foundation for the "type → kind candidates" policy: one engine, three surfaces (the
// search box's suggestions / the palette / #148's chip-band inline input). Candidate
// generation is consolidated here; what varies per surface is only "which sections to show
// how many of" and "the default action on confirm" — so the lineup, ordering, and kind
// labels never drift between surfaces.
//
// Shaped as a real ES module (named exports) same as settings.ts / searchbox.ts, not routed
// through window. This module also owns the open/closed state (pure state = open / close /
// isOpen / subscribe. Follows the existing convention of not putting callbacks in the store).
// Islands subscribe via useSyncExternalStore.
//
// Both the filter-type entries (jumping to a tag / poster / folder) and the action-type
// entries (settings, new tab, …) are normalized down to one perform() — no separate types,
// the only difference is section. perform's actual body is registered by command-builder.ts
// as a dependency-injected closure after the app boots.
import { get as confirmGet } from './confirm.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { compile, normalize } from './search.ts';
import { isOpen as settingsIsOpen } from './settings.ts';

// section is a "heading", not a type meant to branch behavior by kind.
// 'folder' is the slot the design comments used to call 'collection' — an old name that
// stuck around even after collections became the sidebar's folder list (2026-07-04); it's
// now aligned with the code-side vocabulary (applyFolderFilter / staticFolders / the query
// leaf's type:'folder').
export type CommandSection = 'command' | 'tab' | 'tag' | 'user' | 'folder';

export interface CommandEntry {
  id: string;
  section: CommandSection;
  title: string;
  /** A string to match against besides title (e.g. a poster's screen name). */
  keywords?: string;
  /** Faint auxiliary text shown at the right edge of the row (shortcut notation, count, path). */
  hint?: string;
  /** Ranking within the same score band (a tag's use count, a poster's post count). */
  weight?: number;
  /**
   * The "narrowing condition" this candidate itself means. **The material for when a surface
   * has its own confirm action** — candidate generation (lineup / ordering / kind label) never
   * branches on it — per ADR 0016: "what a surface decides is only which sections to show how
   * many of, and the default action on confirm."
   *
   * How it's actually split: the search box and the palette both run `perform()` (AND-add to
   * the current tab — the search-box-derived convention of discarding the in-progress body
   * text and replacing it). #148's chip-band inline input reads this field and hands it
   * straight to `addFilter` instead — **it never drags the search box's in-progress text
   * along** (that surface is just a "add one chip" input, not a full-text search field).
   * Entries that don't carry this (action-type / tab / folder-jump) fall through to
   * `perform()` on every surface.
   */
  filter?: { type: string; value: string; label?: string };
  perform(): void;
}

export interface CommandProvider {
  id: string;
  /**
   * Returns the candidates as of right now. Called the instant the palette opens, so it
   * carries no freshness management of its own. It takes query so the provider itself can
   * decide "don't enumerate on an empty query" (tags and posters run into the thousands, and
   * no surface shows them all the instant it opens). Narrowing itself is entirely
   * queryEntries's job, so the provider only has to return the base population.
   */
  entries(query: string): CommandEntry[];
}

export interface CommandGroup {
  section: CommandSection;
  items: CommandEntry[];
}

// The order the headings appear in. Score ranks WITHIN a section — sections themselves never
// swap places (if the action-type section slid under tags, "what can I even do here" would
// stop being readable).
const SECTION_ORDER: readonly CommandSection[] = ['command', 'tab', 'tag', 'user', 'folder'];

// Ordering weight: exact match > prefix match > substring match > fuzzy. Only the fuzzy
// judgment reuses the existing search's compile() as-is — the whole app shares one matching
// semantics (spelling-variant normalization, subsequence, edit distance), and the palette
// doesn't carry its own scorer.
const SCORE_EXACT = 4;
const SCORE_PREFIX = 3;
const SCORE_SUBSTRING = 2;
const SCORE_FUZZY = 1;
const SCORE_ANY = 0; // empty query = every entry ties
const NO_MATCH = -1;

const providers = new Map<string, CommandProvider>();

/** Registers a batch of fixed entries (the same lineup for the app's whole lifetime). */
export function registerCommands(id: string, entries: readonly CommandEntry[]): () => void {
  const frozen = [...entries];
  return registerProvider({ id, entries: () => frozen });
}

/** Registers dynamic entries (tabs / tags / posters / folders) as a provider. */
export function registerProvider(provider: CommandProvider): () => void {
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
  };
}

/** For tests: drops every registration (never called from product code). */
export function resetProviders(): void {
  providers.clear();
}

/**
 * The score for one entry. Takes whichever of title and keywords matches best.
 * nq / matcher are built once by the caller (not re-compiled on every render).
 */
export function scoreEntry(entry: CommandEntry, nq: string, matcher: (hay: string) => boolean): number {
  if (!nq) return SCORE_ANY;
  let best = NO_MATCH;
  for (const field of [entry.title, entry.keywords]) {
    if (!field) continue;
    const nh = normalize(field);
    const s = nh === nq ? SCORE_EXACT : nh.startsWith(nq) ? SCORE_PREFIX : nh.includes(nq) ? SCORE_SUBSTRING : matcher(field) ? SCORE_FUZZY : NO_MATCH;
    if (s > best) best = s;
  }
  return best;
}

export interface QueryOptions {
  /** The sections to show (the per-surface lineup). Omit = all. */
  sections?: readonly CommandSection[];
  /** The cap per section (the per-surface count). Omit = unlimited. */
  limit?: Partial<Record<CommandSection, number>>;
}

/**
 * Returns candidates bundled by section. Every surface routes through this one function —
 * ordering and matching semantics are shared.
 */
export function queryEntries(query: string, opts?: QueryOptions): CommandGroup[] {
  const nq = normalize(query).trim();
  const matcher = compile(query);
  const wanted = opts?.sections;
  // Registration order is used as the final tiebreak on a tie (the same input always gets the same order).
  const buckets = new Map<CommandSection, { entry: CommandEntry; score: number; seq: number }[]>();
  let seq = 0;
  for (const provider of providers.values()) {
    for (const entry of provider.entries(query)) {
      if (wanted && !wanted.includes(entry.section)) continue;
      const score = scoreEntry(entry, nq, matcher);
      if (score === NO_MATCH) continue;
      const bucket = buckets.get(entry.section);
      if (bucket) bucket.push({ entry, score, seq: seq++ });
      else buckets.set(entry.section, [{ entry, score, seq: seq++ }]);
    }
  }
  const groups: CommandGroup[] = [];
  for (const section of SECTION_ORDER) {
    const bucket = buckets.get(section);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort((a, b) => b.score - a.score || (b.entry.weight || 0) - (a.entry.weight || 0) || a.seq - b.seq);
    const cap = opts?.limit?.[section];
    groups.push({ section, items: (cap == null ? bucket : bucket.slice(0, cap)).map((r) => r.entry) });
  }
  return groups;
}

// --- Open/closed state (pure state — same shape as settings.ts) ---------------------------------
let open_ = false;
let openSeq = 0;
const subs = new Set<() => void>();

export function isOpen(): boolean {
  return open_;
}

/**
 * The number of times it has been opened. If an island uses this as its key, reopening it
 * mid-close-animation never carries over the in-progress query (the same convention as
 * ConfirmHost / BulkTagDialogHost).
 */
export function openId(): number {
  return openSeq;
}

function set(v: boolean) {
  const next = !!v;
  if (next === open_) return;
  open_ = next;
  if (next) openSeq++;
  for (const cb of [...subs]) cb();
}

export function open(): void {
  set(true);
}

export function close(): void {
  set(false);
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/**
 * Runs an entry. **Closing before running perform** is the whole reason this function
 * exists, and the order can't be reversed, for two reasons: ①Base UI Dialog restores focus
 * to where it was before opening when it closes, so if perform ran first the restore target
 * would be the DOM AFTER perform ran ②if perform opens a different modal (settings /
 * confirm), the close handling and the open handling would race within the same frame.
 * Closed off in one place so a caller can't forget it.
 */
export function runEntry(entry: CommandEntry): void {
  close();
  entry.perform();
}

// --- Ctrl/Cmd+K ---------------------------------------------------------------
// The division of roles is settled: `/` focuses the search box (search-box-builder.ts),
// Ctrl/Cmd+K is the palette. Registration lives in GlobalShortcuts (app/App.tsx); the guard +
// action sit here, same as every other app-wide shortcut — this module is the one that knows
// whether it's open, so it's the natural place to hold that check too.
//
// Kept live even inside input fields (other app-wide shortcuts stand down inside
// INPUT/TEXTAREA, but Ctrl+K's badge next to the search box advertises it as an entry point —
// it would be a lie if you couldn't press it from there. Windows text input has no default
// behavior bound to Ctrl+K, and Chrome itself uses Ctrl+K for the address-bar search).
export function handleShortcutPaletteKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  if ((e.key || '').toLowerCase() !== 'k') return;
  // Passes through while already open — the only way to close is unified to Esc and a background click (Base UI's dismiss).
  if (open_) return;
  if (confirmGet() || lightboxIsOpen()) return;
  if (settingsIsOpen()) return;
  e.preventDefault();
  open();
}
