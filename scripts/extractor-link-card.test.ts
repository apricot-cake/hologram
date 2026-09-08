import { apiFixture } from './test-api-fixtures.ts';
// リンクカード（OGP のプレビューカード）の取得（#181）。fetch は差し替えるのでネットワークは
// 要らない＝ extractor-poll.test.ts / extractor-quoted.test.ts と同じモックの作法。
//
// X のフィクスチャは作り話ではない。card.name / binding_values のキーは、このファイルが叩く
// のと同じ cdn.syndication.twimg.com のエンドポイントを読む独立した複数のオープンソース実装
//（FxEmbed、tweetic、twscrape、OldTwitter＝2026-08-02 に確認。x.ts 自身のコメントを参照）と
// 突き合わせてある。Bluesky のフィクスチャは公式の app.bsky.embed.external lexicon の #view の
// 形（thumb は blob 参照ではなく既に URL）に従う。
//
// プラットフォームごとに見るもの:
//   1. リンクを共有する投稿は rec.linkCard に url/title/description/thumbnail が入る。
//   2. カードの無い投稿（あるいは X では別の種類のカード＝アンケートや broadcast）は
//      rec.linkCard が null のまま。
//   3. 画像の無いカードでもテキストは入る（thumbnail は null。決して落とさない）。

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
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'vote',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          card: { name: 'poll2choice_text_only', binding_values: { choice1_label: { string_value: 'Yes', type: 'STRING' }, choice1_count: { string_value: '0' }, choice2_label: { string_value: 'No', type: 'STRING' }, choice2_count: { string_value: '0' } } },
        },
      ],
    ]);

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

  // #915: 実際の X の応答では card_url は t.co の短縮リンク。entities.urls が同じ短縮リンクの
  // 展開先を運ぶ（#843 で実測した JAXA の投稿）。
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
      ['getPostThread', { thread: { post: { author: { handle: 'alice.bsky.social', did: 'did:plc:alice' }, record: { text: 'a pic', createdAt: '2026-01-01T00:00:00Z' }, embed: { $type: 'app.bsky.embed.images#view', images: [{ fullsize: 'https://cdn.bsky.app/img/1.jpg', alt: '' }] } } } }],
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
