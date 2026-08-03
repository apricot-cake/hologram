// Bluesky search translation. Machine-checked against the frozen sister project
// apricot-cake/dialect via scripts/check-websearch-equivalence.cts (#822, 2026-08-03) -
// dialect's own bluesky.ts, GUI-measured 2026-07-11 (issue #27), turned out to support
// far more than Bluesky's help-center-documented operator set: exclude(-word, partial/
// undocumented but confirmed working), author exclusion, an OR hashtag cluster, tag
// exclusion, and media/video/reply filters - all sent as separate URL params
// (&author=/&excludeAuthor=/&tag=/&excludeTag=/&media=/&video=/&replies=), not as q=
// tokens. In particular hashtagOr (&tag=, OR semantics) IS real on Bluesky, confirming
// the suspicion recorded in the Issue - this module previously dropped it out of
// caution with no dialect access to check against.
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryPlus, encodeQueryTokens, quoteIfSpaced, stripAt, stripHash, stripQuerySyntax } from '../text.ts';

function build(state: PlatformQueryState, applied: string[], dropped: PlatformResult['dropped']): string | null {
  const terms = state.terms.map(quoteIfSpaced).filter(Boolean);
  const excludeTerms = state.exclude.map((t) => stripQuerySyntax(t).trim()).filter(Boolean);
  const tags = state.hashtag.map(stripHash).filter(Boolean);
  const fromUser = state.fromUser ? stripAt(state.fromUser) : '';
  const excludeUser = state.excludeUser.map(stripAt).filter(Boolean).join(' ');
  const orTags = state.hashtagOr.map(stripHash).filter(Boolean).join(' ');
  const excludeTags = state.excludeHashtag.map(stripHash).filter(Boolean).join(' ');

  // A search needs a positive condition to run: exclude/media/reply-filter alone (with
  // no keyword, tag, author or hashtag-OR cluster) is not a search Bluesky will run.
  // Matches dialect's own hasPositiveTerm-based gate (bluesky.ts).
  if (!terms.length && !tags.length && !fromUser && !orTags.length) return null;

  const qParts: string[] = [...terms];
  if (terms.length) applied.push('キーワード');

  if (state.keywordsOr.length) dropped.push({ reason: 'Bluesky の検索は「いずれか」条件に対応していません' });

  qParts.push(...excludeTerms.map((t) => `-${t}`));
  if (excludeTerms.length) applied.push('除外キーワード');

  qParts.push(...tags.map((t) => `#${t}`));
  if (tags.length) applied.push('ハッシュタグ');

  if (state.since) {
    qParts.push(`since:${state.since}`);
    applied.push('期間（開始）');
  }
  if (state.until) {
    qParts.push(`until:${state.until}`);
    applied.push('期間（終了）');
  }

  // Param order below (media/video/replies, then author/excludeAuthor/tag/excludeTag)
  // matches dialect's own buildParts append order exactly (bluesky.ts) - functionally
  // order-independent, but kept identical for byte-equal URLs against the equivalence
  // harness.
  const paramParts: string[] = [`q=${encodeQueryTokens(qParts)}`];

  if (state.mediaOnly) {
    paramParts.push('media=true');
    applied.push('メディアのみ');
  }
  if (state.videoOnly) {
    paramParts.push('video=true');
    applied.push('動画のみ');
  }
  // replies=none/only is one param with two values (mutually exclusive) - excludeReplies
  // wins if both are set, matching dialect's own conflict resolution (bluesky.ts).
  if (state.excludeReplies) {
    paramParts.push('replies=none');
    applied.push('返信を除外');
  } else if (state.repliesOnly) {
    paramParts.push('replies=only');
    applied.push('返信のみ');
  }

  // author=/excludeAuthor=/tag=/excludeTag= take space-joined multi-value lists
  // (form-encoded, "+" for space) - a different URL param family from the q= tokens
  // above, per dialect's 2026-07-11 GUI capture (issue #27).
  if (fromUser) {
    paramParts.push(`author=${encodeQueryPlus(fromUser)}`);
    applied.push('投稿者');
  }
  if (excludeUser) {
    paramParts.push(`excludeAuthor=${encodeQueryPlus(excludeUser)}`);
    applied.push('除外する投稿者');
  }
  if (orTags) {
    paramParts.push(`tag=${encodeQueryPlus(orTags)}`);
    applied.push('ハッシュタグ（いずれか）');
  }
  if (excludeTags) {
    paramParts.push(`excludeTag=${encodeQueryPlus(excludeTags)}`);
    applied.push('除外ハッシュタグ');
  }

  if (state.minLikes != null || state.minReposts != null || state.minReplies != null) dropped.push({ reason: 'Bluesky の検索はエンゲージメント数の下限に対応していません' });

  return `https://bsky.app/search?${paramParts.join('&')}`;
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
