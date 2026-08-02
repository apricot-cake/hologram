// Unit tests for app/src/main/lib-db-query.ts (the DB read path).
// Builds a small DB with the real writer (writePost in app/src/main/lib-db-record-writer.ts,
// the single producer shared by capture, import, and ZIP intake), and checks that
// postsFromDb/postsByIds faithfully restore the record shape (including the parallel-array
// contract for tags/tagIds that the query.ts tag leaf needs), and that the FTS5 rank contract
// documented in app/src/main/lib-db-schema.ts actually holds.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';
import { postsByIds, postsFromDb, searchPostsFts } from '../app/src/main/lib-db-query';
import { openDatabase } from '../app/src/main/lib-db';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let handle: any;
let postCount = 0;

beforeAll(async () => {
  const records: any[] = [];
  const add = (rec: any) => records.push(rec);

  add({
    captureId: 'cap-1',
    image: 'cap-1.jpg',
    media: [
      { url: 'https://x.example/1.jpg', alt: 'alt1', width: 100, height: 200, file: 'cap-1-media-0.jpg' },
      { url: 'https://x.example/2.mp4', alt: 'alt2', width: 50, height: 60, file: 'cap-1-media-1.mp4', type: 'video', posterFile: 'cap-1-poster.jpg' },
      { url: 'https://i.pximg.net/u.zip', alt: null, width: 700, height: 700, file: 'cap-1-media-2.zip', type: 'ugoira', posterFile: 'cap-1-poster.jpg', frames: [{ file: '000000.jpg', delay: 60 }] },
    ],
    text: 'a beautiful sunset over the mountains',
    hashtags: ['nature', 'photo'],
    tags: ['character:alice', 'style:sketch'],
    platform: 'x',
    isReply: true,
    isQuote: false,
    isEdited: true,
    editedAt: '2026-01-01T12:00:00Z',
    cw: 'spider photo inside',
    sensitive: true,
    // #180: a quote/renote sub-record rides the same posts row as every other
    // optional field here.
    quotedPost: { url: 'https://x.example/quoted', displayName: 'Bob', screenName: 'bob', userId: '9', avatar: null, text: 'the original', date: '2025-12-31T00:00:00Z', cw: null, media: [] },
    // #162: dimension/file-size facet aggregates — written directly here (this
    // test drives writePost, not fillMediaDims) just to check the column round-trips.
    mediaMaxW: 3000,
    mediaMaxH: 4000,
    mediaMaxBytes: 12582912,
    capturedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  add({
    captureId: 'cap-2',
    image: 'cap-2.jpg',
    media: [],
    text: 'a rainy morning downtown',
    tags: ['character:alice'],
    platform: 'bluesky',
    capturedAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  });
  // #560: shape of a drag-save — only the 2nd of a 4-image set was taken, so media holds
  // only one entry, and its position in the original post survives only via imageIndex/imageCount
  add({
    captureId: 'cap-3',
    image: 'cap-3.jpg',
    media: [{ url: 'https://x.example/3.jpg', alt: null, width: 800, height: 600, file: 'cap-3.jpg' }],
    source: 'drag',
    platform: 'x',
    imageIndex: 2,
    imageCount: 4,
    // #188: pixiv シリーズ情報も他の任意フィールドと同じ列に相乗り（プラットフォーム名
    // はテストの前提を崩さないよう 'x' のままにしてある — 往復するかどうかに関係ない）
    seriesId: '12345',
    seriesTitle: 'ある冒険',
    seriesOrder: 3,
    capturedAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
  });

  handle = openDatabase(path.join(mkTempDir('hologram-db-query-db-'), 'test.db'));
  const stmts = preparePostStmts(handle.sqlite);
  const resolveTagId = makeTagResolver(handle.sqlite);
  for (const rec of records) writePost(stmts, resolveTagId, rec);
  postCount = (handle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n;
});

afterAll(() => {
  handle.sqlite.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test('writePost が3件を投入する（前提）', () => {
  expect(postCount).toBe(3);
});

describe('postsFromDb: 形と並び', () => {
  test('全件返す', async () => {
    expect(await postsFromDb(handle.sqlite)).toHaveLength(3);
  });

  test('capturedAt の新しい順', async () => {
    expect((await postsFromDb(handle.sqlite)).map((p: any) => p.captureId)).toEqual(['cap-3', 'cap-2', 'cap-1']);
  });

  test('text 列が往復する', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.text).toBe('a beautiful sunset over the mountains');
  });

  test('hashtags の JSON 列が配列へ戻る', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.hashtags).toEqual(['nature', 'photo']);
  });

  test('media 行は seq 順で戻る', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.media.map((m: any) => m.file)).toEqual(['cap-1-media-0.jpg', 'cap-1-media-1.mp4', 'cap-1-media-2.zip']);
  });

  test('静止画は type を持たず、動画は type と posterFile を持つ（#119 St1）', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.media[0].type).toBeNull();
    expect(cap1.media[1]).toMatchObject({ type: 'video', posterFile: 'cap-1-poster.jpg' });
  });

  // #119 St3: the ugoira frame table round-trips as a single JSON column (no use case needs per-frame querying)
  test('うごイラはコマ表が配列で戻り、他のメディアは null（#119 St3）', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.media[2]).toMatchObject({ type: 'ugoira', frames: [{ file: '000000.jpg', delay: 60 }] });
    expect(cap1.media[0].frames).toBeNull();
    expect(cap1.media[1].frames).toBeNull();
  });

  test('INTEGER 0/1 の真偽値は true/false へ戻る（0/1 のままにしない）', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect({ isReply: cap1.isReply, isQuote: cap1.isQuote }).toEqual({ isReply: true, isQuote: false });
  });

  test('未設定の真偽値列は false でなく null のまま', async () => {
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect(cap2.isReply).toBeNull();
  });

  // #189: isEdited/editedAt round-trip through the posts table (same 0/1 <-> bool conversion as isReply)
  test('isEdited / editedAt が往復する', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect({ isEdited: cap1.isEdited, editedAt: cap1.editedAt }).toEqual({ isEdited: true, editedAt: '2026-01-01T12:00:00Z' });
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect({ isEdited: cap2.isEdited, editedAt: cap2.editedAt }).toEqual({ isEdited: null, editedAt: null });
  });

  // #178: cw/sensitive round-trip through the posts table. sensitive uses the same
  // 0/1 <-> bool conversion as isEdited, but stays null (not false) when unset (tri-state).
  test('cw / sensitive が往復する', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect({ cw: cap1.cw, sensitive: cap1.sensitive }).toEqual({ cw: 'spider photo inside', sensitive: true });
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect({ cw: cap2.cw, sensitive: cap2.sensitive }).toEqual({ cw: null, sensitive: null });
  });

  // #188: series info is likewise meaningless just because the column exists — it only
  // round-trips once the reader actually reads it
  test('seriesId / seriesTitle / seriesOrder が往復する（#188）', async () => {
    const cap3 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-3');
    expect({ seriesId: cap3.seriesId, seriesTitle: cap3.seriesTitle, seriesOrder: cap3.seriesOrder }).toEqual({ seriesId: '12345', seriesTitle: 'ある冒険', seriesOrder: 3 });
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect({ seriesId: cap2.seriesId, seriesTitle: cap2.seriesTitle, seriesOrder: cap2.seriesOrder }).toEqual({ seriesId: null, seriesTitle: null, seriesOrder: null });
  });

  // #180: the JSON-column sub-record round-trips through writePost -> DB ->
  // postsFromDb the same way hashtags/domFilled do, and a post with none reads
  // back null rather than an empty object.
  test('mediaMaxW / mediaMaxH / mediaMaxBytes が往復する（#162）', async () => {
    const posts = await postsFromDb(handle.sqlite);
    const cap1 = posts.find((p) => p.captureId === 'cap-1');
    const cap2 = posts.find((p) => p.captureId === 'cap-2');
    expect({ mediaMaxW: cap1.mediaMaxW, mediaMaxH: cap1.mediaMaxH, mediaMaxBytes: cap1.mediaMaxBytes }).toEqual({ mediaMaxW: 3000, mediaMaxH: 4000, mediaMaxBytes: 12582912 });
    // cap-2 never set them — same "null on rows nothing filled" convention as seriesId etc.
    expect({ mediaMaxW: cap2.mediaMaxW, mediaMaxH: cap2.mediaMaxH, mediaMaxBytes: cap2.mediaMaxBytes }).toEqual({ mediaMaxW: null, mediaMaxH: null, mediaMaxBytes: null });
  });

  test('quotedPost が往復する（#180）', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.quotedPost).toEqual({ url: 'https://x.example/quoted', displayName: 'Bob', screenName: 'bob', userId: '9', avatar: null, text: 'the original', date: '2025-12-31T00:00:00Z', cw: null, media: [] });
    expect(cap1.replyToPost).toBeNull();
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect({ quotedPost: cap2.quotedPost, replyToPost: cap2.replyToPost }).toEqual({ quotedPost: null, replyToPost: null });
  });

  // #560: if a column is known only to the writer and never queried by the reader, the inspector's
  // "N of M" display won't show it even though the column exists — it only means something once it round-trips
  test('ドラッグ保存の imageIndex / imageCount が往復する（#560）', async () => {
    const cap3 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-3');
    expect({ imageIndex: cap3.imageIndex, imageCount: cap3.imageCount }).toEqual({ imageIndex: 2, imageCount: 4 });
  });

  test('ドラッグ以外の保存経路では両方 null', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect({ imageIndex: cap1.imageIndex, imageCount: cap1.imageCount }).toEqual({ imageIndex: null, imageCount: null });
  });
});

// #5 2026-07-18 comment: tag leaves match by id, so saved searches don't get orphaned
// when a tag is renamed
describe('tags/tagIds の並行配列の契約', () => {
  test('tags と tagIds は同じ長さ', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.tagIds).toHaveLength(cap1.tags.length);
  });

  test('同じタグ名は同じ id へ解決される（get-or-create の重複排除）', async () => {
    const all = await postsFromDb(handle.sqlite);
    const cap1 = all.find((p: any) => p.captureId === 'cap-1');
    const cap2 = all.find((p: any) => p.captureId === 'cap-2');
    const aliceId = cap1.tagIds[cap1.tags.indexOf('character:alice')];

    expect(aliceId).toBeDefined();
    expect(cap2.tagIds).toContain(aliceId);
  });

  // Simulate a future tag-rename feature by renaming directly in the DB — the name changes
  // but the id doesn't, confirming that saved searches matching on tagId keep working
  test('改名しても id は変わらない（名前だけ次の読み出しに反映される）', async () => {
    const before = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    const aliceId = before.tagIds[before.tags.indexOf('character:alice')];

    handle.sqlite.prepare('UPDATE tags SET name = ? WHERE id = ?').run('character:alice-renamed', aliceId);

    const after = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(after.tags).toContain('character:alice-renamed');
    expect(after.tagIds).toContain(aliceId);
  });
});

describe('postsByIds', () => {
  test('要求した部分集合だけを返す', async () => {
    const subset = await postsByIds(handle.sqlite, ['cap-2']);
    expect(subset.map((p: any) => p.captureId)).toEqual(['cap-2']);
  });

  test('空配列は空の IN() を投げずに短絡する', async () => {
    expect(await postsByIds(handle.sqlite, [])).toHaveLength(0);
  });
});

// The query shape documented in lib-db-schema.ts
describe('searchPostsFts（FTS5 の rank 契約）', () => {
  test('MATCH が語を含む投稿を見つける', () => {
    const hits = searchPostsFts(handle.sqlite, 'mountains');
    expect(hits.map((h: any) => h.postId)).toEqual(['cap-1']);
  });

  test('rank は数値で出る（bm25＝より負なら関連が強い）', () => {
    expect(typeof searchPostsFts(handle.sqlite, 'mountains')[0].rank).toBe('number');
  });

  // #178: CW text is the poster's own words (treated the same as text/title), so it's included in full-text search
  test('cw の語も検索に乗る（#178）', () => {
    expect(searchPostsFts(handle.sqlite, 'spider').map((h: any) => h.postId)).toEqual(['cap-1']);
  });

  test('空クエリは全件一致でなく0件', () => {
    expect(searchPostsFts(handle.sqlite, '')).toHaveLength(0);
  });

  test('壊れた MATCH 式は throw せず空で返る', () => {
    expect(searchPostsFts(handle.sqlite, '"unbalanced')).toHaveLength(0);
  });
});
