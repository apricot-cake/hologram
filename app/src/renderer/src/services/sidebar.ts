// Sidebar model sources — the two filter-row columns: the POST column
// (#filterRows: フォルダ / プラットフォーム / … / タグ rows, their badges, the
// 作品/キャラ progressive-disclosure rows, and the 複数画像 toggle state) and the
// POSTER column (#posterFilterRows: プラットフォーム / 作品 / キャラ / タグ / サーバー / 日付
// / フォルダ rows + badges + progressive disclosure). viewer.ts keeps EVERY business rule
// (which filter a click opens, the vocab-driven disclosure math, kind labels) and its
// delegated click handlers on each container; the React components own rendering the rows.
//
// Converted from a PUSHED bridge (viewer built a full model incl. labels and called
// render()/renderPoster()) to a PULLED source, the same shape as the grid /
// image-tab / tabs sources: viewer no longer re-derives+pushes a model after
// every filter/tag/library mutation — this module derives it fresh on get(), reading
// hologramStore keys (postQueryTree/posterQueryTree/multiOnly/qfCat) + the tags/folders/
// posts-data/listing services directly. Labels are NOT part of the model — the components
// resolve their own row names via t() and the 作品/キャラ custom label via
// hologramTags.getTagLabels(), the same "component resolves its own i18n" pattern every
// other component uses (buildSidebarModel used to carry MSG-resolved strings
// because it ran inside viewer.ts; that reason is gone once the derivation moves here).
//
// tagKindOf/posterFilterVocab/namedPosters are NOT reimplemented here — they're the
// exact closures viewer.ts already builds (via hologramTags.makeTags / listing.ts's
// makeListing), bound onto the shared service object (hologramTags) / live binding
// (listing.ts's namedPosters) once at boot so this module reads the SAME functions
// instead of a second copy that could drift. They're null/undefined until viewer.ts's
// binding call runs, because this module's store/service subscriptions are wired at
// load time, before viewer.ts's own `await hologramI18n`-gated body runs — a pull that
// lands in that narrow window just sees "no data yet" and recomputes once viewer
// wires up and the first real mutation notifies.
//
// Two independent sources (post / poster) so a change in one column never triggers the
// other's subscribers. Plain IIFE on window (like grid.ts); loaded BEFORE viewer.js,
// AFTER store.ts/folders.ts/tags.ts/posts-data.ts (see the barrel's import order) —
// every dependency this module reads is already assigned by the time its own
// top-level subscriptions are wired. query.ts/listing.ts are real ES modules now
// (imported directly below) rather than window-IIFEs, so their load order no
// longer matters.
import { buildShadow } from './query.ts';
import { namedPosters } from './listing.ts';
import { get as getPostsData, subscribe as subscribePostsData } from './posts-data.ts';
import { tagKindOf, posterFilterVocab, onChange } from './tags.ts';
import { get as storeGet, subscribe as storeSubscribe } from './store.ts';

type SidebarSource<T> = { get(): T | null; subscribe(cb: () => void): HologramUnsubscribe };

function computePostModel(): HologramSidebarModel {
  const activeFilters = buildShadow(storeGet('postQueryTree'));
  // Per-category active-filter counts. Instance filters live inside the platform
  // flyout, so they count toward the platform badge; the tag badge splits by 種別 so a
  // 作品/キャラ filter lights its own row, leaving タグ for general (未分類) tags only.
  const badges: Record<string, number> = {};
  for (const f of activeFilters) badges[f.type] = (badges[f.type] || 0) + 1;
  badges.platform = (badges.platform || 0) + (badges.instance || 0);
  let tagWork = 0,
    tagChar = 0,
    tagGen = 0;
  for (const f of activeFilters)
    if (f.type === 'tag') {
      const k = tagKindOf ? tagKindOf(f.value) : null;
      if (k === 'work') tagWork++;
      else if (k === 'character') tagChar++;
      else tagGen++;
    }
  badges.tag = tagGen;
  badges.work = tagWork;
  badges.character = tagChar;
  const posts = getPostsData();
  // 作品/キャラ rows are progressively disclosed — shown only once at least one tag
  // wears that 種別 (zero trace for people who just save posts).
  let hasWork = false,
    hasChar = false;
  if (tagKindOf) {
    const tagset = new Set<string>(posts.flatMap((p) => p.tags || []));
    for (const t of tagset) {
      const k = tagKindOf(t);
      if (k === 'work') hasWork = true;
      else if (k === 'character') hasChar = true;
      if (hasWork && hasChar) break;
    }
  }
  const qfCat = storeGet('qfCat');
  return {
    // Only post-side flyout rows carry .qf-open (poster rows read their own half below).
    openCat: qfCat && !String(qfCat).startsWith('poster-') ? qfCat : null,
    multi: { active: !!storeGet('multiOnly') },
    badges,
    visible: { work: hasWork, character: hasChar },
  };
}

function computePosterModel(): HologramPosterSidebarModel {
  const kindOf = (v: string) => (tagKindOf ? tagKindOf(v) : null);
  const vocab = posterFilterVocab ? posterFilterVocab() : [];
  const named = namedPosters ? namedPosters() : [];
  const instPresent = new Set(named.map((u) => u.instance).filter(Boolean));
  // Row badges count the matching leaves in the poster query tree (shadow).
  const leaves = buildShadow(storeGet('posterQueryTree'));
  const tagLeaves = leaves.filter((f) => f.type === 'tag');
  const badges: Record<string, number> = {
    'poster-platform': leaves.filter((f) => f.type === 'platform').length,
    'poster-work': tagLeaves.filter((f) => kindOf(f.value) === 'work').length,
    'poster-character': tagLeaves.filter((f) => kindOf(f.value) === 'character').length,
    'poster-tag': tagLeaves.filter((f) => !kindOf(f.value)).length,
    'poster-instance': leaves.filter((f) => f.type === 'instance').length,
    'poster-date': leaves.some((f) => f.type === 'date') ? 1 : 0,
    'poster-folder': leaves.some((f) => f.type === 'folder') ? 1 : 0,
  };
  const qfCat = storeGet('qfCat');
  return {
    // Only poster-side flyout rows carry .qf-open here (post rows read their own half above).
    openCat: qfCat && String(qfCat).startsWith('poster-') ? qfCat : null,
    badges,
    // 段階的開示: reveal a row only when posters actually carry that kind of value.
    visible: {
      work: vocab.some((t) => kindOf(t) === 'work'),
      character: vocab.some((t) => kindOf(t) === 'character'),
      tag: vocab.some((t) => !kindOf(t)),
      instance: instPresent.size > 0,
    },
  };
}

// Each source wires its own upstream subscriptions ONCE at module load (mirrors
// grid.ts) rather than per subscribe() caller — there's a single consumer (the
// component) in practice, but this avoids stacking duplicates if that changes. `wire`
// is the list of "register this notify callback" calls the source's own compute()
// depends on — store keys plus whichever services it reads.
function makeSource<T>(compute: () => T, wire: Array<(cb: () => void) => void>): SidebarSource<T> {
  const subs = new Set<() => void>();
  const notify = () => {
    for (const cb of [...subs]) {
      try {
        cb();
      } catch (_e) {
        /* ignore */
      }
    }
  };
  for (const w of wire) w(notify);
  return {
    get: compute,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

const byKey = (k: string) => (cb: () => void) => storeSubscribe(k, cb);

export const hologramPostSidebarSource = makeSource(computePostModel, [byKey('postQueryTree'), byKey('multiOnly'), byKey('qfCat'), (cb) => onChange(cb), subscribePostsData]);

export const hologramPosterSidebarSource = makeSource(computePosterModel, [
  byKey('posterQueryTree'),
  byKey('qfCat'),
  (cb) => onChange(cb),
  subscribePostsData, // namedPosters()/buildUsers() read allPosts
]);
