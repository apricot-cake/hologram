// Tag co-occurrence service — the related-tag suggestion math, extracted from
// viewer.js as the fourth "pure logic → service" slice (最終形B): charCandidatesFor
// (the strong 作品→キャラ tier), relatedTagCandidates (the generic weak tier), and
// worksCooccurringWith (the 同名キャラ homonym detector's history probe). Plain IIFE
// on window (like query.js / records.js / facets.js); loaded BEFORE viewer.js;
// touches no DOM. Runtime couplings are INJECTED via makeCooc(deps) so this file
// loads under Node too (scripts/test-cooc-unit.js). CommonJS-exported like records.js.
(function () {
  'use strict';

  // deps contract (all functions):
  //   allPosts() — full library (getter — viewer reassigns it)
  //   tagKindOf(tag) — 用語帳 kind ('work'/'character'/null)
  function makeCooc(deps: Parameters<CorpusCoocApi['makeCooc']>[0]) {
    const { allPosts, tagKindOf } = deps;

    // Tag co-occurrence: 作品 → characters that have shared a post with any of these
    // 作品 tags, most-frequent first. Deterministic + explainable (the count IS the
    // confidence). 種別 already fixes the two hard guesses (which tags relate, which is
    // the parent), so what's left — which character belongs to which work — is high
    // precision (a character co-occurs with ~one work).
    function charCandidatesFor(workTags: string[] | null | undefined): Array<[string, number]> {
      if (!workTags || !workTags.length) return [];
      const works = new Set(workTags);
      const counts = new Map<string, number>();
      for (const p of allPosts()) {
        const tags = Array.isArray(p.tags) ? p.tags : [];
        if (!tags.some((t) => works.has(t))) continue;
        for (const t of tags) if (tagKindOf(t) === 'character') counts.set(t, (counts.get(t) || 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    }

    // 同名キャラ（別作品）の検知: the 作品 tags this character has co-occurred with
    // elsewhere in the library (the current group excluded, so a just-added tag never
    // counts itself as history).
    function worksCooccurringWith(charTag: string, excludeIds?: Set<string> | null): Set<string> {
      const works = new Set<string>();
      for (const p of allPosts()) {
        if (excludeIds && excludeIds.has(p.captureId)) continue;
        const tags = Array.isArray(p.tags) ? p.tags : [];
        if (!tags.includes(charTag)) continue;
        for (const t of tags) if (tagKindOf(t) === 'work') works.add(t);
      }
      return works;
    }

    // Generic all-tag co-occurrence — the WEAK suggestion tier (charCandidatesFor is
    // the strong one: there 種別 pins what relates to what). For each non-selected
    // tag Y, find the selected tag X it shares the most posts with; the pair
    // qualifies only when that count reaches minCount (薄いうちは出さない — one or
    // two shared posts could be coincidence), so thin libraries stay silent.
    // Returns [{tag, withTag, count}] count-desc (ja-locale tiebreak), capped at
    // limit — withTag+count feed the "X と N 件で一緒" tooltip, so every suggestion
    // stays explainable. opts.exclude: extra tags to never suggest (e.g. ones the
    // strong tier already offers).
    function relatedTagCandidates(selectedTags: ReadonlyArray<string> | null | undefined, opts?: { minCount?: number; limit?: number; exclude?: Set<string> | null }): Array<{ tag: string; withTag: string | null; count: number }> {
      const sel = new Set((selectedTags || []).filter(Boolean));
      if (!sel.size) return [];
      const o = opts || {};
      const minCount = o.minCount != null ? o.minCount : 3;
      const limit = o.limit != null ? o.limit : 8;
      const exclude = o.exclude || null;
      const pair = new Map<string, Map<string, number>>(); // candidate Y -> Map(selected X -> shared-post count)
      for (const p of allPosts()) {
        const tags = Array.isArray(p.tags) ? p.tags : [];
        if (tags.length < 2) continue;
        const present = tags.filter((t) => sel.has(t));
        if (!present.length) continue;
        for (const t of tags) {
          if (sel.has(t) || (exclude && exclude.has(t))) continue;
          let m = pair.get(t);
          if (!m) pair.set(t, (m = new Map()));
          for (const x of present) m.set(x, (m.get(x) || 0) + 1);
        }
      }
      const out: Array<{ tag: string; withTag: string | null; count: number }> = [];
      for (const [tag, m] of pair) {
        let withTag: string | null = null;
        let count = 0;
        for (const [x, n] of m)
          if (n > count) {
            count = n;
            withTag = x;
          }
        if (count >= minCount) out.push({ tag, withTag, count });
      }
      out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'));
      return out.slice(0, limit);
    }

    return { charCandidatesFor, worksCooccurringWith, relatedTagCandidates };
  }

  const api: CorpusCoocApi = { makeCooc };
  if (typeof window !== 'undefined') window.corpusCooc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
