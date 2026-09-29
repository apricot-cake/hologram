import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { itemDirectoryAbsolute } from '../../../native-host/item-storage.mts';
import { listTrashRecords } from './lib-trash-capture.ts';
import { postKeyOf } from '../../../native-host/post-key.mts';
import { resolveInSaveFolder } from './lib-save-folder-path.ts';
import { parseJsonLoose } from './lib-json.ts';

const FILE_FIELDS = new Set(['file', 'posterFile', 'image', 'video', 'avatarFile', 'bannerFile', 'thumbnailFile']);

function referencedDirectories(folder: string, record: unknown, dirs = new Set<string>()): Set<string> {
  if (!record || typeof record !== 'object') return dirs;
  for (const [key, value] of Object.entries(record)) {
    if (FILE_FIELDS.has(key) && typeof value === 'string') {
      const resolved = resolveInSaveFolder(folder, value);
      if (resolved) dirs.add(path.dirname(resolved));
    } else if (value && typeof value === 'object') referencedDirectories(folder, value, dirs);
  }
  return dirs;
}

// ゴミ箱からの復元や他の投稿に必要な共有画像は、最後の参照が消えるまで残す。
export async function collectUnreferencedQuotes(sqlite: Database.Database, trashDir: string) {
  const folder = path.dirname(trashDir);
  const trash = await listTrashRecords(trashDir);
  const retained = new Set(trash.map((p) => postKeyOf(p.quotedPost?.url)).filter(Boolean));
  const externalDirs = referencedDirectories(folder, trash);
  const profiles = sqlite.prepare('SELECT avatarFile,bannerFile FROM poster_profiles').all();
  referencedDirectories(folder, profiles, externalDirs);
  const postDirs = new Map<string, Set<string>>();
  const posts = sqlite.prepare('SELECT captureId,image,video,avatarFile,quotedPost,replyToPost,linkCard FROM posts').all() as Array<Record<string, unknown> & { captureId: string }>;
  for (const post of posts) {
    const record = { ...post };
    for (const key of ['quotedPost', 'replyToPost', 'linkCard']) {
      if (typeof record[key] === 'string') record[key] = parseJsonLoose(record[key]);
    }
    postDirs.set(post.captureId, referencedDirectories(folder, record));
  }
  for (const media of sqlite.prepare('SELECT postId,file,posterFile FROM media').all() as Array<{ postId: string; file: string | null; posterFile: string | null }>) {
    referencedDirectories(folder, media, postDirs.get(media.postId));
  }
  const removedDirs = new Set<string>();
  sqlite.transaction(() => {
    let removed: number;
    do {
      removed = 0;
      const rows = sqlite.prepare('SELECT captureId,postKey FROM posts q WHERE isContext=1 AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.quotedPostId=q.captureId)').all() as Array<{ captureId: string; postKey: string }>;
      const candidates = new Map(
        rows
          .filter((row) => !retained.has(row.postKey))
          .map((row) => {
            const dirs = new Set([itemDirectoryAbsolute(folder, row.captureId)]);
            for (const dir of postDirs.get(row.captureId) || []) {
              // 投稿IDをパス成分にしない。実際の参照が指す、安全な共有ディレクトリだけを回収する。
              if (path.dirname(dir) === path.join(folder, 'quoted-media') && /^quote-[a-f0-9]{64}$/.test(path.basename(dir))) dirs.add(dir);
            }
            return [row.captureId, dirs] as const;
          }),
      );
      // 共有画像を保持する間はcontext行も残し、最後の参照が消えた時に再び回収できるようにする。
      let changed: boolean;
      do {
        changed = false;
        const used = new Set(externalDirs);
        for (const [id, dirs] of postDirs) if (!candidates.has(id)) for (const dir of dirs) used.add(dir);
        for (const [id, dirs] of candidates) {
          if ([...dirs].some((dir) => used.has(dir))) {
            candidates.delete(id);
            changed = true;
          }
        }
      } while (changed);
      for (const [id, dirs] of candidates) {
        sqlite.prepare('DELETE FROM posts WHERE captureId=?').run(id);
        postDirs.delete(id);
        for (const dir of dirs) removedDirs.add(dir);
        removed++;
      }
    } while (removed);
  })();
  for (const dir of removedDirs) await fs.promises.rm(dir, { recursive: true, force: true });
}
