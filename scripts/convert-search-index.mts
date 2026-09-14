import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function convertSearchIndex(db: Database.Database) {
  const version = Number(db.pragma('user_version', { simple: true }));
  if (version === 49) return;
  if (version !== 48) throw new Error(`Expected schema 48, got ${version}`);
  db.transaction(() => {
    db.exec('DROP TABLE IF EXISTS posts_fts; DROP INDEX IF EXISTS idx_posts_ftsRowid; ALTER TABLE posts DROP COLUMN ftsRowid;');
    db.pragma('user_version = 49');
  })();
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error('Pass an existing hologram.db path');
  const db = new Database(file);
  try {
    if (Number(db.pragma('user_version', { simple: true })) !== 49) {
      const backup = `${file}.before-meilisearch-${Date.now()}.db`;
      await db.backup(backup);
      convertSearchIndex(db);
      console.log(JSON.stringify({ backup, schema: 49 }));
    }
  } finally {
    db.close();
  }
}
