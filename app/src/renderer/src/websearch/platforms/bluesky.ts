// Bluesky search translation. Bluesky's own help center documents a small, fixed
// operator set (from:/to:/since:/until:/mentions:/lang:/domain:) - no OR, no -exclude,
// no min-likes, no media-only operator. This module only uses the documented operators;
// everything else is reported as dropped rather than guessed (see types.ts's confidence
// note - the Issue's own design draft assumed a Bluesky-only hashtag-OR operator, but
// that claim rests on dialect's measured table, which is unreachable here, so this
// module does NOT implement it and drops OR clusters instead - flagged in the Issue/PR
// as something to re-check once dialect is reachable).
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryPlus, quoteIfSpaced } from '../text.ts';

function build(state: PlatformQueryState, applied: string[], dropped: PlatformResult['dropped']): string | null {
  const parts: string[] = [];

  for (const term of state.terms) parts.push(quoteIfSpaced(term));
  if (state.terms.length) applied.push('キーワード');

  if (state.keywordsOr.length) dropped.push({ reason: 'Bluesky の検索は「いずれか」条件に対応していません' });
  if (state.exclude.length) dropped.push({ reason: 'Bluesky の検索は除外条件に対応していません' });
  if (state.excludeHashtag.length) dropped.push({ reason: 'Bluesky の検索は除外条件に対応していません' });

  for (const tag of state.hashtag) parts.push(`#${tag}`);
  if (state.hashtag.length) applied.push('ハッシュタグ');
  if (state.hashtagOr.length) dropped.push({ reason: 'Bluesky の検索は「いずれか」条件に対応していません' });

  if (state.fromUser) {
    parts.push(`from:${state.fromUser}`);
    applied.push('投稿者');
  }
  if (state.excludeUser.length) dropped.push({ reason: 'Bluesky の検索は投稿者の除外に対応していません' });

  if (state.since) {
    parts.push(`since:${state.since}`);
    applied.push('期間（開始）');
  }
  if (state.until) {
    parts.push(`until:${state.until}`);
    applied.push('期間（終了）');
  }

  if (state.mediaOnly || state.videoOnly) dropped.push({ reason: 'Bluesky の検索はメディア絞り込みに対応していません' });
  if (state.repliesOnly || state.excludeReplies) dropped.push({ reason: 'Bluesky の検索は返信の絞り込みに対応していません' });
  if (state.minLikes != null || state.minReposts != null || state.minReplies != null) dropped.push({ reason: 'Bluesky の検索はエンゲージメント数の下限に対応していません' });

  if (!parts.length) return null;
  return `https://bsky.app/search?q=${encodeQueryPlus(parts.join(' '))}`;
}

export const blueskyPlatform: PlatformDef = {
  id: 'bluesky',
  label: 'Bluesky',
  build(state) {
    const applied: string[] = [];
    const approximated: PlatformResult['approximated'] = [];
    const dropped: PlatformResult['dropped'] = [];
    if (isEmptyState(state)) return { url: null, applied, approximated, dropped };
    const url = build(state, applied, dropped);
    return { url, applied, approximated, dropped };
  },
};
