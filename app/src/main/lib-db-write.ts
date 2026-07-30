'use strict';

// DB-owned organization state for #298/St5. The read path already uses SQLite,
// but these values still lived in JSON files until the truth-source flip. Keep
// the replacement operations here so every IPC handler shares the same
// transaction boundary instead of each rebuilding a different subset of tables.

import type Database from 'better-sqlite3';
import { normFolders } from './lib-folder-tree.ts';

type Sqlite = Database.Database;

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

function tagResolver(sqlite: Sqlite) {
  const select = sqlite.prepare('SELECT id FROM tags WHERE name = ? ORDER BY id LIMIT 1');
  const insert = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  return (name: string) => {
    const row = select.get(name) as { id: number } | undefined;
    return row?.id ?? Number(insert.run(name).lastInsertRowid);
  };
}

function replaceTagTypes(sqlite: Sqlite, types: unknown, labels: unknown) {
  const normalized = types && typeof types === 'object' ? (types as Record<string, unknown>) : {};
  const resolve = tagResolver(sqlite);
  sqlite.prepare('UPDATE tags SET kind = NULL').run();
  const setKind = sqlite.prepare('UPDATE tags SET kind = ? WHERE id = ?');
  for (const [name, kind] of Object.entries(normalized)) {
    if (!name) continue;
    setKind.run(typeof kind === 'string' ? kind : null, resolve(name));
  }
  stateSet(sqlite, 'tagTypeLabels', JSON.stringify(labels && typeof labels === 'object' ? labels : null));
}

function readTagTypes(sqlite: Sqlite) {
  const types: Record<string, string> = {};
  for (const row of sqlite.prepare('SELECT name, kind FROM tags WHERE kind IS NOT NULL ORDER BY id').all() as Array<{ name: string; kind: string }>) {
    if (!(row.name in types)) types[row.name] = row.kind;
  }
  let labels: unknown = null;
  try {
    labels = JSON.parse(stateGet(sqlite, 'tagTypeLabels') || 'null');
  } catch {
    // The value is DB-owned and only written by this module. A malformed value
    // is therefore non-authoritative rather than a reason to block all tags.
  }
  // Same reasoning for the shape: the only writer is replaceTagTypes, whose
  // input is the renderer's 種別-label map (TagTypesState.labels, the shared
  // wire type in ipc-payloads.ts) — so an object here IS that map.
  return { types, labels: labels && typeof labels === 'object' ? (labels as Record<string, string>) : null };
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

function replacePosterTags(sqlite: Sqlite, data: any) {
  sqlite.prepare('DELETE FROM poster_tags').run();
  const resolve = tagResolver(sqlite);
  const insert = sqlite.prepare('INSERT OR IGNORE INTO poster_tags (posterKey, tagId) VALUES (?, ?)');
  for (const [key, tags] of Object.entries(data?.tags && typeof data.tags === 'object' ? data.tags : {})) {
    if (!key) continue;
    for (const name of strings(tags)) insert.run(key, resolve(name));
  }
}

function readPosterTags(sqlite: Sqlite) {
  const tags: Record<string, string[]> = {};
  for (const row of sqlite.prepare('SELECT pt.posterKey, t.name FROM poster_tags pt JOIN tags t ON t.id = pt.tagId ORDER BY pt.rowid').all() as Array<{ posterKey: string; name: string }>) {
    (tags[row.posterKey] || (tags[row.posterKey] = [])).push(row.name);
  }
  return { tags };
}

// Post-level edit: tag assignment (post_tags) + the tagging-wizard's userKind/
// tagReviewed flags. These two columns were added by the add-store-state
// migration specifically because they had no St2 home (lib-db.ts's migration
// comment) — normalizePostRecord's PostRecordShape deliberately excludes them
// (native-host/post-record.mts), so they are DB-only and never round-trip
// through a sidecar. Returns false without writing if postId isn't a known
// post, mirroring the old sidecar handler's "jsonPath missing -> ok:false".
function replacePostTags(sqlite: Sqlite, postId: string, tags: unknown, patch: unknown): boolean {
  const post = sqlite.prepare('SELECT ftsRowid FROM posts WHERE captureId = ?').get(postId) as { ftsRowid: number | null } | undefined;
  if (!post) return false;

  const names = strings(tags);
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

// Current tags + userKind/tagReviewed for one post — ipc-trash.ts's
// delete-post reads this before a post's row disappears (trashing moves the
// sidecar out of the watched folder, and the next importAll cascade-deletes
// post_tags along with the row) so it can carry the DB state into the
// trashed sidecar copy restore-post already re-derives from.
function readPostFlags(sqlite: Sqlite, postId: string): { tags: string[]; userKind: string | null; tagReviewed: boolean | null } | null {
  const row = sqlite.prepare('SELECT userKind, tagReviewed FROM posts WHERE captureId = ?').get(postId) as { userKind: string | null; tagReviewed: number | null } | undefined;
  if (!row) return null;
  const tags = (sqlite.prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid').all(postId) as Array<{ name: string }>).map((r) => r.name);
  return { tags, userKind: row.userKind, tagReviewed: row.tagReviewed == null ? null : !!row.tagReviewed };
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

function applyPostFlagsFromRecord(sqlite: Sqlite, postId: string, rec: { userKind?: unknown; tagReviewed?: unknown }) {
  const userKind = rec.userKind === 'plain' || rec.userKind === 'media' ? rec.userKind : null;
  const tagReviewed = rec.tagReviewed == null ? null : rec.tagReviewed ? 1 : 0;
  if (userKind == null && tagReviewed == null) return;
  sqlite.prepare('UPDATE posts SET userKind = COALESCE(?, userKind), tagReviewed = COALESCE(?, tagReviewed) WHERE captureId = ?').run(userKind, tagReviewed, postId);
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
    getUngrouped: () => readUngrouped(sqlite),
    setUngrouped: (keys: unknown) => transaction(() => replaceUngrouped(sqlite, keys)),
    getFolders: () => readFolders(sqlite),
    setFolders: (data: unknown) => transaction(() => replaceFolders(sqlite, data)),
    getManualGroups: () => readManualGroups(sqlite),
    setManualGroups: (groups: unknown) => transaction(() => replaceManualGroups(sqlite, groups)),
    getPosterFolders: () => readPosterFolders(sqlite),
    setPosterFolders: (data: unknown) => transaction(() => replacePosterFolders(sqlite, data)),
    getPosterTags: () => readPosterTags(sqlite),
    setPosterTags: (data: unknown) => transaction(() => replacePosterTags(sqlite, data)),
    getTabs: () => readTabs(sqlite),
    setTabs: (data: unknown) => transaction(() => replaceTabs(sqlite, data)),
    setPostTags: (postId: string, tags: unknown, patch: unknown) => transaction(() => replacePostTags(sqlite, postId, tags, patch)),
    getPostFlags: (postId: string) => readPostFlags(sqlite, postId),
    restorePostFlags: (postId: string, rec: { userKind?: unknown; tagReviewed?: unknown }) => transaction(() => applyPostFlagsFromRecord(sqlite, postId, rec)),
    deletePost: (postId: string) => transaction(() => deletePost(sqlite, postId)),
    deleteAllPosts: () => transaction(() => deleteAllPosts(sqlite)),
  };
}

export { createDbWriter };
