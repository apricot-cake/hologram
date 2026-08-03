// Mastodon search translation. Machine-checked against the frozen sister project
// apricot-cake/dialect via scripts/check-websearch-equivalence.cts (#822, 2026-08-03) -
// dialect's own mastodon.ts (2026-07-08 GUI-measured, logged-in real search) confirmed
// from:/-word exclude/before:/after:/has:media/-is:reply/language: all work as
// documented, with before:/after: narrowing exactly on the given date (no drift found -
// this module previously flagged that as an approximation with no way to check it).
//
// needsInstanceHost: like Misskey, full-text search on Mastodon requires being logged
// into the instance you search from, so the URL always targets the configured home
// instance, never the saved post's own origin host.
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryTokens, quoteIfSpaced, stripAt, stripHash, stripQuerySyntax } from '../text.ts';

function build(state: PlatformQueryState, host: string, applied: string[], approximated: PlatformResult['approximated'], dropped: PlatformResult['dropped']): string | null {
  const tags = state.hashtag.map(stripHash).filter(Boolean);
  const handle = state.fromUser ? stripAt(state.fromUser) : '';
  const textToks = state.terms.map(quoteIfSpaced).filter(Boolean);
  const excludeToks = state.exclude.map((t) => `-${stripQuerySyntax(t).trim()}`).filter((t) => t !== '-');

  const hasOtherConditions = textToks.length > 0 || excludeToks.length > 0 || Boolean(handle) || Boolean(state.since) || Boolean(state.until) || state.mediaOnly || state.excludeReplies;
  // A single tag, alone, with no other condition: the tag page (/tags/<name>) is the
  // only route a logged-out visitor can see - matches dialect's own single-tag shortcut.
  if (tags.length === 1 && !hasOtherConditions) {
    applied.push('ハッシュタグ');
    return `https://${host}/tags/${encodeURIComponent(tags[0])}`;
  }

  // A search needs a positive condition to run: exclude alone (with no keyword, tag or
  // author) is not a search Mastodon will run. Matches dialect's own hasPositiveTerm
  // gate (mastodon.ts) - fromUser DOES count here, unlike Misskey.
  if (!textToks.length && !tags.length && !handle) return null;

  const toks = [...textToks, ...tags.map((t) => `#${t}`)];
  if (state.terms.length) applied.push('キーワード');
  if (tags.length) applied.push('ハッシュタグ');

  toks.push(...excludeToks);
  if (excludeToks.length) applied.push('除外キーワード');

  if (handle) {
    // A remote handle (user@host) sends as-is; dialect's 2026-07-08 GUI capture
    // confirmed from:user@host works directly, with no leading @ (unlike the mention
    // syntax elsewhere on the site).
    toks.push(`from:${handle}`);
    applied.push('投稿者');
  }

  if (state.since) {
    toks.push(`after:${state.since}`);
    applied.push('期間（開始）');
  }
  if (state.until) {
    toks.push(`before:${state.until}`);
    applied.push('期間（終了）');
  }

  if (state.videoOnly) {
    toks.push('has:media');
    approximated.push({ note: '「動画のみ」はメディア全般（has:media）に近似されます' });
  } else if (state.mediaOnly) {
    toks.push('has:media');
    applied.push('メディアのみ');
  }

  if (state.excludeReplies) {
    toks.push('-is:reply');
    applied.push('返信を除外');
  }

  if (state.keywordsOr.length || state.hashtagOr.length || state.excludeHashtag.length) {
    dropped.push({ reason: 'Mastodon の検索は「いずれか」条件・除外ハッシュタグに対応していません' });
  }
  if (state.excludeUser.length) dropped.push({ reason: 'Mastodon の検索は投稿者の除外に対応していません' });
  if (state.repliesOnly) dropped.push({ reason: 'Mastodon の検索は返信のみへの絞り込みに対応していません' });
  if (state.minLikes != null || state.minReposts != null || state.minReplies != null) dropped.push({ reason: 'Mastodon の検索はエンゲージメント数の下限に対応していません' });

  // type=statuses is a fixed constant, present regardless of the query - kept for
  // URL-shape fidelity with dialect's measured output.
  return `https://${host}/search?q=${encodeQueryTokens(toks)}&type=statuses`;
}

export const mastodonPlatform: PlatformDef = {
  id: 'mastodon',
  label: 'Mastodon',
  needsInstanceHost: true,
  build(state, ctx) {
    const applied: string[] = [];
    const approximated: PlatformResult['approximated'] = [];
    const dropped: PlatformResult['dropped'] = [];
    const host = ctx.instanceHost || '';
    if (!host) {
      dropped.push({ reason: 'ホームインスタンス（Mastodon）が未設定です' });
      return { url: null, applied, approximated, dropped };
    }
    if (isEmptyState(state)) return { url: null, applied, approximated, dropped };
    const url = build(state, host, applied, approximated, dropped);
    return { url, applied, approximated, dropped };
  },
};
