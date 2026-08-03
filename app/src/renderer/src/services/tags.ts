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
import type { PosterTagRow, TagTypeRow } from '../../../main/ipc-payloads.ts';

// #86: alias -> canonical-name, loaded once at boot (readTagAliasMap below)
// and reloaded on the same 'tag-types' org-changed signal writeTagTypes'
// sibling listener already reacts to (add/remove-tag-alias's IPC handlers
// send that same kind — see ipc-tag-vocab.ts's notifyTagVocabChanged). Kept as
// its own module-level store (not folded into tagTypes) because it is NAME
// space throughout, same reasoning as tagKindOfName: an alias is typed text
// resolving to typed text, never an entity id.
let tagAliasMap: Map<string, string> = new Map();
// The reverse index (canonical name -> every alias pointing at it) the picker
// needs to annotate a suggestion with WHICH alias matched the user's query —
// rebuilt alongside tagAliasMap so the two never drift.
let aliasesByCanonical: Map<string, string[]> = new Map();
export const getTagAliasMap = () => tagAliasMap;
function setTagAliasMap(m: Map<string, string>) {
  tagAliasMap = m;
  const rev = new Map<string, string[]>();
  for (const [alias, canonical] of m) {
    const list = rev.get(canonical);
    if (list) list.push(alias);
    else rev.set(canonical, [alias]);
  }
  aliasesByCanonical = rev;
}
async function readTagAliasMap(): Promise<Map<string, string>> {
  try {
    const rows = await hologramIpc.getTagAliases();
    return new Map(rows.map((r) => [r.alias, r.canonicalName]));
  } catch {
    return new Map();
  }
}

// #810: the Kind store is keyed by tag ENTITY (tags.id), not by name — `kind` is
// a column of the tags row, so two tags sharing a name can carry different kinds
// (#777's split creates exactly that), and the old {name: kind} map both hid the
// second one on read and erased it on the next write.
//
// That split the kind lookup in two, and WHICH one a call site wants follows from
// the space it is working in:
//
//   tagKindOf(tagId)     — entity space. Anything that already knows which tags
//     row it is holding: the facet rows (#774 made them per entity), the poster
//     filter vocabulary, a right-clicked chip whose record carries ids.
//   tagKindOfName(name)  — name space, "does any entity with this name carry a
//     kind". The tag EDITOR is name space by construction (you type a string, and
//     the write resolves it to a row), so the picker's vocabulary and the
//     co-occurrence suggestions — whose input is a typed name and whose output is
//     a name to type — stay here. Making them entity-precise would list one
//     string twice in one picker, both rows writing the same name.
export type TagTypeStore = Record<number, TagTypeRow>;
export type PosterTagStore = Record<string, PosterTagRow>;

// deps contract:
//   tagTypes() / tagLabels() / posterTags() / allPosts() —
//     getters (viewer reassigns these lets on load/import)
//   t(key,subs?) — i18n message lookup (getMessage; aliased t18n internally —
//     this file uses bare `t` pervasively as a tag-string loop variable)
//   charCandidatesFor(workTags) / relatedTagCandidates(sel, opts) — cooc.js
//     products (deferred arrows — consts declared after the wiring point)
//   membersOf(key) — services/aliases.ts (#23 St1), optional. A merged
//     poster's tags read as the UNION across every posterKey its group
//     bundles (design: "poster-tags は読みは membersOf の union・書きは
//     primary へ一本化") — the write side needs no change here: every caller
//     already passes buildUsers()'s u.key, which is always the primary once
//     #23's buildUsers fold lands, so a plain setPosterTags(key, …) already
//     lands on the primary. Absent/default = identity ([key] alone), so a
//     poster with no group reads exactly as before.
export function makeTags(deps: {
  tagTypes(): TagTypeStore;
  tagLabels(): Record<string, string>;
  posterTags(): PosterTagStore;
  allPosts(): HologramPost[];
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  charCandidatesFor(workTags: string[]): Array<[string, number]>;
  relatedTagCandidates(selectedTags: string[], opts?: { exclude?: Set<string> | null }): Array<{ tag: string; withTag: string | null; count: number }>;
  membersOf?(key: string): string[];
}) {
  const { tagTypes, tagLabels, posterTags, allPosts, t: t18n, charCandidatesFor, relatedTagCandidates, membersOf } = deps;
  const KIND_LABEL: Record<string, string> = { work: t18n('kindWork'), character: t18n('kindCharacter') }; // resolved once at load

  function tagKindOf(tagId: number | null | undefined): string | null {
    if (tagId == null) return null;
    return tagTypes()[tagId]?.kind || null;
  }
  // The name-space lookup (see the header): "does ANY entity called this carry a
  // kind". Memoized on the store OBJECT rather than rebuilt per call, because the
  // suggestion tiers ask it once per tag per post — every mutator below replaces
  // the store instead of mutating it in place, which is what makes the identity
  // check a valid staleness test.
  let byName: { src: TagTypeStore; map: Map<string, string> } | null = null;
  function kindByName(): Map<string, string> {
    const src = tagTypes();
    if (byName && byName.src === src) return byName.map;
    const map = new Map<string, string>();
    for (const row of Object.values(src)) if (row && !map.has(row.name)) map.set(row.name, row.kind);
    byName = { src, map };
    return map;
  }
  function tagKindOfName(tag: string): string | null {
    return kindByName().get(tag) || null;
  }
  function kindLabel(kind: string): string {
    const labels = tagLabels();
    return (labels && labels[kind]) || KIND_LABEL[kind] || '';
  }

  // One poster's tag entities as the filter side reads them (#810): the EFFECTIVE
  // set, so a poster tagged only with a child answers to its parent, exactly as a
  // post does since #774. A row whose ids are unavailable (the optimistic state
  // between a tag edit and its write coming back) degrades to its raw names with
  // no id — readers then match by name, which is the right answer for a poster
  // whose ids are unknown.
  function entriesOfRow(row: PosterTagRow | undefined): HologramTagEntry[] {
    if (!row) return [];
    const ids = Array.isArray(row.effectiveTagIds) ? row.effectiveTagIds : [];
    if (ids.length) {
      const names = Array.isArray(row.effectiveTags) ? row.effectiveTags : [];
      const labels = Array.isArray(row.effectiveTagLabels) ? row.effectiveTagLabels : [];
      return ids.map((id, i) => ({ id, name: names[i] || '', label: labels[i] || names[i] || '' }));
    }
    return (Array.isArray(row.tags) ? row.tags : []).map((name) => ({ id: null, name, label: name }));
  }

  // The RAW names a poster carries — what the inspector's tag field shows and
  // edits. Unaffected by parent relationships on purpose (#21's rule: the data is
  // always only what the user tagged), so removing a rule removes its effect.
  function posterTagsOf(key: string): string[] {
    const members = membersOf ? membersOf(key) : [key];
    if (members.length === 1) {
      const row = posterTags()[members[0]];
      return row && Array.isArray(row.tags) ? row.tags : [];
    }
    const set = new Set<string>();
    for (const m of members) for (const t of posterTags()[m]?.tags || []) set.add(t);
    return [...set];
  }
  // The same union read, in entity space — the poster-side counterpart of a post
  // record's effectiveTagIds/effectiveTags/effectiveTagLabels.
  function posterTagEntriesOf(key: string): HologramTagEntry[] {
    const members = membersOf ? membersOf(key) : [key];
    const out: HologramTagEntry[] = [];
    const seen = new Set<string>();
    for (const m of members)
      for (const e of entriesOfRow(posterTags()[m])) {
        const k = e.id != null ? 'i:' + e.id : 'n:' + e.name;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
      }
    return out;
  }
  // Tag entities effectively applied to at least one poster — the vocabulary the
  // filter offers. One row per ENTITY (#810): two same-named tags are two rows,
  // told apart by the label (#774's "name(displayParentName)"). Kinded
  // (Work/Character) tags stay in (kind dots distinguish them); order is by kind
  // (Work → Character → General) then ja-collation so the flyout reads like the
  // palette.
  function posterFilterVocab(): HologramTagEntry[] {
    const m = new Map<string, HologramTagEntry>();
    for (const row of Object.values(posterTags()))
      for (const e of entriesOfRow(row)) {
        const k = e.id != null ? 'i:' + e.id : 'n:' + e.name;
        if (!m.has(k)) m.set(k, e);
      }
    const rank = (e: HologramTagEntry) => {
      const k = e.id != null ? tagKindOf(e.id) : tagKindOfName(e.name);
      return k === 'work' ? 0 : k === 'character' ? 1 : 2;
    };
    return [...m.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'ja'));
  }

  // Tag vocabulary sectioned by kind: the Work/Character kind sections first, then Uncategorized
  // (applied tags carrying no kind). Shared by the inspector's tag field and the bulk
  // tag dialog (via inspectorTagPickerData), which filter locally while typing.
  //
  // NAME space throughout (#810): this is the picker's vocabulary, and picking a
  // row types that string into a tag field — so the list is of strings, one row
  // per distinct name even where two entities share it (they would be two
  // identical rows writing the same value). Which entity that write lands on is
  // the write path's question, not this list's.
  function groupedTagVocab(opts?: { scope?: 'post' | 'poster' } | null): Array<{ name: string; tags: string[] }> {
    const scope = (opts && opts.scope) || 'post';
    const byJa = (a: string, b: string) => a.localeCompare(b, 'ja');
    const out: Array<{ name: string; tags: string[] }> = [];
    // Glossary: Work/Character are first-class categories — surface them as their own
    // sections ahead of Uncategorized, and pull kinded tags OUT of Uncategorized so each tag shows
    // once (kind takes precedence, danbooru-style).
    const kindSec: Record<string, string[]> = { work: [], character: [] };
    for (const [t, k] of kindByName()) if (k === 'work' || k === 'character') kindSec[k].push(t);
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
      for (const row of Object.values(posterTags())) for (const t of Array.isArray(row?.tags) ? row.tags : []) if (!tagKindOfName(t)) applied.add(t);
    } else {
      for (const p of allPosts()) for (const t of Array.isArray(p.tags) ? p.tags : []) if (!tagKindOfName(t)) applied.add(t);
    }
    // #86: a tag whose only foothold is an alias (zero direct usage so far)
    // still belongs in the general pool -- the AI-vocab-bridge case (a model's
    // English output aliased to a Japanese tag) names a canonical tag that may
    // not be applied to anything yet, and kinded tags already appear above
    // regardless of usage (kindByName reads tagTypes, not applied posts) so
    // this closes the same gap for the unkinded pool.
    const generalSet = new Set(applied);
    for (const canonical of tagAliasMap.values()) if (!tagKindOfName(canonical)) generalSet.add(canonical);
    const general = [...generalSet].sort(byJa);
    if (general.length) out.push({ name: t18n('tagUncategorized'), tags: general });
    return out;
  }

  // Same underlying vocabulary as the pickers (groupedTagVocab/charCandidatesFor)
  // but shaped as DATA for the React tag editor, which filters by its own local
  // query client-side — so keystrokes never round-trip through here.
  function inspectorTagPickerData(selectedTags: string[] | null | undefined, recordsForSource: HologramPost[] | null | undefined, scope?: string) {
    const sel = new Set<string>(selectedTags || []);
    // #86: each item carries its OWN alias strings (aliasesByCanonical, kept in
    // sync with tagAliasMap by setTagAliasMap) so TagField can match a typed
    // alias against a vocabulary entry it would otherwise never surface, and
    // annotate the hit ("←ねこ") without a second round trip.
    const vocabGroups = groupedTagVocab({ scope: (scope || 'post') as 'post' | 'poster' }).map((g) => ({
      name: g.name,
      items: g.tags.map((t) => ({ tag: t, kind: tagKindOfName(t) || null, aliases: aliasesByCanonical.get(t) })),
    }));
    const srcSet = new Set<string>();
    for (const r of recordsForSource || []) for (const h of Array.isArray(r.hashtags) ? r.hashtags : []) srcSet.add(h);
    const srcTagsForPicker = [...srcSet].map((t) => ({ tag: t, kind: tagKindOfName(t) || null }));
    // Suggestion groups, strongest first. Tier 1 (kind-scoped): Work on the card →
    // character candidates. Tier 2 (generic, post scope only): tags that often share
    // a post with any selected tag — a weak hint, so it sits below the kinded group,
    // dedupes against it, and stays silent until pairs have real support (minCount
    // lives in cooc.js). Poster tagging keeps tier 1 only: its general vocabulary is
    // deliberately separate from post-content descriptors (see groupedTagVocab).
    const coocGroups: any[] = [];
    const strong = new Set<string>();
    const workTags = [...sel].filter((t) => tagKindOfName(t) === 'work');
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
          items: rel.map((r) => ({ tag: r.tag, kind: tagKindOfName(r.tag) || null, title: t18n('editCoocWhy', [r.withTag, r.count]) })),
        });
      }
    }
    // #86: the flat alias map, for TagField's free-text Enter path (typing a
    // registered alias and confirming it should snap to the canonical name,
    // same "確定するチップは正規名" rule the picker follows) -- a direct
    // string lookup, cheaper than scanning the nested vocabGroups shape above.
    return { vocabGroups, srcTagsForPicker, coocGroups, aliasMap: Object.fromEntries(tagAliasMap) };
  }

  return { tagKindOf, tagKindOfName, kindLabel, posterTagsOf, posterTagEntriesOf, posterFilterVocab, groupedTagVocab, inspectorTagPickerData };
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
export let tagKindOf: ((tagId: number | null | undefined) => string | null) | null = null;
export function bindTagKindOf(fn: (tagId: number | null | undefined) => string | null): void {
  tagKindOf = fn;
}
export let posterFilterVocab: (() => HologramTagEntry[]) | null = null;
export function bindPosterFilterVocab(fn: () => HologramTagEntry[]): void {
  posterFilterVocab = fn;
}

// --- state (the 3 maps, owned here now — see header comment) ---
// tagTypes is keyed by tags.id and posterTags by posterKey (#810). Every mutator
// below REPLACES the map it touches rather than mutating it in place — makeTags'
// name-space memo uses object identity as its staleness test.
let tagTypes: TagTypeStore = {};
let tagLabels = {} as Record<string, string>;
let posterTags: PosterTagStore = {};
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
// The wire hands back one row per kinded ENTITY (#810); this module keys them by
// id so a lookup is O(1) and two same-named rows stay two rows.
async function readTagTypes(): Promise<{ types: TagTypeStore; labels: Record<string, string> }> {
  try {
    const r = await hologramIpc.getTagTypes();
    const types: TagTypeStore = {};
    for (const row of (r && r.types) || []) if (row && Number.isInteger(row.id)) types[row.id] = row;
    return { types, labels: (r && r.labels) || {} };
  } catch {
    return { types: {}, labels: {} };
  }
}
// Always writes BOTH maps so writing one never drops the other (set-tag-types
// only keeps the labels it receives). name/label go back over the wire untouched
// and main ignores them — the write is (id, kind) pairs.
async function writeTagTypes() {
  try {
    await hologramIpc.setTagTypes(Object.values(tagTypes), tagLabels);
  } catch {
    /* best-effort */
  }
}
async function readPosterTags(): Promise<PosterTagStore> {
  try {
    const r = await hologramIpc.getPosterTags();
    return (r && r.tags) || {};
  } catch {
    return {};
  }
}
// The write is name-keyed (a tag typed just now has no id yet — see
// lib-db-write.ts's replacePosterTags), so the ids and the #774 effective set the
// read carries have to come back FROM the write. Re-reading is how they do: the
// optimistic row a mutator left behind carries names only, and readers fall back
// to matching by name until this lands. Best-effort, like every call here — a
// failed re-read just leaves the store on that name-only fallback.
async function writePosterTags() {
  try {
    await hologramIpc.setPosterTags({ tags: posterTagNames() });
    posterTags = await readPosterTags();
    notify('poster');
  } catch {
    /* best-effort */
  }
}
function posterTagNames(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, row] of Object.entries(posterTags)) if (row && row.tags.length) out[key] = row.tags;
  return out;
}
// A poster's row as it looks between an edit and the write coming back: the names
// the user just set, and no ids. Dropping them rather than keeping the stale ones
// is the same call services/posts.ts's applyTagWrite makes for posts — arrays that
// no longer line up are worse than none.
function pendingPosterRow(tags: string[]): PosterTagRow {
  return { tags: tags.slice(), tagIds: [], effectiveTagIds: [], effectiveTags: [], effectiveTagLabels: [] };
}

// Boot-time load into this service's own state (idempotent — safe to call
// once from viewer.js's bootApp; a later call reuses the same promise).
let loadPromise: Promise<void> | null = null;
async function doLoad() {
  const [pt, tt, am] = await Promise.all([readPosterTags(), readTagTypes(), readTagAliasMap()]);
  posterTags = pt;
  tagTypes = tt.types;
  tagLabels = tt.labels;
  setTagAliasMap(am);
}
export function load() {
  if (!loadPromise) loadPromise = doLoad();
  return loadPromise;
}

// #32 St2: another window's set-tag-types / set-poster-tags landed — re-read the
// domain that actually changed (already current on disk by the time org-changed
// fires) and notify this window's own subscribers, same "reload + notify" shape
// folders.ts's org-changed listener uses. Best-effort: no bridge under Node (unit
// tests) — same swallow every hologramIpc call in this module already uses.
try {
  hologramIpc.onOrgChanged(async (kind) => {
    if (kind === 'tag-types') {
      // #86: add/remove-tag-alias (ipc-tag-vocab.ts's notifyTagVocabChanged)
      // relay on this SAME kind as every other tag-vocab write, so the alias
      // map is re-read right alongside the kind store it already reloads here.
      const [tt, am] = await Promise.all([readTagTypes(), readTagAliasMap()]);
      tagTypes = tt.types;
      tagLabels = tt.labels;
      setTagAliasMap(am);
      notify('kind');
    } else if (kind === 'poster-tags') {
      posterTags = await readPosterTags();
      notify('poster');
    }
  });
} catch {
  /* no bridge (Node unit test) */
}

// --- mutators: persist + notify (viewer.js calls these instead of
// mutating the maps itself; the surrounding business logic — undo
// recording, inspector refresh, confirm dialogs — stays in viewer.js) ---
// #810: classifies one tag ENTITY. The caller resolves which entity it means
// (kind-menu-builder.ts) — a name cannot decide it once two tags can share one.
// The re-read afterwards is not belt-and-braces: `name`/`label` are the DB's to
// compute (#774's display-parent rule), and a tag being classified for the first
// time has neither in this store yet.
export async function setTagKind(tagId: number, kind: string | null) {
  const next: TagTypeStore = { ...tagTypes };
  if (kind) next[tagId] = { id: tagId, kind, name: next[tagId]?.name || '', label: next[tagId]?.label || '' };
  else delete next[tagId];
  tagTypes = next;
  await writeTagTypes();
  const tt = await readTagTypes();
  tagTypes = tt.types;
  tagLabels = tt.labels;
  notify('kind');
}
export async function setKindLabel(kind: string, label: string | null | undefined) {
  const v = (label || '').trim();
  const next = { ...tagLabels };
  if (v) next[kind] = v;
  else delete next[kind];
  tagLabels = next;
  await writeTagTypes();
  notify('kind');
}
// Single poster's tag list (applyPosterTagChange in viewer.js); tags===null
// clears the entry. Fire-and-forget persist, matching the pre-move behavior.
export function setPosterTags(key: string, tags: string[] | null) {
  const next: PosterTagStore = { ...posterTags };
  if (tags && tags.length) next[key] = pendingPosterRow(tags);
  else delete next[key];
  posterTags = next;
  writePosterTags();
  notify('poster');
}
// Bulk apply (undo/redo): records = [{key, tags}], persisted once.
export function applyPosterTagRecords(records: Array<{ key: string; tags?: string[] }>) {
  const next: PosterTagStore = { ...posterTags };
  for (const r of records) {
    if (r.tags && r.tags.length) next[r.key] = pendingPosterRow(r.tags);
    else delete next[r.key];
  }
  posterTags = next;
  writePosterTags();
  notify('poster');
}
