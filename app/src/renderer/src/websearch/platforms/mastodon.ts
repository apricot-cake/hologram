// Mastodon search translation. Mastodon 4.2 documented (in its own release notes and
// user-facing search help) a small full-text operator set: from:, before:, after:,
// has:media/has:poll/has:embed/has:link, language:. This module uses the operators most
// consistently documented (from:/before:/after:/has:media); it does NOT assume an
// exclude(-) or OR operator, which are not confidently documented, so those concepts are
// dropped rather than guessed (see types.ts's confidence note).
//
// needsInstanceHost: like Misskey, full-text search on Mastodon requires being logged
// into the instance you search from, so the URL always targets the configured home
// instance, never the saved post's own origin host.
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryPlus, quoteIfSpaced } from '../text.ts';

function build(state: PlatformQueryState, host: string, applied: string[], approximated: PlatformResult['approximated'], dropped: PlatformResult['dropped']): string | null {
  const parts: string[] = [];

  for (const term of state.terms) parts.push(quoteIfSpaced(term));
  if (state.terms.length) applied.push('キーワード');

  for (const tag of state.hashtag) parts.push(`#${tag}`);
  if (state.hashtag.length) applied.push('ハッシュタグ');

  if (state.fromUser) {
    parts.push(`from:@${state.fromUser}`);
    applied.push('投稿者');
  }

  if (state.since) {
    parts.push(`after:${state.since}`);
    approximated.push({ note: '期間（開始）は日付の境界が実際とずれる場合があります' });
  }
  if (state.until) {
    parts.push(`before:${state.until}`);
    approximated.push({ note: '期間（終了）は日付の境界が実際とずれる場合があります' });
  }

  if (state.videoOnly) {
    parts.push('has:media');
    approximated.push({ note: '「動画のみ」はメディア全般（has:media）に近似されます' });
  } else if (state.mediaOnly) {
    parts.push('has:media');
    applied.push('メディアのみ');
  }

  if (state.keywordsOr.length || state.exclude.length || state.hashtagOr.length || state.excludeHashtag.length) {
    dropped.push({ reason: 'Mastodon の検索は除外・「いずれか」条件に対応していません' });
  }
  if (state.excludeUser.length) dropped.push({ reason: 'Mastodon の検索は投稿者の除外に対応していません' });
  if (state.repliesOnly || state.excludeReplies) dropped.push({ reason: 'Mastodon の検索は返信の絞り込みに対応していません' });
  if (state.minLikes != null || state.minReposts != null || state.minReplies != null) dropped.push({ reason: 'Mastodon の検索はエンゲージメント数の下限に対応していません' });

  if (!parts.length) return null;
  return `https://${host}/search?q=${encodeQueryPlus(parts.join(' '))}&type=statuses`;
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
