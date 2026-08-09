// X（twitter/x.com）の高度な検索への翻訳。問い合わせの演算子の揃いは5サイトの中でいちばん
// 豊富で、公に文書化されてもいるので、このモジュールが対応する概念もいちばん多い。下で使う
// 演算子（from:/since:/until:/filter:media/filter:videos/filter:replies/-filter:replies/
// min_faves:/min_retweets:/min_replies:/-word/(a OR b)/#tag）は、X が長く公開してきた
// 「advanced search」の構文。
//
// 凍結した姉妹プロジェクト apricot-cake/dialect と
// scripts/check-websearch-equivalence.cts で機械的に突き合わせた（#822、2026-08-03）＝
// dialect 自身の x.ts がこのモジュールの演算子の選び方を裏づけ、単一項目の OR には括弧が
// 要らないという規則（下記）と、text.ts で直した問い合わせ構文の除去と %20 の符号化の不具合
// を見つけた。videoOnly/repliesOnly/hashtagOr/excludeHashtag は dialect 自身の X のモジュール
// に無い Hologram だけの拡張のまま（dialect は videoOnly/repliesOnly/hashtagOr を Bluesky に
// 限定していて、X の excludeHashtag という概念は端から持たない）＝どれも実在して実際に効く
// X の演算子へ写るので、そのまま残す。dialect がこのサイト向けにたまたま模していなかった
// だけのこと。
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryTokens, quoteIfSpaced, stripAt, stripHash, stripQuerySyntax } from '../text.ts';

function build(state: PlatformQueryState, applied: string[]): string | null {
  const terms = state.terms.map(quoteIfSpaced).filter(Boolean);
  const orWords = state.keywordsOr.map(quoteIfSpaced).filter(Boolean);
  const tags = state.hashtag.map(stripHash).filter(Boolean);
  const fromUser = state.fromUser ? stripAt(state.fromUser) : '';

  // X はそもそも走らせるのに肯定の条件を要求する（from:/ハッシュタグ/キーワード）＝除外
  // だけ、エンゲージメントだけの問い合わせは X が走らせる検索にならない。dialect 自身の
  // hasPositiveTerm の関門（x.ts）と同じ。
  if (!terms.length && !tags.length && !fromUser && !orWords.length) return null;

  const parts: string[] = [...terms];
  if (terms.length) applied.push('キーワード');

  // OR の候補が1つだけなら括弧も OR も要らない＝ただの普通の語（dialect 自身の
  // orWords.length >= 2 の関門と同じ。x.ts）。
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

  // hashtagOr は X における Hologram だけの拡張（dialect は hashtagOr を Bluesky に限定
  // している＝types.ts 参照）。上の keywordsOr 自身の単一項目の規則と揃えてある。
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

  // videoOnly/repliesOnly は dialect 自身の X のモジュールに無い Hologram だけの拡張＝
  // dialect はこの2つの概念を Bluesky だけに限定している（types.ts 参照）が、X の文書化
  // された高度な検索には実在して実際に効く filter:videos/filter:replies の演算子がある。
  // だからこのモジュールは、効く演算子を使わずに置くのではなく、一般化した概念をそれらへ
  // 写す。翻訳の欠落ではない＝dialect はどのみち X についてこの入力を模していない。
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

  // f=live は新しい順のタブに固定する＝Hologram は利用者に見えるソートの概念を持たない
  // （new/top を選択肢として出す dialect とは違う）ので、常に新しい順を要求する。ライブラリ
  // 検索という使い方が気にするのは「自分がついさっき保存したもの」であって、X のアルゴリズム
  // が決める Top のタブではない。src=typed_query は X 自身が付ける UI 由来の印で、dialect の
  // resolve() がわざわざ付けない無害な飾り。どちらも #822 の等価性の確認で見つかった、意図
  // してそうしている dialect との差異であって翻訳の欠落ではない＝types.ts の確信度の注記を
  // 参照。
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
