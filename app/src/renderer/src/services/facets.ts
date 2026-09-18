import type { Translate } from './translation.ts';
import { hasVisualMedia, kindOf } from './query.ts';
export const PF_ORDER = ['x', 'bluesky', 'pixiv'];

export function makeFacets(deps: {
  getFilteredPosts(excludeTypes?: string[]): HologramPost[];
  qHasValue(type: string, v: string): boolean;
  qHasTag(tagId: number | null, name: string): boolean;
  posterQHasValue(type: string, v: string): boolean;
  posterQHasTag(tagId: number | null, name: string): boolean;
  allPosts(): HologramPost[];
  tagGroupEntries(): HologramTagEntry[];
  hostOf(url: string | null | undefined): string;
  userKey(p: HologramPost): string;
  t: Translate;
  PF_NAME: Record<string, string>;
  posterTagEntriesOf(key: string): HologramTagEntry[];
  filteredPosters(): HologramUserAgg[];
  posterFilterVocab(): HologramTagEntry[];
  namedPosters(): HologramUserAgg[];
  postFolders(): HologramFolder[];
  buildUsers(): HologramUserAgg[];
}) {
  const { getFilteredPosts, qHasValue, qHasTag, posterQHasValue, posterQHasTag, allPosts, hostOf, userKey, t, PF_NAME, posterTagEntriesOf, filteredPosters, posterFilterVocab, namedPosters, postFolders, buildUsers } = deps;
  const entryKey = (e: HologramTagEntry) => (e.id != null ? 'i:' + e.id : 'n:' + e.name);
  function tagEntriesOf(p: HologramPost): HologramTagEntry[] {
    return (p.tags || []).map((name, i) => ({ id: p.tagIds?.[i] ?? null, name, label: name }));
  }

  function tagVocab(): HologramTagEntry[] {
    const m = new Map<string, HologramTagEntry>();
    for (const e of deps.tagGroupEntries()) m.set(entryKey(e), e);
    for (const p of allPosts()) for (const e of tagEntriesOf(p)) if (!m.has(entryKey(e))) m.set(entryKey(e), e);
    return [...m.values()];
  }
  const tagRow = (e: HologramTagEntry, cnt: Map<string, number>, extra?: Record<string, unknown>): HologramQfRow => ({ v: e.name, l: e.label, tagId: e.id ?? undefined, on: qHasTag(e.id, e.name), count: cnt.get(entryKey(e)) || 0, facetDim: true, ...extra });
  const posterTagRow = (e: HologramTagEntry, cnt: Map<string, number>, extra?: Record<string, unknown>): HologramQfRow => ({ v: e.name, l: e.label, tagId: e.id ?? undefined, on: posterQHasTag(e.id, e.name), count: cnt.get(entryKey(e)) || 0, facetDim: true, ...extra });
  const byTagCount = (a: HologramQfRow, b: HologramQfRow) => (b.count || 0) - (a.count || 0) || (a.l || '').localeCompare(b.l || '', 'ja');

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
    // ORで追加する候補の件数は、その項目自身の条件を外して集計する。
    const excludeTypes = cat === 'platform' ? ['platform', 'domain'] : ['kind', 'postType', 'media', 'user'].includes(cat) ? [cat] : [];
    let countPool: HologramPost[] | undefined;
    const countForCategory = (keyFn: (p: any) => string | string[] | null | undefined, pool?: any[]) => {
      countPool ??= getFilteredPosts(excludeTypes);
      return facetCounts(keyFn, pool ?? countPool);
    };
    const act = (type: string, v: string): boolean => qHasValue(type, v);
    switch (cat) {
      case 'kind': {
        const cnt = countForCategory((p) => kindOf(p));
        return [
          ['post', t('kindPost')],
          ['image', t('kindImage')],
        ].map(([v, l]) => ({ v, l, on: act('kind', v), count: cnt.get(v) || 0 }));
      }
      case 'platform': {
        const pcnt = countForCategory((p) => p.platform);
        const out: HologramQfRow[] = [];
        for (const v of PF_ORDER) {
          out.push({ v, l: PF_NAME[v], on: act('platform', v), count: pcnt.get(v) || 0 });
        }
        const stripWww = (h: string) => h.replace(/^www\./, '');
        const domainOf = (p: HologramPost): string => (p.platform ? '' : stripWww(hostOf(p.url)));
        const dcnt = countForCategory((p) => domainOf(p) || null);
        const domains = new Set<string>();
        for (const p of allPosts()) {
          const d = domainOf(p);
          if (d) domains.add(d);
        }
        for (const d of [...domains].sort((a, b) => (dcnt.get(b) || 0) - (dcnt.get(a) || 0) || a.localeCompare(b))) {
          out.push({ v: d, l: d, on: act('domain', d), type: 'domain', facetDim: true, count: dcnt.get(d) || 0 });
        }
        if (allPosts().some((p) => !p.platform && !hostOf(p.url))) {
          const noneCnt = countForCategory((p) => (!p.platform && !hostOf(p.url) ? '__none' : null));
          out.push({ v: '__none', l: t('qfSiteNone'), on: act('platform', '__none'), count: noneCnt.get('__none') || 0 });
        }
        return out;
      }
      case 'postType': {
        const cnt = countForCategory((p) => {
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
        const cnt = countForCategory((p) => p.mediaType);
        const out: HologramQfRow[] = [
          ['image', t('qfImage')],
          ['video', t('qfVideo')],
          ['gif', t('qfGif')],
        ].map(([v, l]) => ({ v, l, on: act('media', v), count: cnt.get(v) || 0 }));
        if (allPosts().some((p) => !hasVisualMedia(p))) {
          const noneCnt = countForCategory((p) => (!hasVisualMedia(p) ? '__none' : null));
          out.push({ v: '__none', l: t('qfMediaNone'), on: act('media', '__none'), count: noneCnt.get('__none') || 0 });
        }
        return out;
      }
      case 'poster-tag': {
        const cnt = facetCounts((u) => posterTagEntriesOf(u.key).map(entryKey), filteredPosters());
        return [...new Map([...deps.tagGroupEntries(), ...posterFilterVocab()].map((e) => [entryKey(e), e])).values()].map((e) => posterTagRow(e, cnt)).sort(byTagCount);
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
      case 'tag': {
        const cnt = countForCategory((p) => {
          const entries = tagEntriesOf(p);
          return entries.length ? entries.map(entryKey) : '__none';
        });
        const out = tagVocab()
          .map((e) => tagRow(e, cnt))
          .sort(byTagCount);
        if (allPosts().some((p) => !(p.tags || []).length)) out.unshift({ v: '__none', l: t('qfTagNone'), on: act('tag', '__none'), count: cnt.get('__none') || 0, facetDim: true });
        return out;
      }
      case 'folder': {
        const folders = postFolders();
        const byId = new Map(folders.map((f) => [f.id, f]));
        const kidsOf = new Map<string | null, HologramFolder[]>();
        for (const f of folders) {
          const p = f.parentId || null;
          const arr = kidsOf.get(p);
          if (arr) arr.push(f);
          else kidsOf.set(p, [f]);
        }
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
        const cnt = countForCategory((p) => folders.filter((f) => itemsDeep(f).has(p.captureId)).map((f) => f.id));
        return folders.map((f) => ({ v: f.id, l: pathOf(f), on: act('folder', f.id), count: cnt.get(f.id) || 0 }));
      }
      case 'hashtag': {
        const cnt = countForCategory((p) => p.hashtags);
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
        const cnt = countForCategory((p) => userKey(p));
        return buildUsers()
          .sort((a, b) => b.count - a.count)
          .map((u) => ({ v: u.key, l: u.displayName || u.screenName || '(unknown)', sn: u.screenName, avatarFile: u.avatarFile || undefined, on: act('user', u.key), count: cnt.get(u.key) || 0, facetDim: true }))
          .sort((a, b) => b.count - a.count || (a.l || '').localeCompare(b.l || '', 'ja'));
      }
      default:
        return [];
    }
  }

  return { facetCounts, qfValues };
}
