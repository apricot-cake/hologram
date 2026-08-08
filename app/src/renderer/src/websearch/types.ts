// #207 - library -> web-search translation engine. Rewritten from the frozen sister
// project apricot-cake/dialect (MIT), forward path only: types / platforms / resolve /
// googleFallback / the tree->QueryState adapter. dialect's own reverse-translation, UI
// picker and share-link modules are NOT ported (out of scope - see the Issue).
//
// This whole directory is pure logic - no DOM, no Electron, no i18n runtime. Drop /
// approximation NOTES are raw Japanese strings, written in the same register as the rest
// of the app's UI - the note text is data shown in a tooltip, not chrome, so it does not
// go through the message table the way the popover's own labels do.
//
// Confidence note (read before trusting a platform's operator table): #822 (2026-08-03)
// ran the equivalence harness (scripts/check-websearch-equivalence.cts - see resolve.ts's
// sibling) against a real clone of the frozen dialect repo (DIALECT_REPO), fuzzing every
// concept the two engines share across 5000+ generated cases per platform with zero
// mismatches. Every platform module below has been machine-checked against dialect's
// measured operator tables (packages/core/src/platforms/*.ts) - the fixes that pass
// found are documented in each module's own header comment (wrong encoding, missing
// operators, a forced pixiv URL shape that broke on pixiv's own error page, etc.).
// Concepts a module supports beyond dialect's own model for that site (a Hologram-only
// extension - e.g. X's videoOnly/repliesOnly, pixiv's fromUser artist-page jump) are
// called out explicitly in that module's header, since the harness cannot check those
// against anything. Re-run the harness after touching any operator table - see this
// file's own comment in check-websearch-equivalence.cts for the DIALECT_REPO setup.

/** The five sites Hologram saves from - the same set the popover offers as rows. Matches
 * services/facets.ts PF_ORDER literal strings exactly (p.platform's own values). */
export type PlatformId = 'x' | 'bluesky' | 'misskey' | 'mastodon' | 'pixiv';

/** A user leaf resolved to an actual, platform-shaped identifier - see
 * services/profile-url.ts ProfileUrlSubject comment, which this mirrors: x/bluesky =
 * the bare handle, misskey/mastodon = user or user-at-remoteHost (already correctly
 * shaped by the extractor for a federated author; a LOCAL author's origin host is
 * appended by the adapter, since a bare username is ambiguous once the search runs from
 * a DIFFERENT host - the configured home instance), pixiv = the numeric user id.
 *
 * `platform` records which site this person was actually captured from: a from:/acct:
 * filter only ever makes sense on THAT platform (or Google, which does not care) - a
 * user resolved from a Misskey post has no sensible X translation, and resolve.ts uses
 * this field to drop the condition on every row it does not belong to, rather than
 * silently keeping quiet about a mismatch. */
export interface ResolvedUser {
  platform: PlatformId;
  handle: string;
}

/** The engine's condition-tree-independent query shape - a flat bag of concepts a
 * platform module reads whichever subset of it applies. Absent/empty = "no such
 * condition was in the tree", never "empty string means match everything" - every
 * platform module must treat an empty array/null the same as "not present". */
export interface QueryState {
  /** Positive keyword terms, ANDed. */
  terms: string[];
  /** A single "any of these keywords" cluster (facet-CNF only ever has one text OR group). */
  keywordsOr: string[];
  /** Excluded keywords. */
  exclude: string[];
  /** Positive tags/hashtags, ANDed. A pixiv tag and a hashtag leaf both land here -
   * pixiv's own search IS a tag search, so the two Hologram leaf types collapse to one
   * concept once translated. */
  hashtag: string[];
  /** A single "any of these tags" cluster. */
  hashtagOr: string[];
  /** Excluded tags/hashtags. */
  excludeHashtag: string[];
  /** The one resolved author, or null - a leaf that could not be resolved to a real
   * handle is reported as dropped instead of ending up here as a guess (see
   * ResolvedUser). Per-platform narrowing (does this belong on THIS row?) happens in
   * resolve.ts, not here - the adapter's job stops at "what did the tree say". */
  fromUser: ResolvedUser | null;
  /** Excluded authors, ANDed. */
  excludeUser: ResolvedUser[];
  /** Posted-date bounds, local-day YYYY-MM-DD strings (already resolved by the tree's
   * own local-day semantics - see services/query.ts localDayRange). Library-only date
   * axes (captured-at, etc.) never reach this field - the adapter drops those instead. */
  since: string | null;
  until: string | null;
  mediaOnly: boolean;
  videoOnly: boolean;
  excludeReplies: boolean;
  repliesOnly: boolean;
  minLikes: number | null;
  minReposts: number | null;
  minReplies: number | null;
}

export function emptyQueryState(): QueryState {
  return {
    terms: [],
    keywordsOr: [],
    exclude: [],
    hashtag: [],
    hashtagOr: [],
    excludeHashtag: [],
    fromUser: null,
    excludeUser: [],
    since: null,
    until: null,
    mediaOnly: false,
    videoOnly: false,
    excludeReplies: false,
    repliesOnly: false,
    minLikes: null,
    minReposts: null,
    minReplies: null,
  };
}

/** The shape a platform module actually reads: same as QueryState, but with fromUser and
 * excludeUser already narrowed to plain handle strings for THIS platform (resolve.ts's
 * job - see narrowForPlatform) - a platform's build() never has to know about
 * ResolvedUser or cross-platform mismatches, only "is there a usable handle or not". */
export type PlatformQueryState = Omit<QueryState, 'fromUser' | 'excludeUser'> & {
  fromUser: string | null;
  excludeUser: string[];
};

/** Test/call-site convenience: an all-empty PlatformQueryState, so a unit test can spread
 * it and override just the fields it cares about without QueryState's ResolvedUser
 * shape getting in the way (fromUser/excludeUser differ between the two types). */
export function emptyPlatformQueryState(): PlatformQueryState {
  return { ...emptyQueryState(), fromUser: null, excludeUser: [] };
}

/** True iff nothing at all is set - a platform module facing this should build null
 * rather than a search URL with no query (X/Bluesky reject an empty q; Misskey/Mastodon
 * would silently return "everything"; pixiv has no bare "all tags" browse). */
export function isEmptyState(s: PlatformQueryState): boolean {
  return (
    s.terms.length === 0 &&
    s.keywordsOr.length === 0 &&
    s.exclude.length === 0 &&
    s.hashtag.length === 0 &&
    s.hashtagOr.length === 0 &&
    s.excludeHashtag.length === 0 &&
    s.fromUser == null &&
    s.excludeUser.length === 0 &&
    s.since == null &&
    s.until == null &&
    !s.mediaOnly &&
    !s.videoOnly &&
    !s.excludeReplies &&
    !s.repliesOnly &&
    s.minLikes == null &&
    s.minReposts == null &&
    s.minReplies == null
  );
}

/** Per-build context a platform module may need beyond the query itself. */
export interface PlatformCtx {
  /** Misskey/Mastodon only: the home-instance host the search should run against (search
   * is login-gated there, so it must be a host the user can actually log into - never
   * the saved post's own origin host). null/empty = not configured yet. */
  instanceHost?: string | null;
}

export interface ApproxNote {
  /** A short Japanese label for the condition that was approximated (shown in the row's
   * warning-icon tooltip breakdown). */
  note: string;
}
export interface DropNote {
  /** A short Japanese sentence explaining why the condition could not be translated. */
  reason: string;
}

export interface PlatformResult {
  /** null = nothing translatable was left to search (isEmptyState after everything this
   * platform can't use got dropped), or a required ctx (instanceHost) is missing. */
  url: string | null;
  /** Concepts that made it into the URL unchanged. */
  applied: string[];
  approximated: ApproxNote[];
  dropped: DropNote[];
}

export interface PlatformDef {
  id: PlatformId;
  /** Display label - a proper noun, not translated. */
  label: string;
  /** Misskey/Mastodon: the popover must show the home-instance picker/warning for this row. */
  needsInstanceHost?: boolean;
  build(state: PlatformQueryState, ctx: PlatformCtx): PlatformResult;
}
