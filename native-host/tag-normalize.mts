// Storage-time glyph normalization for tag/hashtag NAMES (#197). Unicode NFKC
// folds full-width/half-width and compatibility variants together, plus a trim
// for stray leading/trailing whitespace — nothing else. Case and kana/hiragana
// are deliberately left alone (display and the user's own spelling choice stay
// intact; see the issue for why folding those is a different, unwanted, kind of
// normalization).
//
// Why this can't reuse renderer/src/services/search.ts's `normalize`: that one
// additionally lowercases and folds katakana<->hiragana for FUZZY MATCHING at
// query time (#193's territory — a different problem with a different, heavier,
// answer). Applying it here would make "VTuber" and "ネコ"/"ねこ" collapse into
// the same stored tag, which the issue explicitly rules out.
//
// Why this isn't fixed by #193 either: query-time normalization only helps a
// SEARCH reach a tag, it does not stop two glyph variants of the same tag from
// existing as two separate library entries in the first place — the facet chip
// list and its counts are built from exact stored strings, not through the
// fuzzy matcher, so the vocabulary keeps splitting and counts keep fracturing
// unless the DATA itself is normalized on the way in. The two normalizations
// solve different problems and neither substitutes for the other.
//
// Kept Electron-free (no imports at all) so it loads from native-host's CJS
// runtime (via require, like post-record.mts's siblings), the app's Electron
// main process (ESM), AND the renderer's Vite bundle (browser, no node
// builtins) — the same cross-boundary role post-record.mts and post-key.mts
// already play.

// Normalizes one tag name. Non-strings (and strings that are empty/whitespace
// only after normalizing) become ''  — callers filter that out, matching how
// every other tag-array normalizer here already drops non-strings.
export function normalizeTagName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  let t = raw;
  try {
    t = t.normalize('NFKC');
  } catch {
    // Environments without String.prototype.normalize (none targeted today,
    // but search.ts's normalize carries the same fallback) keep the raw text
    // rather than throwing — a trim-only tag beats losing the save entirely.
  }
  return t.trim();
}

// Normalizes a tag/hashtag array: filters to strings, applies normalizeTagName,
// drops entries that end up empty, and dedupes (first occurrence wins) —
// mirroring what a byte-exact vocabulary/count view already assumes of a
// post's tag list.
export function normalizeTagNames(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = normalizeTagName(v);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
