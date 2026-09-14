import type { Translate } from './translation.ts';
import { hologramIpc } from './ipc.ts';
import type { PosterTagRow, TagGroupMember } from '../../../main/ipc-payloads.ts';
export type TagGroupStore = Record<number, TagGroupMember>;
export type PosterTagStore = Record<string, PosterTagRow>;
export function makeTags(deps: {
  tagGroups(): TagGroupStore;
  tagLabels(): Record<string, string>;
  posterTags(): PosterTagStore;
  allPosts(): HologramPost[];
  t: Translate;
  relatedTagCandidates(selectedTags: string[], opts?: { exclude?: Set<string> | null }): Array<{ tag: string; withTag: string | null; count: number }>;
}) {
  const { tagGroups, tagLabels, posterTags, allPosts, t: t18n, relatedTagCandidates } = deps;

  function tagGroupOf(tagId: number | null | undefined): string | null {
    if (tagId == null) return null;
    return tagGroups()[tagId]?.groupId || null;
  }
  let byName: { src: TagGroupStore; map: Map<string, string> } | null = null;
  function kindByName(): Map<string, string> {
    const src = tagGroups();
    if (byName && byName.src === src) return byName.map;
    const map = new Map<string, string>();
    for (const row of Object.values(src)) if (row && !map.has(row.name)) map.set(row.name, row.groupId);
    byName = { src, map };
    return map;
  }
  function tagGroupOfName(tag: string): string | null {
    return kindByName().get(tag) || null;
  }
  function tagGroupLabel(groupId: string): string {
    const labels = tagLabels();
    return (labels && labels[groupId]) || '';
  }
  function entriesOfRow(row: PosterTagRow | undefined): HologramTagEntry[] {
    if (!row) return [];
    return row.tags.map((name, i) => ({ id: row.tagIds[i] ?? null, name, label: name }));
  }

  function posterTagsOf(key: string): string[] {
    const row = posterTags()[key];
    return row && Array.isArray(row.tags) ? row.tags : [];
  }
  function posterTagEntriesOf(key: string): HologramTagEntry[] {
    return entriesOfRow(posterTags()[key]);
  }
  function posterFilterVocab(): HologramTagEntry[] {
    const m = new Map<string, HologramTagEntry>();
    for (const row of Object.values(posterTags()))
      for (const e of entriesOfRow(row)) {
        const k = e.id != null ? 'i:' + e.id : 'n:' + e.name;
        if (!m.has(k)) m.set(k, e);
      }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, 'ja'));
  }

  function groupedTagVocab(opts?: { scope?: 'post' | 'poster' } | null): Array<{ name: string; tags: string[] }> {
    const scope = (opts && opts.scope) || 'post';
    const byJa = (a: string, b: string) => a.localeCompare(b, 'ja');
    const out: Array<{ name: string; tags: string[] }> = [];
    for (const [id, name] of Object.entries(tagLabels())) {
      const tags = [...kindByName()]
        .filter(([, group]) => group === id)
        .map(([tag]) => tag)
        .sort(byJa);
      out.push({ name, tags });
    }
    const applied = new Set<string>();
    if (scope === 'poster') {
      for (const row of Object.values(posterTags())) for (const t of Array.isArray(row?.tags) ? row.tags : []) if (!tagGroupOfName(t)) applied.add(t);
    } else {
      for (const p of allPosts()) for (const t of Array.isArray(p.tags) ? p.tags : []) if (!tagGroupOfName(t)) applied.add(t);
    }
    const general = [...applied].sort(byJa);
    if (general.length) out.push({ name: t18n('tagUncategorized'), tags: general });
    return out;
  }
  function inspectorTagPickerData(selectedTags: string[] | null | undefined, recordsForSource: HologramPost[] | null | undefined, scope?: string) {
    const sel = new Set<string>(selectedTags || []);
    const vocabGroups = groupedTagVocab({ scope: (scope || 'post') as 'post' | 'poster' }).map((g) => ({
      name: g.name,
      items: g.tags.map((t) => ({ tag: t, kind: tagGroupOfName(t) || null })),
    }));
    const srcSet = new Set<string>();
    for (const r of recordsForSource || []) for (const h of Array.isArray(r.hashtags) ? r.hashtags : []) srcSet.add(h);
    const srcTagsForPicker = [...srcSet].map((t) => ({ tag: t, kind: tagGroupOfName(t) || null }));
    const coocGroups: any[] = [];
    if (scope !== 'poster') {
      const rel = relatedTagCandidates([...sel]);
      if (rel.length) {
        coocGroups.push({
          name: t18n('editCoocRelated'),
          items: rel.map((r) => ({ tag: r.tag, kind: tagGroupOfName(r.tag) || null, title: t18n('editCoocWhy', { name: r.withTag, occurrences: r.count }) })),
        });
      }
    }
    return { vocabGroups, srcTagsForPicker, coocGroups };
  }

  return { tagGroupOf, tagGroupOfName, tagGroupLabel, posterTagsOf, posterTagEntriesOf, posterFilterVocab, groupedTagVocab, inspectorTagPickerData };
}

export function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((t) => s.has(t));
}
export let tagGroupOf: ((tagId: number | null | undefined) => string | null) | null = null;
export function bindTagGroupOf(fn: (tagId: number | null | undefined) => string | null): void {
  tagGroupOf = fn;
}
export let posterFilterVocab: (() => HologramTagEntry[]) | null = null;
export function bindPosterFilterVocab(fn: () => HologramTagEntry[]): void {
  posterFilterVocab = fn;
}
let tagGroups: TagGroupStore = {};
let tagLabels = {} as Record<string, string>;
let posterTags: PosterTagStore = {};
export const getTagGroups = () => tagGroups;
export const getTagLabels = () => tagLabels;
export const getPosterTags = () => posterTags;
const subs: Array<(groupId?: string) => void> = [];
function notify(groupId?: string) {
  for (const cb of [...subs]) {
    try {
      cb(groupId);
    } catch {
      /* 握りつぶす */
    }
  }
}
export function onChange(cb: (groupId?: string) => void) {
  subs.push(cb);
  return () => {
    const i = subs.indexOf(cb);
    if (i >= 0) subs.splice(i, 1);
  };
}
async function readTagGroups(): Promise<{ memberships: TagGroupStore; labels: Record<string, string> }> {
  try {
    const r = await hologramIpc.getTagGroups();
    const memberships: TagGroupStore = {};
    for (const row of (r && r.memberships) || []) if (row && Number.isInteger(row.id)) memberships[row.id] = row;
    return { memberships, labels: (r && r.labels) || {} };
  } catch {
    return { memberships: {}, labels: {} };
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
async function writePosterTags() {
  try {
    await hologramIpc.setPosterTags({ tags: posterTagNames() });
    posterTags = await readPosterTags();
    notify('poster');
  } catch {
    /* できる範囲で */
  }
}
function posterTagNames(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, row] of Object.entries(posterTags)) if (row && row.tags.length) out[key] = row.tags;
  return out;
}
function pendingPosterRow(tags: string[]): PosterTagRow {
  return { tags: tags.slice(), tagIds: [] };
}
let loadPromise: Promise<void> | null = null;
async function doLoad() {
  const [pt, tt] = await Promise.all([readPosterTags(), readTagGroups()]);
  posterTags = pt;
  tagGroups = tt.memberships;
  tagLabels = tt.labels;
}
export function load() {
  if (!loadPromise) loadPromise = doLoad();
  return loadPromise;
}
try {
  hologramIpc.onOrgChanged(async (groupId) => {
    if (groupId === 'tag-groups') {
      const tt = await readTagGroups();
      tagGroups = tt.memberships;
      tagLabels = tt.labels;
      notify('groupId');
    } else if (groupId === 'poster-tags') {
      posterTags = await readPosterTags();
      notify('poster');
    }
  });
} catch {
  /* ブリッジ無し（Node の単体テスト） */
}
export async function setTagGroup(tagId: number, groupId: string | null) {
  const result = await hologramIpc.setTagGroup(tagId, groupId || null);
  if (!result.ok) throw new Error('Could not change tag group');
  const state = await readTagGroups();
  tagGroups = state.memberships;
  tagLabels = state.labels;
  notify('group');
}
export async function setTagGroupLabel(groupId: string, label: string | null | undefined) {
  const name = label?.trim();
  if (!name) return;
  const state = await hologramIpc.getTagGroups();
  const labels = { ...state.labels, [groupId]: name };
  const result = await hologramIpc.setTagGroups(state.memberships, labels);
  if (!result.ok) throw new Error('Could not rename tag group');
  tagLabels = labels;
  notify('group');
}
export function setPosterTags(key: string, tags: string[] | null) {
  const next: PosterTagStore = { ...posterTags };
  if (tags && tags.length) next[key] = pendingPosterRow(tags);
  else delete next[key];
  posterTags = next;
  writePosterTags();
  notify('poster');
}
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
