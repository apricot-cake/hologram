// サイトで絞らない素の Google への変換。dialect 自身のプラットフォームの表（Google を6件目
// として持っていた）と揃えるため、そして下のプロパティテストのために残してある。
// ポップオーバーはこれを選べる行としては一切見せない（UI が実際に出すものは
// googleFallback.ts を参照＝行ごとの、site: で絞った代替のリンク）。このモジュールがあるのは、
// 「タグ・投稿者・日付に当たる演算子の概念を実質持たない検索エンジンへ翻訳する」処理の
// 実装を、テスト済みの1本にして両方の呼び出し側で共有するため。5つのサイトのモジュールと
// 違い、これは狭めていない QueryState をそのまま受け取る＝解決済みの投稿者がどのプラット
// フォーム由来かは、素のキーワード検索には関係しない。
import type { QueryState } from '../types.ts';
import { encodeQueryPlus, quoteIfSpaced } from '../text.ts';

export interface GoogleBuildResult {
  url: string | null;
  applied: string[];
  approximated: { note: string }[];
  dropped: { reason: string }[];
}

export function buildGoogleQuery(state: QueryState, siteDomain?: string | null): GoogleBuildResult {
  const applied: string[] = [];
  const approximated: GoogleBuildResult['approximated'] = [];
  const dropped: GoogleBuildResult['dropped'] = [];

  const words: string[] = [];
  if (siteDomain) words.push(`site:${siteDomain}`);

  for (const t of state.terms) words.push(quoteIfSpaced(t));
  if (state.terms.length) applied.push('キーワード');
  for (const t of state.keywordsOr) words.push(quoteIfSpaced(t));
  if (state.keywordsOr.length) approximated.push({ note: '「いずれか」条件は通常のキーワードとして近似されます' });
  for (const t of state.exclude) words.push(`-${quoteIfSpaced(t)}`);
  if (state.exclude.length) applied.push('除外キーワード');

  for (const tag of state.hashtag) words.push(`"#${tag}"`);
  if (state.hashtag.length) applied.push('ハッシュタグ');
  for (const tag of state.hashtagOr) words.push(`"#${tag}"`);
  if (state.hashtagOr.length) approximated.push({ note: '「いずれか」条件は通常のキーワードとして近似されます' });
  for (const tag of state.excludeHashtag) words.push(`-"#${tag}"`);
  if (state.excludeHashtag.length) applied.push('除外ハッシュタグ');

  if (state.fromUser) {
    words.push(quoteIfSpaced(state.fromUser.handle));
    approximated.push({ note: '投稿者は通常のキーワードとして近似されます' });
  }
  for (const u of state.excludeUser) words.push(`-${quoteIfSpaced(u.handle)}`);
  if (state.excludeUser.length) applied.push('除外する投稿者');

  if (state.since || state.until || state.mediaOnly || state.videoOnly || state.repliesOnly || state.excludeReplies || state.minLikes != null || state.minReposts != null || state.minReplies != null) {
    dropped.push({ reason: 'Google 検索は期間・メディア種別・エンゲージメント数の絞り込みに対応していません' });
  }

  const meaningfulWords = siteDomain ? words.length > 1 : words.length > 0;
  if (!meaningfulWords) return { url: null, applied, approximated, dropped };
  return { url: `https://www.google.com/search?q=${encodeQueryPlus(words.join(' '))}`, applied, approximated, dropped };
}
