// Poster-alias service — non-destructive, reversible name-merging of posterKeys
// that name the same real-world author/account (#23 St1: design confirmed
// 2026-07-11 / 2026-07-16 / 2026-07-19 / 2026-07-20 on the issue). Same
// "state owning" shape as tags.ts: load()/mutators persist to disk
// (get/set-poster-aliases, DB-backed via ipc-organize.ts) and notify
// subscribers; callers (poster-grid-builder.ts) hold the surrounding business
// logic (undo recording, confirm gate, toast, bumping the shared
// markPostsMutated generation) and call these mutators instead of reaching
// into the group array themselves.
//
// Canonical key = the group's primary posterKey (2026-07-11 design: no new id
// namespace) — every reader that groups/counts/filters posters folds a member
// key onto resolve(key), so the existing userKey space (query leaves, poster
// folders/tags) keeps working unchanged. membersOf(key) is the read every
// leaf/aggregate compiles against (the "user" query leaf, buildUsers' 2nd
// fold pass, poster-tag/-folder union reads); resolve(key) is membersOf's
// first entry — reindex() below keeps the primary pinned to that slot.
//
// Stage ① only (this issue's checklist item 1: foundation + manual UI +
// propagation). alias-suggest.ts (stage ②'s decision-free candidate ranking)
// and a `dismissed` list (stage ②'s reject-and-remember) land with that round.
import { hologramIpc } from './ipc.ts';

export interface PosterAliasGroup {
  id: string;
  primary: string;
  members: string[]; // primary first, then the rest in stored order — see reindex()
}

const genId = () => 'al-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

let groups: PosterAliasGroup[] = [];
let byKey = new Map<string, PosterAliasGroup>();

// Rebuilt after every load/mutation (the group count is tiny — a handful of
// merges at most — so a full rebuild is cheaper than patching the index).
function reindex() {
  byKey = new Map();
  for (const g of groups) {
    // Primary first: membersOf(key)[0] is the cheap "canonical key" a hot loop
    // can take without a second resolve() call, and it has to agree with resolve().
    g.members = [g.primary, ...g.members.filter((m) => m !== g.primary)];
    for (const m of g.members) byKey.set(m, g);
  }
}

async function readAliases() {
  try {
    const r = await hologramIpc.getPosterAliases();
    return Array.isArray(r?.groups) ? r.groups : [];
  } catch {
    return [];
  }
}
// Fire-and-forget persist, matching tags.ts's setPosterTags precedent.
async function writeAliases() {
  try {
    await hologramIpc.setPosterAliases({ groups: groups.map((g) => ({ id: g.id, primary: g.primary, members: g.members })) });
  } catch {
    /* best-effort */
  }
}

let loadPromise: Promise<void> | null = null;
async function doLoad() {
  const raw = await readAliases();
  groups = raw.filter((g): g is PosterAliasGroup => !!g && typeof g.id === 'string' && typeof g.primary === 'string' && Array.isArray(g.members) && g.members.length >= 2);
  reindex();
}
// Idempotent — safe to call once from viewer's bootApp; a later call reuses the same promise.
export function load(): Promise<void> {
  if (!loadPromise) loadPromise = doLoad();
  return loadPromise;
}

// --- subscribers (this module's own change channel — mirrors tags.ts; nobody
// bumps the shared post-generation counter here, that stays the caller's job
// exactly like tags.ts's mutators leave markPostsMutated to viewer.ts) ---
const subs: Array<() => void> = [];
function notify() {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}
export function onChange(cb: () => void): () => void {
  subs.push(cb);
  return () => {
    const i = subs.indexOf(cb);
    if (i >= 0) subs.splice(i, 1);
  };
}

// --- reads ---
export function groupOf(key: string): PosterAliasGroup | null {
  return byKey.get(key) || null;
}
/** Every posterKey this key's group bundles (primary first), or [key] alone when ungrouped. */
export function membersOf(key: string): string[] {
  const g = byKey.get(key);
  return g ? g.members : [key];
}
/** The group's canonical key (2026-07-11 design: the primary IS the canonical key — no new id namespace). Identity when ungrouped. */
export function resolve(key: string): string {
  const g = byKey.get(key);
  return g ? g.primary : key;
}
export function isPrimary(key: string): boolean {
  const g = byKey.get(key);
  return !g || g.primary === key;
}
export function allGroups(): readonly PosterAliasGroup[] {
  return groups;
}

// --- mutators: persist + notify. Undo recording / confirm gate / toast stay
// with the caller (poster-grid-builder.ts), same split tags.ts's header
// comment describes for its own mutators. ---

// Merge keyA and keyB's groups into one (creating a fresh group when neither
// has one yet). opts.primary must be a member of the union when given; falls
// back to whichever of keyA/keyB already had a group's primary — keyA's wins
// when BOTH already did, so merging an ungrouped poster INTO an already-merged
// one keeps that group's identity by default (the caller passes the poster
// whose inspector is open as keyA).
export function merge(keyA: string, keyB: string, opts?: { primary?: string }): boolean {
  if (!keyA || !keyB || keyA === keyB) return false;
  const gA = byKey.get(keyA);
  const gB = byKey.get(keyB);
  if (gA && gA === gB) return false; // already the same group
  const members = [...new Set([...(gA ? gA.members : [keyA]), ...(gB ? gB.members : [keyB])])];
  const fallbackPrimary = (gA && gA.primary) || (gB && gB.primary) || keyA;
  const primary = opts?.primary && members.includes(opts.primary) ? opts.primary : fallbackPrimary;
  const id = (gA && gA.id) || (gB && gB.id) || genId();
  groups = groups.filter((g) => g !== gA && g !== gB);
  groups.push({ id, primary, members });
  reindex();
  writeAliases();
  notify();
  return true;
}

// Remove key from its group. A group left with fewer than 2 members is not a
// group any more (dissolved — the last remaining member goes back to
// ungrouped too), the same "<2 members" floor lib-db-write.ts's
// replacePosterAliases enforces on the way to disk. Promotes the first
// remaining member to primary automatically when the removed key WAS the
// primary, so a group never persists with a primary that's not its member.
export function unlink(key: string): boolean {
  const g = byKey.get(key);
  if (!g) return false;
  const members = g.members.filter((m) => m !== key);
  groups = groups.filter((x) => x !== g);
  if (members.length >= 2) groups.push({ id: g.id, primary: g.primary === key ? members[0] : g.primary, members });
  reindex();
  writeAliases();
  notify();
  return true;
}

// Make key its group's primary (2026-07-11 design: default is the most-posted
// member, changeable from the inspector — the caller decides "most-posted" via
// buildUsers() counts and passes the winning key here; this module stays free
// of that dependency, same reasoning tags.ts keeps post/tag business logic out
// of its own mutators).
export function setPrimary(key: string): boolean {
  const g = byKey.get(key);
  if (!g || g.primary === key) return false;
  g.primary = key;
  reindex();
  writeAliases();
  notify();
  return true;
}

// --- undo/redo snapshot primitives (poster-grid-builder.ts's Ctrl+Z wiring for
// merge/unlink, #23 St1) ---
//
// The shared undo stack (undo.ts) is a per-target ADD/REMOVE value diff — a
// shape built for "is this value in that target's list" (post tags, poster
// tags, folder items). A merge/unlink is a structural edit on GROUPS, not a
// value in a list — merging two posters that were EACH already the primary of
// their own multi-member group (a normal case: merging a 3rd poster into an
// already-merged pair) has to restore ALL of both sides' prior groups exactly,
// not just "remove the one key that was named in the UI". So instead of a
// value diff, poster-grid-builder.ts's applier records a full before/after
// SNAPSHOT of every group touched, and these two functions are the only
// primitives it needs: capture the current groups touching a set of keys, and
// replace whatever currently touches those same keys with a given snapshot.

/** Every DISTINCT group (deep-cloned) that currently contains any of `keys`. */
export function snapshotFor(keys: readonly string[]): PosterAliasGroup[] {
  const seen = new Set<string>();
  const out: PosterAliasGroup[] = [];
  for (const key of keys) {
    const g = byKey.get(key);
    if (g && !seen.has(g.id)) {
      seen.add(g.id);
      out.push({ id: g.id, primary: g.primary, members: [...g.members] });
    }
  }
  return out;
}

// Drops every CURRENT group that contains any of `keys` first — a group
// straddling an affected + an unaffected key is rebuilt in full from
// `snapshot`, never partially patched — then re-inserts `snapshot` verbatim.
export function restore(keys: readonly string[], snapshot: readonly PosterAliasGroup[]): void {
  const keySet = new Set(keys);
  groups = groups.filter((g) => !g.members.some((m) => keySet.has(m)));
  for (const g of snapshot) if (g.members.length >= 2) groups.push({ id: g.id, primary: g.primary, members: [...g.members] });
  reindex();
  writeAliases();
  notify();
}
