import { expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { CURRENT_SCHEMA_SQL } from '../app/src/main/lib-db-schema.ts';
import { convertQuotedPosts } from './convert-quoted-posts.mts';
import { postsFromDb } from '../app/src/main/lib-db-query.ts';

test('既存の引用JSONを参照へ変換し、本文・タグ・取得経路を保つ。再実行も安全', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(CURRENT_SCHEMA_SQL.replace(/^.*(?:isContext INTEGER|postKey TEXT,|quotedPostId TEXT|CREATE INDEX posts_postKey|CREATE INDEX posts_quotedPostId).*\n/gm, ''));
    db.pragma('user_version = 47');
    db.prepare("INSERT INTO posts(captureId,text,capturedAt,updatedAt,capturedVia,quotedPost) VALUES ('parent','元の本文','2026-01-01','2026-01-02','original',?)").run(JSON.stringify({ url: 'https://x.com/a/status/123', text: '引用元', media: [] }));
    await convertQuotedPosts(db);
    expect(db.prepare("SELECT text,capturedVia FROM posts WHERE captureId='parent'").get()).toEqual({ text: '元の本文', capturedVia: 'original' });
    expect((await postsFromDb(db))[0].quotedPost?.text).toBe('引用元');
    await convertQuotedPosts(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 2 });
  } finally {
    db.close();
  }
});
