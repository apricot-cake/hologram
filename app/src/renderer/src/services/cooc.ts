export function makeCooc(deps: { allPosts(): HologramPost[] }) {
  const { allPosts } = deps;
  const rawTags = (p: HologramPost): string[] => (Array.isArray(p.tags) ? p.tags : []);
  function relatedTagCandidates(selectedTags: ReadonlyArray<string> | null | undefined, opts?: { minCount?: number; limit?: number; exclude?: Set<string> | null }): Array<{ tag: string; withTag: string | null; count: number }> {
    const sel = new Set((selectedTags || []).filter(Boolean));
    if (!sel.size) return [];
    const o = opts || {};
    const minCount = o.minCount != null ? o.minCount : 3;
    const limit = o.limit != null ? o.limit : 8;
    const exclude = o.exclude || null;
    const pair = new Map<string, Map<string, number>>(); // 候補 Y → Map(選択中の X → 共有している投稿の件数)
    for (const p of allPosts()) {
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

  return { relatedTagCandidates };
}
