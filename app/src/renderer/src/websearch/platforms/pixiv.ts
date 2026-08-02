// pixiv search translation. pixiv's search IS a tag search
// (https://www.pixiv.net/tags/<word>/artworks) - there is no separate full-text mode, so
// both Hologram 'text' and 'tag'/'hashtag' leaves fold into the same word list here (the
// adapter already merges tag+hashtag into state.hashtag; this module additionally treats
// state.terms as approximate tag-search words, since pixiv's own search box accepts
// free text the same way). scd=/ecd= (since/until) and the -word exclusion syntax are
// real, commonly-seen pixiv search URL parameters; the "Nusers入り" milestone-tag
// approximation for a likes floor is the Issue's own example. None of this has been
// machine-checked against dialect (see types.ts's confidence note).
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryPlus, quoteIfSpaced } from '../text.ts';

// Automatic bookmark-count milestone tags pixiv appends to a work once it crosses each
// threshold. Approximating "at least N likes" as "carries the largest milestone tag <= N"
// - never exact (a work with 12,000 bookmarks reads the same as one with 10,001), which
// is exactly why the Issue calls this one out as needing the warning icon.
const BOOKMARK_MILESTONES: ReadonlyArray<[number, string]> = [
  [100000, '100000users入り'],
  [50000, '50000users入り'],
  [10000, '10000users入り'],
  [5000, '5000users入り'],
  [1000, '1000users入り'],
  [500, '500users入り'],
];
function nearestMilestoneTag(min: number): string | null {
  for (const [threshold, tag] of BOOKMARK_MILESTONES) if (min >= threshold) return tag;
  return null;
}

/** pixiv ResolvedUser handles the adapter builds are a bare numeric id (see
 * resolve-user.ts) - anything else means no real pixiv user id was ever captured for
 * that leaf. */
function isNumericPixivUserId(v: string): boolean {
  return /^\d+$/.test(v);
}

function build(state: PlatformQueryState, applied: string[], approximated: PlatformResult['approximated'], dropped: PlatformResult['dropped']): string | null {
  // A pixiv "from this artist" browse and a tag search are two different pages - combining
  // them would need a route this module cannot verify (see the module header), so when an
  // author condition resolved, everything else about the query is reported as dropped and
  // the URL is just that artist's works list (still a real, useful jump).
  if (state.fromUser) {
    if (!isNumericPixivUserId(state.fromUser)) {
      dropped.push({ reason: 'pixiv のユーザーIDを解決できませんでした' });
    } else {
      applied.push('投稿者');
      const other = state.terms.length || state.keywordsOr.length || state.exclude.length || state.hashtag.length || state.hashtagOr.length || state.excludeHashtag.length || state.since || state.until || state.minLikes != null;
      if (other) dropped.push({ reason: 'pixiv では投稿者の指定と他の条件を同時に翻訳できません' });
      return `https://www.pixiv.net/users/${state.fromUser}/artworks`;
    }
  }

  const words: string[] = [];
  for (const tag of state.hashtag) words.push(quoteIfSpaced(tag));
  if (state.hashtag.length) applied.push('タグ');

  for (const term of state.terms) words.push(quoteIfSpaced(term));
  if (state.terms.length) approximated.push({ note: 'キーワードはタグ検索の語として近似されます' });

  for (const term of state.exclude) words.push(`-${quoteIfSpaced(term)}`);
  if (state.exclude.length) applied.push('除外キーワード');
  for (const tag of state.excludeHashtag) words.push(`-${quoteIfSpaced(tag)}`);
  if (state.excludeHashtag.length) applied.push('除外タグ');

  if (state.keywordsOr.length || state.hashtagOr.length) dropped.push({ reason: 'pixiv の検索は「いずれか」条件に対応していません' });
  if (state.excludeUser.length) dropped.push({ reason: 'pixiv の検索は投稿者の除外に対応していません' });
  if (state.mediaOnly || state.videoOnly) dropped.push({ reason: 'pixiv の検索URLではメディア種別を絞り込めません' });
  if (state.repliesOnly || state.excludeReplies) dropped.push({ reason: 'pixiv に返信の概念はありません' });
  if (state.minReposts != null || state.minReplies != null) dropped.push({ reason: 'pixiv にリポスト数・返信数の概念はありません' });

  if (state.minLikes != null) {
    const tag = nearestMilestoneTag(state.minLikes);
    if (tag) {
      words.push(tag);
      approximated.push({ note: `いいね数の下限は近いブックマーク数タグ（${tag}）に近似され、実際の下限とは異なる場合があります` });
    } else {
      dropped.push({ reason: 'いいね数の下限が小さすぎて対応するタグがありません' });
    }
  }

  if (!words.length) {
    if (!state.since && !state.until) return null;
    // A bare date range with no tag at all has nowhere to live in pixiv's tag-search URL.
    dropped.push({ reason: 'pixiv の検索URLはタグ・キーワードなしの期間指定に対応していません' });
    return null;
  }

  const path = words.join(' ');
  let url = `https://www.pixiv.net/tags/${encodeURIComponent(path)}/artworks?word=${encodeQueryPlus(path)}&s_mode=s_tag_full&order=date_d`;
  if (state.since) {
    url += `&scd=${state.since}`;
    applied.push('期間（開始）');
  }
  if (state.until) {
    url += `&ecd=${state.until}`;
    applied.push('期間（終了）');
  }
  return url;
}

export const pixivPlatform: PlatformDef = {
  id: 'pixiv',
  label: 'pixiv',
  build(state) {
    const applied: string[] = [];
    const approximated: PlatformResult['approximated'] = [];
    const dropped: PlatformResult['dropped'] = [];
    if (isEmptyState(state)) return { url: null, applied, approximated, dropped };
    const url = build(state, applied, approximated, dropped);
    return { url, applied, approximated, dropped };
  },
};
