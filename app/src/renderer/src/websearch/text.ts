// プラットフォームのモジュールが共有する小さな文字列のヘルパ＝空白を含む語を1トークンの
// ままにするための引用符付けと、サイトごとに違う URL の符号化の癖いくつか。凍結した姉妹
// プロジェクト apricot-cake/dialect と scripts/check-websearch-equivalence.cts で機械的に
// 突き合わせた（#822、2026-08-03）＝下の encodeQueryTokens と stripQuerySyntax は、dialect
// の urlParts.ts/text.ts で実測された挙動をそのまま再現する（演算子ごとに付いたあちらの
// リポジトリの「GUI操作で実測」のコメントを参照）。

/** エスケープせずに埋め込むと宛先サイトの問い合わせの構文解析を壊すと dialect 自身の調査が
 * 突き止めた2種類の生の文字を落とす＝裸の `"` はフレーズの引用の対応を崩し、裸の `(`/`)` は
 * OR のグループの解析を崩す。dialect の stripQuerySyntax（text.ts）も、利用者が与えた語・
 * タグ・ハンドルを埋め込む前に同じ除去をしている。 */
export function stripQuerySyntax(s: string): string {
  return s.replace(/["()]/g, '');
}

/** from:/author=/username= の演算子へ埋め込む前にハンドルを整える＝問い合わせを壊す文字を
 * 落とし（stripQuerySyntax 参照）、前後を詰め、先頭の '@' を落とす（from:@user という演算子
 * はここに挙げたどのサイトでも無効＝@ はメンションの構文のもので、投稿者の演算子のものでは
 * ない）。dialect の stripAt（text.ts）と同じ。 */
export function stripAt(handle: string): string {
  return stripQuerySyntax(handle).trim().replace(/^@+/, '');
}

/** #tag/tag=/excludeTag= の演算子へ埋め込む前にタグを整える＝問い合わせを壊す文字を落とし、
 * 前後を詰め、先頭の '#'（全角も含む）を落とす。そうしないと、既に自分でハッシュ記号を
 * 持っているタグは、このモジュールが自前のものを足した時点で二重（'##foo'）になる。
 * dialect の stripHash（text.ts）と同じ。 */
export function stripHash(tag: string): string {
  return stripQuerySyntax(tag)
    .trim()
    .replace(/^[#＃]+/, '');
}

/** 語が空白を含むときは二重引用符で包み、複数語のフレーズがサイトの問い合わせの構文解析に
 * とって AND で結ばれた複数の語ではなく1つのトークンとして読まれるようにする。先に問い合わせ
 * を壊す文字を落とす（stripQuerySyntax 参照）＝dialect の quoteIfPhrase と同じで、あちらも
 * 同じ順で「整えてから引用符で包む」をしている。 */
export function quoteIfSpaced(term: string): string {
  const t = stripQuerySyntax(term).trim();
  if (!t) return t;
  if (/[\s　]/.test(t)) return `"${t}"`;
  return t;
}

/** URLSearchParams そのものを通した本物の application/x-www-form-urlencoded ＝サイトの
 * 「他の」パラメータ向け（Bluesky の &author=/&tag= など）で、q= の値には決して使わない
 * （encodeQueryTokens 参照）。encodeURIComponent の空白を + に差し替えたものとは違う＝
 * フォームの符号化はより広い文字集合を退避させる（例: '!' を %21 にする。素の
 * encodeURIComponent はこれを生のまま残す）。dialect 自身の formEncode（urlParts.ts）と
 * 同じで、あちらも同じ理由で全く同じ URLSearchParams の往復を使っている。 */
export function encodeQueryPlus(s: string): string {
  return new URLSearchParams([['', s]]).toString().slice(1);
}

/** q= のトークンを1つずつ独立にパーセント符号化し、リテラルの '%20' で繋ぐ＝dialect が実測
 * した q= の値がどのサイトでも実際に使っている符号化（X・Bluesky・Misskey・Mastodon の
 * すべてを GUI で取得した URL で確認済み）であって、encodeQueryPlus がサイトの他のパラメータ
 * へ当てる '+' のフォーム符号化の流儀ではない。dialect の Misskey のモジュールがその理由を
 * 明示している:「URLSearchParamsはスペースを「+」にするが、Misskey側が「+」をスペースへ
 * 戻す保証がないため、%20になるencodeURIComponentで組む」。 */
export function encodeQueryTokens(tokens: readonly string[]): string {
  return tokens.map((t) => encodeURIComponent(t)).join('%20');
}

/** 空でない、前後を詰めた文字列を空白1つで繋ぐ＝ここに挙げたどのサイトの検索欄も使う
 * 「並べれば AND」という共通の形。 */
export function joinTerms(parts: ReadonlyArray<string | null | undefined>): string {
  return parts
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean)
    .join(' ');
}
