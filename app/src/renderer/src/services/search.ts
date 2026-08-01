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
