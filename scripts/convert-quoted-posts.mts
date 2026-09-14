import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { pathToFileURL } from 'node:url';
import { postKeyOf } from '../native-host/post-key.mts';
import { makeTagResolver, preparePostStmts, writeQuotedReference } from '../app/src/main/lib-db-record-writer.ts';
import { normalizePostRecord } from '../native-host/post-record.mts';
import { postsFromDb } from '../app/src/main/lib-db-query.ts';

// 配備前に実行する、47 → 48 の一度限りの変換。元DBはバックアップしてから変更する。
export async function convertQuotedPosts(sqlite: Database.Database) {
  const version = Number(sqlite.pragma('user_version', { simple: true }));
  if (version === 48) return;
  if (version !== 47) throw new Error(`Expected schema 47, got ${version}`);
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite.exec(`ALTER TABLE posts ADD COLUMN isContext INTEGER NOT NULL DEFAULT 0 CHECK(isContext IN (0, 1));
      ALTER TABLE posts ADD COLUMN postKey TEXT;
      ALTER TABLE posts ADD COLUMN quotedPostId TEXT REFERENCES posts(captureId) ON DELETE SET NULL;
      CREATE INDEX posts_postKey ON posts(postKey);
      CREATE INDEX posts_quotedPostId ON posts(quotedPostId);`);
    const setKey = sqlite.prepare('UPDATE posts SET postKey = ? WHERE captureId = ?');
    for (const row of sqlite.prepare('SELECT captureId, url FROM posts').all() as Array<{ captureId: string; url: string | null }>) setKey.run(row.url ? postKeyOf(row.url) : null, row.captureId);
    const records = await postsFromDb(sqlite);
    const stmts = preparePostStmts(sqlite);
    const tags = makeTagResolver(sqlite);
    for (const record of records) {
      if (!record.quotedPost?.url) continue;
      const id = writeQuotedReference(stmts, tags, normalizePostRecord(record));
      if (id) sqlite.prepare('UPDATE posts SET quotedPostId = ?, quotedPost = NULL WHERE captureId = ?').run(id, record.captureId);
    }
    if ((sqlite.pragma('foreign_key_check') as unknown[]).length) throw new Error('Foreign key check failed');
    sqlite.pragma('user_version = 48');
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error('Pass an existing hologram.db path');
  const db = new Database(file);
  try {
    if (Number(db.pragma('user_version', { simple: true })) !== 48) {
      const backup = `${file}.before-quoted-posts-${Date.now()}.db`;
      await db.backup(backup);
      await convertQuotedPosts(db);
      console.log(JSON.stringify({ backup, schema: 48 }));
    }
  } finally {
    db.close();
  }
}
