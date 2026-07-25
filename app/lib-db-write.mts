'use strict';

// DB-owned organization state for #298/St5. The read path already uses SQLite,
// but these values still lived in JSON files until the truth-source flip. Keep
// the replacement operations here so every IPC handler shares the same
// transaction boundary instead of each rebuilding a different subset of tables.

import type Database from 'better-sqlite3';

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
  return { types, labels: labels && typeof labels === 'object' ? labels : null };
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
  const folders = Array.isArray(data?.folders) ? data.folders : [];
  const validPosts = existingPostIds(sqlite);
  sqlite.prepare('DELETE FROM folder_items').run();
  sqlite.prepare('DELETE FROM folders').run();
  sqlite.prepare('DELETE FROM clip_items').run();
  sqlite.prepare('DELETE FROM poster_workspace_items').run();

  const insertFolder = sqlite.prepare('INSERT INTO folders (id, name, kind, created, tree) VALUES (?, ?, ?, ?, ?)');
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
  const insertClip = sqlite.prepare('INSERT OR IGNORE INTO clip_items (postId) VALUES (?)');
  for (const postId of strings(data?.clip)) if (validPosts.has(postId)) insertClip.run(postId);
  const insertWorkspace = sqlite.prepare('INSERT OR IGNORE INTO poster_workspace_items (posterKey) VALUES (?)');
  for (const key of strings(data?.posterWorkspace)) insertWorkspace.run(key);
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
  const folders = (sqlite.prepare('SELECT id, name, kind, created, tree FROM folders ORDER BY rowid').all() as any[]).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    created: row.created,
    items: items.get(row.id) || [],
    ...(row.kind === 'dynamic' && row.tree ? { tree: JSON.parse(row.tree) } : {}),
  }));
  const ids = new Set(folders.map((folder) => folder.id));
  const activeId = stateGet(sqlite, 'activeFolderId');
  return {
    folders,
    activeId: activeId && ids.has(activeId) ? activeId : null,
    clip: (sqlite.prepare('SELECT postId FROM clip_items ORDER BY rowid').all() as Array<{ postId: string }>).map((row) => row.postId),
    posterWorkspace: (sqlite.prepare('SELECT posterKey FROM poster_workspace_items ORDER BY rowid').all() as Array<{ posterKey: string }>).map((row) => row.posterKey),
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
  const transaction = <T,>(fn: () => T) => sqlite.transaction(fn)();
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
  };
}

export { createDbWriter };
