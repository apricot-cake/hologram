// The per-row "Google で代替検索" link a weak-search row (Misskey/Mastodon/pixiv/Bluesky
// - anything narrower than X's operator set) offers for whatever it had to drop or
// approximate: a plain Google search scoped to that site's domain with the same
// concepts folded in as ordinary keywords. This is deliberately simpler than the site's
// own translation (Google has no notion of hashtags/authors/dates as query concepts
// either, so everything beyond keywords is approximated once more, at the Google layer).
import { buildGoogleQuery, type GoogleBuildResult } from './platforms/google.ts';
import type { QueryState } from './types.ts';

/** domain = the row's own site (e.g. 'pixiv.net', or the configured instanceHost for
 * Misskey/Mastodon). null domain (Misskey/Mastodon with no home instance set) means no
 * fallback link either - there is nothing to scope `site:` to. */
export function buildGoogleFallback(state: QueryState, domain: string | null): GoogleBuildResult {
  if (!domain) return { url: null, applied: [], approximated: [], dropped: [{ reason: 'ホームインスタンスが未設定のため Google 代替検索も作成できません' }] };
  return buildGoogleQuery(state, domain);
}
