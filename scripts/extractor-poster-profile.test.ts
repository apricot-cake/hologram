import { apiFixture } from './test-api-fixtures.ts';
// #289: プラットフォームごとの bio/profileLinks/banner の抽出。fetch を差し替える
// ので通信は要らない＝extractor-link-card.test.ts と同じモックの作法。
//
// プラットフォームごとに何を確かめるか。これらの欄は avatar/followers/
// authorCreatedAt を供給する、すでに取得済みの同じ応答に相乗りする（追加の要求を
// 出さない）。#289 の 2026-08-02 の設計コメントにある、確認済みの欄の表に従う。

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchBlueskyPost } from '../extension/utils/extractor/bluesky.ts';
import { fetchXTweet } from '../extension/utils/extractor/x.ts';

function mockFetch(routes: [string, unknown][]) {
  vi.stubGlobal('fetch', async (url: unknown) => {
    const u = String(url);
    for (const [frag, body] of routes) {
      if (u.includes(frag)) return new Response(JSON.stringify(apiFixture(u, body)), { status: 200, headers: { 'content-type': 'application/json' } });
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
      ['getProfile', { avatar: 'https://cdn/a-full.jpg', followersCount: 42, followsCount: 7, createdAt: '2020-01-01T00:00:00Z', description: 'イラスト垢です', banner: 'https://cdn/banner.jpg' }],
    ]);
    const rec = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'abc' }, 'https://bsky.app/profile/alice.bsky.social/post/abc');
    expect(rec.bio).toBe('イラスト垢です');
    expect(rec.banner).toBe('https://cdn/banner.jpg');
    expect(rec.profileLinks).toBeNull();
    expect({ followers: rec.followers, following: rec.following, authorCreatedAt: rec.authorCreatedAt }).toEqual({ followers: 42, following: 7, authorCreatedAt: '2020-01-01T00:00:00.000Z' });
  });
});

describe('X', () => {
  test('syndication の user に含まれる公開プロフィール欄を正規化する', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'hi',
          mediaDetails: [],
          user: {
            screen_name: 'erin',
            id_str: '9',
            name: 'Erin',
            description: 'site https://t.co/site',
            entities: { description: { urls: [{ url: 'https://t.co/site', expanded_url: 'https://example.com' }] }, url: { urls: [{ url: 'https://t.co/site', expanded_url: 'https://example.com' }] } },
            profile_banner_url_https: 'https://pbs.twimg.com/banner.jpg',
            followers_count: 42,
            friends_count: 7,
            created_at: 'Wed Jan 01 00:00:00 +0000 2020',
          },
        },
      ],
    ]);
    const rec = await fetchXTweet({ platform: 'x', id: '1', screenName: 'erin' }, 'https://x.com/erin/status/1');
    expect(rec.bio).toBe('site https://example.com');
    expect(rec.profileLinks).toEqual([{ name: 'URL', value: 'https://example.com' }]);
    expect(rec.banner).toBe('https://pbs.twimg.com/banner.jpg');
    expect({ followers: rec.followers, following: rec.following, authorCreatedAt: rec.authorCreatedAt }).toEqual({ followers: 42, following: 7, authorCreatedAt: '2020-01-01T00:00:00.000Z' });
  });
});
