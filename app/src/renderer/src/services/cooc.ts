// Tag co-occurrence service — the related-tag suggestion math, extracted from
// viewer.js as the fourth "pure logic → service" slice (final form B): charCandidatesFor
// (the strong Work→Character tier), relatedTagCandidates (the generic weak tier), and
// worksCooccurringWith (the same-name-character homonym detector's history probe). A real ES
// module (named exports), imported directly by viewer.ts; touches no DOM. Runtime
// couplings are INJECTED via makeCooc(deps) so this file loads under Node too
// (scripts/test-cooc-unit.cts).

// deps contract (all functions):
//   allPosts() — full library (getter — viewer reassigns it)
//   tagKindOf(tag) — glossary kind ('work'/'character'/null)
export function makeCooc(deps: { allPosts(): HologramPost[]; tagKindOf(tag: string): string | null | undefined }) {
  const { allPosts, tagKindOf } = deps;

  // #774 splits what a post "carries" into two readings, and this file needs both:
  //
  //   effTags(p) — the EFFECTIVE names (raw plus every ancestor the tag_parents
  //     edges imply, computed in lib-db-query.ts). This is the right answer to
  //     "does this post belong under tag X", because that is exactly the question
  //     query-time application redefines: a post tagged only with a child belongs
  //     under the parent too.
  //   rawTags(p) — what the user actually typed. This is the right answer to
  //     "which tag should we OFFER next", because an ancestor is never worth
  //     suggesting: every post carrying the child already carries the parent, so
  //     adding it narrows nothing.
  //
  // The split is why relatedTagCandidates below stays entirely raw while the two
  // kind-scoped probes read effective on their membership tests. Records whose
  // effective array is unavailable (a failed tag write dropped it — see
  // services/posts.ts's applyTagWrite) fall back to raw, which is what this whole
  // file used before #774.
  const rawTags = (p: HologramPost): string[] => (Array.isArray(p.tags) ? p.tags : []);
  const effTags = (p: HologramPost): string[] => (Array.isArray(p.effectiveTags) ? p.effectiveTags : rawTags(p));

  // Tag co-occurrence: Work → characters that have shared a post with any of these
  // Work tags, most-frequent first. Deterministic + explainable (the count IS the
  // confidence). Kind already fixes the two hard guesses (which tags relate, which is
  // the parent), so what's left — which character belongs to which work — is high
  // precision (a character co-occurs with ~one work).
  function charCandidatesFor(workTags: string[] | null | undefined): Array<[string, number]> {
    if (!workTags || !workTags.length) return [];
    const works = new Set(workTags);
    const counts = new Map<string, number>();
    for (const p of allPosts()) {
      // Membership reads effective (#774): asking for a parent Work's characters
      // has to reach the posts that only carry one of its child Works. The
      // characters themselves come from the raw list — a suggestion is something
      // to type, and an implied ancestor is not.
      if (!effTags(p).some((t) => works.has(t))) continue;
      for (const t of rawTags(p)) if (tagKindOf(t) === 'character') counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  // Detecting a same-name character (different work): the Work tags this character has co-occurred with
  // elsewhere in the library (the current group excluded, so a just-added tag never
  // counts itself as history).
  function worksCooccurringWith(charTag: string, excludeIds?: Set<string> | null): Set<string> {
    const works = new Set<string>();
    for (const p of allPosts()) {
      if (excludeIds && excludeIds.has(p.captureId)) continue;
      // Both halves read effective (#774) — unlike the two suggestion tiers, this
      // one's result is not a list of tags to offer but a membership set the
      // homonym check tests against, so an implied parent Work is real history
      // and leaving it out would report a same-name character as unseen.
      const tags = effTags(p);
      if (!tags.includes(charTag)) continue;
      for (const t of tags) if (tagKindOf(t) === 'work') works.add(t);
    }
    return works;
  }

  // Generic all-tag co-occurrence — the WEAK suggestion tier (charCandidatesFor is
  // the strong one: there Kind pins what relates to what). For each non-selected
  // tag Y, find the selected tag X it shares the most posts with; the pair
  // qualifies only when that count reaches minCount (don't show it while it's thin —
  // one or two shared posts could be coincidence), so thin libraries stay silent.
  // Returns [{tag, withTag, count}] count-desc (ja-locale tiebreak), capped at
  // limit — withTag+count feed the "shared with X in N post(s)" tooltip, so every suggestion
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
      // Deliberately raw on BOTH sides (#774): this tier's contract is "these two
      // were typed together N times, and the count IS the confidence". Pairing
      // through effective sets would rank a selected tag's own ancestors at the
      // top of its suggestions, and every one of them is a no-op to add.
      const tags = rawTags(p);
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
