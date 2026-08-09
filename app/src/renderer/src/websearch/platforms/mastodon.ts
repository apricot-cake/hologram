// Mastodon の検索への変換。凍結した姉妹プロジェクト apricot-cake/dialect と
// scripts/check-websearch-equivalence.cts で機械的に突き合わせてある（#822、2026-08-03）。
// dialect 自身の mastodon.ts（2026-07-08 に GUI で実測。ログインした状態の実際の検索）が、
// from: と -word の除外、before:、after:、has:media、-is:reply、language: のすべてが
// 文書どおりに動くことを確かめた。before:/after: は与えた日付でちょうど絞り込まれる
// （ずれは見つからなかった＝このモジュールは以前、確かめる手立てが無いまま近似として
// 印を付けていた）。
//
// needsInstanceHost: Misskey と同じく、Mastodon の全文検索は検索元のインスタンスへ
// ログインしている必要がある。だから URL は常に設定されたホームインスタンスへ向け、
// 保存した投稿の元のホストへは決して向けない。
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryTokens, quoteIfSpaced, stripAt, stripHash, stripQuerySyntax } from '../text.ts';

function build(state: PlatformQueryState, host: string, applied: string[], approximated: PlatformResult['approximated'], dropped: PlatformResult['dropped']): string | null {
  const tags = state.hashtag.map(stripHash).filter(Boolean);
  const handle = state.fromUser ? stripAt(state.fromUser) : '';
  const textToks = state.terms.map(quoteIfSpaced).filter(Boolean);
  const excludeToks = state.exclude.map((t) => `-${stripQuerySyntax(t).trim()}`).filter((t) => t !== '-');

  const hasOtherConditions = textToks.length > 0 || excludeToks.length > 0 || Boolean(handle) || Boolean(state.since) || Boolean(state.until) || state.mediaOnly || state.excludeReplies;
  // タグが1つだけで、他に条件が無い場合。タグのページ（/tags/<name>）は、ログインして
  // いない訪問者が見られる唯一の経路＝dialect 自身のタグ1つの近道と一致する。
  if (tags.length === 1 && !hasOtherConditions) {
    applied.push('ハッシュタグ');
    return `https://${host}/tags/${encodeURIComponent(tags[0])}`;
  }

  // 検索が走るには肯定の条件が要る。除外だけ（キーワードもタグも投稿者も無い）は、
  // Mastodon が走らせてくれる検索ではない。dialect 自身の hasPositiveTerm の関門と
  // 一致する（mastodon.ts）＝ここでは Misskey と違い fromUser も肯定の条件に数える。
  if (!textToks.length && !tags.length && !handle) return null;

  const toks = [...textToks, ...tags.map((t) => `#${t}`)];
  if (state.terms.length) applied.push('キーワード');
  if (tags.length) applied.push('ハッシュタグ');

  toks.push(...excludeToks);
  if (excludeToks.length) applied.push('除外キーワード');

  if (handle) {
    // リモートのハンドル（user@host）はそのまま送る。dialect の 2026-07-08 の GUI での
    // 実測で、from:user@host が先頭の @ 無しでそのまま効くことを確かめた（サイトの他所に
    // あるメンションの構文とは違う）。
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

  // type=statuses は固定の定数で、クエリに関わらず常に付く＝dialect の実測した出力と
  // URL の形を揃えるために残す。
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
