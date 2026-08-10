// pixiv 検索への翻訳。pixiv の検索はそもそもタグ検索
// （https://www.pixiv.net/tags/<word>/artworks）＝全文検索の別モードは存在しないので、
// Hologram の 'text' と 'tag'/'hashtag' の葉はどちらもここで同じ語の一覧へ畳み込まれる
// （アダプタが tag と hashtag を state.hashtag へ既にまとめている。このモジュールはさらに
// state.terms もタグ検索の語の近似として扱う＝pixiv 自身の検索ボックスも同じように自由な
// テキストを受け付けるため）。scd=/ecd=（since/until）と -word の除外構文は、実在する pixiv
// の検索 URL のパラメータ。いいね数の下限を「Nusers入り」のブックマーク数タグで近似するのは
// Issue 自身が挙げている例で、dialect には対応するものが無い（dialect の pixivPopular は UI で
// 選ぶしきい値の概念で、素のいいね数から導かれるものではない）。
//
// 凍結した姉妹プロジェクト apricot-cake/dialect に対して
// scripts/check-websearch-equivalence.cts で機械的に突き合わせている（#822・2026-08-03）＝
// dialect の pixiv.ts は、このモジュールの前の版に本物の不具合を2つ見つけた。(1) 常に
// s_mode=s_tag_full（タグの完全一致）を強制していたが、s_mode を付けないときの pixiv 自身の
// 既定はもっと広いタグの部分一致。dialect は、Hologram が露出していないモードの概念
// （titleOnly/exactTag/tagTitleCaption）が実際に選ばれたときにだけ s_mode を付ける。
// (2) 常に order=date_d を送っていたが、dialect 自身の 2026-07-04 の GUI 調査によれば、
// これは scd=/ecd=（since/until）と組み合わせると pixiv のエラーページを返す。dialect は
// order=date_d を一切送らない（新しい順は既に pixiv の既定で、安全なときでも送るのは冗長）。
// どちらも、dialect が自分の切り分けの概念をどれも立てていないときにそうするのと同じく、
// URL から s_mode と order を落としたままにすることで下で直してある。pixiv には引用符の構文も
// そもそも無い（空白を含む語やタグは1つの句ではなく、別々に AND される2語として埋め込まれ
// る）。このモジュールは以前、引用符があるかのように複数語の項目を引用符で囲んでいた。
//
// state.fromUser（数字の pixiv ユーザーID。取得した投稿のメタデータから直に解決する＝
// resolve-user.ts を参照）は、タグ検索ではなくその作者自身の作品一覧のページへ飛ぶ。dialect
// に対応するものは無い（dialect の pixiv モジュールは fromUser の概念をそもそも読まない＝
// 翻訳先になる、投稿者で絞った pixiv のタグ検索が存在しない）。つまりこれは、dialect の抽象
// 的な QueryState ビルダーが同じ細かさでは持たない情報を使った Hologram だけの拡張で、その
// まま残す。同じく excludeHashtag も exclude と同じ -word の除外一覧へ畳み込む（pixiv のタグ
// 空間は平らで、「除外タグ」と「除外キーワード」を分ける仕組みが無い）。dialect の pixiv
// モジュールが excludeHashtag も読まないのは同様だが、下にある演算子は exclude と同一なので、
// これを翻訳するのは推測ではなく、厳密により完全になるだけ。
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryTokens, stripHash, stripQuerySyntax } from '../text.ts';

// 作品がそれぞれのしきい値を超えたときに pixiv が自動で付ける、ブックマーク数タグ。
// 「いいね N 件以上」を「N 以下で最大のブックマーク数タグを持つ」で近似する＝正確になること
// は決してない（ブックマーク 12,000 件の作品は 10,001 件の作品と同じに読める）。Issue がこれを
// 警告アイコンの要るものとして名指ししているのは、まさにそのため。
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

/** アダプタが組み立てる pixiv の ResolvedUser のハンドルは、素の数字の id（resolve-user.ts
 * を参照）＝それ以外の形は、その葉について本物の pixiv ユーザーID が取得された事実が無い
 * ということ。 */
function isNumericPixivUserId(v: string): boolean {
  return /^\d+$/.test(v);
}

function build(state: PlatformQueryState, applied: string[], approximated: PlatformResult['approximated'], dropped: PlatformResult['dropped']): string | null {
  // pixiv の「この作者から」の閲覧とタグ検索は別々のページで、両方を混ぜるにはこのモジュール
  // が裏を取れない経路が要る（モジュール冒頭を参照）。だから投稿者の条件が解決したときは、
  // 問い合わせの他のすべてを落としたものとして報告し、URL はその作者の作品一覧だけにする
  // （それでも本物の、役に立つ飛び先ではある）。
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

  // 下の順序（terms・keywordsOr・hashtag、そしてブックマーク数タグ）は、dialect の buildParts
  // の追加順（pixiv.ts）と完全に一致させてある。すべてが AND で結ばれる同じタグ検索の経路に
  // 着くので、他のプラットフォームのように別々の URL パラメータになるのとは違い、ここでの語の
  // 順序は、等価性のハーネスがバイト単位で突き合わせる URL 文字列の一部になる。
  const toks: string[] = [];

  const terms = state.terms.map(clean).filter(Boolean);
  toks.push(...terms);
  if (terms.length) approximated.push({ note: 'キーワードはタグ検索の語として近似されます' });

  // OR の候補が1つだけなら括弧も OR も要らない＝dialect の orWords.length >= 2 の切り分けと
  // 同じ（pixiv.ts）。pixiv のヘルプセンターは OR・除外・括弧によるグループの構文をそのまま
  // 文書にしている。X の同等物が文書化されておらず実測で確かめるしかないのとは違う。
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

  // 肯定形のタグ／キーワードの条件が要る＝除外と期間だけでは、pixiv のタグ検索 URL に居場所
  // が無い（dialect の toks.length===0 の切り分けと同じで、除外を足す前に確かめる）。
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
