// Bluesky の検索への変換。凍結した姉妹プロジェクト apricot-cake/dialect と
// scripts/check-websearch-equivalence.cts で機械的に突き合わせてある（#822、2026-08-03）。
// dialect 自身の bluesky.ts（2026-07-11 に GUI で実測、issue #27）は、Bluesky のヘルプ
// センターに載っている演算子の組より遥かに多くを支えていた＝除外（-word。部分的で文書化
// されていないが動作を確認済み）・投稿者の除外・「いずれか」のハッシュタグの束・タグの
// 除外・メディア／動画／返信の絞り込み。どれも q= のトークンではなく別々の URL パラメータ
// （&author=/&excludeAuthor=/&tag=/&excludeTag=/&media=/&video=/&replies=）として送る。
// 特に hashtagOr（&tag=、「いずれか」の意味）は Bluesky に実在し、Issue に書き残されていた
// 疑いを裏付けた＝このモジュールは以前、突き合わせる dialect が手元に無かったので用心して
// 落としていた。
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

  // 検索が走るには肯定の条件が要る。除外・メディア・返信の絞り込みだけ（キーワードも
  // タグも投稿者も「いずれか」のハッシュタグの束も無い）は、Bluesky が走らせてくれる
  // 検索ではない。dialect 自身の hasPositiveTerm による関門と一致する（bluesky.ts）。
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

  // 下のパラメータの順（media/video/replies のあとに author/excludeAuthor/tag/excludeTag）
  // は、dialect 自身の buildParts が足していく順とそっくり同じ（bluesky.ts）。機能としては
  // 順に依らないが、等価性のハーネスに対して URL がバイト単位で一致するよう同じに保つ。
  const paramParts: string[] = [`q=${encodeQueryTokens(qParts)}`];

  if (state.mediaOnly) {
    paramParts.push('media=true');
    applied.push('メディアのみ');
  }
  if (state.videoOnly) {
    paramParts.push('video=true');
    applied.push('動画のみ');
  }
  // replies=none/only は2つの値を取る1つのパラメータ（排他）＝両方立っていれば
  // excludeReplies が勝つ。dialect 自身の衝突の解き方に合わせてある（bluesky.ts）。
  if (state.excludeReplies) {
    paramParts.push('replies=none');
    applied.push('返信を除外');
  } else if (state.repliesOnly) {
    paramParts.push('replies=only');
    applied.push('返信のみ');
  }

  // author=/excludeAuthor=/tag=/excludeTag= は、空白で繋いだ複数値の一覧を取る
  // （form 形式の符号化で、空白は "+"）＝上の q= のトークンとは別系統の URL パラメータ。
  // dialect の 2026-07-11 の GUI での実測による（issue #27）。
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
