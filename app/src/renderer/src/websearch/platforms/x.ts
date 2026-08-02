// X (twitter/x.com) advanced-search translation. Its query-operator set is the richest
// and most publicly documented of the five sites, so this module supports the most
// concepts. Operators used below (from:/since:/until:/filter:media/filter:videos/
// filter:replies/-filter:replies/min_faves:/min_retweets:/min_replies:/-word/(a OR b)/
// #tag) are X's long-published "advanced search" syntax - documented behavior, not a
// guess - but see types.ts's confidence note: none of this has been machine-checked
// against dialect's measured table (no DIALECT_REPO on this machine).
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryPlus, quoteIfSpaced } from '../text.ts';

function build(state: PlatformQueryState, applied: string[]): string | null {
  const parts: string[] = [];

  for (const term of state.terms) parts.push(quoteIfSpaced(term));
  if (state.terms.length) applied.push('キーワード');

  if (state.keywordsOr.length) {
    parts.push(`(${state.keywordsOr.map(quoteIfSpaced).join(' OR ')})`);
    applied.push('キーワード（いずれか）');
  }

  for (const term of state.exclude) parts.push(`-${quoteIfSpaced(term)}`);
  if (state.exclude.length) applied.push('除外キーワード');

  for (const tag of state.hashtag) parts.push(`#${tag}`);
  if (state.hashtag.length) applied.push('ハッシュタグ');

  if (state.hashtagOr.length) {
    parts.push(`(${state.hashtagOr.map((h) => `#${h}`).join(' OR ')})`);
    applied.push('ハッシュタグ（いずれか）');
  }

  for (const tag of state.excludeHashtag) parts.push(`-#${tag}`);
  if (state.excludeHashtag.length) applied.push('除外ハッシュタグ');

  if (state.fromUser) {
    parts.push(`from:${state.fromUser}`);
    applied.push('投稿者');
  }
  for (const u of state.excludeUser) parts.push(`-from:${u}`);
  if (state.excludeUser.length) applied.push('除外する投稿者');

  if (state.since) {
    parts.push(`since:${state.since}`);
    applied.push('期間（開始）');
  }
  if (state.until) {
    parts.push(`until:${state.until}`);
    applied.push('期間（終了）');
  }

  if (state.videoOnly) {
    parts.push('filter:videos');
    applied.push('動画のみ');
  } else if (state.mediaOnly) {
    parts.push('filter:media');
    applied.push('メディアのみ');
  }

  if (state.repliesOnly) {
    parts.push('filter:replies');
    applied.push('返信のみ');
  } else if (state.excludeReplies) {
    parts.push('-filter:replies');
    applied.push('返信を除外');
  }

  if (state.minLikes != null) {
    parts.push(`min_faves:${state.minLikes}`);
    applied.push('いいね数の下限');
  }
  if (state.minReposts != null) {
    parts.push(`min_retweets:${state.minReposts}`);
    applied.push('リポスト数の下限');
  }
  if (state.minReplies != null) {
    parts.push(`min_replies:${state.minReplies}`);
    applied.push('返信数の下限');
  }

  if (!parts.length) return null;
  return `https://x.com/search?q=${encodeQueryPlus(parts.join(' '))}&src=typed_query&f=live`;
}

export const xPlatform: PlatformDef = {
  id: 'x',
  label: 'X',
  build(state) {
    const applied: string[] = [];
    const approximated: PlatformResult['approximated'] = [];
    const dropped: PlatformResult['dropped'] = [];
    if (isEmptyState(state)) return { url: null, applied, approximated, dropped };
    const url = build(state, applied);
    return { url, applied, approximated, dropped };
  },
};
