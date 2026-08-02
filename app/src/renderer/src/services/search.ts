// Shared search utility = the single smart-search matcher (P2④ abolished switching
// between matching modes entirely — it's always just this one loose matcher now. The
// old 'searchMode' pref and the exact/loose segments are retired).
//
// Search combines the following three elements:
//   B orthographic-variation normalization … applies NFKC (full-width↔half-width) +
//                                             katakana→hiragana unification + lowercasing to both sides
//   A subsequence     … matches if characters appear in order (for partial/narrowing use, loose)
//   C edit distance    … tolerates typos (substitution/insertion/deletion) via approximate
//                         substring matching (Sellers' algorithm)
//   → After normalization, each term is judged by "A or C", and all whitespace-separated terms are AND-combined.
//
// A real ES module (named exports) — imported directly by the orchestrator and
// query-builder.ts.

import { toKana } from 'wanakana';

// Katakana (U+30A1..U+30F6) → hiragana (U+3041..U+3096). The long vowel mark ー etc. is left as-is.
function kataToHira(s: string) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : s[i];
  }
  return out;
}

// Orthographic-variation normalization (B). NFKC absorbs full-width alphanumeric→half-width,
// half-width kana→full-width kana, etc., then drops voiced/semi-voiced marks (が→か, ぱ→は)
// and applies lowercasing + kana unification.
// The NFKC → NFD order is mandatory (doing NFD first would interfere with half-width kana's
// compatibility decomposition). Only the combining voiced/semi-voiced marks are stripped, and
// it's converted back to NFC at the end — meaning Latin diacritics (é etc.) stay in their
// composed form, so the edit-distance / word-length accounting stays the same as before,
// except for the voiced marks.
export function normalize(s: unknown) {
  if (s == null) return '';
  let t = String(s);
  try {
    t = t
      .normalize('NFKC')
      .normalize('NFD')
      .replace(/[\u3099\u309a]/g, '')
      .normalize('NFC');
  } catch (_e) {
    /* fallback for older environments */
  }
  return kataToHira(t.toLowerCase());
}

// Strict short-vocabulary match: normalize both sides, then require a contiguous
// substring. Unlike compile(), this deliberately does not accept subsequences or
// typos, so pickers stay precise while sharing the app-wide glyph rules.
export function includesNormalized(haystack: unknown, query: unknown) {
  const hay = normalize(haystack);
  const rawQuery = String(query ?? '');
  const normalizedQuery = normalize(rawQuery);
  const kanaQuery = normalize(toKana(rawQuery, { IMEMode: true }));
  return hay.includes(normalizedQuery) || hay.includes(kanaQuery);
}

// Whether each character of needle appears in hay in order (they need not be contiguous = subsequence match, A).
export function isSubsequence(hay: string, needle: string) {
  let i = 0;
  for (let k = 0; k < needle.length; k++) {
    i = hay.indexOf(needle[k], i);
    if (i === -1) return false;
    i++;
  }
  return true;
}

// Approximate substring match (C). Using Sellers' algorithm, judges whether needle matches
// SOME substring of hay within an edit distance of maxErr (the start/end positions are free = substring match).
export function approxSubstring(hay: string, needle: string, maxErr: number) {
  const n = needle.length,
    h = hay.length;
  if (n === 0) return true;
  if (maxErr <= 0) return hay.indexOf(needle) !== -1;
  // Row 0 (empty needle) can start at cost 0 from any position.
  let prev = new Array(h + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const cur = new Array(h + 1);
    cur[0] = i; // aligning the first i characters of needle against an empty hay = i deletions
    const nc = needle[i - 1];
    let rowMin = cur[0];
    for (let j = 1; j <= h; j++) {
      const cost = nc === hay[j - 1] ? 0 : 1;
      let v = prev[j - 1] + cost; // match or substitution
      const del = prev[j] + 1; // deletion on needle's side
      const ins = cur[j - 1] + 1; // extra character on hay's side (insertion)
      if (del < v) v = del;
      if (ins < v) v = ins;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxErr) return false; // if this whole row exceeds the threshold, it can't work from here on either (pruning)
    prev = cur;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let j = 0; j <= h; j++) if (prev[j] < best) best = prev[j];
  return best <= maxErr;
}

// The tolerated edit count, scaled to word length. Short words get 0 (since mismatches would spike), 1-2 for medium-to-long words.
function errBudget(len: number) {
  return len <= 2 ? 0 : len <= 4 ? 1 : 2;
}

// Normalizes/preprocesses the query once and returns a function that judges each haystack
// (compiled once per render). An empty query is always true.
export function compile(query: string) {
  const nq = normalize(query).trim();
  if (!nq)
    return function () {
      return true;
    };
  const terms = nq
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ({ t, k: errBudget(t.length) }));
  if (!terms.length)
    return function () {
      return true;
    };
  return function (rawHay: string) {
    const H = normalize(rawHay);
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      if (isSubsequence(H, term.t)) continue; // A: loose in-order match
      if (term.k > 0 && approxSubstring(H, term.t, term.k)) continue; // C: tolerates typos
      return false;
    }
    return true;
  };
}

// --- Snippet extraction for the full-text search UX (#29) --------------------
// compile()/isSubsequence/approxSubstring above judge MATCH/NO-MATCH on the
// NORMALIZED string (NFKC etc.) — normalization changes character counts, so a
// position found in normalized text cannot be mapped back to the original
// (design comment on #29: "正規化後オフセットを原文へ逆写像してはいけない").
// Snippets therefore re-search the RAW field text directly, independent of the
// match decision above, in the order the design calls for: ①exact contiguous
// substring (lowercased indexOf) ②approximate substring within the same error
// budget as compile() uses ③give up and hand back a plain head excerpt with no
// highlight.

// The Sellers' DP from approxSubstring, but keeping WHERE the best window ends
// instead of discarding it — approxSubstring only needed a yes/no answer, but a
// snippet needs a position. Runs on the RAW (non-normalized) string on purpose
// (see header comment above); scans left-to-right so a tie keeps the leftmost
// (earliest, most stable) match.
export function approxSubstringEnd(hay: string, needle: string, maxErr: number): number | null {
  const n = needle.length,
    h = hay.length;
  if (n === 0) return null;
  if (maxErr <= 0) {
    const idx = hay.indexOf(needle);
    return idx === -1 ? null : idx + n;
  }
  let prev = new Array(h + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const cur = new Array(h + 1);
    cur[0] = i;
    const nc = needle[i - 1];
    for (let j = 1; j <= h; j++) {
      const cost = nc === hay[j - 1] ? 0 : 1;
      let v = prev[j - 1] + cost;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      if (del < v) v = del;
      if (ins < v) v = ins;
      cur[j] = v;
    }
    prev = cur;
  }
  let bestEnd: number | null = null;
  let bestCost = maxErr + 1;
  for (let j = 0; j <= h; j++) {
    if (prev[j] < bestCost) {
      bestCost = prev[j];
      bestEnd = j;
    }
  }
  return bestCost <= maxErr ? bestEnd : null;
}

/** The [start,end) span of the best match of `query` inside raw `hay`, or null
 * if neither the exact nor the approximate pass found one within budget (the
 * "取れなければ" case — the caller falls back to a plain head excerpt). */
export function matchSpan(hay: string, query: string): { start: number; end: number } | null {
  const q = query.trim();
  if (!q) return null;
  const lq = q.toLowerCase();
  const idx = hay.toLowerCase().indexOf(lq);
  if (idx !== -1) return { start: idx, end: idx + q.length };
  const err = errBudget(q.length);
  if (err <= 0) return null;
  const end = approxSubstringEnd(hay, q, err);
  if (end == null) return null;
  return { start: Math.max(0, end - q.length - err), end };
}

export interface Snippet {
  text: string;
  /** Offsets INTO `text` (already adjusted for the leading ellipsis/window cut). -1/-1 = no match was found — `text` is a plain head excerpt with nothing to highlight. */
  matchStart: number;
  matchEnd: number;
}

/** A windowed excerpt of `raw` around the first match of `query`, for full-text
 * search result rows (#29). Collapses whitespace so a multi-line post body
 * reads as one line in a result row. */
export function snippetOf(raw: string, query: string, radius = 40): Snippet {
  const s = raw.replace(/\s+/g, ' ').trim();
  const span = matchSpan(s, query);
  if (!span) {
    const head = s.slice(0, radius * 2);
    return { text: head + (s.length > head.length ? '…' : ''), matchStart: -1, matchEnd: -1 };
  }
  const start = Math.max(0, span.start - radius);
  const end = Math.min(s.length, span.end + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < s.length ? '…' : '';
  return { text: prefix + s.slice(start, end) + suffix, matchStart: span.start - start + prefix.length, matchEnd: span.end - start + prefix.length };
}
