import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { itemFileRelative } from '../../../native-host/item-storage.mts';
import { flatFileName, regularLibraryFile } from './lib-item-references.ts';

// ディスクに存在する現在の参照を優先する。欠落した旧 basename だけを自分の実体へ結ぶ。
function repairedReference(folder: string, captureId: string, value: unknown): string | null {
  if (!flatFileName(value)) return null;
  try {
    fs.lstatSync(path.join(folder, value));
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
  }
  try {
    const next = itemFileRelative(captureId, value);
    return regularLibraryFile(folder, next) ? next : null;
  } catch {
    return null;
  }
}

export async function repairLegacyItemReferences(sqlite: Database.Database, folder: string, isCurrent: () => boolean = () => true, beforeCommit: () => void = () => {}) {
  let cursor = '',
    repaired = 0;
  const posts = sqlite.prepare('SELECT captureId,image,video,avatarFile,linkCard FROM posts WHERE captureId>? ORDER BY captureId LIMIT 32');
  const media = sqlite.prepare('SELECT id,file,posterFile FROM media WHERE postId=?');
  for (;;) {
    if (!isCurrent()) break;
    const batch = posts.all(cursor) as Array<Record<string, any>>;
    if (!batch.length) break;
    for (const post of batch) {
      if (!isCurrent()) return repaired;
      cursor = post.captureId;
      const changes: Array<{ table: 'posts' | 'media'; key: string | number; field: string; old: string; next: string; reference: string; target: string }> = [];
      const collect = (table: 'posts' | 'media', key: string | number, field: string, value: unknown) => {
        const next = repairedReference(folder, post.captureId, value);
        if (next && typeof value === 'string') changes.push({ table, key, field, old: value, next, reference: value, target: next });
      };
      for (const field of ['image', 'video', 'avatarFile']) collect('posts', post.captureId, field, post[field]);
      for (const row of media.all(post.captureId) as Array<{ id: number; file: string; posterFile: string | null }>) {
        collect('media', row.id, 'file', row.file);
        collect('media', row.id, 'posterFile', row.posterFile);
      }
      if (typeof post.linkCard === 'string') {
        try {
          const card = JSON.parse(post.linkCard);
          const next = repairedReference(folder, post.captureId, card?.thumbnailFile);
          if (next) changes.push({ table: 'posts', key: post.captureId, field: 'linkCard', old: post.linkCard, next: JSON.stringify({ ...card, thumbnailFile: next }), reference: card.thumbnailFile, target: next });
        } catch {
          /* 壊れた JSON の修復はこの移行の対象ではない。 */
        }
      }
      if (!changes.length) continue;
      beforeCommit();
      if (!isCurrent()) return repaired;
      const committed = sqlite.transaction(() => {
        let count = 0;
        for (const change of changes) {
          if (repairedReference(folder, post.captureId, change.reference) !== change.target) continue;
          const keyField = change.table === 'posts' ? 'captureId' : 'id';
          // 実際の欄を再確認し、調査後の編集を上書きしない。
          const result = sqlite.prepare(`UPDATE ${change.table} SET ${change.field}=? WHERE ${keyField}=? AND ${change.field} IS ?`).run(change.next, change.key, change.old);
          count += result.changes;
        }
        return count;
      })();
      repaired += committed;
    }
    // 起動時に全ライブラリを同期走査しない。移動・終了・取込の所有権を各 batch で確認する。
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return repaired;
}
