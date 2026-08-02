// Facet service — facetCounts (bucket aggregation) + qfValues (the sidebar value-
// flyout row models, 15 categories), extracted 1:1 from viewer.js as the third
// "pure logic → service" slice of the viewer decomposition (final form B). A real ES
// module (named exports), imported directly by viewer.ts; touches no DOM. Every
// runtime coupling is INJECTED via makeFacets(deps) — reassigned viewer lets
// (allPosts) come in as getter functions, and consts declared after
// the wiring point (posterQB / pfStore / the hologramQuery destructure) as deferred
// wrappers — so this file loads under Node too (scripts/test-facets-unit.cts).

import { hasVisualMedia, kindOf } from './query.ts';

// Poster-platform facet sort order (facet rows only — viewer's own PF lists are
// written inline where they render).
export const PF_ORDER = ['x', 'bluesky', 'misskey', 'mastodon', 'pixiv'];

// deps contract (all functions unless noted):
//   getFilteredPosts() — current-query post population (default counting pool)
//   qHasValue(type,v) / posterQHasValue(type,v) — "is this value active" per tree
//   qHasTag(tagId,name) — the tag-leaf variant of qHasValue (#774): a tag row is
//     active when the tree holds a leaf for that ENTITY, not merely that name
//   allPosts() — full library (facet vocabulary; getter — viewer reassigns it)
//   hostOf(url) / userKey(p) — from query.js (wrapped: destructured after wiring)
//   t(key,subs?) — message lookup / PF_NAME (value) — label table (const by the wiring point)
//   tagKindOf(tag) — glossary kind ('work'/'character'/undefined)
//   posterTagsOf(key) / filteredPosters() / posterFilterVocab() / namedPosters()
//   posterFolders() — pfStore.all() (wrapped: pfStore is declared later)
//   buildUsers() — user facet source (cached in viewer)
//   resolve(key) / membersOf(key) — services/aliases.ts (#23 St1); identity /
//     [key] when the poster isn't merged
export function makeFacets(deps: {
  getFilteredPosts(): HologramPost[];
  qHasValue(type: string, v: string): boolean;
  qHasTag(tagId: number | null, name: string): boolean;
  posterQHasValue(type: string, v: string): boolean;
  allPosts(): HologramPost[];
  hostOf(url: string | null | undefined): string;
  userKey(p: HologramPost): string;
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  PF_NAME: Record<string, string>;
  tagKindOf(tag: string): string | null | undefined;
  posterTagsOf(key: string): string[];
  filteredPosters(): HologramUserAgg[];
  posterFilterVocab(): string[];
  namedPosters(): HologramUserAgg[];
  posterFolders(): HologramFolder[];
  postFolders(): HologramFolder[];
  buildUsers(): HologramUserAgg[];
  resolve(key: string): string;
  membersOf(key: string): string[];
}) {
  const { getFilteredPosts, qHasValue, qHasTag, posterQHasValue, allPosts, hostOf, userKey, t, PF_NAME, tagKindOf, posterTagsOf, filteredPosters, posterFilterVocab, namedPosters, posterFolders, postFolders, buildUsers, resolve, membersOf } = deps;

  // --- Tag rows are per ENTITY, not per name (#774 / #5's ID model) -----------
  // A tag row stands for one tags-table row: `name` is what a pick writes into
  // the query leaf, `label` is what the row shows (two entities sharing a name
  // are only told apart by their display parent — "alice(東方)"), and `key` is
  // the counting bucket.
  //
  // The entries come from the record's EFFECTIVE arrays, so a parent tag gets a
  // row (and a count) from posts that only carry its children — the whole point
  // of applying parent relationships at query time. A record without them (a
  // failed tag write dropped its ids — services/posts.ts's applyTagWrite) falls
  // back to its raw names, which is what these rows were keyed on before #774:
  // less precise, never wrong for a library with no same-name pair.
  interface TagEntry {
    key: string;
    id: number | null;
    name: string;
    label: string;
  }
  function tagEntriesOf(p: HologramPost): TagEntry[] {
    const ids = p.effectiveTagIds;
    if (Array.isArray(ids) && ids.length) {
      const names: string[] = Array.isArray(p.effectiveTags) ? p.effectiveTags : [];
      const labels: string[] = Array.isArray(p.effectiveTagLabels) ? p.effectiveTagLabels : [];
      return ids.map((id: number, i: number) => {
        const name = names[i] != null ? names[i] : '';
        return { key: 'i:' + id, id, name, label: labels[i] || name };
      });
    }
    return (p.tags || []).map((name: string) => ({ key: 'n:' + name, id: null, name, label: name }));
  }
  // The library-wide tag vocabulary, first occurrence wins (every occurrence of
  // one id carries the same name/label — they all come from the same tags row).
  function tagVocab(): TagEntry[] {
    const m = new Map<string, TagEntry>();
    for (const p of allPosts()) for (const e of tagEntriesOf(p)) if (!m.has(e.key)) m.set(e.key, e);
    return [...m.values()];
  }
  const tagRow = (e: TagEntry, cnt: Map<string, number>, extra?: Record<string, unknown>): HologramQfRow => ({ v: e.name, l: e.label, tagId: e.id ?? undefined, on: qHasTag(e.id, e.name), count: cnt.get(e.key) || 0, facetDim: true, ...extra });
  // Present values (count desc) precede absent ones; ja-locale name tiebreak.
  const byTagCount = (a: HologramQfRow, b: HologramQfRow) => (b.count || 0) - (a.count || 0) || (a.l || '').localeCompare(b.l || '', 'ja');

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
  // as `pool` and key off a HologramUserAgg instead.
  function facetCounts(keyFn: (p: HologramPost) => string | string[] | null | undefined): Map<string, number>;
  function facetCounts<T extends HologramUserAgg>(keyFn: (p: T) => string | string[] | null | undefined, pool: T[]): Map<string, number>;
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

  function qfValues(cat: string): HologramQfRow[] {
    // "on" = this value already exists anywhere in the query tree.
    const act = (type: string, v: string): boolean => qHasValue(type, v);
    switch (cat) {
      case 'kind': {
        // #195: counted (unlike the pre-bookmark two-value version) — a
        // library with few/no bookmarks should show that at a glance rather
        // than presenting an option with nothing behind it as equal to the
        // other two.
        const cnt = facetCounts((p) => kindOf(p));
        return [
          ['post', t('kindPost')],
          ['image', t('kindImage')],
          ['bookmark', t('kindBookmark')],
        ].map(([v, l]) => ({ v, l, on: act('kind', v), count: cnt.get(v) || 0 }));
      }
      case 'platform': {
        // Expand each instance as a sub-row directly under Misskey/Mastodon (independently selectable)
        const hostsOf = (plat: string) => {
          const set = new Set<string>();
          for (const p of allPosts())
            if (p.platform === plat) {
              const h = hostOf(p.url);
              if (h) set.add(h);
            }
          return [...set].sort();
        };
        const pcnt = facetCounts((p) => p.platform);
        const icnt = facetCounts((p) => (p.platform === 'misskey' || p.platform === 'mastodon' ? hostOf(p.url) : null));
        const out: HologramQfRow[] = [];
        for (const v of PF_ORDER) {
          out.push({ v, l: PF_NAME[v], on: act('platform', v), count: pcnt.get(v) || 0 });
          if (v === 'misskey' || v === 'mastodon') {
            for (const h of hostsOf(v)) out.push({ v: h, l: h, on: act('instance', h), type: 'instance', sub: true, count: icnt.get(h) || 0 });
          }
        }
        // #253: "サイト" — platform-less records get a row per resolvable host
        // instead of one catch-all "no platform" bucket (leading 'www.' folded;
        // eTLD+1 is NOT folded — that needs a public-suffix list, see the Issue's
        // rejected-option note). A post counts here only when it has NO platform
        // (dedup rule: never listed under both an upper-section platform row and
        // a lower-section domain row).
        const stripWww = (h: string) => h.replace(/^www\./, '');
        const domainOf = (p: HologramPost): string => (p.platform ? '' : stripWww(hostOf(p.url)));
        const dcnt = facetCounts((p) => domainOf(p) || null);
        const domains = new Set<string>();
        for (const p of allPosts()) {
          const d = domainOf(p);
          if (d) domains.add(d);
        }
        for (const d of [...domains].sort((a, b) => (dcnt.get(b) || 0) - (dcnt.get(a) || 0) || a.localeCompare(b))) {
          out.push({ v: d, l: d, on: act('domain', d), type: 'domain', facetDim: true, count: dcnt.get(d) || 0 });
        }
        // "出自なし" = records with NO resolvable origin at all (no URL, or an
        // unparseable one) — migration-imported images and the like (#85/#84).
        // Narrower than the old "no platform" bucket now that platform-less-but-
        // domained records get their own row above; still carried as the
        // 'platform'/'__none' leaf (this project is pre-release — see CLAUDE.md's
        // no-backward-compat-for-personal-library rule — so redefining what that
        // sentinel counts needs no migration). The matching predicate lives in
        // query-builder.ts (not query.ts) — this round's file split keeps #180 off
        // query.ts/extension/, so the platform-leaf predicate augmentation for
        // '__none' and the new 'domain' leaf type both live in that wiring layer.
        if (allPosts().some((p) => !p.platform && !hostOf(p.url))) {
          const noneCnt = facetCounts((p) => (!p.platform && !hostOf(p.url) ? '__none' : null));
          out.push({ v: '__none', l: t('qfSiteNone'), on: act('platform', '__none'), count: noneCnt.get('__none') || 0 });
        }
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
        const out: HologramQfRow[] = [
          ['image', t('qfImage')],
          ['video', t('qfVideo')],
          ['gif', t('qfGif')],
        ].map(([v, l]) => ({ v, l, on: act('media', v), count: cnt.get(v) || 0 }));
        // ("Multiple images" was folded in here as __multi; it's now a first-class sidebar
        //  toggle row — setupMultiSidebar in viewer.js — so the Media flyout is
        //  back to just the per-record media types image/video/gif.)
        // #365: a 4th row for records with no media at all (a text-only post) —
        // '__none' sentinel, same shape as "no platform"/"no tags" above, and same
        // "only list it if it would come up populated" rule. mediaType can't find
        // these on its own (see hasVisualMedia's doc comment in query.ts).
        if (allPosts().some((p) => !hasVisualMedia(p))) {
          const noneCnt = facetCounts((p) => (!hasVisualMedia(p) ? '__none' : null));
          out.push({ v: '__none', l: t('qfMediaNone'), on: act('media', '__none'), count: noneCnt.get('__none') || 0 });
        }
        return out;
      }
      case 'poster-tag': {
        // Poster-mode sidebar tag filter: lists GENERAL (non-kinded) tags applied to
        // posters. Work/Character live in their own rows. Picking one adds/removes a tag leaf
        // in the poster query tree (posterQB), NOT the post query. "on" = already chosen.
        const cnt = facetCounts((u) => posterTagsOf(u.key), filteredPosters());
        return posterFilterVocab()
          .filter((t) => !tagKindOf(t))
          .map((t) => ({ v: t, l: t, on: posterQHasValue('tag', t), count: cnt.get(t) || 0, facetDim: true }))
          .sort((a, b) => b.count - a.count || a.l.localeCompare(b.l, 'ja'));
      }
      case 'poster-work':
      case 'poster-character': {
        // Work/Character rows: the poster tags whose Kind matches. They map to the same tag
        // leaf type as the general Tags row; the kind only scopes which this flyout offers.
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
        // #23 St1: read as the union across every posterKey the poster's group
        // bundles (design: "poster-folders も同型" as poster-tags' union read) —
        // a folder toggle recorded under a since-merged secondary key, before
        // this poster existed as one row, still counts.
        const folders = posterFolders();
        const cnt = facetCounts((u) => {
          const keys = membersOf(u.key);
          return folders.filter((f) => keys.some((k) => f.items.includes(k))).map((f) => f.id);
        }, filteredPosters());
        return folders.map((f) => ({ v: f.id, l: f.name, on: posterQHasValue('folder', f.id), count: cnt.get(f.id) || 0 }));
      }
      case 'work':
      case 'character': {
        // Glossary (Phase 2 ②): a Work/Character section lists the tags whose Kind matches.
        // They ARE tags (type:'tag'), so picking one adds an ordinary tag filter —
        // the kind only scopes which tags this flyout offers.
        // Kind is looked up by NAME (services/tags.ts keys it that way), so two
        // entities sharing a name necessarily share a Kind — an id-keyed Kind store
        // is #5's remaining scope, not this one's. The ROWS are still per entity.
        const cnt = facetCounts((p) => tagEntriesOf(p).map((e) => e.key));
        return (
          tagVocab()
            .filter((e) => tagKindOf(e.name) === cat)
            .map((e) => tagRow(e, cnt, { type: 'tag' }))
            // Facet order: values present in the current results first (count desc),
            // absent ones sink to the bottom (greyed but still pickable).
            .sort(byTagCount)
        );
      }
      case 'tag': {
        // Include tags from all posts (incl. imported url-less images), not just SNS posts.
        // Glossary: kinded tags live in the Work/Character rows — the Tags flyout is general-only.
        // A post with no tags at all buckets under the '__none' sentinel — same shape as
        // "No platform" above, and query.ts special-cases the value the same way.
        const cnt = facetCounts((p) => {
          const entries = tagEntriesOf(p);
          return entries.length ? entries.map((e) => e.key) : '__none';
        });
        const out = tagVocab()
          .filter((e) => !tagKindOf(e.name))
          .map((e) => tagRow(e, cnt))
          .sort(byTagCount);
        // "No tags" = posts whose tags are empty. It's the entry point for chained
        // tagging, so it's pinned at the front rather than mixed into the count-order
        // ranking (the same shape as GitHub's Labels dropdown putting Unlabeled at the
        // front; "No platform" is placed at the end instead because there it's an edge
        // case, not an entry point). Not shown if there are none — i.e. don't list an
        // entry that would come up empty — same as on the platform side.
        if (allPosts().some((p) => !(p.tags || []).length)) out.unshift({ v: '__none', l: t('qfTagNone'), on: act('tag', '__none'), count: cnt.get('__none') || 0, facetDim: true });
        return out;
      }
      case 'folder': {
        // Library folders (folders.json). Each row toggles a 'folder' leaf.
        // Rows are labelled by path and counted over the SUBTREE, because that is
        // what picking the row does (#41): a parent stands for everything under it.
        // Counting only direct members would put a 0 next to a row that then shows
        // twelve posts — the number has to mean the same thing as the click.
        const folders = postFolders();
        const byId = new Map(folders.map((f) => [f.id, f]));
        const kidsOf = new Map<string | null, HologramFolder[]>();
        for (const f of folders) {
          const p = f.parentId || null;
          const arr = kidsOf.get(p);
          if (arr) arr.push(f);
          else kidsOf.set(p, [f]);
        }
        // Memoized bottom-up union. The set is registered before recursing, so even a
        // file that somehow kept a cycle terminates (with a partial answer) instead of
        // hanging the render.
        const deep = new Map<string, Set<string>>();
        const itemsDeep = (f: HologramFolder): Set<string> => {
          const hit = deep.get(f.id);
          if (hit) return hit;
          const s = new Set<string>(f.items || []);
          deep.set(f.id, s);
          for (const k of kidsOf.get(f.id) || []) for (const c of itemsDeep(k)) s.add(c);
          return s;
        };
        const pathOf = (f: HologramFolder) => {
          const parts: string[] = [];
          const seen = new Set<string>();
          let cur: HologramFolder | undefined = f;
          while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            parts.unshift(cur.name);
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
          }
          return parts.join(' / ');
        };
        const cnt = facetCounts((p) => folders.filter((f) => itemsDeep(f).has(p.captureId)).map((f) => f.id));
        return folders.map((f) => ({ v: f.id, l: pathOf(f), on: act('folder', f.id), count: cnt.get(f.id) || 0 }));
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
        // #23 St1: buildUsers() already folds onto the primary key, so the count
        // bucket has to key off the SAME resolved value or a merged poster's
        // count would only ever show its own raw posts, not the group's total.
        const cnt = facetCounts((p) => resolve(userKey(p)));
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
