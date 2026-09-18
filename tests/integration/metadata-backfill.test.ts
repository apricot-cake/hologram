import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer';
import { postsByIdsSync } from '../../app/src/main/lib-db-query';
import { applyCachedMetadata } from '../../app/src/main/lib-metadata-backfill';

test('取得済み補完は画像・タグID・履歴を保ち、再適用せず、失敗データを書かない', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-backfill-'));
  const handle = openDatabase(path.join(folder, 'hologram.db'));
  const db = handle.sqlite;
  try {
    const key = 'x:123';
    const root = path.join(folder, '.hologram-metadata-backfill');
    fs.mkdirSync(path.join(root, 'results'), { recursive: true });
    const record = {
      captureId: 'eagle-123',
      url: 'https://x.com/a/status/123/photo/2',
      source: 'eagle-migration',
      platform: 'x',
      date: '2025-01-01T00:00:00Z',
      capturedAt: '2025-01-01T00:00:00Z',
      text: '既存本文',
      tags: ['維持'],
      image: 'a.jpg',
      media: [{ file: 'a.jpg', url: '', crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }],
    };
    writePost(preparePostStmts(db), makeTagResolver(db), record);
    db.prepare('UPDATE posts SET localViewCount = 7 WHERE captureId = ?').run(record.captureId);
    const before = postsByIdsSync(db, [record.captureId])[0];
    fs.writeFileSync(path.join(root, 'progress.json'), JSON.stringify({ version: 1, folder, entries: [{ key, url: record.url, ids: [record.captureId], status: 'fetched' }] }));
    const resultFile = path.join(root, 'results', createHash('sha256').update(key).digest('hex') + '.json');
    const result = { url: record.url, platform: 'x', text: 'API本文', screenName: 'a', userId: '42', displayName: '投稿者', date: '2024-12-01T00:00:00Z', likes: 0, media: [{ url: 'https://example.com/1.jpg' }, { url: 'https://example.com/2.jpg' }] };
    fs.writeFileSync(resultFile, JSON.stringify({ fetchedAt: '2026-01-01T00:00:00Z', result: { ...result, metaError: 'fetchFailed' } }));
    expect(() => applyCachedMetadata(db, folder, key)).toThrow();
    expect(postsByIdsSync(db, [record.captureId])[0]).toEqual(before);
    fs.writeFileSync(resultFile, JSON.stringify({ fetchedAt: '2026-01-01T00:00:00Z', result }));
    expect(applyCachedMetadata(db, folder, key)).toEqual({ ok: true, updated: 1 });
    const after = postsByIdsSync(db, [record.captureId])[0];
    expect(after).toMatchObject({ text: '既存本文', screenName: 'a', userId: '42', likes: 0, date: result.date, source: 'eagle-migration', saveScope: 'media', imageCount: 2, localViewCount: 7, capturedAt: record.capturedAt });
    expect(after.media[0]).toMatchObject({ ...before.media[0], url: result.media[1].url });
    expect(after.tagIds).toEqual(before.tagIds);
    expect(after.image).toEqual(before.image);
    expect(applyCachedMetadata(db, folder, key)).toEqual({ ok: true, updated: 1 });
    expect(postsByIdsSync(db, [record.captureId])[0]).toEqual(after);
  } finally {
    db.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
