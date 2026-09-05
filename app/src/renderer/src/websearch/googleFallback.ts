// 検索の弱い行（pixiv・Bluesky＝X の演算子の組より狭いもの）が、
// 落とすか近似するしかなかったぶんについて出す、行ごとの「Google で代替検索」のリンク。
// 中身はそのサイトのドメインに絞った素の Google 検索で、同じ概念を普通のキーワードとして
// 畳み込む。サイト自身への翻訳より意図して単純にしてある（Google もハッシュタグ・投稿者・
// 日付をクエリの概念としては持たないので、キーワードより先はすべて Google の層でもう一度
// 近似される）。
import { buildGoogleQuery, type GoogleBuildResult } from './platforms/google.ts';
import type { QueryState } from './types.ts';

/** domain = その行自身のサイト（たとえば 'pixiv.net'）。 */
export function buildGoogleFallback(state: QueryState, domain: string | null): GoogleBuildResult {
  if (!domain) return { url: null, applied: [], approximated: [], dropped: [{ reason: 'ホームインスタンスが未設定のため Google 代替検索も作成できません' }] };
  return buildGoogleQuery(state, domain);
}
