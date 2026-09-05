'use strict';

// Misskey 対応の廃止に伴う一度限りのデータ削除。旧版の取込キューや完全 ZIP から
// 後で戻ったレコードも消せるよう、取込キューを適用した直後に毎回呼ぶ。ゴミ箱の
// ディレクトリ走査だけはライブラリを開いた最初の1回に限る。

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { itemDirectoryAbsolute, itemDirectoryRelative } from '../../../native-host/item-storage.mts';
import { parseJsonLoose } from './lib-json.ts';
import { resolveInSaveFolder, TRASH_SUBDIR } from './lib-save-folder-path.ts';

export interface MisskeyRetirementResult {
  posts: number;
  trash: number;
  files: number;
  profiles: number;
}

function stringValues(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    if (/^avatars\//.test(value.replace(/\\/g, '/'))) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) stringValues(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) stringValues(item, out);
  }
}

function collectSharedRefsFromRecord(record: Record<string, unknown>, out: Set<string>): void {
  for (const key of ['avatarFile', 'bannerFile', 'quotedPost', 'replyToPost']) {
    const value = record[key];
    if (typeof value === 'string' && (key === 'quotedPost' || key === 'replyToPost')) {
      try {
        stringValues(parseJsonLoose(value), out);
      } catch {
        stringValues(value, out);
      }
    } else stringValues(value, out);
  }
}

function sharedRefsInDb(sqlite: Database.Database): Set<string> {
  const refs = new Set<string>();
  for (const row of sqlite.prepare('SELECT avatarFile, quotedPost, replyToPost FROM posts').all() as Array<Record<string, unknown>>) collectSharedRefsFromRecord(row, refs);
  for (const table of ['poster_profiles', 'poster_profile_snapshots']) {
    for (const row of sqlite.prepare(`SELECT avatarFile, bannerFile FROM ${table}`).all() as Array<Record<string, unknown>>) collectSharedRefsFromRecord(row, refs);
  }
  return refs;
}

function removePath(target: string, recursive = false): number {
  try {
    if (!fs.existsSync(target)) return 0;
    fs.rmSync(target, { force: true, recursive });
    return 1;
  } catch {
    return 0;
  }
}

function retireActive(sqlite: Database.Database, saveFolder: string): Omit<MisskeyRetirementResult, 'trash'> & { candidates: Set<string> } {
  const rows = sqlite.prepare("SELECT captureId, ftsRowid, avatarFile, quotedPost, replyToPost FROM posts WHERE platform = 'misskey'").all() as Array<Record<string, unknown> & { captureId: string; ftsRowid: number | null }>;
  const candidates = new Set<string>();
  for (const row of rows) collectSharedRefsFromRecord(row, candidates);
  const profileRows = sqlite.prepare("SELECT avatarFile, bannerFile FROM poster_profiles WHERE platform = 'misskey' OR posterKey LIKE 'misskey:%'").all() as Array<Record<string, unknown>>;
  for (const row of profileRows) collectSharedRefsFromRecord(row, candidates);

  const tx = sqlite.transaction(() => {
    const deleteFts = sqlite.prepare('DELETE FROM posts_fts WHERE rowid = ?');
    const deletePost = sqlite.prepare('DELETE FROM posts WHERE captureId = ?');
    for (const row of rows) {
      if (row.ftsRowid != null) deleteFts.run(row.ftsRowid);
      deletePost.run(row.captureId);
    }
    sqlite.prepare("DELETE FROM poster_folder_items WHERE posterKey LIKE 'misskey:%'").run();
    sqlite.prepare("DELETE FROM poster_tags WHERE posterKey LIKE 'misskey:%'").run();
    sqlite.prepare("DELETE FROM poster_alias_group_members WHERE posterKey LIKE 'misskey:%'").run();
    sqlite.prepare('DELETE FROM poster_alias_groups WHERE id NOT IN (SELECT DISTINCT groupId FROM poster_alias_group_members)').run();
    sqlite
      .prepare(`UPDATE poster_alias_groups
      SET primaryKey = (SELECT MIN(posterKey) FROM poster_alias_group_members WHERE groupId = poster_alias_groups.id)
      WHERE primaryKey NOT IN (SELECT posterKey FROM poster_alias_group_members WHERE groupId = poster_alias_groups.id)`)
      .run();
    sqlite.prepare("DELETE FROM poster_profiles WHERE platform = 'misskey' OR posterKey LIKE 'misskey:%'").run();
  });
  tx();

  let files = 0;
  for (const row of rows) files += removePath(itemDirectoryAbsolute(saveFolder, row.captureId), true);
  return { posts: rows.length, files, profiles: profileRows.length, candidates };
}

function retireTrash(saveFolder: string, candidates: Set<string>): { trash: number; files: number; remainingRefs: Set<string> } {
  const trashDir = path.join(saveFolder, TRASH_SUBDIR);
  const remainingRefs = new Set<string>();
  let names: string[];
  try {
    names = fs.readdirSync(trashDir);
  } catch {
    return { trash: 0, files: 0, remainingRefs };
  }
  let trash = 0;
  let files = 0;
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const jsonFile = path.join(trashDir, name);
    try {
      const record = parseJsonLoose(fs.readFileSync(jsonFile, 'utf8'));
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
      if (record.platform !== 'misskey') {
        collectSharedRefsFromRecord(record, remainingRefs);
        continue;
      }
      collectSharedRefsFromRecord(record, candidates);
      const captureId = typeof record.captureId === 'string' && record.captureId ? record.captureId : name.replace(/\.json$/i, '');
      const itemKey = path.basename(itemDirectoryRelative(captureId));
      files += removePath(path.join(trashDir, itemKey), true);
      files += removePath(jsonFile);
      trash++;
    } catch {
      // 壊れたゴミ箱レコードは、ほかのゴミ箱処理と同じく触らない。
    }
  }
  return { trash, files, remainingRefs };
}

export function retireMisskey(sqlite: Database.Database, saveFolder: string, includeTrash = false): MisskeyRetirementResult {
  const active = retireActive(sqlite, saveFolder);
  const trash = includeTrash ? retireTrash(saveFolder, active.candidates) : { trash: 0, files: 0, remainingRefs: new Set<string>() };
  const liveRefs = sharedRefsInDb(sqlite);
  let files = active.files + trash.files;
  files += removePath(path.join(saveFolder, 'emoji'), true);
  for (const ref of active.candidates) {
    if (liveRefs.has(ref) || trash.remainingRefs.has(ref)) continue;
    const target = resolveInSaveFolder(saveFolder, ref);
    if (target) files += removePath(target);
  }
  return { posts: active.posts, trash: trash.trash, files, profiles: active.profiles };
}
