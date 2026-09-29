'use strict';

// 投稿スクリーンショットの廃止に伴う、保存済みライブラリの一度限りの掃除。
//
// 旧経路が保存したスクリーンショットは posts.image と投稿 URL を使い、source を持たない。
// ローカル取り込み・クリップボード・右クリック保存は source を必ず持つため、その
// 原本画像は対象にならない。投稿の行自体は本文とメタデータを持つので残し、画像の
// 参照と寸法だけを外す。
//
// SQLite のスキーマ互換ではなくデータの掃除なので user_version には入れない。
// 完全 ZIP や古い取込キューから旧レコードが後から戻る場合にも備え、DB 同期後に
// 冪等に呼ぶ。

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { itemDirectoryRelative } from '../../../native-host/item-storage.mts';
import { writeFileAtomicSync } from './lib-atomic.ts';
import { parseJsonLoose } from './lib-json.ts';
import { resolveInSaveFolder, TRASH_SUBDIR } from './lib-save-folder-path.ts';

interface ScreenshotRow {
  captureId: string;
  image: string;
}

export interface ScreenshotRetirementResult {
  posts: number;
  trash: number;
  files: number;
}

function removeFile(file: string | null): boolean {
  if (!file) return true;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

function retireActiveScreenshots(sqlite: Database.Database, saveFolder: string): Pick<ScreenshotRetirementResult, 'posts' | 'files'> {
  const rows = sqlite
    .prepare(
      `SELECT captureId, image FROM posts
       WHERE image IS NOT NULL AND image <> '' AND url IS NOT NULL AND url <> '' AND source IS NULL
         AND NOT EXISTS (SELECT 1 FROM media WHERE media.postId = posts.captureId AND media.file = posts.image)`,
    )
    .all() as ScreenshotRow[];
  const usedElsewhere = sqlite.prepare(
    `SELECT 1 FROM posts WHERE captureId <> ? AND (image = ? OR video = ? OR avatarFile = ?)
     UNION ALL SELECT 1 FROM media WHERE postId <> ? AND (file = ? OR posterFile = ?)
     UNION ALL SELECT 1 FROM poster_profiles WHERE avatarFile = ? OR bannerFile = ?
     LIMIT 1`,
  );
  const retired: string[] = [];
  let files = 0;
  for (const row of rows) {
    const file = resolveInSaveFolder(saveFolder, row.image);
    const existed = Boolean(file && fs.existsSync(file));
    // 保存フォルダ外を指す壊れた参照は外部ファイルへ触れず、参照だけを外す。
    const shared = Boolean(usedElsewhere.get(row.captureId, row.image, row.image, row.image, row.captureId, row.image, row.image, row.image, row.image));
    if (!shared && file && !removeFile(file)) continue;
    if (!shared && existed) files++;
    retired.push(row.captureId);
  }
  if (retired.length) {
    const update = sqlite.prepare('UPDATE posts SET image = NULL, shotW = NULL, shotH = NULL, shotAnimated = NULL WHERE captureId = ?');
    sqlite.transaction((ids: string[]) => {
      for (const id of ids) update.run(id);
    })(retired);
  }
  return { posts: retired.length, files };
}

function retireTrashScreenshots(saveFolder: string): Pick<ScreenshotRetirementResult, 'trash' | 'files'> {
  const trashDir = path.join(saveFolder, TRASH_SUBDIR);
  let names: string[];
  try {
    names = fs.readdirSync(trashDir);
  } catch {
    return { trash: 0, files: 0 };
  }
  let trash = 0;
  let files = 0;
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const jsonFile = path.join(trashDir, name);
    try {
      const record = parseJsonLoose(fs.readFileSync(jsonFile, 'utf8'));
      if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.image !== 'string' || !record.image || typeof record.url !== 'string' || !record.url || record.source != null) continue;
      if (Array.isArray(record.media) && record.media.some((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && entry.file === record.image)) continue;
      const captureId = typeof record.captureId === 'string' && record.captureId ? record.captureId : name.replace(/\.json$/i, '');
      const itemKey = path.basename(itemDirectoryRelative(captureId));
      const base = path.basename(record.image);
      const candidates = [path.join(trashDir, itemKey, base), path.join(trashDir, base)];
      let failed = false;
      for (const candidate of candidates) {
        const existed = fs.existsSync(candidate);
        if (!removeFile(candidate)) {
          failed = true;
          break;
        }
        if (existed) files++;
      }
      if (failed) continue;
      delete record.image;
      delete record.shotW;
      delete record.shotH;
      delete record.shotAnimated;
      writeFileAtomicSync(jsonFile, JSON.stringify(record, null, 2));
      trash++;
    } catch {
      // 壊れたゴミ箱レコードは既存の一覧処理と同じく触らない。
    }
  }
  return { trash, files };
}

export function retireScreenshotImages(sqlite: Database.Database, saveFolder: string, includeTrash = false): ScreenshotRetirementResult {
  const active = retireActiveScreenshots(sqlite, saveFolder);
  const trash = includeTrash ? retireTrashScreenshots(saveFolder) : { trash: 0, files: 0 };
  return { posts: active.posts, trash: trash.trash, files: active.files + trash.files };
}
