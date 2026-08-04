// Quote/renote and reply-to sidecar sub-records (#180, X reply-to added by
// #806). fetch is swapped out, no network needed — same mocking convention as
// extractor-hashtags.test.ts.
//
// What's checked per platform:
//   1. A quote/renote whose response bundles the target's full content fills
//      quotedPost (text/author/date/media), not just the existing quotedUrl.
//   2. A quote/renote whose target has no usable content leaves quotedPost
//      null (isQuote may still be true — quotedUrl is unaffected by this Issue).
//   3. replyToPost fills on Misskey (note.reply) and X (parent, #806), and
//      stays null on Bluesky/Mastodon, whose APIs carry no reply-body field.
//   4. Bluesky's embed.record gating (list/feed/starter-pack, recordWithMedia)
//      still excludes non-post targets from quotedPost the same way it
//      already excludes them from isQuote/quotedUrl.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchBlueskyPost } from '../extension/utils/extractor/bluesky.ts';
import { fetchMastodonStatus } from '../extension/utils/extractor/mastodon.ts';
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

describe('X', () => {
  const ID = { platform: 'x', id: '1', screenName: 'alice' };
  const URL_ = 'https://x.com/alice/status/1';

  test('quoted_tweet からテキスト・投稿者・メディアを取る', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'my take',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          quoted_tweet: {
            id_str: '99',
            text: 'original text',
            created_at: 'Wed Jan 01 00:00:00 +0000 2026',
            user: { screen_name: 'bob', name: 'Bob', id_str: '2', profile_image_url_https: 'https://x.example/bob_normal.jpg' },
            mediaDetails: [{ media_url_https: 'https://pbs.twimg.com/media/a.jpg', type: 'photo', original_info: { width: 10, height: 20 } }],
          },
        },
      ],
    ]);

    const rec = await fetchXTweet(ID, URL_);
    expect(rec.isQuote).toBe(true);
    expect(rec.quotedUrl).toBe('https://x.com/bob/status/99');
    expect(rec.quotedPost).toEqual({
      url: 'https://x.com/bob/status/99',
      displayName: 'Bob',
      screenName: 'bob',
      userId: '2',
      avatar: 'https://x.example/bob_400x400.jpg',
      text: 'original text',
      date: expect.any(String),
      cw: null,
      media: [{ url: 'https://pbs.twimg.com/media/a.jpg?name=orig', alt: null, width: 10, height: 20, type: 'image' }],
    });
    // Not a reply in this fixture (no in_reply_to_screen_name) — replyToPost
    // stays null regardless of the quote above.
    expect(rec.replyToPost).toBeNull();
  });

  test('quoted_tweet が無ければ quotedPost は null', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'solo', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' } }]]);

    const rec = await fetchXTweet(ID, URL_);
    expect(rec.isQuote).toBeFalsy();
    expect(rec.quotedPost).toBeNull();
  });

  test('#806: parent からテキスト・投稿者・メディアを取って replyToPost へ入れる', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'a reply',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          in_reply_to_screen_name: 'carol',
          in_reply_to_status_id_str: '50',
          in_reply_to_user_id_str: '3',
          parent: {
            id_str: '50',
            text: 'parent text',
            created_at: 'Wed Jan 01 00:00:00 +0000 2026',
            user: { screen_name: 'carol', name: 'Carol', id_str: '3', profile_image_url_https: 'https://x.example/carol_normal.jpg' },
            mediaDetails: [{ media_url_https: 'https://pbs.twimg.com/media/p.jpg', type: 'photo', original_info: { width: 30, height: 40 } }],
          },
        },
      ],
    ]);

    const rec = await fetchXTweet(ID, URL_);
    expect(rec.isReply).toBe(true);
    expect(rec.replyToId).toBe('50');
    expect(rec.replyToPost).toEqual({
      url: 'https://x.com/carol/status/50',
      displayName: 'Carol',
      screenName: 'carol',
      userId: '3',
      avatar: 'https://x.example/carol_400x400.jpg',
      text: 'parent text',
      date: expect.any(String),
      cw: null,
      media: [{ url: 'https://pbs.twimg.com/media/p.jpg?name=orig', alt: null, width: 30, height: 40, type: 'image' }],
    });
  });

  test('#806: parent の無い返信（削除済み・鍵アカウントの親など）では replyToPost は null のまま', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'a reply',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          in_reply_to_screen_name: 'carol',
          in_reply_to_status_id_str: '50',
        },
      ],
    ]);

    const rec = await fetchXTweet(ID, URL_);
    expect(rec.isReply).toBe(true);
    expect(rec.replyToId).toBe('50');
    expect(rec.replyToPost).toBeNull();
  });

  test('返信でないツイートは replyToPost が null のまま', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'solo', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' } }]]);

    const rec = await fetchXTweet(ID, URL_);
    expect(rec.isReply).toBeFalsy();
    expect(rec.replyToPost).toBeNull();
  });
});

describe('Bluesky', () => {
  const ID = { platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' };
  const URL_ = 'https://bsky.app/profile/alice.bsky.social/post/rk';
  const DID = 'did:plc:alice';

  function stub(post: Record<string, unknown>) {
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: { author: { handle: 'alice.bsky.social', did: DID }, record: { text: 'my take', createdAt: '2026-01-01T00:00:00Z' }, ...post } } }],
    ]);
  }

  test('embed.record（引用）から ViewRecord のテキスト・投稿者・画像を取る', async () => {
    stub({
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          uri: 'at://did:plc:bob/app.bsky.feed.post/xyz',
          author: { handle: 'bob.bsky.social', did: 'did:plc:bob', displayName: 'Bob', avatar: 'https://bsky.example/bob.jpg' },
          value: { text: 'original text', createdAt: '2025-12-31T00:00:00Z' },
          embeds: [{ $type: 'app.bsky.embed.images#view', images: [{ fullsize: 'https://cdn.bsky.app/img/a.jpg', alt: 'a photo', aspectRatio: { width: 10, height: 20 } }] }],
        },
      },
    });

    const rec = await fetchBlueskyPost(ID, URL_);
    expect(rec.isQuote).toBe(true);
    expect(rec.quotedUrl).toBe('https://bsky.app/profile/bob.bsky.social/post/xyz');
    expect(rec.quotedPost).toEqual({
      url: 'https://bsky.app/profile/bob.bsky.social/post/xyz',
      displayName: 'Bob',
      screenName: 'bob.bsky.social',
      userId: 'did:plc:bob',
      avatar: 'https://bsky.example/bob.jpg',
      text: 'original text',
      date: '2025-12-31T00:00:00.000Z',
      cw: null,
      media: [{ url: 'https://cdn.bsky.app/img/a.jpg', alt: 'a photo', width: 10, height: 20 }],
    });
    // #292/ADR 0011: getPostThread now asks parentHeight=0, so a reply's
    // parent never arrives with content — replyToPost stays null even when
    // this post IS a reply (record.reply set), same as Mastodon (X gets one
    // since #806).
    expect(rec.replyToPost).toBeNull();
  });

  test('recordWithMedia（引用＋自前メディア）でも ViewRecord は1段深いところから取る', async () => {
    stub({
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: {
          $type: 'app.bsky.embed.record#view',
          record: {
            uri: 'at://did:plc:bob/app.bsky.feed.post/xyz',
            author: { handle: 'bob.bsky.social', did: 'did:plc:bob' },
            value: { text: 'original text', createdAt: '2025-12-31T00:00:00Z' },
            embeds: [],
          },
        },
        media: { $type: 'app.bsky.embed.images#view', images: [] },
      },
    });

    const rec = await fetchBlueskyPost(ID, URL_);
    expect(rec.isQuote).toBe(true);
    expect(rec.quotedPost?.text).toBe('original text');
    expect(rec.quotedPost?.screenName).toBe('bob.bsky.social');
  });

  test('embed.record がリスト/フィードなら quote 扱いにしない（quotedPost も null）', async () => {
    stub({
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: { uri: 'at://did:plc:bob/app.bsky.graph.list/xyz', author: { handle: 'bob.bsky.social' } },
      },
    });

    const rec = await fetchBlueskyPost(ID, URL_);
    expect(rec.isQuote).toBeFalsy();
    expect(rec.quotedPost).toBeNull();
  });

  test('引用なし投稿は quotedPost も null', async () => {
    stub({});

    const rec = await fetchBlueskyPost(ID, URL_);
    expect(rec.quotedPost).toBeNull();
  });
});

describe('Misskey', () => {
  const ID = { platform: 'misskey', host: 'misskey.io', noteId: 'n1' };
  const URL_ = 'https://misskey.io/notes/n1';

  test('note.renote（何かを足したリノート＝引用）はフル Note からテキスト・投稿者・メディアを取る', async () => {
    mockFetch([
      [
        '/api/notes/show',
        {
          text: 'my take',
          renoteId: 'n2',
          renote: {
            id: 'n2',
            text: 'original text',
            cw: 'spoiler',
            createdAt: '2025-12-31T00:00:00Z',
            url: 'https://misskey.io/notes/n2',
            user: { name: 'Bob', username: 'bob', id: 'u2', avatarUrl: 'https://misskey.io/avatar/bob.jpg' },
            files: [{ url: 'https://misskey.io/files/a.jpg', type: 'image/jpeg', comment: 'alt text', properties: { width: 10, height: 20 } }],
          },
        },
      ],
    ]);

    const rec = await fetchMisskeyNote(ID, URL_);
    expect(rec.isQuote).toBe(true);
    expect(rec.quotedUrl).toBe('https://misskey.io/notes/n2');
    expect(rec.quotedPost).toEqual({
      url: 'https://misskey.io/notes/n2',
      displayName: 'Bob',
      screenName: 'bob',
      userId: 'u2',
      avatar: 'https://misskey.io/avatar/bob.jpg',
      text: 'original text',
      date: '2025-12-31T00:00:00.000Z',
      cw: 'spoiler',
      media: [{ url: 'https://misskey.io/files/a.jpg', alt: 'alt text', width: 10, height: 20, type: undefined, poster: undefined }],
    });
  });

  test('連合リモートユーザーの renote は user@host 形式の screenName になる', async () => {
    mockFetch([
      [
        '/api/notes/show',
        {
          text: 'my take',
          renoteId: 'n2',
          renote: { id: 'n2', text: 'original text', createdAt: '2025-12-31T00:00:00Z', user: { name: 'Bob', username: 'bob', host: 'remote.example', id: 'u2' } },
        },
      ],
    ]);

    const rec = await fetchMisskeyNote(ID, URL_);
    expect(rec.quotedPost?.screenName).toBe('bob@remote.example');
  });

  test('note.reply（リプ先）もフル Note から取る', async () => {
    mockFetch([
      [
        '/api/notes/show',
        {
          text: 'a reply',
          replyId: 'n0',
          reply: { id: 'n0', text: 'parent text', createdAt: '2025-12-31T00:00:00Z', user: { name: 'Carol', username: 'carol', id: 'u0' } },
        },
      ],
    ]);

    const rec = await fetchMisskeyNote(ID, URL_);
    expect(rec.isReply).toBe(true);
    expect(rec.replyToPost).toEqual({
      url: 'https://misskey.io/notes/n0',
      displayName: 'Carol',
      screenName: 'carol',
      userId: 'u0',
      avatar: null,
      text: 'parent text',
      date: '2025-12-31T00:00:00.000Z',
      cw: null,
      media: [],
    });
  });

  test('何も足さないピュアリノートは quote 扱いにしない（quotedPost も null）', async () => {
    mockFetch([['/api/notes/show', { text: null, renoteId: 'n2', renote: { id: 'n2', text: 'original text' } }]]);

    const rec = await fetchMisskeyNote(ID, URL_);
    expect(rec.isQuote).toBeFalsy();
    expect(rec.quotedPost).toBeNull();
  });
});

describe('Mastodon', () => {
  const ID = { platform: 'mastodon', host: 'mastodon.social', id: '1' };
  const URL_ = 'https://mastodon.social/@alice/1';

  const fullStatus = () => ({
    url: 'https://mastodon.social/@bob/2',
    content: '<p>original text</p>',
    spoiler_text: 'spoiler',
    created_at: '2025-12-31T00:00:00Z',
    account: { display_name: 'Bob', acct: 'bob', id: 'u2', avatar: 'https://mastodon.social/avatar/bob.jpg' },
    media_attachments: [{ url: 'https://mastodon.social/media/a.jpg', type: 'image', description: 'alt text', meta: { original: { width: 10, height: 20 } } }],
  });

  test('フォーク流（quote が直接フル Status）から取る', async () => {
    mockFetch([['/api/v1/statuses/', { content: '<p>my take</p>', quote: fullStatus() }]]);

    const rec = await fetchMastodonStatus(ID, URL_);
    expect(rec.isQuote).toBe(true);
    expect(rec.quotedPost).toEqual({
      url: 'https://mastodon.social/@bob/2',
      displayName: 'Bob',
      screenName: 'bob',
      userId: 'u2',
      avatar: 'https://mastodon.social/avatar/bob.jpg',
      text: 'original text',
      date: '2025-12-31T00:00:00.000Z',
      cw: 'spoiler',
      media: [{ url: 'https://mastodon.social/media/a.jpg', alt: 'alt text', width: 10, height: 20, type: 'image', poster: undefined }],
    });
  });

  test('mainline 4.4+ 流（quote.quoted_status にフル Status）から取る', async () => {
    mockFetch([['/api/v1/statuses/', { content: '<p>my take</p>', quote: { state: 'accepted', quoted_status: fullStatus() } }]]);

    const rec = await fetchMastodonStatus(ID, URL_);
    expect(rec.quotedPost?.text).toBe('original text');
    expect(rec.quotedPost?.screenName).toBe('bob');
  });

  test('shallow ShallowQuote（quoted_status_id のみ）は isQuote は立つが quotedPost は null', async () => {
    mockFetch([['/api/v1/statuses/', { content: '<p>my take</p>', quote: { state: 'pending', quoted_status_id: '2' } }]]);

    const rec = await fetchMastodonStatus(ID, URL_);
    expect(rec.isQuote).toBe(true);
    expect(rec.quotedPost).toBeNull();
  });

  test('引用なし投稿は quotedPost も null、リプ先があっても replyToPost は常に null（本文取得に追加リクエストが要るため v1 対象外）', async () => {
    mockFetch([['/api/v1/statuses/', { content: '<p>a reply</p>', in_reply_to_id: '9' }]]);

    const rec = await fetchMastodonStatus(ID, URL_);
    expect(rec.quotedPost).toBeNull();
    expect(rec.isReply).toBe(true);
    expect(rec.replyToPost).toBeNull();
  });
});
