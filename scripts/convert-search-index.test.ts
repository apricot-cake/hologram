import { expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { convertSearchIndex } from './convert-search-index.mts';
test('検索索引だけを除去し、投稿・タグを保持する。再実行も安全', () => {
  const db = new Database(':memory:');
  try {
    db.exec(
      "CREATE TABLE posts(captureId TEXT PRIMARY KEY, text TEXT, ftsRowid INTEGER); CREATE UNIQUE INDEX idx_posts_ftsRowid ON posts(ftsRowid); CREATE VIRTUAL TABLE posts_fts USING fts5(text); INSERT INTO posts VALUES ('a','猫',1); CREATE TABLE tags(name TEXT); INSERT INTO tags VALUES ('作品'); PRAGMA user_version=48;",
    );
    convertSearchIndex(db);
    convertSearchIndex(db);
    expect(db.prepare('SELECT * FROM posts').all()).toEqual([{ captureId: 'a', text: '猫' }]);
    expect(db.prepare('SELECT * FROM tags').all()).toEqual([{ name: '作品' }]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'posts_fts%'").all()).toEqual([]);
    expect(db.pragma('user_version', { simple: true })).toBe(49);
  } finally {
    db.close();
  }
});
