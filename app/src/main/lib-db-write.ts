'use strict';
import { observePosterName, posterNamesByKey } from './lib-poster-names.ts';

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { PostFlagsSchema, type PostFlags, type PosterProfileSchema, PosterProfilesSchema } from '../shared/data-schemas.ts';
import { TagPatchSchema } from '../shared/ipc-inputs.ts';
import { IdsSchema, LabelsSchema, TagGroupsWriteSchema, type TagGroupMemberWriteSchema, TagGroupNamesSchema, FoldersSchema, ManualGroupsSchema, PosterFoldersSchema, PosterTagNamesSchema, TabsSchema, HistoryEntrySchema, HistoryQuerySchema } from '../shared/data-schemas.ts';
import { normalizeCropRect } from '../../../native-host/post-record.mts';
import { normFolders } from './lib-folder-tree.ts';
import { normalizeTagName, normalizeTagNames } from '../../../native-host/tag-normalize.mts';
import { saveClassifiedTag, getClassifiedAssignments, setClassifiedAssignments, syncWorkTags, exportTagClassification, restoreTagClassification } from './lib-tag-classification.ts';
import type { ClassifiedTagInput, TagAssignment } from '../shared/tag-classification.ts';
import type { PosterTagNamesState, PosterTagRow, PosterTagsState, TagGroupNamesState, TagGroupMember, TagGroupsState } from './ipc-payloads.ts';
import { deleteTags as deleteTagsImpl, mergeTags as mergeTagsImpl, renameTag as renameTagImpl, setTagGroup as setTagGroupImpl, tagVocabOverview as tagVocabOverviewImpl } from './lib-db-tag-vocab.ts';

type Sqlite = Database.Database;

function stateGet(sqlite: Sqlite, key: string): string | null {
  const row = sqlite.prepare('SELECT value FROM store_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function stateSet(sqlite: Sqlite, key: string, value: string) {
  sqlite.prepare('INSERT INTO store_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** このライブラリの同一性を持つ store_state のキー (#176 / #233)。 */
const LIBRARY_ID_KEY = 'libraryId';

/**
 * このライブラリ自身の id。最初に読んだときに発行する。
 *
 * id が config.json でもマーカーファイルでもなくデータベースに居るのは、ライブラリとは
 * データベースそのものだから (#176:「DB 自体が目印」)。フォルダを写せば写しは同じ同一性を
 * 持ち、アプリを別のフォルダへ向ければ id もそれに従って変わる。
 *
 * CREATE の時点ではなく遅らせて書くので、これより前からあるライブラリは、埋め戻しの
 * マイグレーションを要さずに次の起動で id を得る。
 */
function ensureLibraryId(sqlite: Sqlite): string {
  const existing = stateGet(sqlite, LIBRARY_ID_KEY);
  if (existing) return existing;
  const id = randomUUID();
  stateSet(sqlite, LIBRARY_ID_KEY, id);
  return id;
}

function existingPostIds(sqlite: Sqlite): Set<string> {
  return new Set((sqlite.prepare('SELECT captureId FROM posts').all() as Array<{ captureId: string }>).map((row) => row.captureId));
}
function tagResolver(sqlite: Sqlite) {
  const select = sqlite.prepare('SELECT id FROM tags WHERE name = ? ORDER BY id LIMIT 1');
  const insert = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  return (rawName: string) => {
    const name = normalizeTagName(rawName) || rawName;
    const row = select.get(name) as { id: number } | undefined;
    return row?.id ?? Number(insert.run(name).lastInsertRowid);
  };
}
function replaceTagGroups(sqlite: Sqlite, memberships: z.output<typeof TagGroupMemberWriteSchema>[], labels: z.output<typeof LabelsSchema>) {
  sqlite.prepare('UPDATE tags SET groupId = NULL').run();
  const setGroup = sqlite.prepare('UPDATE tags SET groupId = ? WHERE id = ?');
  for (const { id, groupId } of memberships) {
    setGroup.run(groupId, id);
  }
  stateSet(sqlite, 'tagGroupLabels', JSON.stringify(labels));
}
function readTagGroupLabels(sqlite: Sqlite): Record<string, string> | null {
  let labels: unknown = null;
  try {
    labels = JSON.parse(stateGet(sqlite, 'tagGroupLabels') || 'null');
  } catch {
    /* 上を参照 */
  }
  const parsed = LabelsSchema.safeParse(labels);
  return parsed.success ? parsed.data : null;
}

function readTagGroups(sqlite: Sqlite): TagGroupsState {
  const rows = sqlite.prepare('SELECT id, name, groupId FROM tags WHERE groupId IS NOT NULL ORDER BY id').all() as Array<{ id: number; name: string; groupId: string }>;
  const memberships: TagGroupMember[] = rows.map((row) => ({ id: row.id, groupId: row.groupId, name: row.name, label: row.name }));
  return { memberships, labels: readTagGroupLabels(sqlite) };
}
function readTagGroupNames(sqlite: Sqlite): TagGroupNamesState {
  const memberships: Record<string, string> = {};
  for (const row of sqlite.prepare('SELECT name, groupId FROM tags WHERE groupId IS NOT NULL ORDER BY id').all() as Array<{ name: string; groupId: string }>) {
    if (!(row.name in memberships)) memberships[row.name] = row.groupId;
  }
  return { memberships, labels: readTagGroupLabels(sqlite) };
}
function fillTagGroupsByName(sqlite: Sqlite, memberships: z.output<typeof TagGroupNamesSchema>['memberships'], labels: z.output<typeof LabelsSchema>) {
  const resolve = tagResolver(sqlite);
  const setGroup = sqlite.prepare('UPDATE tags SET groupId = ? WHERE name = ? AND groupId IS NULL');
  for (const [rawName, groupId] of Object.entries(memberships)) {
    const name = normalizeTagName(rawName);
    if (!name) continue;
    resolve(name); // 入って来る種別が、このライブラリの見たことがないタグを指す場合がある
    setGroup.run(groupId, name);
  }
  stateSet(sqlite, 'tagGroupLabels', JSON.stringify(labels));
}

function replaceUngrouped(sqlite: Sqlite, keys: string[]) {
  sqlite.prepare('DELETE FROM ungrouped_keys').run();
  const insert = sqlite.prepare('INSERT INTO ungrouped_keys (postKey) VALUES (?)');
  for (const key of keys) insert.run(key);
}

function readUngrouped(sqlite: Sqlite) {
  return { keys: (sqlite.prepare('SELECT postKey FROM ungrouped_keys ORDER BY rowid').all() as Array<{ postKey: string }>).map((row) => row.postKey) };
}

function replaceFolders(sqlite: Sqlite, data: z.output<typeof FoldersSchema>) {
  const folders = normFolders(data.folders);
  const validPosts = existingPostIds(sqlite);
  sqlite.prepare('DELETE FROM folder_items').run();
  sqlite.prepare('DELETE FROM folders').run();

  const insertFolder = sqlite.prepare('INSERT INTO folders (id, name, kind, created, tree) VALUES (?, ?, ?, ?, ?)');
  const setParent = sqlite.prepare('UPDATE folders SET parentId = ? WHERE id = ?');
  const insertItem = sqlite.prepare('INSERT OR IGNORE INTO folder_items (folderId, postId) VALUES (?, ?)');
  const ids = new Set<string>();
  for (const folder of folders) {
    const kind = folder.kind;
    const tree = kind === 'dynamic' && folder.tree ? JSON.stringify(folder.tree) : null;
    insertFolder.run(folder.id, folder.name, kind, folder.created, tree);
    ids.add(folder.id);
    for (const postId of folder.items) if (validPosts.has(postId)) insertItem.run(folder.id, postId);
  }
  for (const folder of folders) if (folder.parentId) setParent.run(folder.parentId, folder.id);
  stateSet(sqlite, 'activeFolderId', data.activeId !== null && ids.has(data.activeId) ? data.activeId : '');
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

function replaceManualGroups(sqlite: Sqlite, groups: string[][]) {
  const validPosts = existingPostIds(sqlite);
  sqlite.prepare('DELETE FROM manual_group_items').run();
  sqlite.prepare('DELETE FROM manual_groups').run();
  const create = sqlite.prepare('INSERT INTO manual_groups DEFAULT VALUES');
  const insert = sqlite.prepare('INSERT INTO manual_group_items (groupId, postId, seq) VALUES (?, ?, ?)');
  for (const group of groups) {
    const members = group.filter((id) => validPosts.has(id));
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

function replacePosterFolders(sqlite: Sqlite, data: z.output<typeof PosterFoldersSchema>) {
  sqlite.prepare('DELETE FROM poster_folder_items').run();
  sqlite.prepare('DELETE FROM poster_folders').run();
  const folder = sqlite.prepare('INSERT INTO poster_folders (id, name) VALUES (?, ?)');
  const item = sqlite.prepare('INSERT OR IGNORE INTO poster_folder_items (folderId, posterKey) VALUES (?, ?)');
  for (const entry of data.folders) {
    folder.run(entry.id, entry.name);
    for (const key of entry.items) item.run(entry.id, key);
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
function replacePosterTags(sqlite: Sqlite, data: z.output<typeof PosterTagNamesSchema>) {
  sqlite.prepare('DELETE FROM poster_tags').run();
  const resolve = tagResolver(sqlite);
  const insert = sqlite.prepare('INSERT OR IGNORE INTO poster_tags (posterKey, tagId) VALUES (?, ?)');
  for (const [key, tags] of Object.entries(data.tags)) {
    for (const name of normalizeTagNames(tags)) insert.run(key, resolve(name));
  }
}
function readPosterTags(sqlite: Sqlite): PosterTagsState {
  const rowsByPoster = new Map<string, Array<{ id: number; name: string }>>();
  for (const row of sqlite.prepare('SELECT pt.posterKey AS posterKey, t.id AS id, t.name AS name FROM poster_tags pt JOIN tags t ON t.id = pt.tagId ORDER BY pt.rowid').all() as Array<{ posterKey: string; id: number; name: string }>) {
    let list = rowsByPoster.get(row.posterKey);
    if (!list) rowsByPoster.set(row.posterKey, (list = []));
    list.push({ id: row.id, name: row.name });
  }
  const tags: Record<string, PosterTagRow> = {};
  for (const [posterKey, list] of rowsByPoster) {
    tags[posterKey] = { tags: list.map((t) => t.name), tagIds: list.map((t) => t.id) };
  }
  return { tags };
}
function readPosterTagNames(sqlite: Sqlite): PosterTagNamesState {
  const tags: Record<string, string[]> = {};
  for (const row of sqlite.prepare('SELECT pt.posterKey, t.name FROM poster_tags pt JOIN tags t ON t.id = pt.tagId ORDER BY pt.rowid').all() as Array<{ posterKey: string; name: string }>) {
    (tags[row.posterKey] || (tags[row.posterKey] = [])).push(row.name);
  }
  return { tags };
}
type PosterProfileJson = z.output<typeof PosterProfileSchema>;

function readPosterProfiles(sqlite: Sqlite): { profiles: PosterProfileJson[] } {
  const names = posterNamesByKey(sqlite);
  return {
    profiles: (sqlite.prepare('SELECT posterKey, platform, userId, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, following, authorCreatedAt, contentHash, provenance, firstObservedAt, lastObservedAt FROM poster_profiles ORDER BY posterKey').all() as PosterProfileJson[]).map(
      (p) => ({ ...p, names: names.get(p.posterKey) || [] }),
    ),
  };
}

function replacePosterProfiles(sqlite: Sqlite, data: z.output<typeof PosterProfilesSchema>): void {
  sqlite.prepare('DELETE FROM poster_profiles').run();
  sqlite.prepare('DELETE FROM poster_names').run();
  const profiles = data.profiles;
  const insertProfile = sqlite.prepare('INSERT INTO poster_profiles (posterKey, platform, userId, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, following, authorCreatedAt, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const p of profiles) {
    insertProfile.run(p.posterKey, p.platform, p.userId, p.displayName, p.screenName, p.bio, p.links, p.avatar, p.avatarFile, p.banner, p.bannerFile, p.followers, p.following, p.authorCreatedAt, p.contentHash, p.provenance, p.firstObservedAt, p.lastObservedAt);
    if (p.platform && p.userId) {
      for (const name of p.names || []) observePosterName(sqlite, p.posterKey, name);
      for (const field of ['displayName', 'screenName'] as const) {
        const value = p[field];
        if (value) observePosterName(sqlite, p.posterKey, { field, value, firstObservedAt: p.lastObservedAt, lastObservedAt: p.lastObservedAt });
      }
    }
  }
}
function replacePostTags(sqlite: Sqlite, postId: string, tags: string[], patch: z.output<typeof TagPatchSchema> | null): boolean {
  const post = sqlite.prepare('SELECT captureId FROM posts WHERE captureId = ?').get(postId);
  if (!post) return false;

  const names = normalizeTagNames(tags);
  const classified = sqlite.prepare("SELECT pt.tagId, pt.implied, t.name FROM post_tags pt JOIN tags t ON t.id=pt.tagId WHERE pt.postId=? AND t.category!='general'").all(postId) as Array<{ tagId: number; implied: number; name: string }>;
  sqlite.prepare('DELETE FROM post_tags WHERE postId = ?').run(postId);
  const resolve = tagResolver(sqlite);
  const insertTag = sqlite.prepare('INSERT OR IGNORE INTO post_tags (postId, tagId) VALUES (?, ?)');
  for (const name of names) {
    const existing = classified.filter((t) => t.name === name);
    if (existing.length) {
      for (const tag of existing) sqlite.prepare('INSERT OR IGNORE INTO post_tags(postId,tagId,implied) VALUES(?,?,?)').run(postId, tag.tagId, tag.implied);
    } else insertTag.run(postId, resolve(name));
  }
  syncWorkTags(sqlite);

  const sets = ['updatedAt = ?'];
  const params: unknown[] = [new Date().toISOString()];
  if (patch) {
    if (patch.userKind !== undefined) {
      sets.push('userKind = ?');
      params.push(patch.userKind);
    }
    if (patch.tagReviewed !== undefined) {
      sets.push('tagReviewed = ?');
      params.push(patch.tagReviewed ? 1 : 0);
    }
  }
  sqlite.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE captureId = ?`).run(...params, postId);
  return true;
}
interface PostMemberships {
  folders: string[];
  manualGroups: Array<{ groupId: number; seq: number }>;
}
function readPostFlags(sqlite: Sqlite, postId: string): ({ tags: string[]; userKind: string | null; tagReviewed: boolean | null } & PostMemberships & Pick<PostFlags, 'tagClassification'>) | null {
  const row = sqlite.prepare('SELECT userKind, tagReviewed FROM posts WHERE captureId = ?').get(postId) as { userKind: string | null; tagReviewed: number | null } | undefined;
  if (!row) return null;
  const tags = (sqlite.prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid').all(postId) as Array<{ name: string }>).map((r) => r.name);
  const folders = (sqlite.prepare('SELECT folderId FROM folder_items WHERE postId = ? ORDER BY rowid').all(postId) as Array<{ folderId: string }>).map((r) => r.folderId);
  const manualGroups = sqlite.prepare('SELECT groupId, seq FROM manual_group_items WHERE postId = ? ORDER BY groupId').all(postId) as Array<{ groupId: number; seq: number }>;
  const tagClassification = exportTagClassification(sqlite, postId);
  return { tags, userKind: row.userKind, tagReviewed: row.tagReviewed == null ? null : !!row.tagReviewed, folders, manualGroups, ...(tagClassification ? { tagClassification } : {}) };
}
function deletePost(sqlite: Sqlite, postId: string): boolean {
  if (sqlite.prepare('SELECT 1 FROM posts WHERE quotedPostId = ? LIMIT 1').get(postId)) {
    sqlite.prepare('UPDATE posts SET isContext = 1 WHERE captureId = ?').run(postId);
    sqlite.prepare('DELETE FROM post_tags WHERE postId = ?').run(postId);
    sqlite.prepare('DELETE FROM folder_items WHERE postId = ?').run(postId);
    sqlite.prepare('DELETE FROM manual_group_items WHERE postId = ?').run(postId);
    return true;
  }
  return sqlite.prepare('DELETE FROM posts WHERE captureId = ?').run(postId).changes > 0;
}
function deleteAllPosts(sqlite: Sqlite): number {
  return sqlite.prepare('DELETE FROM posts').run().changes;
}
function recordPostView(sqlite: Sqlite, postId: string, viewedAt = new Date().toISOString()): number | null {
  if (!postId) return null;
  const row = sqlite.prepare('UPDATE posts SET localViewCount = localViewCount + 1, lastViewedAt = ? WHERE captureId = ? RETURNING localViewCount').get(viewedAt, postId) as { localViewCount: number } | undefined;
  return row?.localViewCount ?? null;
}
function applyPostFlagsFromRecord(sqlite: Sqlite, postId: string, rec: PostFlags) {
  if (rec.tagClassification) restoreTagClassification(sqlite, postId, rec.tagClassification);
  const userKind = rec.userKind ?? null;
  const tagReviewed = rec.tagReviewed == null ? null : rec.tagReviewed ? 1 : 0;
  if (userKind != null || tagReviewed != null) {
    sqlite.prepare('UPDATE posts SET userKind = COALESCE(?, userKind), tagReviewed = COALESCE(?, tagReviewed) WHERE captureId = ?').run(userKind, tagReviewed, postId);
  }
  if (rec.localViewCount !== undefined) {
    sqlite.prepare('UPDATE posts SET localViewCount = ? WHERE captureId = ?').run(rec.localViewCount, postId);
  }
  if (rec.lastViewedAt !== undefined) {
    sqlite.prepare('UPDATE posts SET lastViewedAt = ? WHERE captureId = ?').run(rec.lastViewedAt, postId);
  }
  restoreMemberships(sqlite, postId, rec);
}
function restoreMemberships(sqlite: Sqlite, postId: string, rec: PostFlags) {
  const folders = rec.folders ?? [];
  if (folders.length) {
    const insert = sqlite.prepare('INSERT OR IGNORE INTO folder_items (folderId, postId) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM folders WHERE id = ?)');
    for (const folderId of folders) {
      insert.run(folderId, postId, folderId);
    }
  }
  const groups = rec.manualGroups ?? [];
  if (groups.length) {
    const insert = sqlite.prepare('INSERT OR IGNORE INTO manual_group_items (groupId, postId, seq) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM manual_groups WHERE id = ?)');
    for (const g of groups) {
      insert.run(g.groupId, postId, g.seq, g.groupId);
    }
  }
}

function replaceTabs(sqlite: Sqlite, data: z.output<typeof TabsSchema>) {
  sqlite.prepare('DELETE FROM tab_windows').run();
  sqlite.prepare('DELETE FROM tabs').run();
  const tabs = data.tabs;
  const insert = sqlite.prepare('INSERT INTO tabs (id, windowId, position, pinned, title, state) VALUES (?, ?, ?, ?, ?, ?)');
  const ids = new Set<string>();
  tabs.forEach((tab, position) => {
    ids.add(tab.id);
    insert.run(tab.id, 'main', position, tab.pinned ? 1 : 0, tab.title, JSON.stringify(tab.state));
  });
  sqlite.prepare('INSERT INTO tab_windows (windowId, activeTabId) VALUES (?, ?)').run('main', data.activeTabId !== null && ids.has(data.activeTabId) ? data.activeTabId : null);
}

function readTabs(sqlite: Sqlite) {
  const tabs = (sqlite.prepare("SELECT id, pinned, title, state FROM tabs WHERE windowId = 'main' ORDER BY position").all() as any[]).map((row) => ({ id: row.id, pinned: !!row.pinned, title: row.title, state: JSON.parse(row.state) }));
  if (!tabs.length) return null;
  const active = sqlite.prepare("SELECT activeTabId FROM tab_windows WHERE windowId = 'main'").get() as { activeTabId: string | null } | undefined;
  return { tabs, activeTabId: active?.activeTabId || null };
}
const HISTORY_PAGE_SIZE = 200;
const HISTORY_MAX_ROWS = 50000;
const HISTORY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function appendHistory(sqlite: Sqlite, row: z.output<typeof HistoryEntrySchema>): void {
  const { ts, u, kind, title } = row;
  sqlite.prepare('INSERT INTO history (ts, u, kind, title, state) VALUES (?, ?, ?, ?, ?)').run(ts, u, kind, title, JSON.stringify(row.state ?? null));
}
function queryHistory(sqlite: Sqlite, opts: z.output<typeof HistoryQuerySchema> = {}): { rows: { id: number; ts: number; u: string; kind: string; title: string; state: unknown }[]; hasMore: boolean } {
  const search = opts.search?.trim() ?? '';
  const before = opts.before;
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (search) {
    clauses.push('(title LIKE ? OR u LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like);
  }
  if (before) {
    clauses.push('(ts < ? OR (ts = ? AND id < ?))');
    params.push(before.ts, before.ts, before.id);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = sqlite.prepare(`SELECT id, ts, u, kind, title, state FROM history ${where} ORDER BY ts DESC, id DESC LIMIT ?`).all(...params, HISTORY_PAGE_SIZE + 1) as { id: number; ts: number; u: string; kind: string; title: string; state: string }[];
  const hasMore = rows.length > HISTORY_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, HISTORY_PAGE_SIZE) : rows;
  return { rows: page.map((r) => ({ id: r.id, ts: r.ts, u: r.u, kind: r.kind, title: r.title, state: JSON.parse(r.state) })), hasMore };
}

function deleteHistoryRow(sqlite: Sqlite, id: unknown): void {
  if (typeof id !== 'number') return;
  sqlite.prepare('DELETE FROM history WHERE id = ?').run(id);
}

function clearHistory(sqlite: Sqlite): void {
  sqlite.prepare('DELETE FROM history').run();
}
function pruneHistory(sqlite: Sqlite): void {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  sqlite.prepare('DELETE FROM history WHERE ts < ?').run(cutoff);
  sqlite.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY ts DESC, id DESC LIMIT ?)').run(HISTORY_MAX_ROWS);
}

function createDbWriter(sqlite: Sqlite) {
  const transaction = <T>(fn: () => T) => sqlite.transaction(fn)();
  return {
    stateGet: (key: string) => stateGet(sqlite, key),
    stateSet: (key: string, value: string) => transaction(() => stateSet(sqlite, key, value)),
    getTagGroups: () => readTagGroups(sqlite),
    setTagGroups: (memberships: z.input<typeof TagGroupMemberWriteSchema>[], labels: z.input<typeof LabelsSchema>) =>
      transaction(() => {
        const parsed = TagGroupsWriteSchema.parse({ memberships, labels });
        replaceTagGroups(sqlite, parsed.memberships, parsed.labels);
      }),
    getTagGroupNames: () => readTagGroupNames(sqlite),
    fillTagGroupsByName: (memberships: z.input<typeof TagGroupNamesSchema>['memberships'], labels: z.input<typeof LabelsSchema>) => transaction(() => fillTagGroupsByName(sqlite, TagGroupNamesSchema.shape.memberships.parse(memberships), LabelsSchema.parse(labels))),
    getUngrouped: () => readUngrouped(sqlite),
    setUngrouped: (keys: z.input<typeof IdsSchema>) => transaction(() => replaceUngrouped(sqlite, IdsSchema.parse(keys))),
    getFolders: () => readFolders(sqlite),
    setFolders: (data: z.input<typeof FoldersSchema>) => transaction(() => replaceFolders(sqlite, FoldersSchema.parse(data))),
    getManualGroups: () => readManualGroups(sqlite),
    setManualGroups: (groups: z.input<typeof ManualGroupsSchema>['groups']) => transaction(() => replaceManualGroups(sqlite, ManualGroupsSchema.shape.groups.parse(groups))),
    getPosterFolders: () => readPosterFolders(sqlite),
    setPosterFolders: (data: z.input<typeof PosterFoldersSchema>) => transaction(() => replacePosterFolders(sqlite, PosterFoldersSchema.parse(data))),
    getPosterTags: () => readPosterTags(sqlite),
    getPosterTagNames: () => readPosterTagNames(sqlite),
    setPosterTags: (data: z.input<typeof PosterTagNamesSchema>) => transaction(() => replacePosterTags(sqlite, PosterTagNamesSchema.parse(data))),
    getPosterProfiles: () => readPosterProfiles(sqlite),
    setPosterProfiles: (data: z.input<typeof PosterProfilesSchema>) => transaction(() => replacePosterProfiles(sqlite, PosterProfilesSchema.parse(data))),
    getTabs: () => readTabs(sqlite),
    setTabs: (data: z.input<typeof TabsSchema>) => transaction(() => replaceTabs(sqlite, TabsSchema.parse(data))),
    appendHistory: (row: z.input<typeof HistoryEntrySchema>) => transaction(() => appendHistory(sqlite, HistoryEntrySchema.parse(row))),
    queryHistory: (opts: z.input<typeof HistoryQuerySchema>) => queryHistory(sqlite, HistoryQuerySchema.parse(opts)),
    deleteHistoryRow: (id: unknown) => transaction(() => deleteHistoryRow(sqlite, id)),
    clearHistory: () => transaction(() => clearHistory(sqlite)),
    pruneHistory: () => transaction(() => pruneHistory(sqlite)),
    setPostTags: (postId: string, tags: string[], patch: z.input<typeof TagPatchSchema> | null) => transaction(() => replacePostTags(sqlite, postId, z.array(z.string()).parse(tags), TagPatchSchema.nullable().parse(patch))),
    recordPostView: (postId: string, viewedAt?: string) => transaction(() => recordPostView(sqlite, postId, viewedAt)),
    setMediaCrop: (postId: string, seq: number, crop: unknown) =>
      transaction(() => {
        const normalized = normalizeCropRect(crop);
        // 旧形式の単一画像は posts.image のみを持つ。編集時に media へ追加する。
        sqlite
          .prepare(`INSERT INTO media (postId, seq, file, type)
          SELECT captureId, ?, image, 'image' FROM posts
          WHERE captureId=? AND image IS NOT NULL AND image!=''
            AND ?=(SELECT COALESCE(MAX(seq)+1, 0) FROM media WHERE postId=?)
            AND NOT EXISTS (SELECT 1 FROM media WHERE postId=? AND file=posts.image)`)
          .run(seq, postId, seq, postId, postId);
        const result = sqlite.prepare('UPDATE media SET cropX=?, cropY=?, cropWidth=?, cropHeight=? WHERE postId=? AND seq=?').run(normalized?.x ?? null, normalized?.y ?? null, normalized?.width ?? null, normalized?.height ?? null, postId, seq);
        return result.changes === 1;
      }),
    getPostFlags: (postId: string) => readPostFlags(sqlite, postId),
    restorePostFlags: (postId: string, rec: unknown) => transaction(() => applyPostFlagsFromRecord(sqlite, postId, PostFlagsSchema.parse(rec))),
    deletePost: (postId: string) => transaction(() => deletePost(sqlite, postId)),
    deleteAllPosts: () => transaction(() => deleteAllPosts(sqlite)),
    tagVocabOverview: () => tagVocabOverviewImpl(sqlite),
    saveClassifiedTag: (input: ClassifiedTagInput) => saveClassifiedTag(sqlite, input),
    getClassifiedAssignments: (postIds: string[]) => getClassifiedAssignments(sqlite, postIds),
    setClassifiedAssignments: (rows: TagAssignment[]) => setClassifiedAssignments(sqlite, rows),
    renameTag: (tagId: number, newName: string) => renameTagImpl(sqlite, tagId, newName),
    mergeTags: (sourceTagId: number, targetTagId: number) => mergeTagsImpl(sqlite, sourceTagId, targetTagId),
    setTagGroup: (tagId: number, groupId: string | null) => setTagGroupImpl(sqlite, tagId, groupId),
    deleteTags: (tagIds: number[]) => deleteTagsImpl(sqlite, tagIds),
  };
}

export { createDbWriter, ensureLibraryId, LIBRARY_ID_KEY };
