// Builds the userKey -> ResolvedUser lookup the adapter needs to translate a 'user' leaf
// (see types.ts's ResolvedUser doc comment). A 'user' leaf only carries the tree's own
// userKey string (services/query.ts's userKey - platform + ':' + (userId or
// '@'+screenName)) and a display label, neither of which is a usable site handle on its
// own (CLAUDE.md/#207's own note: "fromUserのハンドル解決はレコード実データ依存"). The
// real per-platform identity lives on the POST records themselves - `screenName`,
// already shaped correctly per platform by every extractor (see services/profile-url.ts's
// ProfileUrlSubject comment, which this mirrors exactly): x/bluesky = the bare handle,
// misskey/mastodon = username or username@remoteHost, pixiv = the numeric user id.
//
// This module is intentionally NOT wired into the adapter's own import graph - the
// adapter stays a pure tree-only function (buildWebSearchState(tree, deps)); this file
// is how a caller (websearch/prefs.ts's home-host suggestion, or the popover itself)
// builds the `deps.resolveUser` function from a posts snapshot it already has (fetched
// once via hologramIpc.listPosts() - see prefs.ts), without this directory reaching into
// orchestrator.ts's live listing pipeline.
import { hostOf, userKey } from '../services/query.ts';
import type { PlatformId, ResolvedUser } from './types.ts';

const KNOWN_PLATFORMS = new Set<PlatformId>(['x', 'bluesky', 'misskey', 'mastodon', 'pixiv']);

/** Minimal post shape this needs - a structural subset of HologramPost. */
export interface UserSourcePost {
  platform?: string | null;
  screenName?: string | null;
  url?: string | null;
  userId?: string | number | null;
}

function toResolvedUser(p: UserSourcePost): ResolvedUser | null {
  if (!p.platform || !KNOWN_PLATFORMS.has(p.platform as PlatformId)) return null;
  const platform = p.platform as PlatformId;
  if (!p.screenName) return null; // no handle ever captured for this record - unresolvable, same as dialect's own trap
  if (platform === 'misskey' || platform === 'mastodon') {
    if (p.screenName.includes('@')) return { platform, handle: p.screenName }; // extractor already appended the remote host
    const host = hostOf(p.url);
    if (!host) return null; // local author but no origin host recoverable - cannot fully qualify the acct
    return { platform, handle: `${p.screenName}@${host}` };
  }
  return { platform, handle: p.screenName }; // x / bluesky / pixiv: screenName is already the right shape
}

/** One entry per (platform, key) — later posts by the same person overwrite earlier ones
 * only if the earlier one failed to resolve (a person's screenName should never change
 * across their own posts, so first-resolved wins otherwise). */
export function buildUserHandleIndex(posts: readonly UserSourcePost[]): Map<string, ResolvedUser> {
  const map = new Map<string, ResolvedUser>();
  for (const p of posts) {
    if (!p.platform) continue;
    const key = userKey(p as any);
    if (map.has(key)) continue;
    const resolved = toResolvedUser(p);
    if (resolved) map.set(key, resolved);
  }
  return map;
}
