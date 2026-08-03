// Small text helpers shared by the platform modules - quoting a term that contains
// whitespace so it stays one token, and the couple of URL-encoding quirks that differ
// per site. Machine-checked against the frozen sister project apricot-cake/dialect via
// scripts/check-websearch-equivalence.cts (#822, 2026-08-03) - encodeQueryTokens and
// stripQuerySyntax below reproduce dialect's measured urlParts.ts/text.ts behavior
// exactly (see that repo's own "GUI操作で実測" comments on each operator).

/** Strips the two raw characters dialect's own research found corrupt the destination
 * site's query parser when embedded unescaped: a bare `"` desyncs phrase-quoting, a bare
 * `(`/`)` desyncs OR-group parsing. Dialect's stripQuerySyntax (text.ts) does the same
 * removal before embedding any user-supplied term/tag/handle. */
export function stripQuerySyntax(s: string): string {
  return s.replace(/["()]/g, '');
}

/** Cleans a handle before embedding it in a from:/author=/username= operator: strips
 * query-breaking characters (see stripQuerySyntax), trims, then drops any leading '@'
 * (a from:@user operator is invalid on every one of these sites - the @ belongs to
 * mention syntax, not the author operator). Matches dialect's stripAt (text.ts). */
export function stripAt(handle: string): string {
  return stripQuerySyntax(handle).trim().replace(/^@+/, '');
}

/** Cleans a tag before embedding it in a #tag/tag=/excludeTag= operator: strips
 * query-breaking characters, trims, then drops any leading '#' (full-width included) -
 * a tag that already carries its own hash mark would otherwise double up ('##foo') once
 * this module adds its own. Matches dialect's stripHash (text.ts). */
export function stripHash(tag: string): string {
  return stripQuerySyntax(tag)
    .trim()
    .replace(/^[#＃]+/, '');
}

/** Wraps a term in double quotes when it contains whitespace, so a multi-word phrase
 * reads as one token to the site's query parser instead of several ANDed words. Strips
 * query-breaking characters first (see stripQuerySyntax) - matches dialect's
 * quoteIfPhrase, which does the same clean-then-quote in that order. */
export function quoteIfSpaced(term: string): string {
  const t = stripQuerySyntax(term).trim();
  if (!t) return t;
  if (/[\s　]/.test(t)) return `"${t}"`;
  return t;
}

/** True application/x-www-form-urlencoded, via URLSearchParams itself - for a site's
 * OTHER params (Bluesky's &author=/&tag=/etc.), never for a q= value (see
 * encodeQueryTokens). NOT the same as encodeURIComponent-with-+-swapped-in: form
 * encoding escapes a wider character set (e.g. '!' as %21, which plain
 * encodeURIComponent leaves raw) - matches dialect's own formEncode (urlParts.ts),
 * which uses the identical URLSearchParams round-trip for the same reason. */
export function encodeQueryPlus(s: string): string {
  return new URLSearchParams([['', s]]).toString().slice(1);
}

/** Percent-encodes each q= token independently and joins them with a literal '%20' -
 * the encoding dialect's own measured q= values actually use across every site (X,
 * Bluesky, Misskey, Mastodon all confirmed via GUI-captured URLs), NOT the '+' form-
 * encoded convention encodeQueryPlus applies to a site's other params. Misskey's own
 * dialect module spells out why explicitly: "URLSearchParamsはスペースを「+」にするが、
 * Misskey側が「+」をスペースへ戻す保証がないため、%20になるencodeURIComponentで組む". */
export function encodeQueryTokens(tokens: readonly string[]): string {
  return tokens.map((t) => encodeURIComponent(t)).join('%20');
}

/** Joins non-empty, trimmed strings with a single space - the common "AND by
 * juxtaposition" shape every one of these sites' query boxes uses. */
export function joinTerms(parts: ReadonlyArray<string | null | undefined>): string {
  return parts
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean)
    .join(' ');
}
