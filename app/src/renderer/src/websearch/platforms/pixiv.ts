// pixiv search translation. pixiv's search IS a tag search
// (https://www.pixiv.net/tags/<word>/artworks) - there is no separate full-text mode, so
// both Hologram 'text' and 'tag'/'hashtag' leaves fold into the same word list here (the
// adapter already merges tag+hashtag into state.hashtag; this module additionally treats
// state.terms as approximate tag-search words, since pixiv's own search box accepts
// free text the same way). scd=/ecd= (since/until) and the -word exclusion syntax are
// real pixiv search URL parameters; the "Nusers入り" milestone-tag approximation for a
// likes floor is the Issue's own example, with no equivalent in dialect (dialect's own
// pixivPopular is a UI-chosen threshold concept, not derived from a raw likes number).
//
// Machine-checked against the frozen sister project apricot-cake/dialect via
// scripts/check-websearch-equivalence.cts (#822, 2026-08-03) - dialect's own pixiv.ts
// found two real bugs in the previous version of this module: (1) it always forced
// s_mode=s_tag_full (exact tag match), when pixiv's own default with no s_mode is a
// broader PARTIAL tag match - dialect only sets s_mode when a mode concept Hologram does
// not expose (titleOnly/exactTag/tagTitleCaption) is actually chosen; (2) it always sent
// order=date_d, which dialect's own 2026-07-04 GUI research found returns pixiv's error
// page when combined with scd=/ecd= (since/until) - dialect never sends order=date_d at
// all (new-first is already pixiv's default, sending it is redundant even when safe).
// Both are fixed below by leaving the URL bare of s_mode/order the way dialect does when
// none of its own gating concepts are set. pixiv also has no quote syntax at all (a
// term/tag with a space embeds as two separately-AND'd words, not a phrase) - this
// module previously wrapped multi-word entries in quotes as if it did.
//
// state.fromUser (a numeric pixiv user id, resolved directly from captured post
// metadata - see resolve-user.ts) jumps to that artist's own works-list page instead of
// a tag search; dialect has no equivalent (its pixiv module never reads a fromUser
// concept at all - there is no author-filtered pixiv tag search to translate to), so
// this is a Hologram-only extension using information dialect's abstract QueryState
// builder does not carry with the same specificity, kept as-is. Likewise
// excludeHashtag folds into the same -word exclusion list as exclude (pixiv's tag space
// is flat - there is no separate "excluded tag" vs "excluded keyword" mechanism) even
// though dialect's own pixiv module never reads excludeHashtag either; the underlying
// operator is identical to exclude, so translating it is strictly more complete, not a
// guess.
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryTokens, stripHash, stripQuerySyntax } from '../text.ts';

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

  const clean = (s: string) => stripQuerySyntax(s).trim();

  // Order below (terms, keywordsOr, hashtag, then the milestone tag) matches dialect's
  // own buildParts append order exactly (pixiv.ts) - all land in the same AND'd
  // tag-search path, so unlike the other platforms' separate URL params, word order
  // here is part of the URL string the equivalence harness compares byte-for-byte.
  const toks: string[] = [];

  const terms = state.terms.map(clean).filter(Boolean);
  toks.push(...terms);
  if (terms.length) approximated.push({ note: 'キーワードはタグ検索の語として近似されます' });

  // A single OR-candidate needs no parens/OR at all - matches dialect's own
  // orWords.length >= 2 gate (pixiv.ts). pixiv's own help center documents OR/exclude/
  // parens-group syntax directly, unlike X's undocumented-but-measured equivalent.
  const orWords = state.keywordsOr.map(clean).filter(Boolean);
  if (orWords.length >= 2) toks.push(`(${orWords.join(' OR ')})`);
  else toks.push(...orWords);
  if (orWords.length) applied.push('キーワード（いずれか）');

  const tags = state.hashtag.map(stripHash).filter(Boolean);
  toks.push(...tags);
  if (tags.length) applied.push('タグ');

  if (state.hashtagOr.length) dropped.push({ reason: 'pixiv の検索はハッシュタグの「いずれか」条件に対応していません' });
  if (state.excludeUser.length) dropped.push({ reason: 'pixiv の検索は投稿者の除外に対応していません' });
  if (state.mediaOnly || state.videoOnly) dropped.push({ reason: 'pixiv の検索URLではメディア種別を絞り込めません' });
  if (state.repliesOnly || state.excludeReplies) dropped.push({ reason: 'pixiv に返信の概念はありません' });
  if (state.minReposts != null || state.minReplies != null) dropped.push({ reason: 'pixiv にリポスト数・返信数の概念はありません' });

  if (state.minLikes != null) {
    const tag = nearestMilestoneTag(state.minLikes);
    if (tag) {
      toks.push(tag);
      approximated.push({ note: `いいね数の下限は近いブックマーク数タグ（${tag}）に近似され、実際の下限とは異なる場合があります` });
    } else {
      dropped.push({ reason: 'いいね数の下限が小さすぎて対応するタグがありません' });
    }
  }

  // A positive tag/keyword condition is required - excludes and a date range alone have
  // nowhere to live in pixiv's tag-search URL (matches dialect's own toks.length===0
  // gate, checked before excludes are appended).
  if (!toks.length) {
    if (state.since || state.until) dropped.push({ reason: 'pixiv の検索URLはタグ・キーワードなしの期間指定に対応していません' });
    return null;
  }

  const excludeToks: string[] = [];
  const excludeTerms = state.exclude.map(clean).filter(Boolean);
  excludeToks.push(...excludeTerms.map((t) => `-${t}`));
  if (excludeTerms.length) applied.push('除外キーワード');
  const excludeTags = state.excludeHashtag.map(stripHash).filter(Boolean);
  excludeToks.push(...excludeTags.map((t) => `-${t}`));
  if (excludeTags.length) applied.push('除外タグ');

  let url = `https://www.pixiv.net/tags/${encodeQueryTokens([...toks, ...excludeToks])}/artworks`;
  const params: string[] = [];
  if (state.since) {
    params.push(`scd=${state.since}`);
    applied.push('期間（開始）');
  }
  if (state.until) {
    params.push(`ecd=${state.until}`);
    applied.push('期間（終了）');
  }
  if (params.length) url += `?${params.join('&')}`;
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
