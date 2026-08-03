// Misskey search translation. Machine-checked against the frozen sister project
// apricot-cake/dialect via scripts/check-websearch-equivalence.cts (#822, 2026-08-03) -
// dialect's own misskey.ts (GUI/route-table research, 2026-07-03/07-08) found more than
// a plain full-text box: Meilisearch backs /search?q=, so a leading "-word" DOES exclude
// (undocumented but confirmed working), and the frontend router exposes non-public
// &username=/&host= params for an author filter. Quote syntax, by contrast, is
// confirmed BROKEN (wrapping a term in "..." makes the whole search return 0 results,
// even combined with other AND terms) - so unlike X/Bluesky/Mastodon, this module never
// quotes a multi-word term.
//
// needsInstanceHost: search is login-gated on most instances, so the URL always targets
// the user's configured home instance (websearch/prefs.ts), never the saved post's own
// origin host.
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryTokens, stripAt, stripHash, stripQuerySyntax } from '../text.ts';

function build(state: PlatformQueryState, host: string, applied: string[], dropped: PlatformResult['dropped']): string | null {
  const terms = state.terms.map((t) => stripQuerySyntax(t).trim()).filter(Boolean);
  const tags = state.hashtag.map(stripHash).filter(Boolean);
  const handle = state.fromUser ? stripAt(state.fromUser) : '';
  const excludeToks = state.exclude.map((t) => `-${stripQuerySyntax(t).trim()}`).filter((t) => t !== '-');

  if (state.keywordsOr.length || state.hashtagOr.length || state.excludeHashtag.length) {
    dropped.push({ reason: 'Misskey の検索は「いずれか」条件・除外ハッシュタグに対応していません' });
  }
  if (state.excludeUser.length) dropped.push({ reason: 'Misskey の検索URLは投稿者の除外に対応していません' });
  if (state.since || state.until) dropped.push({ reason: 'Misskey の検索は期間の絞り込みに対応していません' });
  if (state.mediaOnly || state.videoOnly) dropped.push({ reason: 'Misskey の検索はメディア絞り込みに対応していません' });
  if (state.repliesOnly || state.excludeReplies) dropped.push({ reason: 'Misskey の検索は返信の絞り込みに対応していません' });
  if (state.minLikes != null || state.minReposts != null || state.minReplies != null) dropped.push({ reason: 'Misskey の検索はエンゲージメント数の下限に対応していません' });

  // A single tag, alone, with no other condition: the tag page (/tags/<name>) is the
  // only route Misskey lets a logged-out visitor see. Adding exclude would silently be
  // dropped there (no q= to carry it), so that combination falls through to /search
  // instead - matches dialect's 2026-07-10 fix (previously exclude was lost silently).
  if (tags.length === 1 && terms.length === 0 && !handle && excludeToks.length === 0) {
    applied.push('ハッシュタグ');
    return `https://${host}/tags/${encodeURIComponent(tags[0])}`;
  }

  const toks = [...terms, ...tags.map((t) => `#${t}`)];
  // A user filter alone does not run a search on Misskey - a keyword or hashtag is
  // required (matches dialect's own gate: "ユーザー指定だけでは検索が実行されない").
  if (toks.length === 0) return null;
  if (terms.length) applied.push('キーワード');
  if (tags.length) applied.push('ハッシュタグ');

  toks.push(...excludeToks);
  if (excludeToks.length) applied.push('除外キーワード');

  // type=note is a fixed constant Misskey's own search form always sends, present or
  // absent makes no difference to Hologram's translation - kept for URL-shape fidelity
  // with dialect's measured output.
  let url = `https://${host}/search?q=${encodeQueryTokens(toks)}&type=note`;
  if (handle) {
    // A remote handle (user@host) splits into separate username=/host= params; a local
    // handle sends username= alone.
    const [user, remoteHost] = handle.split('@');
    url += `&username=${encodeURIComponent(user)}`;
    if (remoteHost) url += `&host=${encodeURIComponent(remoteHost)}`;
    applied.push('投稿者');
  }
  return url;
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
    const url = build(state, host, applied, dropped);
    return { url, applied, approximated, dropped };
  },
};
