'use strict';

// DB-owned organization state for #298/St5. The read path already uses SQLite,
// but these values still lived in JSON files until the truth-source flip. Keep
// the replacement operations here so every IPC handler shares the same
// transaction boundary instead of each rebuilding a different subset of tables.

import type Database from 'better-sqlite3';
import { normFolders } from './lib-folder-tree.ts';
import { normalizeTagName, normalizeTagNames } from '../../../native-host/tag-normalize.mts';
import { effectiveTagsOf, tagClosureResolver } from './lib-db-query.ts';
import type { PosterTagNamesState, PosterTagRow, PosterTagsState, TagTypeNamesState, TagTypeRow, TagTypesState } from './ipc-payloads.ts';
import {
  addTagParent as addTagParentImpl,
  deleteOrphanTags as deleteOrphanTagsImpl,
  keepSeparateRename as keepSeparateRenameImpl,
  mergeTags as mergeTagsImpl,
  removeTagParent as removeTagParentImpl,
  renameTag as renameTagImpl,
  setTagKind as setTagKindImpl,
  splitTag as splitTagImpl,
  tagParentEdges as tagParentEdgesImpl,
  tagSplitPreview as tagSplitPreviewImpl,
  tagVocabOverview as tagVocabOverviewImpl,
} from './lib-db-tag-vocab.ts';

type Sqlite = Database.Database;

// Generic string-array cleanup for non-tag values (postId/folderId/postKey
// arrays) — no glyph normalization, those aren't tag text. Tag arrays use
// normalizeTagNames instead (below): see replacePostTags/replacePosterTags.
function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v) => typeof v === 'string' && v).map(String))] : [];
}

function stateGet(sqlite: Sqlite, key: string): string | null {
  const row = sqlite.prepare('SELECT value FROM store_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function stateSet(sqlite: Sqlite, key: string, value: string) {
  sqlite.prepare('INSERT INTO store_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function existingPostIds(sqlite: Sqlite): Set<string> {
  return new Set((sqlite.prepare('SELECT captureId FROM posts').all() as Array<{ captureId: string }>).map((row) => row.captureId));
}

// Normalizes (NFKC + trim, #197) before every lookup/insert — the choke point
// for every IPC-driven tag write below (tag types, poster tags, post tags),
// same role makeTagResolver plays for the save pipeline (lib-db-record-writer.ts).
function tagResolver(sqlite: Sqlite) {
  const select = sqlite.prepare('SELECT id FROM tags WHERE name = ? ORDER BY id LIMIT 1');
  const insert = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  return (rawName: string) => {
    const name = normalizeTagName(rawName) || rawName;
    const row = select.get(name) as { id: number } | undefined;
    return row?.id ?? Number(insert.run(name).lastInsertRowid);
  };
}

// #810: the Kind store is keyed by tag ENTITY. The renderer hands back the same
// rows readTagTypes gave it, so a kind lands on the id the user classified — no
// name resolution, and therefore no same-name fold to lose one of them in.
//
// Still a whole-map replace (the renderer owns the map and re-sends it on every
// change, the same shape every other setter in this module has), but the reset
// is now safe: NULLing every kind and re-applying by id restores exactly what
// the sender holds, whereas the name-keyed version re-applied only ONE entity
// per name and left the other permanently kindless.
function replaceTagTypes(sqlite: Sqlite, types: unknown, labels: unknown) {
  sqlite.prepare('UPDATE tags SET kind = NULL').run();
  const setKind = sqlite.prepare('UPDATE tags SET kind = ? WHERE id = ?');
  for (const row of Array.isArray(types) ? types : []) {
    if (!row || typeof row !== 'object') continue;
    const { id, kind } = row as { id?: unknown; kind?: unknown };
    if (!Number.isInteger(id) || typeof kind !== 'string' || !kind) continue;
    setKind.run(kind, id);
  }
  stateSet(sqlite, 'tagTypeLabels', JSON.stringify(labels && typeof labels === 'object' ? labels : null));
}

// The renamable work/character label table, shared by both readers below. The
// value is DB-owned and only written by this module, so a malformed one is
// non-authoritative rather than a reason to block all tags — and an object here
// IS the renderer's kind-label map (TagTypesState.labels in ipc-payloads.ts),
// since replaceTagTypes is its only writer.
function readTagTypeLabels(sqlite: Sqlite): Record<string, string> | null {
  let labels: unknown = null;
  try {
    labels = JSON.parse(stateGet(sqlite, 'tagTypeLabels') || 'null');
  } catch {
    /* see above */
  }
  return labels && typeof labels === 'object' ? (labels as Record<string, string>) : null;
}

function readTagTypes(sqlite: Sqlite): TagTypesState {
  // labelOf is #774's display-name rule; a library with no parent edges has no
  // resolver at all, and then a tag's label is just its name.
  const closure = tagClosureResolver(sqlite);
  const rows = sqlite.prepare('SELECT id, name, kind FROM tags WHERE kind IS NOT NULL ORDER BY id').all() as Array<{ id: number; name: string; kind: string }>;
  const types: TagTypeRow[] = rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, label: closure ? closure.labelOf(row.id) : row.name }));
  return { types, labels: readTagTypeLabels(sqlite) };
}

// --- The name-keyed pair, for the ZIP interchange only (#810) ---------------
// tag-types.json crosses between LIBRARIES, where a tag id means nothing, so the
// archive keeps the name-keyed shape this module used to expose everywhere. Two
// same-named entities necessarily collapse into one entry here (first/lowest id
// wins) — that is a property of a name-keyed format, not a bug to fix in it.
function readTagTypeNames(sqlite: Sqlite): TagTypeNamesState {
  const types: Record<string, string> = {};
  for (const row of sqlite.prepare('SELECT name, kind FROM tags WHERE kind IS NOT NULL ORDER BY id').all() as Array<{ name: string; kind: string }>) {
    if (!(row.name in types)) types[row.name] = row.kind;
  }
  return { types, labels: readTagTypeLabels(sqlite) };
}

// The import half. Deliberately NOT a replace: it fills a kind in only where the
// named entity has none, so importing an archive can never erase a kind a local
// same-name entity already carries. That is also exactly lib-archive.ts's
// mergeTagTypes rule ("cur wins") expressed against entities instead of names —
// the caller passes the already-merged map, and every entry that came from the
// local side is a no-op here by construction.
function fillTagKindsByName(sqlite: Sqlite, types: unknown, labels: unknown) {
  const normalized = types && typeof types === 'object' ? (types as Record<string, unknown>) : {};
  const resolve = tagResolver(sqlite);
  const setKind = sqlite.prepare('UPDATE tags SET kind = ? WHERE name = ? AND kind IS NULL');
  for (const [rawName, kind] of Object.entries(normalized)) {
    const name = normalizeTagName(rawName);
    if (!name || typeof kind !== 'string' || !kind) continue;
    resolve(name); // an incoming kind may name a tag this library has never seen
    setKind.run(kind, name);
  }
  stateSet(sqlite, 'tagTypeLabels', JSON.stringify(labels && typeof labels === 'object' ? labels : null));
}

function replaceUngrouped(sqlite: Sqlite, keys: unknown) {
  sqlite.prepare('DELETE FROM ungrouped_keys').run();
  const insert = sqlite.prepare('INSERT INTO ungrouped_keys (postKey) VALUES (?)');
  for (const key of strings(keys)) insert.run(key);
}

function readUngrouped(sqlite: Sqlite) {
  return { keys: (sqlite.prepare('SELECT postKey FROM ungrouped_keys ORDER BY rowid').all() as Array<{ postKey: string }>).map((row) => row.postKey) };
}

function replaceFolders(sqlite: Sqlite, data: any) {
  const folders = normFolders(data?.folders);
  const validPosts = existingPostIds(sqlite);
  sqlite.prepare('DELETE FROM folder_items').run();
  sqlite.prepare('DELETE FROM folders').run();

  const insertFolder = sqlite.prepare('INSERT INTO folders (id, name, kind, created, tree) VALUES (?, ?, ?, ?, ?)');
  const setParent = sqlite.prepare('UPDATE folders SET parentId = ? WHERE id = ?');
  const insertItem = sqlite.prepare('INSERT OR IGNORE INTO folder_items (folderId, postId) VALUES (?, ?)');
  const ids = new Set<string>();
  for (const folder of folders) {
    if (!folder || typeof folder.id !== 'string' || !folder.id || typeof folder.name !== 'string') continue;
    const kind = folder.kind === 'dynamic' ? 'dynamic' : 'static';
    const tree = kind === 'dynamic' && folder.tree && typeof folder.tree === 'object' ? JSON.stringify(folder.tree) : null;
    insertFolder.run(folder.id, folder.name, kind, Number.isFinite(folder.created) ? folder.created : null, tree);
    ids.add(folder.id);
    for (const postId of strings(folder.items)) if (validPosts.has(postId)) insertItem.run(folder.id, postId);
  }
  // Insert every id before applying edges: sibling order is array order, so a
  // valid child may legitimately precede its parent in the flat list.
  for (const folder of folders) if (folder.parentId) setParent.run(folder.parentId, folder.id);
  stateSet(sqlite, 'activeFolderId', typeof data?.activeId === 'string' && ids.has(data.activeId) ? data.activeId : '');
}

function readFolders(sqlite: Sqlite) {
  const itemRows = sqlite.prepare('SELECT folderId, postId FROM folder_items ORDER BY rowid').all() as Array<{ folderId: string; postId: string }>;
  const items = new Map<string, string[]>();
  for (const row of itemRows) {
    let values = items.get(row.folderId);
    if (!values) items.set(row.folderId, (values = []));
    values.push(row.postId);
  }
  const folders = normFolders(
    (sqlite.prepare('SELECT id, name, kind, created, parentId, tree FROM folders ORDER BY rowid').all() as any[]).map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      created: row.created,
      parentId: row.parentId,
      items: items.get(row.id) || [],
      ...(row.kind === 'dynamic' && row.tree ? { tree: JSON.parse(row.tree) } : {}),
    })),
  );
  const ids = new Set(folders.map((folder) => folder.id));
  const activeId = stateGet(sqlite, 'activeFolderId');
  return {
    folders,
    activeId: activeId && ids.has(activeId) ? activeId : null,
  };
}

function replaceManualGroups(sqlite: Sqlite, groups: unknown) {
  const validPosts = existingPostIds(sqlite);
  sqlite.prepare('DELETE FROM manual_group_items').run();
  sqlite.prepare('DELETE FROM manual_groups').run();
  const create = sqlite.prepare('INSERT INTO manual_groups DEFAULT VALUES');
  const insert = sqlite.prepare('INSERT INTO manual_group_items (groupId, postId, seq) VALUES (?, ?, ?)');
  for (const group of Array.isArray(groups) ? groups : []) {
    const members = strings(group).filter((id) => validPosts.has(id));
    if (members.length < 2) continue;
    const groupId = Number(create.run().lastInsertRowid);
    members.forEach((postId, seq) => insert.run(groupId, postId, seq));
  }
}

function readManualGroups(sqlite: Sqlite) {
  const rows = sqlite.prepare('SELECT groupId, postId FROM manual_group_items ORDER BY groupId, seq').all() as Array<{ groupId: number; postId: string }>;
  const groups = new Map<number, string[]>();
  for (const row of rows) {
    let values = groups.get(row.groupId);
    if (!values) groups.set(row.groupId, (values = []));
    values.push(row.postId);
  }
  return { groups: [...groups.values()] };
}

function replacePosterFolders(sqlite: Sqlite, data: any) {
  sqlite.prepare('DELETE FROM poster_folder_items').run();
  sqlite.prepare('DELETE FROM poster_folders').run();
  const folder = sqlite.prepare('INSERT INTO poster_folders (id, name) VALUES (?, ?)');
  const item = sqlite.prepare('INSERT OR IGNORE INTO poster_folder_items (folderId, posterKey) VALUES (?, ?)');
  for (const entry of Array.isArray(data?.folders) ? data.folders : []) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.name !== 'string') continue;
    folder.run(entry.id, entry.name);
    for (const key of strings(entry.items)) item.run(entry.id, key);
  }
}

function readPosterFolders(sqlite: Sqlite) {
  const items = new Map<string, string[]>();
  for (const row of sqlite.prepare('SELECT folderId, posterKey FROM poster_folder_items ORDER BY rowid').all() as Array<{ folderId: string; posterKey: string }>) {
    let values = items.get(row.folderId);
    if (!values) items.set(row.folderId, (values = []));
    values.push(row.posterKey);
  }
  return { folders: (sqlite.prepare('SELECT id, name FROM poster_folders ORDER BY rowid').all() as Array<{ id: string; name: string }>).map((row) => ({ ...row, items: items.get(row.id) || [] })) };
}

// The write stays keyed by NAME even though the read hands back entities (#810):
// the poster tag editor is a text field, and a tag typed just now has no id until
// this resolve() creates it — exactly the asymmetry replacePostTags already has.
function replacePosterTags(sqlite: Sqlite, data: any) {
  sqlite.prepare('DELETE FROM poster_tags').run();
  const resolve = tagResolver(sqlite);
  const insert = sqlite.prepare('INSERT OR IGNORE INTO poster_tags (posterKey, tagId) VALUES (?, ?)');
  for (const [key, tags] of Object.entries(data?.tags && typeof data.tags === 'object' ? data.tags : {})) {
    if (!key) continue;
    for (const name of normalizeTagNames(tags)) insert.run(key, resolve(name));
  }
}

// #810: a poster's tags read as ENTITIES, in the same parallel-array shape a post
// record carries, plus #774's effective set — the raw tags and every ancestor the
// tag_parents edges imply. Without the ids the renderer could only match posters
// by name, which is the method #774 explicitly rejected (a name-keyed closure
// reaches only one of two same-named entities and miscounts the display name);
// without the effective set, filtering posters by a parent tag would miss the
// posters carrying only its children, while the post side found them.
function readPosterTags(sqlite: Sqlite): PosterTagsState {
  const rowsByPoster = new Map<string, Array<{ id: number; name: string }>>();
  for (const row of sqlite.prepare('SELECT pt.posterKey AS posterKey, t.id AS id, t.name AS name FROM poster_tags pt JOIN tags t ON t.id = pt.tagId ORDER BY pt.rowid').all() as Array<{ posterKey: string; id: number; name: string }>) {
    let list = rowsByPoster.get(row.posterKey);
    if (!list) rowsByPoster.set(row.posterKey, (list = []));
    list.push({ id: row.id, name: row.name });
  }
  const closure = tagClosureResolver(sqlite);
  const tags: Record<string, PosterTagRow> = {};
  for (const [posterKey, list] of rowsByPoster) {
    tags[posterKey] = { tags: list.map((t) => t.name), tagIds: list.map((t) => t.id), ...effectiveTagsOf(closure, list) };
  }
  return { tags };
}

// The name-only projection, for the ZIP interchange — same reasoning as
// readTagTypeNames above (poster-tags.json travels between libraries, ids do not).
function readPosterTagNames(sqlite: Sqlite): PosterTagNamesState {
  const tags: Record<string, string[]> = {};
  for (const row of sqlite.prepare('SELECT pt.posterKey, t.name FROM poster_tags pt JOIN tags t ON t.id = pt.tagId ORDER BY pt.rowid').all() as Array<{ posterKey: string; name: string }>) {
    (tags[row.posterKey] || (tags[row.posterKey] = [])).push(row.name);
  }
  return { tags };
}

// #23 St1: poster-alias groups — non-destructive, reversible name-merging.
// Same replace-whole-thing shape as poster folders/tags above: the renderer
// owns the union-find bookkeeping (services/aliases.ts) and hands back the
// full group list on every mutation. A group needs 2+ members (a lone
// "group" is not a merge); `primary` must be one of `members` or the first
// member wins — both defensive against a hand-edited or corrupted import.
function replacePosterAliases(sqlite: Sqlite, data: any) {
  sqlite.prepare('DELETE FROM poster_alias_group_members').run();
  sqlite.prepare('DELETE FROM poster_alias_groups').run();
  const insertGroup = sqlite.prepare('INSERT INTO poster_alias_groups (id, primaryKey) VALUES (?, ?)');
  const insertMember = sqlite.prepare('INSERT OR IGNORE INTO poster_alias_group_members (groupId, posterKey) VALUES (?, ?)');
  const claimed = new Set<string>(); // one group per posterKey (the UNIQUE index enforces it too) — first group wins a key claimed twice
  for (const entry of Array.isArray(data?.groups) ? data.groups : []) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
    const members = strings(entry.members).filter((key) => !claimed.has(key));
    if (members.length < 2) continue;
    const primary = typeof entry.primary === 'string' && members.includes(entry.primary) ? entry.primary : members[0];
    insertGroup.run(entry.id, primary);
    for (const key of members) {
      claimed.add(key);
      insertMember.run(entry.id, key);
    }
  }
}

function readPosterAliases(sqlite: Sqlite) {
  const members = new Map<string, string[]>();
  for (const row of sqlite.prepare('SELECT groupId, posterKey FROM poster_alias_group_members ORDER BY rowid').all() as Array<{ groupId: string; posterKey: string }>) {
    let list = members.get(row.groupId);
    if (!list) members.set(row.groupId, (list = []));
    list.push(row.posterKey);
  }
  return {
    groups: (sqlite.prepare('SELECT id, primaryKey FROM poster_alias_groups ORDER BY rowid').all() as Array<{ id: string; primaryKey: string }>)
      .map((row) => ({ id: row.id, primary: row.primaryKey, members: members.get(row.id) || [] }))
      // Defensive: a group whose members all vanished (e.g. a hand-edited DB) is not worth surfacing.
      .filter((g) => g.members.length >= 2),
  };
}

// Post-level edit: tag assignment (post_tags) + a patch of loose per-post
// fields. userKind/tagReviewed (the tagging-wizard's flags) were added by the
// add-store-state migration specifically because they had no St2 home
// (lib-db.ts's migration comment) — normalizePostRecord's PostRecordShape
// deliberately excludes them (native-host/post-record.mts), so they are
// DB-only and never round-trip through a sidecar. memo (#36) is different: it
// IS part of PostRecordShape and travels with the record (export ZIP, trash
// restore) like any other field — this is just its one in-app EDIT path,
// chosen over a new IPC because this one already had the allowlist/atomic-write/
// updatedAt-bump plumbing a sidecar-backed field needs. Returns false without
// writing if postId isn't a known post, mirroring the old sidecar handler's
// "jsonPath missing -> ok:false".
function replacePostTags(sqlite: Sqlite, postId: string, tags: unknown, patch: unknown): boolean {
  const post = sqlite.prepare('SELECT ftsRowid FROM posts WHERE captureId = ?').get(postId) as { ftsRowid: number | null } | undefined;
  if (!post) return false;

  const names = normalizeTagNames(tags);
  sqlite.prepare('DELETE FROM post_tags WHERE postId = ?').run(postId);
  const resolve = tagResolver(sqlite);
  const insertTag = sqlite.prepare('INSERT OR IGNORE INTO post_tags (postId, tagId) VALUES (?, ?)');
  for (const tagId of names.map(resolve)) insertTag.run(postId, tagId);

  const sets = ['updatedAt = ?'];
  const params: unknown[] = [new Date().toISOString()];
  if (patch && typeof patch === 'object') {
    if ('userKind' in (patch as Record<string, unknown>)) {
      sets.push('userKind = ?');
      const userKind = (patch as Record<string, unknown>).userKind;
      params.push(userKind === 'plain' || userKind === 'media' ? userKind : null);
    }
    if ('tagReviewed' in (patch as Record<string, unknown>)) {
      sets.push('tagReviewed = ?');
      params.push((patch as Record<string, unknown>).tagReviewed ? 1 : 0);
    }
    // #36: the inspector's memo textarea. Unlike the two flags above this
    // column also feeds posts_fts (add-post-cw-sensitive's rebuild recipe) —
    // but that index has no live reader yet (query.ts's textHaystackOf is the
    // only wired-up free-text search path, same module comment as eagleName/
    // description before it), so this patch does not also rewrite the FTS row;
    // whichever stage wires posts_fts up gets it from the next writePost pass,
    // same as every other column this function doesn't touch.
    if ('memo' in (patch as Record<string, unknown>)) {
      sets.push('memo = ?');
      const memo = (patch as Record<string, unknown>).memo;
      params.push(typeof memo === 'string' && memo ? memo : null);
    }
  }
  sqlite.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE captureId = ?`).run(...params, postId);

  // posts_fts is standalone (no content= link, lib-db-schema.ts's schema
  // comment), so a plain column UPDATE is valid FTS5 SQL — no delete+reinsert
  // needed to keep the other indexed columns intact. Addressed by rowid, not by
  // the UNINDEXED postId (#444) — see posts.ftsRowid. Null only for a posts row
  // some other path inserted directly, which has no FTS row to update either.
  if (post.ftsRowid != null) sqlite.prepare('UPDATE posts_fts SET tagsText = ? WHERE rowid = ?').run(names.join(' '), post.ftsRowid);
  return true;
}

// Where a post sits in the library's structure, as the trash record has to carry
// it (#593). Both are ID references, not names: a folder rename between the
// delete and the restore must not lose the membership.
interface PostMemberships {
  folders: string[];
  // seq is the post's position INSIDE its group, kept because a manual group is
  // an ordered container — restoring a post to the end of the group it used to
  // lead is not "back where it was".
  manualGroups: Array<{ groupId: number; seq: number }>;
}

// Everything about one post that lives in the DB rather than in its record, read
// before the row disappears — ipc-trash.ts's delete-post carries this into the
// trash record, and restore-post reads it back.
//
// Every field here shares one reason for existing: FK ON DELETE CASCADE takes
// these rows with the post, and nothing in a record would reconstruct them.
// #593 added the two memberships after finding that a restored post came back
// with its tags but belonging to nothing — while #34's replacement path had been
// carrying the same two across to the new capture all along.
function readPostFlags(sqlite: Sqlite, postId: string): ({ tags: string[]; userKind: string | null; tagReviewed: boolean | null } & PostMemberships) | null {
  const row = sqlite.prepare('SELECT userKind, tagReviewed FROM posts WHERE captureId = ?').get(postId) as { userKind: string | null; tagReviewed: number | null } | undefined;
  if (!row) return null;
  const tags = (sqlite.prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid').all(postId) as Array<{ name: string }>).map((r) => r.name);
  const folders = (sqlite.prepare('SELECT folderId FROM folder_items WHERE postId = ? ORDER BY rowid').all(postId) as Array<{ folderId: string }>).map((r) => r.folderId);
  const manualGroups = sqlite.prepare('SELECT groupId, seq FROM manual_group_items WHERE postId = ? ORDER BY groupId').all(postId) as Array<{ groupId: number; seq: number }>;
  return { tags, userKind: row.userKind, tagReviewed: row.tagReviewed == null ? null : !!row.tagReviewed, folders, manualGroups };
}

// Re-applies userKind/tagReviewed from a sidecar-shaped record onto an
// existing posts row. Used by ipc-trash.ts's restore-post (reading the trashed
// sidecar copy delete-post stamped with the pre-trash DB values), because these
// two columns never round-trip through normalizePostRecord/lib-db-import.ts: a
// plain importAll after a restore recreates the posts row with tags intact but
// these two columns NULL, since nothing else ever writes them from a sidecar.
// COALESCE keeps the existing column when the record doesn't carry the field
// (undefined -> null param), rather than clobbering it to NULL.
// Direct DB-side removal for a user-initiated delete (ipc-trash.ts's
// delete-post). #299 (St6): once the DB is authoritative, "the sidecar is
// gone from the watched folder" is no longer a signal importAll acts on
// (lib-db-import.ts's dbIsTruth gate — a post can legitimately have no
// sidecar at all once native saves flow through the inbox instead), so a
// trash move can no longer rely on the NEXT importAll noticing the file's
// absence and cascade-deleting the row. This is that deletion, made explicit.
// FK ON DELETE CASCADE takes media/post_tags with it; posts_fts is standalone
// (schema comment) so its row is removed explicitly.
// (addressed by rowid, not the UNINDEXED postId — #444; the lookup has to happen
// before the posts row carrying the key is gone).
function deletePost(sqlite: Sqlite, postId: string): boolean {
  const post = sqlite.prepare('SELECT ftsRowid FROM posts WHERE captureId = ?').get(postId) as { ftsRowid: number | null } | undefined;
  if (post?.ftsRowid != null) sqlite.prepare('DELETE FROM posts_fts WHERE rowid = ?').run(post.ftsRowid);
  return sqlite.prepare('DELETE FROM posts WHERE captureId = ?').run(postId).changes > 0;
}

// Clear-all's DB half. Wiping the media files used to be enough because the next
// folder scan noticed the records had lost their files and dropped the rows; with
// the scan gone (#302), the wipe has to say so. Organization (folders, tags,
// poster-*) is deliberately kept — clear-all has always been "remove the posts",
// and the surviving structure is what the user rebuilds into.
function deleteAllPosts(sqlite: Sqlite): number {
  sqlite.prepare('DELETE FROM posts_fts').run();
  return sqlite.prepare('DELETE FROM posts').run().changes;
}

function applyPostFlagsFromRecord(sqlite: Sqlite, postId: string, rec: { userKind?: unknown; tagReviewed?: unknown; folders?: unknown; manualGroups?: unknown }) {
  const userKind = rec.userKind === 'plain' || rec.userKind === 'media' ? rec.userKind : null;
  const tagReviewed = rec.tagReviewed == null ? null : rec.tagReviewed ? 1 : 0;
  if (userKind != null || tagReviewed != null) {
    sqlite.prepare('UPDATE posts SET userKind = COALESCE(?, userKind), tagReviewed = COALESCE(?, tagReviewed) WHERE captureId = ?').run(userKind, tagReviewed, postId);
  }
  restoreMemberships(sqlite, postId, rec);
}

// Puts the post back into the folders and manual groups it was in (#593), and
// ONLY into the ones that still exist.
//
// A container can be deleted while the post sits in the trash, and both tables
// reference theirs by foreign key — an INSERT naming a folder that is gone fails
// and would take the whole restore down with it. Dropping just that one
// membership is what #34's replacement path already does in effect (it copies
// the surviving rows, so a deleted folder contributes nothing), and losing the
// post to protect a membership would be the wrong trade.
//
// Silent by design: the alternatives are refusing the restore, or recreating a
// container the user deleted on purpose. INSERT OR IGNORE covers the post
// already being a member (a restore replayed after a partial failure).
//
// The record is external input — the trash folder is writable from outside the
// app (#324) — so every id is type-checked before it reaches a statement.
function restoreMemberships(sqlite: Sqlite, postId: string, rec: { folders?: unknown; manualGroups?: unknown }) {
  const folders = Array.isArray(rec.folders) ? rec.folders : [];
  if (folders.length) {
    const insert = sqlite.prepare('INSERT OR IGNORE INTO folder_items (folderId, postId) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM folders WHERE id = ?)');
    for (const folderId of folders) {
      if (typeof folderId === 'string' && folderId) insert.run(folderId, postId, folderId);
    }
  }
  const groups = Array.isArray(rec.manualGroups) ? rec.manualGroups : [];
  if (groups.length) {
    const insert = sqlite.prepare('INSERT OR IGNORE INTO manual_group_items (groupId, postId, seq) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM manual_groups WHERE id = ?)');
    for (const g of groups) {
      const groupId = g && typeof g === 'object' ? (g as { groupId?: unknown }).groupId : null;
      const seq = g && typeof g === 'object' ? (g as { seq?: unknown }).seq : null;
      if (typeof groupId === 'number' && Number.isInteger(groupId) && typeof seq === 'number' && Number.isInteger(seq)) insert.run(groupId, postId, seq, groupId);
    }
  }
}

function replaceTabs(sqlite: Sqlite, data: any) {
  sqlite.prepare('DELETE FROM tab_windows').run();
  sqlite.prepare('DELETE FROM tabs').run();
  const tabs = Array.isArray(data?.tabs) ? data.tabs : [];
  const insert = sqlite.prepare('INSERT INTO tabs (id, windowId, position, pinned, title, state) VALUES (?, ?, ?, ?, ?, ?)');
  const ids = new Set<string>();
  tabs.forEach((tab: any, position: number) => {
    if (!tab || typeof tab.id !== 'string' || !tab.id) return;
    ids.add(tab.id);
    insert.run(tab.id, 'main', position, tab.pinned ? 1 : 0, typeof tab.title === 'string' ? tab.title : null, JSON.stringify(tab.state ?? null));
  });
  sqlite.prepare('INSERT INTO tab_windows (windowId, activeTabId) VALUES (?, ?)').run('main', typeof data?.activeTabId === 'string' && ids.has(data.activeTabId) ? data.activeTabId : null);
}

function readTabs(sqlite: Sqlite) {
  const tabs = (sqlite.prepare("SELECT id, pinned, title, state FROM tabs WHERE windowId = 'main' ORDER BY position").all() as any[]).map((row) => ({ id: row.id, pinned: !!row.pinned, title: row.title, state: JSON.parse(row.state) }));
  if (!tabs.length) return null;
  const active = sqlite.prepare("SELECT activeTabId FROM tab_windows WHERE windowId = 'main'").get() as { activeTabId: string | null } | undefined;
  return { tabs, activeTabId: active?.activeTabId || null };
}

function createDbWriter(sqlite: Sqlite) {
  const transaction = <T>(fn: () => T) => sqlite.transaction(fn)();
  return {
    stateGet: (key: string) => stateGet(sqlite, key),
    stateSet: (key: string, value: string) => transaction(() => stateSet(sqlite, key, value)),
    getTagTypes: () => readTagTypes(sqlite),
    setTagTypes: (types: unknown, labels: unknown) => transaction(() => replaceTagTypes(sqlite, types, labels)),
    // #810: the by-name pair below is lib-archive.ts's, and only lib-archive.ts's.
    getTagTypeNames: () => readTagTypeNames(sqlite),
    fillTagKindsByName: (types: unknown, labels: unknown) => transaction(() => fillTagKindsByName(sqlite, types, labels)),
    getUngrouped: () => readUngrouped(sqlite),
    setUngrouped: (keys: unknown) => transaction(() => replaceUngrouped(sqlite, keys)),
    getFolders: () => readFolders(sqlite),
    setFolders: (data: unknown) => transaction(() => replaceFolders(sqlite, data)),
    getManualGroups: () => readManualGroups(sqlite),
    setManualGroups: (groups: unknown) => transaction(() => replaceManualGroups(sqlite, groups)),
    getPosterFolders: () => readPosterFolders(sqlite),
    setPosterFolders: (data: unknown) => transaction(() => replacePosterFolders(sqlite, data)),
    getPosterTags: () => readPosterTags(sqlite),
    getPosterTagNames: () => readPosterTagNames(sqlite),
    setPosterTags: (data: unknown) => transaction(() => replacePosterTags(sqlite, data)),
    getPosterAliases: () => readPosterAliases(sqlite),
    setPosterAliases: (data: unknown) => transaction(() => replacePosterAliases(sqlite, data)),
    getTabs: () => readTabs(sqlite),
    setTabs: (data: unknown) => transaction(() => replaceTabs(sqlite, data)),
    setPostTags: (postId: string, tags: unknown, patch: unknown) => transaction(() => replacePostTags(sqlite, postId, tags, patch)),
    getPostFlags: (postId: string) => readPostFlags(sqlite, postId),
    restorePostFlags: (postId: string, rec: { userKind?: unknown; tagReviewed?: unknown; folders?: unknown; manualGroups?: unknown }) => transaction(() => applyPostFlagsFromRecord(sqlite, postId, rec)),
    deletePost: (postId: string) => transaction(() => deletePost(sqlite, postId)),
    deleteAllPosts: () => transaction(() => deleteAllPosts(sqlite)),
    // #21 tag-vocabulary layer (lib-db-tag-vocab.ts). Reads run outside a
    // transaction (better-sqlite3 read statements do not need one); every
    // write below wraps its own multi-statement work in lib-db-tag-vocab.ts
    // itself (mergeTags/keepSeparateRename), so this layer just forwards.
    tagVocabOverview: () => tagVocabOverviewImpl(sqlite),
    tagParentEdges: () => tagParentEdgesImpl(sqlite),
    renameTag: (tagId: number, newName: string) => renameTagImpl(sqlite, tagId, newName),
    keepSeparateRenameTag: (tagId: number, newName: string, displayParentTagId: number) => keepSeparateRenameImpl(sqlite, tagId, newName, displayParentTagId),
    mergeTags: (sourceTagId: number, targetTagId: number) => mergeTagsImpl(sqlite, sourceTagId, targetTagId),
    addTagParent: (tagId: number, parentTagId: number, isDisplay: boolean) => addTagParentImpl(sqlite, tagId, parentTagId, isDisplay),
    removeTagParent: (tagId: number, parentTagId: number) => removeTagParentImpl(sqlite, tagId, parentTagId),
    setTagKind: (tagId: number, kind: string | null) => setTagKindImpl(sqlite, tagId, kind),
    deleteOrphanTags: (tagIds: number[]) => deleteOrphanTagsImpl(sqlite, tagIds),
    tagSplitPreview: (tagId: number, candidateParentTagId: number) => tagSplitPreviewImpl(sqlite, tagId, candidateParentTagId),
    splitTag: (sourceTagId: number, displayParentTagId: number, postIds: string[]) => splitTagImpl(sqlite, sourceTagId, displayParentTagId, postIds),
  };
}

export { createDbWriter };
