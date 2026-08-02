// Misskey search translation. Misskey's built-in note search (/search?q=...) is a plain
// full-text box - it has no publicly documented operator DSL (no from:/since:/exclude/
// OR the way X or Mastodon do), and search itself is opt-in per instance (some instances
// disable it, or only search their own local notes). Given that, this module only turns
// terms + hashtags into the one q param it can be reasonably confident about;
// everything else is reported as dropped so the row's warning icon tells the truth
// instead of promising a filter Misskey cannot actually apply.
//
// needsInstanceHost: search is login-gated on most instances, so the URL always targets
// the user's configured home instance (websearch/prefs.ts), never the saved post's own
// origin host.
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryPlus, quoteIfSpaced } from '../text.ts';

function build(state: PlatformQueryState, host: string, applied: string[], approximated: PlatformResult['approximated'], dropped: PlatformResult['dropped']): string | null {
  const parts: string[] = [];

  for (const term of state.terms) parts.push(quoteIfSpaced(term));
  if (state.terms.length) applied.push('キーワード');

  for (const tag of state.hashtag) parts.push(`#${tag}`);
  if (state.hashtag.length) approximated.push({ note: 'ハッシュタグは本文検索の語として近似されます' });

  if (state.keywordsOr.length || state.exclude.length || state.hashtagOr.length || state.excludeHashtag.length) {
    dropped.push({ reason: 'Misskey の検索は除外・「いずれか」条件に対応していません' });
  }
  if (state.fromUser || state.excludeUser.length) dropped.push({ reason: 'Misskey の検索URLは投稿者の指定に対応していません' });
  if (state.since || state.until) dropped.push({ reason: 'Misskey の検索は期間の絞り込みに対応していません' });
  if (state.mediaOnly || state.videoOnly) dropped.push({ reason: 'Misskey の検索はメディア絞り込みに対応していません' });
  if (state.repliesOnly || state.excludeReplies) dropped.push({ reason: 'Misskey の検索は返信の絞り込みに対応していません' });
  if (state.minLikes != null || state.minReposts != null || state.minReplies != null) dropped.push({ reason: 'Misskey の検索はエンゲージメント数の下限に対応していません' });

  if (!parts.length) return null;
  return `https://${host}/search?q=${encodeQueryPlus(parts.join(' '))}`;
}

export const misskeyPlatform: PlatformDef = {
  id: 'misskey',
  label: 'Misskey',
  needsInstanceHost: true,
  build(state, ctx) {
    const applied: string[] = [];
    const approximated: PlatformResult['approximated'] = [];
    const dropped: PlatformResult['dropped'] = [];
    const host = ctx.instanceHost || '';
    if (!host) {
      dropped.push({ reason: 'ホームインスタンス（Misskey）が未設定です' });
      return { url: null, applied, approximated, dropped };
    }
    if (isEmptyState(state)) return { url: null, applied, approximated, dropped };
    const url = build(state, host, applied, approximated, dropped);
    return { url, applied, approximated, dropped };
  },
};
