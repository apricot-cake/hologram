// #289: bio/profileLinks/banner extraction, per platform. fetch is swapped
// out, no network needed — same mocking convention as extractor-link-card.test.ts.
//
// What's checked per platform: the fields ride the SAME already-fetched
// response that supplies avatar/followers/authorCreatedAt (no extra request),
// per #289's 2026-08-02 design comment's confirmed field table.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchBlueskyPost } from '../extension/utils/extractor/bluesky.ts';
import { fetchMisskeyNote } from '../extension/utils/extractor/misskey.ts';
import { fetchMastodonStatus } from '../extension/utils/extractor/mastodon.ts';
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
    expect(rec.profileLinks).toEqual([{ name: 'pixiv', value: 'https://pixiv.net/users/1', verifiedAt: null }]);
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

describe('Mastodon', () => {
  test('account.note(HTML)を平文化してbio、fields[]をverifiedAt付きでprofileLinksへ', async () => {
    mockFetch([
      [
        '/api/v1/statuses/',
        {
          content: '<p>hello</p>',
          account: {
            id: 'a1',
            username: 'carol',
            display_name: 'Carol',
            note: '<p>絵描きです。<a href="https://carol.example">carol.example</a></p>',
            fields: [
              { name: 'Website', value: '<a href="https://carol.example" rel="me nofollow noopener">https://carol.example</a>', verified_at: '2026-01-01T00:00:00Z' },
              { name: 'Pronouns', value: 'she/her', verified_at: null },
            ],
          },
        },
      ],
    ]);
    const rec = await fetchMastodonStatus({ host: 'example.social', id: '1' }, 'https://example.social/@carol/1');
    expect(rec.bio).toBe('絵描きです。carol.example'); // htmlToText strips the <a>, keeping only its visible text
    expect(rec.profileLinks).toEqual([
      { name: 'Website', value: 'https://carol.example', verifiedAt: '2026-01-01T00:00:00.000Z' },
      { name: 'Pronouns', value: 'she/her', verifiedAt: null },
    ]);
  });

  test('banner は本 Issue の受け入れ条件に含まれない（Mastodon には header があっても採らない）', async () => {
    mockFetch([['/api/v1/statuses/', { content: '<p>x</p>', account: { id: 'a2', username: 'dan', header: 'https://example.social/header.jpg' } }]]);
    const rec = await fetchMastodonStatus({ host: 'example.social', id: '2' }, 'https://example.social/@dan/2');
    expect(rec.banner).toBeNull();
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
