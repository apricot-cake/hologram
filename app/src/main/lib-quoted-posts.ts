import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { itemDirectoryAbsolute, itemDirectoryRelative } from '../../../native-host/item-storage.mts';
import { listTrashRecords } from './lib-trash-capture.ts';
import { postKeyOf } from '../../../native-host/post-key.mts';

// ゴミ箱からの復元に必要な引用元は残す。共有画像は共有リソースの保存先に置く。
export async function collectUnreferencedQuotes(sqlite: Database.Database, trashDir: string) {
  const retained = new Set((await listTrashRecords(trashDir)).map((p) => postKeyOf(p.quotedPost?.url)).filter(Boolean));
  const removedIds: string[] = [];
  sqlite.transaction(() => {
    let removed: number;
    do {
      removed = 0;
      const rows = sqlite.prepare('SELECT captureId,postKey FROM posts q WHERE isContext=1 AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.quotedPostId=q.captureId)').all() as Array<{ captureId: string; postKey: string }>;
      for (const row of rows) {
        if (retained.has(row.postKey)) continue;
        sqlite.prepare('DELETE FROM posts WHERE captureId=?').run(row.captureId);
        removedIds.push(row.captureId);
        removed++;
      }
    } while (removed);
  })();
  const files = sqlite.prepare('SELECT file FROM media UNION SELECT posterFile AS file FROM media UNION SELECT image AS file FROM posts UNION SELECT video AS file FROM posts').all() as Array<{ file: string | null }>;
  for (const id of removedIds) {
    const prefix = `${itemDirectoryRelative(id)}/`;
    if (files.some((m) => m.file?.startsWith(prefix))) continue;
    await fs.promises.rm(itemDirectoryAbsolute(path.dirname(trashDir), id), { recursive: true, force: true });
  }
}
