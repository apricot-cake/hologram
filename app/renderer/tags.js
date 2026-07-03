// Tag vocabulary / 種別 (kind) domain service — the read-side derivations over
// the tag stores: tagKindOf/kindLabel (種別 lookup + renamable labels),
// groupedTagVocab (the picker's sectioned vocabulary for post/poster scopes),
// inspectorTagPickerData (the React tag editor's full data bundle incl. cooc
// suggestion tiers), posterTagsOf/posterFilterVocab (poster-applied tags), and
// sameTags. Extracted 1:1 from viewer.js as the eighth "pure logic → service"
// slice of the viewer decomposition (最終形B). Plain IIFE on window (like
// query.js / listing.js); loaded BEFORE viewer.js; touches no DOM. Mutations
// (setTagKind / persistTagTypes / posterTags writes) stay in viewer.js — this
// module only reads, so every store comes in as a getter. CommonJS-exported
// like records.js / listing.js for the Node unit test.
(function () {
  'use strict';

  // deps contract:
  //   tagTypes() / tagLabels() / tagGroups() / posterTags() / allPosts() —
  //     getters (viewer reassigns these lets on load/import)
  //   MSG — pre-resolved message table (finalized before makeTags runs)
  //   charCandidatesFor(workTags) / relatedTagCandidates(sel, opts) — cooc.js
  //     products (deferred arrows — consts declared after the wiring point)
  function makeTags(deps) {
    const { tagTypes, tagLabels, tagGroups, posterTags, allPosts, MSG, charCandidatesFor, relatedTagCandidates } = deps;
    const KIND_LABEL = { work: MSG.kindWork, character: MSG.kindCharacter }; // MSG is finalized at load

    function tagKindOf(tag) {
      return tagTypes()[tag] || null;
    }
    function kindLabel(kind) {
      const labels = tagLabels();
      return (labels && labels[kind]) || KIND_LABEL[kind] || '';
    }

    function posterTagsOf(key) {
      const t = posterTags()[key];
      return Array.isArray(t) ? t : [];
    }
    // Tags actually applied to at least one poster — the vocabulary the filter offers.
    // Kinded (作品/キャラ) tags stay in (種別 dots distinguish them); order is by 種別
    // (作品 → キャラ → 一般) then ja-collation so the flyout reads like the palette.
    function posterFilterVocab() {
      const set = new Set();
      for (const arr of Object.values(posterTags())) for (const t of Array.isArray(arr) ? arr : []) set.add(t);
      const rank = (t) => {
        const k = tagKindOf(t);
        return k === 'work' ? 0 : k === 'character' ? 1 : 2;
      };
      return [...set].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ja'));
    }

    // Tag vocabulary grouped by tag-group (defined groups in order, then 未分類 =
    // ungrouped tags that exist on posts), each section filtered by `query`. Shared
    // by the inspector's TagEditor and the bulk edit modal (via inspectorTagPickerData).
    function groupedTagVocab(query, opts) {
      const scope = (opts && opts.scope) || 'post';
      const q = (query || '').toLowerCase();
      const ok = (t) => !q || t.toLowerCase().includes(q);
      const byJa = (a, b) => a.localeCompare(b, 'ja');
      const groups = tagGroups();
      const grouped = new Set(groups.flatMap((g) => g.tags || []));
      const out = [];
      // 用語帳: 作品/キャラ are first-class categories — surface them as their own
      // sections ahead of the freeform groups, and pull kinded tags OUT of their
      // group / 未分類 so each tag shows once (種別 takes precedence, danbooru-style).
      const kindSec = { work: [], character: [] };
      for (const [t, k] of Object.entries(tagTypes())) if (k === 'work' || k === 'character') kindSec[k].push(t);
      for (const [k, name] of [
        ['work', kindLabel('work')],
        ['character', kindLabel('character')],
      ]) {
        const tags = kindSec[k].filter(ok).sort(byJa);
        if (tags.length) out.push({ name, tags });
      }
      // Poster scope shares 作品/キャラ (a tag's 種別 is a global attribute of the
      // string) but keeps a SEPARATE general pool: the freeform post groups
      // (人物/角度/形式) and post-applied tags are post-content descriptors,
      // meaningless for a person. The poster general pool grows from poster-applied
      // tags instead (posterTags), so people get their own vocabulary.
      if (scope === 'poster') {
        const applied = new Set();
        for (const arr of Object.values(posterTags())) for (const t of Array.isArray(arr) ? arr : []) if (!tagKindOf(t)) applied.add(t);
        const general = [...applied].filter(ok).sort(byJa);
        if (general.length) out.push({ name: MSG.tagGroupOther, tags: general });
        return out;
      }
      for (const g of groups) {
        const tags = (g.tags || [])
          .filter((t) => !tagKindOf(t))
          .filter(ok)
          .sort(byJa);
        if (tags.length) out.push({ name: g.name, tags });
      }
      const applied = new Set();
      for (const p of allPosts()) for (const t of Array.isArray(p.tags) ? p.tags : []) if (!grouped.has(t) && !tagKindOf(t)) applied.add(t);
      const ungrouped = [...applied].filter(ok).sort(byJa);
      if (ungrouped.length) out.push({ name: MSG.tagGroupOther, tags: ungrouped });
      return out;
    }

    // Same underlying vocabulary as the pickers (groupedTagVocab/charCandidatesFor)
    // but shaped as DATA for the React tag editor, which filters by its own local
    // query client-side — so keystrokes never round-trip through here (the full/
    // unfiltered vocabulary is the only thing ever asked for: query is always '').
    function inspectorTagPickerData(selectedTags, recordsForSource, scope) {
      const sel = new Set(selectedTags || []);
      const vocabGroups = groupedTagVocab('', { scope: scope || 'post' }).map((g) => ({
        name: g.name,
        items: g.tags.map((t) => ({ tag: t, kind: tagKindOf(t) || null })),
      }));
      const srcSet = new Set();
      for (const r of recordsForSource || []) for (const h of Array.isArray(r.hashtags) ? r.hashtags : []) srcSet.add(h);
      const srcTagsForPicker = [...srcSet].map((t) => ({ tag: t, kind: tagKindOf(t) || null }));
      // Suggestion groups, strongest first. Tier 1 (kind-scoped): 作品 on the card →
      // character candidates. Tier 2 (generic, post scope only): tags that often share
      // a post with any selected tag — a weak hint, so it sits below the kinded group,
      // dedupes against it, and stays silent until pairs have real support (minCount
      // lives in cooc.js). Poster tagging keeps tier 1 only: its general vocabulary is
      // deliberately separate from post-content descriptors (see groupedTagVocab).
      const coocGroups = [];
      const strong = new Set();
      const workTags = [...sel].filter((t) => tagKindOf(t) === 'work');
      if (workTags.length) {
        const cands = charCandidatesFor(workTags)
          .filter(([t]) => !sel.has(t))
          .slice(0, 8);
        if (cands.length) {
          const who = workTags.join('・');
          coocGroups.push({
            name: workTags.length === 1 ? MSG.editCoocCharsOf(workTags[0]) : MSG.editCoocChars,
            items: cands.map(([t, n]) => ({ tag: t, title: MSG.editCoocWhy(who, n) })),
          });
          for (const [t] of cands) strong.add(t);
        }
      }
      if (scope !== 'poster') {
        const rel = relatedTagCandidates([...sel], { exclude: strong });
        if (rel.length) {
          coocGroups.push({
            name: MSG.editCoocRelated,
            items: rel.map((r) => ({ tag: r.tag, kind: tagKindOf(r.tag) || null, title: MSG.editCoocWhy(r.withTag, r.count) })),
          });
        }
      }
      return { vocabGroups, srcTagsForPicker, coocGroups };
    }

    return { tagKindOf, kindLabel, posterTagsOf, posterFilterVocab, groupedTagVocab, inspectorTagPickerData };
  }

  function sameTags(a, b) {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every((t) => s.has(t));
  }

  const api = { makeTags, sameTags };
  if (typeof window !== 'undefined') window.corpusTags = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
