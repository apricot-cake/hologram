// Link-card (OGP preview card) capture (#181). fetch is swapped out, no
// network needed — same mocking convention as extractor-poll.test.ts /
// extractor-quoted.test.ts.
//
// The X fixture is not invented: card.name/binding_values keys are
// cross-checked against several independent open-source readers of the SAME
// cdn.syndication.twimg.com endpoint this file calls (FxEmbed, tweetic,
// twscrape, OldTwitter — read 2026-08-02, see x.ts's own comment). The
// Bluesky fixture follows the official app.bsky.embed.external lexicon's
// #view shape (thumb already a URL, not a blob ref); the Mastodon fixture
// follows the official PreviewCard entity.
//
// What's checked per platform:
//   1. A link-share post fills rec.linkCard with url/title/description/thumbnail.
//   2. A post with no card (or, on X, a DIFFERENT kind of card — a poll or a
//      broadcast) leaves rec.linkCard null.
//   3. A card with no image still fills text (thumbnail null, never dropped).

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchBlueskyPost } from '../extension/utils/extractor/bluesky.ts';
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

describe('X', () => {
  const ID = { platform: 'x', id: '1', screenName: 'alice' };
  const URL_ = 'https://x.com/alice/status/1';

  const linkCard = {
    name: 'summary_large_image',
    binding_values: {
      title: { string_value: 'A great article', type: 'STRING' },
      description: { string_value: 'It explains things.', type: 'STRING' },
      card_url: { string_value: 'https://example.com/article', type: 'STRING' },
      domain: { string_value: 'example.com', type: 'STRING' },
      photo_image_full_size_original: { image_value: { url: 'https://pbs.twimg.com/card_img/1/orig', width: 1200, height: 630 }, type: 'IMAGE' },
    },
  };

  test('summary_large_image カードから url・タイトル・説明文・サムネを取る', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'read this', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' }, card: linkCard }]]);

    const rec = await fetchXTweet(ID, URL_);
    expect(rec.linkCard).toEqual({
      url: 'https://example.com/article',
      title: 'A great article',
      description: 'It explains things.',
      thumbnail: 'https://pbs.twimg.com/card_img/1/orig',
    });
  });

  test('サムネ用バインディングが無いカードは thumbnail が null（テキストは残す）', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'read this',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          card: { name: 'summary', binding_values: { title: { string_value: 'No image here', type: 'STRING' }, card_url: { string_value: 'https://example.com/no-image', type: 'STRING' } } },
        },
      ],
    ]);

    const rec = await fetchXTweet(ID, URL_);
    expect(rec.linkCard).toEqual({ url: 'https://example.com/no-image', title: 'No image here', description: null, thumbnail: null });
  });

  test('poll カードは linkCard にしない（#179 の同じカード機構と排他）', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'vote', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' }, card: { name: 'poll2choice_text_only', binding_values: { choice1_label: { string_value: 'Yes', type: 'STRING' }, choice2_label: { string_value: 'No', type: 'STRING' } } } }]]);

    expect((await fetchXTweet(ID, URL_)).linkCard).toBeNull();
  });

  test('broadcast など他種のカードも linkCard にしない', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'live now', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' }, card: { name: '745291183405076480:broadcast', binding_values: { broadcast_title: { string_value: 'Launch', type: 'STRING' } } } }]]);

    expect((await fetchXTweet(ID, URL_)).linkCard).toBeNull();
  });

  test('カードの無い投稿は linkCard が null', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'solo', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' } }]]);

    expect((await fetchXTweet(ID, URL_)).linkCard).toBeNull();
  });

  // #915: card_url is a t.co short link on real X responses; entities.urls
  // carries the same short link's expansion (the JAXA post measured in #843).
  test('card_url が entities.urls に載っている t.co なら展開先を url に採る（#915）', async () => {
    const shortenedCard = { ...linkCard, binding_values: { ...linkCard.binding_values, card_url: { string_value: 'https://t.co/uXNG3Y7uHS', type: 'STRING' } } };
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'read this',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          card: shortenedCard,
          entities: { urls: [{ url: 'https://t.co/uXNG3Y7uHS', expanded_url: 'https://www.jaxa.jp/press/2026/04/20260424-1_j.html' }] },
        },
      ],
    ]);

    const rec = await fetchXTweet(ID, URL_);
    expect(rec.linkCard?.url).toBe('https://www.jaxa.jp/press/2026/04/20260424-1_j.html');
  });

  test('card_url に対応する entities.urls が無ければ card_url のまま（回帰なし）', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'read this',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          card: linkCard,
          entities: { urls: [{ url: 'https://t.co/unrelated', expanded_url: 'https://example.org/unrelated' }] },
        },
      ],
    ]);

    const rec = await fetchXTweet(ID, URL_);
    expect(rec.linkCard?.url).toBe('https://example.com/article');
  });
});

describe('Mastodon', () => {
  const ID = { platform: 'mastodon', host: 'mastodon.social', id: '1' };
  const URL_ = 'https://mastodon.social/@alice/1';

  test('status.card から url・タイトル・説明文・サムネを取る', async () => {
    mockFetch([['/api/v1/statuses/', { content: '<p>read this</p>', card: { url: 'https://example.com/article', title: 'A great article', description: 'It explains things.', type: 'link', image: 'https://mastodon.social/system/preview_cards/images/1/original.jpg' } }]]);

    const rec = await fetchMastodonStatus(ID, URL_);
    expect(rec.linkCard).toEqual({
      url: 'https://example.com/article',
      title: 'A great article',
      description: 'It explains things.',
      thumbnail: 'https://mastodon.social/system/preview_cards/images/1/original.jpg',
    });
  });

  test('image の無いカードは thumbnail が null', async () => {
    mockFetch([['/api/v1/statuses/', { content: '<p>text only card</p>', card: { url: 'https://example.com/no-image', title: 'No image', description: '', type: 'link', image: null } }]]);

    const rec = await fetchMastodonStatus(ID, URL_);
    expect(rec.linkCard).toEqual({ url: 'https://example.com/no-image', title: 'No image', description: null, thumbnail: null });
  });

  test('カードの無い投稿は linkCard が null（card: null で返ってくる）', async () => {
    mockFetch([['/api/v1/statuses/', { content: '<p>plain</p>', card: null }]]);

    expect((await fetchMastodonStatus(ID, URL_)).linkCard).toBeNull();
  });
});

describe('Bluesky', () => {
  test('app.bsky.embed.external の view から url・タイトル・説明文・サムネを取る', async () => {
    mockFetch([
      ['resolveHandle', { did: 'did:plc:alice' }],
      [
        'getPostThread',
        {
          thread: {
            post: {
              author: { handle: 'alice.bsky.social', did: 'did:plc:alice' },
              record: { text: 'read this', createdAt: '2026-01-01T00:00:00Z' },
              embed: {
                $type: 'app.bsky.embed.external#view',
                external: { uri: 'https://example.com/article', title: 'A great article', description: 'It explains things.', thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/bafkreiabc@jpeg' },
              },
            },
          },
        },
      ],
    ]);

    const rec = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk');
    expect(rec.linkCard).toEqual({
      url: 'https://example.com/article',
      title: 'A great article',
      description: 'It explains things.',
      thumbnail: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/bafkreiabc@jpeg',
    });
  });

  test('thumb の無い external embed は thumbnail が null', async () => {
    mockFetch([
      ['resolveHandle', { did: 'did:plc:alice' }],
      ['getPostThread', { thread: { post: { author: { handle: 'alice.bsky.social', did: 'did:plc:alice' }, record: { text: 'read this', createdAt: '2026-01-01T00:00:00Z' }, embed: { $type: 'app.bsky.embed.external#view', external: { uri: 'https://example.com/no-thumb', title: 'No thumb', description: '' } } } } }],
    ]);

    const rec = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk');
    expect(rec.linkCard).toEqual({ url: 'https://example.com/no-thumb', title: 'No thumb', description: null, thumbnail: null });
  });

  test('画像埋め込みの投稿（images embed）は linkCard が null', async () => {
    mockFetch([
      ['resolveHandle', { did: 'did:plc:alice' }],
      ['getPostThread', { thread: { post: { author: { handle: 'alice.bsky.social', did: 'did:plc:alice' }, record: { text: 'a pic', createdAt: '2026-01-01T00:00:00Z' }, embed: { $type: 'app.bsky.embed.images#view', images: [{ fullsize: 'https://cdn.bsky.app/img/1.jpg' }] } } } }],
    ]);

    const rec = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk');
    expect(rec.linkCard).toBeNull();
  });

  test('埋め込みの無い投稿は linkCard が null', async () => {
    mockFetch([
      ['resolveHandle', { did: 'did:plc:alice' }],
      ['getPostThread', { thread: { post: { author: { handle: 'alice.bsky.social', did: 'did:plc:alice' }, record: { text: 'plain', createdAt: '2026-01-01T00:00:00Z' } } } }],
    ]);

    expect((await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk')).linkCard).toBeNull();
  });
});
