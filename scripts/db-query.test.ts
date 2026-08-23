// app/src/main/lib-db-query.ts（DB の読み経路）の単体テスト。
// 本物の書き手（app/src/main/lib-db-record-writer.ts の writePost＝保存・取り込み・ZIP 取込が
// 共有する唯一の生成側）で小さな DB を作り、postsFromDb/postsByIds がレコードの形を忠実に
// 復元すること（query.ts のタグの葉が要る tags/tagIds の並行配列の契約も含む）と、
// app/src/main/lib-db-schema.ts に書かれた FTS5 の rank の契約が実際に成り立つことを見る。

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
    cw: 'spider photo inside',
    sensitive: true,
    // #180: 引用・リノートのサブレコードも、ここの他の任意フィールドと同じ posts の行に
    // 相乗りする。
    quotedPost: { url: 'https://x.example/quoted', displayName: 'Bob', screenName: 'bob', userId: '9', avatar: null, text: 'the original', date: '2025-12-31T00:00:00Z', cw: null, media: [] },
    // #290: 投稿自身のカスタム絵文字。
    customEmojis: [{ shortcode: 'ha_to', url: 'https://x.example/ha_to.png', file: 'emoji/abc123.png' }],
    // #179: 投稿のアンケート＝同じ行にもう1つ増える JSON 列。
    poll: {
      choices: [
        { text: 'Yes', votes: 3 },
        { text: 'No', votes: 1 },
      ],
      multiple: false,
      expiresAt: '2026-01-02T00:00:00Z',
    },
    // #181: 投稿の OGP プレビューカード＝同じ行にもう1つ増える JSON 列。
    linkCard: { url: 'https://example.com/article', title: 'A great article', description: 'It explains things.', thumbnailFile: 'cap-1-linkcard.jpg' },
    // #239: 一般の Web ページ抽出の経路で title/author などを何が埋めたか＝同じ行に
    // もう1つ増える JSON 列。
    metaSource: { title: 'ogp', author: 'jsonld' },
    // #162: 寸法・ファイルサイズのファセット集計値。ここでは直接書いている（このテストが
    // 動かすのは fillMediaDims ではなく writePost）。列が往復するかを見るためだけ。
    mediaMaxW: 3000,
    mediaMaxH: 4000,
    mediaMaxBytes: 12582912,
    // #8: 上の mediaMaxW と同じで「直接書いて、列が往復するかだけを見る」もの。
    shotAnimated: true,
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
  // #560: ドラッグ保存の形＝4枚組のうち2枚目だけを取ったので media は1件しか持たず、
  // 元投稿での位置は imageIndex/imageCount 経由でしか残らない
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

  test('ローカル閲覧回数が投稿レコードへ戻る', async () => {
    handle.sqlite.prepare('UPDATE posts SET localViewCount = 3 WHERE captureId = ?').run('cap-1');
    const posts = await postsFromDb(handle.sqlite);
    expect(posts.find((p: any) => p.captureId === 'cap-1').localViewCount).toBe(3);
    expect(posts.find((p: any) => p.captureId === 'cap-2').localViewCount).toBe(0);
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

  // #119 St3: うごイラのコマ表は JSON 列1つとして往復する（コマ単位で問い合わせる用途は無い）
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

  test('isEdited が posts テーブルを往復する', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.isEdited).toBe(true);
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect(cap2.isEdited).toBeNull();
  });

  // #178: cw/sensitive は posts テーブルを往復する。sensitive は isEdited と同じ
  // 0/1 ⇔ bool の変換を使うが、未設定なら false ではなく null のまま（三値）。
  test('cw / sensitive が往復する', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect({ cw: cap1.cw, sensitive: cap1.sensitive }).toEqual({ cw: 'spider photo inside', sensitive: true });
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect({ cw: cap2.cw, sensitive: cap2.sensitive }).toEqual({ cw: null, sensitive: null });
  });

  // #188: シリーズ情報も同じで、列があるというだけでは意味を持たない＝読み手が実際に
  // 読んで初めて往復する
  test('seriesId / seriesTitle / seriesOrder が往復する（#188）', async () => {
    const cap3 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-3');
    expect({ seriesId: cap3.seriesId, seriesTitle: cap3.seriesTitle, seriesOrder: cap3.seriesOrder }).toEqual({ seriesId: '12345', seriesTitle: 'ある冒険', seriesOrder: 3 });
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect({ seriesId: cap2.seriesId, seriesTitle: cap2.seriesTitle, seriesOrder: cap2.seriesOrder }).toEqual({ seriesId: null, seriesTitle: null, seriesOrder: null });
  });

  // #180: JSON 列のサブレコードも hashtags/domFilled と同じように writePost → DB →
  // postsFromDb を往復する。持たない投稿は空オブジェクトではなく null として読み戻る。
  test('mediaMaxW / mediaMaxH / mediaMaxBytes が往復する（#162）', async () => {
    const posts = await postsFromDb(handle.sqlite);
    const cap1 = posts.find((p) => p.captureId === 'cap-1');
    const cap2 = posts.find((p) => p.captureId === 'cap-2');
    expect({ mediaMaxW: cap1.mediaMaxW, mediaMaxH: cap1.mediaMaxH, mediaMaxBytes: cap1.mediaMaxBytes }).toEqual({ mediaMaxW: 3000, mediaMaxH: 4000, mediaMaxBytes: 12582912 });
    // cap-2 は一度も設定していない＝ seriesId などと同じ「何も埋めていない行は null」の規約
    expect({ mediaMaxW: cap2.mediaMaxW, mediaMaxH: cap2.mediaMaxH, mediaMaxBytes: cap2.mediaMaxBytes }).toEqual({ mediaMaxW: null, mediaMaxH: null, mediaMaxBytes: null });
  });

  // #8: shotW/shotH 自身と同じ 書き込み → DB → 読み出し の往復。ただし数値ではなく真偽値
  //（読み側は isReply/sensitive と同じ fromDbBool を通す）。
  test('shotAnimated が往復する（#8）', async () => {
    const posts = await postsFromDb(handle.sqlite);
    const cap1 = posts.find((p) => p.captureId === 'cap-1');
    const cap2 = posts.find((p) => p.captureId === 'cap-2');
    expect(cap1.shotAnimated).toBe(true);
    // cap-2 は一度も設定していない＝ mediaMaxW などと同じ「何も埋めていない行は null」の規約
    expect(cap2.shotAnimated).toBeNull();
  });

  test('quotedPost が往復する（#180）', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.quotedPost).toEqual({ url: 'https://x.example/quoted', displayName: 'Bob', screenName: 'bob', userId: '9', avatar: null, text: 'the original', date: '2025-12-31T00:00:00Z', cw: null, media: [] });
    expect(cap1.replyToPost).toBeNull();
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect({ quotedPost: cap2.quotedPost, replyToPost: cap2.replyToPost }).toEqual({ quotedPost: null, replyToPost: null });
  });

  // #179: quotedPost と同じ「0個か1個」の JSON 列の往復（アンケートを持たない投稿では
  // 空オブジェクトではなく null）。
  test('poll が往復する（#179）', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.poll).toEqual({
      choices: [
        { text: 'Yes', votes: 3 },
        { text: 'No', votes: 1 },
      ],
      multiple: false,
      expiresAt: '2026-01-02T00:00:00Z',
    });
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect(cap2.poll).toBeNull();
  });

  // #181: quotedPost/poll と同じ「0個か1個」の JSON 列の往復（リンクを共有していない投稿
  // では空オブジェクトではなく null）。
  test('linkCard が往復する（#181）', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.linkCard).toEqual({ url: 'https://example.com/article', title: 'A great article', description: 'It explains things.', thumbnailFile: 'cap-1-linkcard.jpg' });
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect(cap2.linkCard).toBeNull();
  });

  // #239: 上の linkCard/poll と同じ「0個か1個」の JSON 列の往復（一度も設定しない
  // プラットフォーム extractor の投稿では空オブジェクトではなく null）。
  test('metaSource が往復する（#239）', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.metaSource).toEqual({ title: 'ogp', author: 'jsonld' });
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect(cap2.metaSource).toBeNull();
  });

  // #290: 同じ JSON 列の往復。ただし「何も無い」の規約は null ではなく空配列＝
  // lib-db-query.ts の parseCustomEmojis のコメントを参照。
  test('customEmojis が往復する（#290）', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect(cap1.customEmojis).toEqual([{ shortcode: 'ha_to', url: 'https://x.example/ha_to.png', file: 'emoji/abc123.png' }]);
    const cap2 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-2');
    expect(cap2.customEmojis).toEqual([]);
  });

  // #560: 列を書き手しか知らず読み手が問い合わせないなら、列があってもインスペクタの
  //「N of M」表示には出ない＝往復して初めて意味を持つ
  test('ドラッグ保存の imageIndex / imageCount が往復する（#560）', async () => {
    const cap3 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-3');
    expect({ imageIndex: cap3.imageIndex, imageCount: cap3.imageCount }).toEqual({ imageIndex: 2, imageCount: 4 });
  });

  test('ドラッグ以外の保存経路では両方 null', async () => {
    const cap1 = (await postsFromDb(handle.sqlite)).find((p: any) => p.captureId === 'cap-1');
    expect({ imageIndex: cap1.imageIndex, imageCount: cap1.imageCount }).toEqual({ imageIndex: null, imageCount: null });
  });
});

// #5 2026-07-18 のコメント: タグの葉は id で一致させるので、タグを改名しても保存した検索が
// 孤児にならない
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

  // 将来のタグ改名機能を、DB で直に改名して模す。名前は変わるが id は変わらない＝ tagId で
  // 一致させる保存した検索が動き続けることを確かめる
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

// lib-db-schema.ts に書かれた問い合わせの形
describe('searchPostsFts（FTS5 の rank 契約）', () => {
  test('MATCH が語を含む投稿を見つける', () => {
    const hits = searchPostsFts(handle.sqlite, 'mountains');
    expect(hits.map((h: any) => h.postId)).toEqual(['cap-1']);
  });

  test('rank は数値で出る（bm25＝より負なら関連が強い）', () => {
    expect(typeof searchPostsFts(handle.sqlite, 'mountains')[0].rank).toBe('number');
  });

  // #178: 閲覧注意のテキストは投稿者自身の言葉（text/title と同じ扱い）なので、全文検索に含める
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
