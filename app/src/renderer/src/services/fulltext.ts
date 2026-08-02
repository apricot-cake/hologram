// Cross-tab full-text search (#29) — the palette's "本文を検索" mode.
//
// Design (Issue #29, comments 2026-07-11/07-14/07-18, and the implementation
// note moved over from memory): search runs over the WHOLE library (not just
// the current tab's narrowing) using the SAME matcher the in-tab quick search
// already uses (services/search.ts's compile()) — one matching semantics for
// the whole app, never a second one for this surface. Ordering is bm25() rank
// from the main process's posts_fts (#5's FTS5 index), fetched over IPC
// (services/ipc.ts's searchFullText) — this module never touches SQLite
// itself, it only asks for the ranks and folds them in.
//
// #288 homework this pass inherits: posts_fts does not index every field this
// module's own matcher checks (media alt text, seriesTitle, quoted/replied-to
// text — see lib-db-schema.ts's POSTS_FTS_SQL column list). A hit that only
// exists because of one of those fields gets no bm25 rank back, so
// rankFullTextMatches falls it back to date order and sorts it after every
// ranked hit — the same "no rank yet → date order" fallback the Issue's design
// already specified for running this feature before #5 landed, repurposed
// here for the narrower per-hit gap instead of an all-or-nothing one. Widening
// posts_fts to cover those fields is a schema rebuild (FTS5 has no ALTER) left
// as follow-up, not a blocker for this Issue's acceptance criteria.
import { compile, snippetOf } from './search.ts';
import { hologramIpc } from './ipc.ts';

// Field priority order = which field "wins" when a post matches on more than
// one (the acceptance criterion is that a tag/hashtag hit must not read as a
// body hit — #29's design comment on the surprise this avoids). Body-ish
// fields first, tag/hashtag last.
export type FullTextFieldKey = 'text' | 'title' | 'description' | 'seriesTitle' | 'alt' | 'quoted' | 'displayName' | 'screenName' | 'eagleName' | 'tag' | 'hashtag';

function fieldsOf(p: HologramPost): { key: FullTextFieldKey; value: string }[] {
  const out: { key: FullTextFieldKey; value: string }[] = [];
  const push = (key: FullTextFieldKey, v: unknown) => {
    if (v != null && String(v).trim()) out.push({ key, value: String(v) });
  };
  push('text', p.text);
  push('title', p.title);
  push('description', p.description);
  push('seriesTitle', p.seriesTitle); // #188: pixiv series name
  for (const m of p.media || []) push('alt', (m as { alt?: unknown } | null | undefined)?.alt);
  // #180: a quote/reply's own sub-record isn't independently searchable — a hit
  // on ITS text surfaces the PARENT post (same convention as textHaystackOf).
  const q = p.quotedPost || p.replyToPost;
  if (q) push('quoted', (q as { text?: unknown }).text);
  push('displayName', p.displayName);
  push('screenName', p.screenName);
  push('eagleName', p.eagleName);
  for (const tag of p.tags || []) push('tag', tag);
  for (const h of p.hashtags || []) push('hashtag', h);
  return out;
}

export interface FullTextMatch {
  post: HologramPost;
  field: FullTextFieldKey;
  snippetText: string;
  matchStart: number;
  matchEnd: number;
}

/** Runs `query` against one post's fields in priority order and returns the
 * FIRST one that matches, with a snippet — null if nothing on the post
 * matches. Same matcher as the in-tab quick search (query.ts's 'text' leaf),
 * so a post that would match today's current-tab search matches here too. */
export function matchPost(query: string, post: HologramPost): FullTextMatch | null {
  const q = query.trim();
  if (!q) return null;
  const matcher = compile(q);
  for (const f of fieldsOf(post)) {
    if (!matcher(f.value)) continue;
    const snip = snippetOf(f.value, q);
    return { post, field: f.key, snippetText: snip.text, matchStart: snip.matchStart, matchEnd: snip.matchEnd };
  }
  return null;
}

/** Orders matches by bm25 rank (more negative = more relevant) where a rank is
 * available; a hit posts_fts has no row for (see module header) falls back to
 * post date, and every such fallback hit sorts after every ranked hit. */
export function rankFullTextMatches(matches: readonly FullTextMatch[], ranks: ReadonlyMap<string, number>): FullTextMatch[] {
  return [...matches].sort((a, b) => {
    const ra = ranks.get(a.post.captureId);
    const rb = ranks.get(b.post.captureId);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return (Date.parse(b.post.date || '') || 0) - (Date.parse(a.post.date || '') || 0);
  });
}

export interface FullTextSearchResult {
  hits: FullTextMatch[];
  /** Total matches before the `limit` cap — the palette's "すべて表示" affordance reads this. */
  total: number;
}

/** The whole pass: match every post in `allPosts`, fetch bm25 ranks for the
 * same query over IPC, order, and cap to `limit`. A failed/unavailable IPC
 * call (no save folder yet, a malformed MATCH expression) degrades to date
 * order for everything rather than surfacing an error — there is no UI for a
 * query-syntax error on this surface (mirrors searchPostsFts's own main-process
 * fallback). */
export async function runFullTextSearch(query: string, allPosts: readonly HologramPost[], limit: number): Promise<FullTextSearchResult> {
  const q = query.trim();
  if (!q) return { hits: [], total: 0 };
  const matches: FullTextMatch[] = [];
  for (const p of allPosts) {
    const m = matchPost(q, p);
    if (m) matches.push(m);
  }
  let ranks = new Map<string, number>();
  try {
    const rows = await hologramIpc.searchFullText(q, 500);
    ranks = new Map((rows || []).map((r) => [r.postId, r.rank]));
  } catch {
    /* main process unreachable — date-order fallback for every hit below */
  }
  const ranked = rankFullTextMatches(matches, ranks);
  return { hits: ranked.slice(0, limit), total: ranked.length };
}

// --- Bridge to the palette (#29) -----------------------------------------
// Same lazy-pull shape as searchbox.ts's handlers()/init(): the palette
// component mounts before orchestrator.ts finishes wiring deps, so it PULLS
// this at interaction time instead of caching it at module load.
export interface FullTextBridge {
  allPosts(): HologramPost[];
  /** The save-folder asset:// URL builder (orchestrator.ts's fileSrc) — result rows show a thumbnail the same way the post grid does. */
  fileSrc(file: string, w?: number): string;
  /** Opens a NEW tab scoped to `query` and shows the inspector on `captureId` —
   * the "jump" action (#29 acceptance: jumping never disturbs the current tab). */
  openResult(query: string, captureId: string): void;
}
let registeredBridge: FullTextBridge | null = null;
export function initFullTextBridge(b: FullTextBridge): void {
  registeredBridge = b;
}
export function fullTextBridge(): FullTextBridge | null {
  return registeredBridge;
}
