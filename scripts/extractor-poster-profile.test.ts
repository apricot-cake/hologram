// #289: プラットフォームごとの bio/profileLinks/banner の抽出。fetch を差し替える
// ので通信は要らない＝extractor-link-card.test.ts と同じモックの作法。
//
// プラットフォームごとに何を確かめるか。これらの欄は avatar/followers/
// authorCreatedAt を供給する、すでに取得済みの同じ応答に相乗りする（追加の要求を
// 出さない）。#289 の 2026-08-02 の設計コメントにある、確認済みの欄の表に従う。

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchBlueskyPost } from '../extension/utils/extractor/bluesky.ts';
import { fetchMisskeyNote } from '../extension/utils/extractor/misskey.ts';
import { fetchXTweet } from '../extension/utils/extractor/x.ts';

function mockFetch(routes: [string, unknown][]) {
  vi.stubGlobal('fetch', async (url: unknown) => {
    const u = String(url);
    for (const [frag, body] of routes) {
      if (u.includes(frag)) return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Bluesky', () => {
  test('getProfile の description/banner を bio/banner へ、profileLinks は概念が無いので null', async () => {
    mockFetch([
      ['resolveHandle', { did: 'did:plc:alice' }],
      ['getPostThread', { thread: { post: { likeCount: 0, repostCount: 0, replyCount: 0, author: { did: 'did:plc:alice', handle: 'alice.bsky.social', avatar: 'https://cdn/a.jpg' }, record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z' } } } }],
      ['getProfile', { avatar: 'https://cdn/a-full.jpg', followersCount: 42, createdAt: '2020-01-01T00:00:00Z', description: 'イラスト垢です', banner: 'https://cdn/banner.jpg' }],
    ]);
    const rec = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'abc' }, 'https://bsky.app/profile/alice.bsky.social/post/abc');
    expect(rec.bio).toBe('イラスト垢です');
    expect(rec.banner).toBe('https://cdn/banner.jpg');
    expect(rec.profileLinks).toBeNull();
  });
});

describe('Misskey', () => {
  test('users/show の description/fields/bannerUrl を拾う', async () => {
    mockFetch([
      ['/api/notes/show', { text: 'hi', user: { id: 'u1', name: 'Alice', username: 'alice', avatarUrl: 'https://misskey.io/a.jpg' } }],
      ['/api/users/show', { followersCount: 7, createdAt: '2020-01-01T00:00:00Z', description: '絵を描きます', fields: [{ name: 'pixiv', value: 'https://pixiv.net/users/1' }], bannerUrl: 'https://misskey.io/banner.jpg' }],
    ]);
    const rec = await fetchMisskeyNote({ host: 'misskey.io', noteId: 'n1' }, 'https://misskey.io/notes/n1');
    expect(rec.bio).toBe('絵を描きます');
    expect(rec.profileLinks).toEqual([{ name: 'pixiv', value: 'https://pixiv.net/users/1' }]);
    expect(rec.banner).toBe('https://misskey.io/banner.jpg');
  });

  test('fields が空/無しなら profileLinks は null', async () => {
    mockFetch([
      ['/api/notes/show', { text: 'hi', user: { id: 'u2', name: 'Bob', username: 'bob' } }],
      ['/api/users/show', { followersCount: 0, createdAt: '2020-01-01T00:00:00Z', description: null, fields: [] }],
    ]);
    const rec = await fetchMisskeyNote({ host: 'misskey.io', noteId: 'n2' }, 'https://misskey.io/notes/n2');
    expect(rec.profileLinks).toBeNull();
    expect(rec.bio).toBeNull();
  });
});

describe('X', () => {
  test('syndication の user には bio/links/banner の概念が無い＝恒久的に null', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'hi', mediaDetails: [], user: { screen_name: 'erin', id_str: '9', name: 'Erin' } }]]);
    const rec = await fetchXTweet({ platform: 'x', id: '1', screenName: 'erin' }, 'https://x.com/erin/status/1');
    expect(rec.bio).toBeNull();
    expect(rec.profileLinks).toBeNull();
    expect(rec.banner).toBeNull();
  });
});
