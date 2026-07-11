// Facet service — facetCounts (bucket aggregation) + qfValues (the sidebar value-
// flyout row models, 15 categories), extracted 1:1 from viewer.js as the third
// "pure logic → service" slice of the viewer decomposition (最終形B). A real ES
// module (named exports), imported directly by viewer.ts; touches no DOM. Every
// runtime coupling is INJECTED via makeFacets(deps) — reassigned viewer lets
// (allPosts / tagGroups) come in as getter functions, and consts declared after
// the wiring point (posterQB / pfStore / the corpusQuery destructure) as deferred
// wrappers — so this file loads under Node too (scripts/test-facets-unit.cts).

// Poster-platform facet sort order (facet rows only — viewer's own PF lists are
// written inline where they render).
export const PF_ORDER = ['x', 'bluesky', 'misskey', 'mastodon', 'pixiv'];

// deps contract (all functions unless noted):
//   getFilteredPosts() — current-query post population (default counting pool)
//   qHasValue(type,v) / posterQHasValue(type,v) — "is this value active" per tree
//   allPosts() — full library (facet vocabulary; getter — viewer reassigns it)
//   hostOf(url) / userKey(p) — from query.js (wrapped: destructured after wiring)
//   t(key,subs?) — message lookup / PF_NAME (value) — label table (const by the wiring point)
//   tagKindOf(tag) — 用語帳 kind ('work'/'character'/undefined)
//   tagGroups() — live viewer state getter
//   posterTagsOf(key) / filteredPosters() / posterFilterVocab() / namedPosters()
//   posterFolders() — pfStore.all() (wrapped: pfStore is declared later)
//   buildUsers() — user facet source (cached in viewer)
export function makeFacets(deps: {
  getFilteredPosts(): CorpusPost[];
  qHasValue(type: string, v: string): boolean;
  posterQHasValue(type: string, v: string): boolean;
  allPosts(): CorpusPost[];
  hostOf(url: string | null | undefined): string;
  userKey(p: CorpusPost): string;
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  PF_NAME: Record<string, string>;
  tagKindOf(tag: string): string | null | undefined;
  tagGroups(): Array<{ id: string; name: string; tags?: string[] }>;
  posterTagsOf(key: string): string[];
  filteredPosters(): CorpusUserAgg[];
  posterFilterVocab(): string[];
  namedPosters(): CorpusUserAgg[];
  posterFolders(): CorpusFolder[];
  postFolders(): CorpusFolder[];
  buildUsers(): CorpusUserAgg[];
}) {
  const { getFilteredPosts, qHasValue, posterQHasValue, allPosts, hostOf, userKey, t, PF_NAME, tagKindOf, tagGroups, posterTagsOf, filteredPosters, posterFilterVocab, namedPosters, posterFolders, postFolders, buildUsers } = deps;

  // Facet counts: how many CURRENT-QUERY matches fall under each value of a facet.
  // Population = getFilteredPosts() (every active condition incl. the search term),
  // so the flyout mirrors the posts you're actually looking at. keyFn(p) returns one
  // value or an array of values (tags, hashtags); each increments its bucket. Built
  // once per flyout render (one cat per render). Pass `pool` to count over a different
  // population — the poster view passes filteredPosters() (counts become poster counts).
  // NOTE: self-category exclusion is intentionally NOT done — picking within the same
  // category narrows the base, so those zeros sink. Values absent from the current
  // results stay listed (greyed but clickable) so you can still pick one.
  // Overloaded: with no pool, keys off the post population (getFilteredPosts());
  // the poster-scoped rows (poster-tag / poster-work / poster-character /
  // poster-platform / poster-instance / poster-folder) pass filteredPosters()
  // as `pool` and key off a CorpusUserAgg instead.
  function facetCounts(keyFn: (p: CorpusPost) => string | string[] | null | undefined): Map<string, number>;
  function facetCounts<T extends CorpusUserAgg>(keyFn: (p: T) => string | string[] | null | undefined, pool: T[]): Map<string, number>;
  function facetCounts(keyFn: (p: any) => string | string[] | null | undefined, pool?: any[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const p of pool || getFilteredPosts()) {
      const k = keyFn(p);
      if (k == null) continue;
      if (Array.isArray(k)) {
        for (const v of k) if (v != null) m.set(v, (m.get(v) || 0) + 1);
      } else m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }

  function qfValues(cat: string): CorpusQfRow[] {
    // "on" = this value already exists anywhere in the query tree.
    const act = (type: string, v: string): boolean => qHasValue(type, v);
    switch (cat) {
      case 'kind':
        return [
          ['post', t('kindPost')],
          ['image', t('kindImage')],
        ].map(([v, l]) => ({ v, l, on: act('kind', v) }));
      case 'platform': {
        // Misskey/Mastodon の直下に各インスタンスをサブ行で展開（独立に選択可）
        const hostsOf = (plat: string) => {
          const set = new Set<string>();
          for (const p of allPosts())
            if (p.platform === plat) {
              const h = hostOf(p.url);
              if (h) set.add(h);
            }
          return [...set].sort();
        };
        const pcnt = facetCounts((p) => p.platform || '__none');
        const icnt = facetCounts((p) => (p.platform === 'misskey' || p.platform === 'mastodon' ? hostOf(p.url) : null));
        const out: CorpusQfRow[] = [];
        for (const v of PF_ORDER) {
          out.push({ v, l: PF_NAME[v], on: act('platform', v), count: pcnt.get(v) || 0 });
          if (v === 'misskey' || v === 'mastodon') {
            for (const h of hostsOf(v)) out.push({ v: h, l: h, on: act('instance', h), type: 'instance', sub: true, count: icnt.get(h) || 0 });
          }
        }
        // 「プラットフォームなし」= platform 未設定の投稿（取り込み画像など）。
        // 該当が1件もなければ出さない（空振りする項目を並べない）。
        if (allPosts().some((p) => !p.platform)) out.push({ v: '__none', l: t('qfPlatformNone'), on: act('platform', '__none'), count: pcnt.get('__none') || 0 });
        return out;
      }
      case 'postType': {
        const cnt = facetCounts((p) => {
          const a: string[] = [];
          if (!p.isReply && !p.isQuote && !p.isThread) a.push('post');
          if (p.isReply) a.push('reply');
          if (p.isQuote) a.push('quote');
          if (p.isThread) a.push('thread');
          return a;
        });
        return [
          ['post', t('qfPost')],
          ['reply', t('qfReply')],
          ['quote', t('qfQuote')],
          ['thread', t('qfThread')],
        ].map(([v, l]) => ({ v, l, on: act('postType', v), count: cnt.get(v) || 0 }));
      }
      case 'media': {
        const cnt = facetCounts((p) => p.mediaType);
        const out: CorpusQfRow[] = [
          ['image', t('qfImage')],
          ['video', t('qfVideo')],
          ['gif', t('qfGif')],
        ].map(([v, l]) => ({ v, l, on: act('media', v), count: cnt.get(v) || 0 }));
        // (複数画像 was folded in here as __multi; it's now a first-class sidebar
        //  toggle row — setupMultiSidebar in viewer.js — so the メディア flyout is
        //  back to just the per-record media types image/video/gif.)
        return out;
      }
      case 'poster-tag': {
        // Poster-mode sidebar tag filter: lists GENERAL (non-kinded) tags applied to
        // posters. 作品/キャラ live in their own rows. Picking one adds/removes a tag leaf
        // in the poster query tree (posterQB), NOT the post query. "on" = already chosen.
        const cnt = facetCounts((u) => posterTagsOf(u.key), filteredPosters());
        return posterFilterVocab()
          .filter((t) => !tagKindOf(t))
          .map((t) => ({ v: t, l: t, on: posterQHasValue('tag', t), count: cnt.get(t) || 0, facetDim: true }))
          .sort((a, b) => b.count - a.count || a.l.localeCompare(b.l, 'ja'));
      }
      case 'poster-work':
      case 'poster-character': {
        // 作品/キャラ rows: the poster tags whose 種別 matches. They map to the same tag
        // leaf type as the general タグ row; the kind only scopes which this flyout offers.
        const kind = cat === 'poster-work' ? 'work' : 'character';
        const cnt = facetCounts((u) => posterTagsOf(u.key), filteredPosters());
        return posterFilterVocab()
          .filter((t) => tagKindOf(t) === kind)
          .map((t) => ({ v: t, l: t, on: posterQHasValue('tag', t), kind, count: cnt.get(t) || 0, facetDim: true }))
          .sort((a, b) => b.count - a.count || a.l.localeCompare(b.l, 'ja'));
      }
      case 'poster-platform': {
        const present = new Set<string>(
          namedPosters()
            .map((u) => u.platform)
            .filter(Boolean),
        );
        const cnt = facetCounts((u) => u.platform, filteredPosters());
        return [...present]
          .sort((a, b) => {
            const ia = PF_ORDER.indexOf(a),
              ib = PF_ORDER.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          })
          .map((v) => ({ v, l: PF_NAME[v] || v, on: posterQHasValue('platform', v), count: cnt.get(v) || 0 }));
      }
      case 'poster-instance': {
        const hosts = new Set<string>();
        for (const u of namedPosters()) if (u.instance) hosts.add(u.instance);
        const cnt = facetCounts((u) => u.instance, filteredPosters());
        return [...hosts].map((h) => ({ v: h, l: h, on: posterQHasValue('instance', h), count: cnt.get(h) || 0, facetDim: true })).sort((a, b) => b.count - a.count || a.l.localeCompare(b.l));
      }
      case 'poster-folder': {
        const folders = posterFolders();
        const cnt = facetCounts((u) => folders.filter((f) => f.items.includes(u.key)).map((f) => f.id), filteredPosters());
        return folders.map((f) => ({ v: f.id, l: f.name, on: posterQHasValue('folder', f.id), count: cnt.get(f.id) || 0 }));
      }
      case 'work':
      case 'character': {
        // 用語帳 (Phase 2 ②): a 作品/キャラ section lists the tags whose 種別 matches.
        // They ARE tags (type:'tag'), so picking one adds an ordinary tag filter —
        // the kind only scopes which tags this flyout offers.
        const cnt = facetCounts((p) => p.tags);
        return (
          [...new Set<string>(allPosts().flatMap((p) => p.tags || []))]
            .filter((t) => tagKindOf(t) === cat)
            .map((t) => ({ v: t, l: t, on: act('tag', t), type: 'tag', count: cnt.get(t) || 0, facetDim: true }))
            // Facet order: values present in the current results first (count desc),
            // absent ones sink to the bottom (greyed but still pickable).
            .sort((a, b) => b.count - a.count || a.l.localeCompare(b.l, 'ja'))
        );
      }
      case 'tag': {
        // Include tags from all posts (incl. imported url-less images), not just SNS posts.
        // 用語帳: kinded tags live in the 作品/キャラ rows — the タグ flyout is general-only.
        const cnt = facetCounts((p) => p.tags);
        const item = (t: string) => ({ v: t, l: t, on: act('tag', t), count: cnt.get(t) || 0, facetDim: true });
        // Within a list/group, present values (count desc) precede absent ones.
        const byCount = (a: { count: number; l: string }, b: { count: number; l: string }) => b.count - a.count || a.l.localeCompare(b.l, 'ja');
        const allTags = [...new Set<string>(allPosts().flatMap((p) => p.tags || []))].filter((t) => !tagKindOf(t)).sort();
        const groups = tagGroups();
        if (!groups.length) return allTags.map(item).sort(byCount);
        const grouped = new Set<string>();
        const out: CorpusQfRow[] = [];
        for (const g of groups) {
          const own = (g.tags || []).filter((t) => allTags.includes(t));
          if (!own.length) continue;
          own.forEach((t) => grouped.add(t));
          out.push({ ghead: g.name || '' });
          own
            .map(item)
            .sort(byCount)
            .forEach((it) => out.push(it));
        }
        const rest = allTags.filter((t) => !grouped.has(t));
        if (rest.length) {
          out.push({ ghead: t('tagGroupOther') });
          rest
            .map(item)
            .sort(byCount)
            .forEach((it) => out.push(it));
        }
        return out;
      }
      case 'collection': {
        // Library folders (collections.json). Each row toggles a 'collection' leaf
        // (folder membership, CF().has). Count = current-query posts in that folder.
        const folders = postFolders();
        const cnt = facetCounts((p) => folders.filter((f) => (f.items || []).includes(p.captureId)).map((f) => f.id));
        return folders.map((f) => ({ v: f.id, l: f.name, on: act('collection', f.id), count: cnt.get(f.id) || 0 }));
      }
      case 'hashtag': {
        const cnt = facetCounts((p) => p.hashtags);
        const counts: Record<string, number> = {};
        allPosts().forEach((p) =>
          (p.hashtags || []).forEach((h: string) => {
            counts[h] = (counts[h] || 0) + 1;
          }),
        );
        return Object.keys(counts)
          .sort((a, b) => counts[b] - counts[a])
          .map((h) => ({ v: h, l: '#' + h, on: act('hashtag', h), count: cnt.get(h) || 0, facetDim: true }))
          .sort((a, b) => b.count - a.count);
      }
      case 'user': {
        const cnt = facetCounts((p) => userKey(p));
        return buildUsers()
          .sort((a, b) => b.count - a.count)
          .slice(0, 100)
          .map((u) => ({ v: u.key, l: u.displayName || u.screenName || '(unknown)', sn: u.screenName, on: act('user', u.key), count: cnt.get(u.key) || 0, facetDim: true }))
          .sort((a, b) => b.count - a.count || (a.l || '').localeCompare(b.l || '', 'ja'));
      }
      case 'instance': {
        const cnt = facetCounts((p) => (p.platform === 'misskey' || p.platform === 'mastodon' ? hostOf(p.url) : null));
        const hosts = new Map<string, number>();
        for (const p of allPosts()) {
          if (p.platform !== 'misskey' && p.platform !== 'mastodon') continue;
          const h = hostOf(p.url);
          if (h) hosts.set(h, (hosts.get(h) || 0) + 1);
        }
        return [...hosts.keys()]
          .sort()
          .map((h) => ({ v: h, l: h, on: act('instance', h), count: cnt.get(h) || 0, facetDim: true }))
          .sort((a, b) => b.count - a.count || a.l.localeCompare(b.l));
      }
      default:
        return [];
    }
  }

  return { facetCounts, qfValues };
}