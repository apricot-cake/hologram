// Tag vocabulary / kind domain service — the read-side derivations over
// the tag stores: tagKindOf/kindLabel (kind lookup + renamable labels),
// groupedTagVocab (the picker's sectioned vocabulary for post/poster scopes),
// inspectorTagPickerData (the React tag editor's full data bundle incl. cooc
// suggestion tiers), posterTagsOf/posterFilterVocab (poster-applied tags), and
// sameTags — extracted 1:1 from viewer.js as the eighth "pure logic → service"
// slice of the viewer decomposition (final form B). makeTags' pure derivations
// still take every store as an injected getter (unchanged signature — the
// Node unit test stubs these directly), but the getters passed in by
// viewer.js now point at THIS module's own state instead of viewer.js's own
// `let`s (P4 "state→store" tags slice, 2026-07-08): tagTypes/tagLabels/
// posterTags moved here as the service's single source of truth,
// with mutators (setTagKind/setKindLabel/setPosterTags/
// applyPosterTagRecords) that persist to disk and notify subscribers via
// onChange, making this the "subscribable tags service".
// viewer.js keeps the surrounding business logic (undo recording, inspector
// refresh, confirm-gated homonym distinction) and calls these mutators
// instead of mutating the maps itself. Nobody subscribes via onChange yet
// (viewer.js still re-pushes the sidebar models explicitly after each
// mutation) — it exists so a later slice (sidebar self-deriving from
// services) has something to subscribe to. A real ES module (named exports)
// imported directly by viewer.ts / sidebar.ts and the Sidebar components; touches
// no DOM. The read-side tagKindOf/posterFilterVocab are also exposed as live
// bindings (below) that viewer.ts binds at boot, so sidebar.ts reads the same
// closures. Disk round-trips go through hologramIpc (services/ipc.ts).
import { hologramIpc } from './ipc.ts';

// deps contract:
//   tagTypes() / tagLabels() / posterTags() / allPosts() —
//     getters (viewer reassigns these lets on load/import)
//   t(key,subs?) — i18n message lookup (getMessage; aliased t18n internally —
//     this file uses bare `t` pervasively as a tag-string loop variable)
//   charCandidatesFor(workTags) / relatedTagCandidates(sel, opts) — cooc.js
//     products (deferred arrows — consts declared after the wiring point)
export function makeTags(deps: {
  tagTypes(): Record<string, string>;
  tagLabels(): Record<string, string>;
  posterTags(): Record<string, string[]>;
  allPosts(): HologramPost[];
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  charCandidatesFor(workTags: string[]): Array<[string, number]>;
  relatedTagCandidates(selectedTags: string[], opts?: { exclude?: Set<string> | null }): Array<{ tag: string; withTag: string | null; count: number }>;
}) {
  const { tagTypes, tagLabels, posterTags, allPosts, t: t18n, charCandidatesFor, relatedTagCandidates } = deps;
  const KIND_LABEL: Record<string, string> = { work: t18n('kindWork'), character: t18n('kindCharacter') }; // resolved once at load

  function tagKindOf(tag: string): string | null {
    return tagTypes()[tag] || null;
  }
  function kindLabel(kind: string): string {
    const labels = tagLabels();
    return (labels && labels[kind]) || KIND_LABEL[kind] || '';
  }

  function posterTagsOf(key: string): string[] {
    const t = posterTags()[key];
    return Array.isArray(t) ? t : [];
  }
  // Tags actually applied to at least one poster — the vocabulary the filter offers.
  // Kinded (Work/Character) tags stay in (kind dots distinguish them); order is by kind
  // (Work → Character → General) then ja-collation so the flyout reads like the palette.
  function posterFilterVocab(): string[] {
    const set = new Set<string>();
    for (const arr of Object.values(posterTags())) for (const t of Array.isArray(arr) ? arr : []) set.add(t);
    const rank = (t: string) => {
      const k = tagKindOf(t);
      return k === 'work' ? 0 : k === 'character' ? 1 : 2;
    };
    return [...set].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ja'));
  }

  // Tag vocabulary sectioned by kind: the Work/Character kind sections first, then Uncategorized
  // (applied tags carrying no kind). Shared by the inspector's tag field and the bulk
  // tag dialog (via inspectorTagPickerData), which filter locally while typing.
  function groupedTagVocab(opts?: { scope?: 'post' | 'poster' } | null): Array<{ name: string; tags: string[] }> {
    const scope = (opts && opts.scope) || 'post';
    const byJa = (a: string, b: string) => a.localeCompare(b, 'ja');
    const out: Array<{ name: string; tags: string[] }> = [];
    // Glossary: Work/Character are first-class categories — surface them as their own
    // sections ahead of Uncategorized, and pull kinded tags OUT of Uncategorized so each tag shows
    // once (kind takes precedence, danbooru-style).
    const kindSec: Record<string, string[]> = { work: [], character: [] };
    for (const [t, k] of Object.entries(tagTypes())) if (k === 'work' || k === 'character') kindSec[k].push(t);
    for (const [k, name] of [
      ['work', kindLabel('work')],
      ['character', kindLabel('character')],
    ]) {
      const tags = kindSec[k].sort(byJa);
      if (tags.length) out.push({ name, tags });
    }
    // Poster scope shares Work/Character (a tag's kind is a global attribute of the
    // string) but keeps a SEPARATE general pool: post-applied tags are post-content
    // descriptors, meaningless for a person. The poster general pool grows from
    // poster-applied tags instead (posterTags), so people get their own vocabulary.
    const applied = new Set<string>();
    if (scope === 'poster') {
      for (const arr of Object.values(posterTags())) for (const t of Array.isArray(arr) ? arr : []) if (!tagKindOf(t)) applied.add(t);
    } else {
      for (const p of allPosts()) for (const t of Array.isArray(p.tags) ? p.tags : []) if (!tagKindOf(t)) applied.add(t);
    }
    const general = [...applied].sort(byJa);
    if (general.length) out.push({ name: t18n('tagUncategorized'), tags: general });
    return out;
  }

  // Same underlying vocabulary as the pickers (groupedTagVocab/charCandidatesFor)
  // but shaped as DATA for the React tag editor, which filters by its own local
  // query client-side — so keystrokes never round-trip through here.
  function inspectorTagPickerData(selectedTags: string[] | null | undefined, recordsForSource: HologramPost[] | null | undefined, scope?: string) {
    const sel = new Set<string>(selectedTags || []);
    const vocabGroups = groupedTagVocab({ scope: (scope || 'post') as 'post' | 'poster' }).map((g) => ({
      name: g.name,
      items: g.tags.map((t) => ({ tag: t, kind: tagKindOf(t) || null })),
    }));
    const srcSet = new Set<string>();
    for (const r of recordsForSource || []) for (const h of Array.isArray(r.hashtags) ? r.hashtags : []) srcSet.add(h);
    const srcTagsForPicker = [...srcSet].map((t) => ({ tag: t, kind: tagKindOf(t) || null }));
    // Suggestion groups, strongest first. Tier 1 (kind-scoped): Work on the card →
    // character candidates. Tier 2 (generic, post scope only): tags that often share
    // a post with any selected tag — a weak hint, so it sits below the kinded group,
    // dedupes against it, and stays silent until pairs have real support (minCount
    // lives in cooc.js). Poster tagging keeps tier 1 only: its general vocabulary is
    // deliberately separate from post-content descriptors (see groupedTagVocab).
    const coocGroups: any[] = [];
    const strong = new Set<string>();
    const workTags = [...sel].filter((t) => tagKindOf(t) === 'work');
    if (workTags.length) {
      const cands = charCandidatesFor(workTags)
        .filter(([t]: [string, number]) => !sel.has(t))
        .slice(0, 8);
      if (cands.length) {
        const who = workTags.join('・');
        coocGroups.push({
          name: workTags.length === 1 ? t18n('editCoocCharsOf', [workTags[0]]) : t18n('editCoocChars'),
          items: cands.map(([t, n]: [string, number]) => ({ tag: t, title: t18n('editCoocWhy', [who, n]) })),
        });
        for (const [t] of cands) strong.add(t);
      }
    }
    if (scope !== 'poster') {
      const rel = relatedTagCandidates([...sel], { exclude: strong });
      if (rel.length) {
        coocGroups.push({
          name: t18n('editCoocRelated'),
          items: rel.map((r) => ({ tag: r.tag, kind: tagKindOf(r.tag) || null, title: t18n('editCoocWhy', [r.withTag, r.count]) })),
        });
      }
    }
    return { vocabGroups, srcTagsForPicker, coocGroups };
  }

  return { tagKindOf, kindLabel, posterTagsOf, posterFilterVocab, groupedTagVocab, inspectorTagPickerData };
}

export function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((t) => s.has(t));
}

// tagKindOf / posterFilterVocab live bindings — bound once at boot by viewer.ts
// (right after its own makeTags() call) via bindTagKindOf / bindPosterFilterVocab,
// so services/sidebar.ts's pull sources read the SAME closures this viewer instance
// builds (both close over this module's own getTagTypes()/getPosterTags(), so there's
// no second implementation to drift). null until viewer's binding call runs — a pull
// that lands before then just sees "no data yet" and recomputes on the next notify.
// Same live-binding shape as listing.ts's namedPosters.
export let tagKindOf: ((tag: string) => string | null) | null = null;
export function bindTagKindOf(fn: (tag: string) => string | null): void {
  tagKindOf = fn;
}
export let posterFilterVocab: (() => string[]) | null = null;
export function bindPosterFilterVocab(fn: () => string[]): void {
  posterFilterVocab = fn;
}

// --- state (the 4 maps, owned here now — see header comment) ---
let tagTypes = {} as Record<string, string>;
let tagLabels = {} as Record<string, string>;
let posterTags = {} as Record<string, string[]>;
export const getTagTypes = () => tagTypes;
export const getTagLabels = () => tagLabels;
export const getPosterTags = () => posterTags;

// --- subscribers (notified after any mutator below runs; nobody listens
// yet — see header comment) ---
const subs: Array<(kind?: string) => void> = [];
function notify(kind?: string) {
  for (const cb of [...subs]) {
    try {
      cb(kind);
    } catch {
      /* ignore */
    }
  }
}
export function onChange(cb: (kind?: string) => void) {
  subs.push(cb);
  return () => {
    const i = subs.indexOf(cb);
    if (i >= 0) subs.splice(i, 1);
  };
}

// tag-types.json / poster-tags.json disk round-trip.
// Private — only load() and the mutators below call these. Only called
// from the browser (viewer.js); never invoked by the Node unit test.
async function readTagTypes() {
  try {
    const r = await hologramIpc.getTagTypes();
    return { types: (r && r.types) || {}, labels: (r && r.labels) || {} };
  } catch {
    return { types: {}, labels: {} };
  }
}
// Always writes BOTH maps so writing one never drops the other (set-tag-types
// only keeps the labels it receives).
async function writeTagTypes() {
  try {
    await hologramIpc.setTagTypes(tagTypes, tagLabels);
  } catch {
    /* best-effort */
  }
}
async function readPosterTags() {
  try {
    const r = await hologramIpc.getPosterTags();
    return (r && r.tags) || {};
  } catch {
    return {};
  }
}
async function writePosterTags() {
  try {
    await hologramIpc.setPosterTags({ tags: posterTags });
  } catch {
    /* best-effort */
  }
}

// Boot-time load into this service's own state (idempotent — safe to call
// once from viewer.js's bootApp; a later call reuses the same promise).
let loadPromise: Promise<void> | null = null;
async function doLoad() {
  const [pt, tt] = await Promise.all([readPosterTags(), readTagTypes()]);
  posterTags = pt;
  tagTypes = tt.types;
  tagLabels = tt.labels;
}
export function load() {
  if (!loadPromise) loadPromise = doLoad();
  return loadPromise;
}

// --- mutators: persist + notify (viewer.js calls these instead of
// mutating the maps itself; the surrounding business logic — undo
// recording, inspector refresh, confirm dialogs — stays in viewer.js) ---
export async function setTagKind(tag: string, kind: string | null) {
  if (kind) tagTypes[tag] = kind;
  else delete tagTypes[tag];
  await writeTagTypes();
  notify('kind');
}
export async function setKindLabel(kind: string, label: string | null | undefined) {
  const v = (label || '').trim();
  if (v) tagLabels[kind] = v;
  else delete tagLabels[kind];
  await writeTagTypes();
  notify('kind');
}
// Single poster's tag list (applyPosterTagChange in viewer.js); tags===null
// clears the entry. Fire-and-forget persist, matching the pre-move behavior.
export function setPosterTags(key: string, tags: string[] | null) {
  if (tags && tags.length) posterTags[key] = tags;
  else delete posterTags[key];
  writePosterTags();
  notify('poster');
}
// Bulk apply (undo/redo): records = [{key, tags}], persisted once.
export function applyPosterTagRecords(records: Array<{ key: string; tags?: string[] }>) {
  for (const r of records) {
    if (r.tags && r.tags.length) posterTags[r.key] = r.tags.slice();
    else delete posterTags[r.key];
  }
  writePosterTags();
  notify('poster');
}
