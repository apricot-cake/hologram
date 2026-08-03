// X (twitter/x.com) advanced-search translation. Its query-operator set is the richest
// and most publicly documented of the five sites, so this module supports the most
// concepts. Operators used below (from:/since:/until:/filter:media/filter:videos/
// filter:replies/-filter:replies/min_faves:/min_retweets:/min_replies:/-word/(a OR b)/
// #tag) are X's long-published "advanced search" syntax.
//
// Machine-checked against the frozen sister project apricot-cake/dialect via
// scripts/check-websearch-equivalence.cts (#822, 2026-08-03) - dialect's own x.ts
// confirmed this module's operator choices and found the single-item-OR-needs-no-parens
// rule (below) and the query-syntax-stripping/%20-encoding bugs fixed in text.ts.
// videoOnly/repliesOnly/hashtagOr/excludeHashtag remain Hologram-only extensions beyond
// dialect's own X module (dialect scopes videoOnly/repliesOnly/hashtagOr to Bluesky
// only, and has no excludeHashtag concept for X at all) - kept as-is since each maps to
// a real, working X operator, just not one dialect happened to model for this site.
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryTokens, quoteIfSpaced, stripAt, stripHash, stripQuerySyntax } from '../text.ts';

function build(state: PlatformQueryState, applied: string[]): string | null {
  const terms = state.terms.map(quoteIfSpaced).filter(Boolean);
  const orWords = state.keywordsOr.map(quoteIfSpaced).filter(Boolean);
  const tags = state.hashtag.map(stripHash).filter(Boolean);
  const fromUser = state.fromUser ? stripAt(state.fromUser) : '';

  // X requires a positive condition to run at all (from:/hashtag/keywords) - an
  // exclude-only or engagement-only query is not a search X will run. Matches dialect's
  // own hasPositiveTerm gate (x.ts).
  if (!terms.length && !tags.length && !fromUser && !orWords.length) return null;

  const parts: string[] = [...terms];
  if (terms.length) applied.push('キーワード');

  // A single OR-candidate needs no parens/OR at all - it is just a normal word (matches
  // dialect's own orWords.length >= 2 gate, x.ts).
  if (orWords.length >= 2) parts.push(`(${orWords.join(' OR ')})`);
  else parts.push(...orWords);
  if (orWords.length) applied.push('キーワード（いずれか）');

  for (const term of state.exclude.map((t) => stripQuerySyntax(t).trim()).filter(Boolean)) parts.push(`-${term}`);
  if (state.exclude.length) applied.push('除外キーワード');

  if (fromUser) {
    parts.push(`from:${fromUser}`);
    applied.push('投稿者');
  }
  for (const u of state.excludeUser.map(stripAt).filter(Boolean)) parts.push(`-from:${u}`);
  if (state.excludeUser.length) applied.push('除外する投稿者');

  parts.push(...tags.map((t) => `#${t}`));
  if (tags.length) applied.push('ハッシュタグ');

  // hashtagOr is a Hologram-only extension on X (dialect scopes hashtagOr to Bluesky
  // only - see types.ts); kept consistent with keywordsOr's own single-item rule above.
  const orTags = state.hashtagOr.map(stripHash).filter(Boolean);
  if (orTags.length >= 2) parts.push(`(${orTags.map((h) => `#${h}`).join(' OR ')})`);
  else parts.push(...orTags.map((h) => `#${h}`));
  if (orTags.length) applied.push('ハッシュタグ（いずれか）');

  for (const tag of state.excludeHashtag.map(stripHash).filter(Boolean)) parts.push(`-#${tag}`);
  if (state.excludeHashtag.length) applied.push('除外ハッシュタグ');

  if (state.since) {
    parts.push(`since:${state.since}`);
    applied.push('期間（開始）');
  }
  if (state.until) {
    parts.push(`until:${state.until}`);
    applied.push('期間（終了）');
  }

  // videoOnly/repliesOnly are Hologram-only extensions beyond dialect's own X module -
  // dialect scopes those two concepts to Bluesky exclusively (see types.ts), but X's
  // documented advanced search has real, working filter:videos/filter:replies operators
  // of its own, so this module maps the generalized concept onto them rather than
  // leaving a working operator unused. Not a translation gap - dialect never modeled
  // this input for X either way.
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

  // f=live pins the newest-first tab: Hologram has no user-facing sort concept (unlike
  // dialect, which exposes new/top as a choice), so it always requests newest - the
  // library-search use case cares about "what did I just save", not X's algorithmic Top
  // tab. src=typed_query is X's own UI-origin marker, harmless decoration dialect's
  // resolve() does not bother adding. Both are a deliberate, documented divergence from
  // dialect found during #822's equivalence pass, not a translation gap - see
  // types.ts's confidence note.
  return `https://x.com/search?q=${encodeQueryTokens(parts)}&src=typed_query&f=live`;
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
