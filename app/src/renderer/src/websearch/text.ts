// Small text helpers shared by the platform modules - quoting a term that contains
// whitespace so it stays one token, and the couple of URL-encoding quirks that differ
// per site (dialect's own note, carried over: "URLエンコードは実測準拠 - サイトごと空白
// +/%20が違う - 直したい誘惑が最大の敵"). Nothing here is exact-copied from dialect (that
// repo is unreachable on this machine); it is the ordinary, documented behavior of
// encodeURIComponent plus each site's own query-string convention.

/** Wraps a term in double quotes when it contains whitespace, so a multi-word phrase
 * reads as one token to the site's query parser instead of several ANDed words. Already-
 * quoted or single-word terms pass through unchanged. */
export function quoteIfSpaced(term: string): string {
  const t = term.trim();
  if (!t) return t;
  if (/\s/.test(t) && !(t.startsWith('"') && t.endsWith('"'))) return `"${t}"`;
  return t;
}

/** encodeURIComponent, but with the space encoded as '+' (the `application/x-www-form-
 * urlencoded` convention most query-string builders, including X's, use for a `q=`
 * value) rather than '%20'. */
export function encodeQueryPlus(s: string): string {
  return encodeURIComponent(s).replace(/%20/g, '+');
}

/** Joins non-empty, trimmed strings with a single space - the common "AND by
 * juxtaposition" shape every one of these sites' query boxes uses. */
export function joinTerms(parts: ReadonlyArray<string | null | undefined>): string {
  return parts
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean)
    .join(' ');
}
