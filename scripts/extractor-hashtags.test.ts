import { apiFixture } from './test-api-fixtures.ts';
// 5つのプラットフォームで、構造化されたハッシュタグ（サイドカーの `hashtags`）を揃える (#177)。
// fetch は差し替えるので、ネットワークは要らない。
//
// 見るのは2つだけ:
//   1. 各プラットフォームが「タグを置いている場所」から取れること
//      （X=entities.hashtags[].text と、無いときの本文の走査し直し /
//        Bluesky=record.facets の tag ファセットと record.tags[] /
//        pixiv=tags.tags[].tag）
//   2. 入る形が全プラットフォームで同じであること＝先頭に `#` の付かない素のタグで、
//      重複が無い。ここが揃っていないと、同じタグがファセットで2つに割れる。グリフの
//      正規化（大文字小文字・全角半角）は #197 の範囲なので、ここでは「素材」を
//      そのままの形で確かめるだけ。
// タグの無い投稿が空配列になること（`null` でも `['']` でもない）も、プラットフォームごとに見る。

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchBlueskyPost } from '../extension/utils/extractor/bluesky.ts';
import { fetchPixivIllust } from '../extension/utils/extractor/pixiv.ts';
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

const X_ID = { platform: 'x', id: '123', screenName: 'alice' };
const X_URL = 'https://x.com/alice/status/123';
const DID = 'did:plc:abc';
const BSKY_ID = { platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' };
const BSKY_URL = 'https://bsky.app/profile/alice.bsky.social/post/rk';

// entities が無いことは「タグが無い」を意味しない（実際に保存した原本でも、タグの無い投稿は
// urls / user_mentions / media だけを持つ entities を返す）＝無ければ本文を読む。
describe('X', () => {
  test('entities.hashtags[].text から取る', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'hi #Alpha and #ベータ',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          entities: {
            hashtags: [
              { indices: [3, 9], text: 'Alpha' },
              { indices: [14, 18], text: 'ベータ' },
            ],
            urls: [],
            user_mentions: [],
            symbols: [],
          },
        },
      ],
    ]);

    expect((await fetchXTweet(X_ID, X_URL)).hashtags).toEqual(['Alpha', 'ベータ']);
  });

  test('entities が無ければ本文から拾う', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: '新作です #イラスト ＃全角タグ', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' } }]]);

    expect((await fetchXTweet(X_ID, X_URL)).hashtags).toEqual(['イラスト', '全角タグ']);
  });

  // URL のフラグメントや色指定を拾うと、誰も打っていないタグがファセットに入る
  test('本文の拾い直しは語中の # と裸の # を拾わない', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'see https://example.com/a#frag or color#fff or a lone # here', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' } }]]);

    expect((await fetchXTweet(X_ID, X_URL)).hashtags).toEqual([]);
  });

  test('タグの無い投稿は空配列', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'hi', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' }, entities: { hashtags: [], urls: [], user_mentions: [], symbols: [] } }]]);

    expect((await fetchXTweet(X_ID, X_URL)).hashtags).toEqual([]);
  });
});

describe('Bluesky', () => {
  const post = (record: Record<string, unknown>) => ({
    author: { handle: 'alice.bsky.social', did: DID, displayName: 'Alice' },
    record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z', ...record },
  });

  function stub(record: Record<string, unknown>) {
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: post(record) } }],
    ]);
  }

  test('tag ファセットから取る（mention / link のファセットは混ぜない）', async () => {
    stub({
      facets: [
        { index: { byteStart: 0, byteEnd: 5 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'Alpha' }] },
        { index: { byteStart: 6, byteEnd: 9 }, features: [{ $type: 'app.bsky.richtext.facet#mention', did: DID }] },
        { index: { byteStart: 10, byteEnd: 20 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }] },
      ],
    });

    expect((await fetchBlueskyPost(BSKY_ID, BSKY_URL)).hashtags).toEqual(['Alpha']);
  });

  // record.tags[] は lexicon で言う「本文やファセットの外側で付ける追加のハッシュタグ」
  test('record.tags[] も同じ投稿のタグとして合流する', async () => {
    stub({
      facets: [{ index: { byteStart: 0, byteEnd: 5 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'Alpha' }] }],
      tags: ['Beta', 'Alpha'], // 両方に同じタグがあっても1つにまとまる
    });

    expect((await fetchBlueskyPost(BSKY_ID, BSKY_URL)).hashtags).toEqual(['Alpha', 'Beta']);
  });

  test('タグの無い投稿は空配列', async () => {
    stub({});

    expect((await fetchBlueskyPost(BSKY_ID, BSKY_URL)).hashtags).toEqual([]);
  });
});

describe('pixiv', () => {
  test('tags.tags[].tag から取る', async () => {
    mockFetch([['/ajax/illust/', { error: false, body: { illustTitle: 'x', userId: '7', pageCount: 1, urls: { original: 'https://i.pximg.net/a_p0.jpg' }, tags: { tags: [{ tag: 'オリジナル' }, { tag: 'R-18' }] } } }]]);

    expect((await fetchPixivIllust({ id: '1' }, 'https://www.pixiv.net/artworks/1')).hashtags).toEqual(['オリジナル', 'R-18']);
  });

  test('タグの無い作品は空配列', async () => {
    mockFetch([['/ajax/illust/', { error: false, body: { illustTitle: 'x', userId: '7', pageCount: 1, urls: { original: 'https://i.pximg.net/a_p0.jpg' }, tags: { tags: [] } } }]]);

    expect((await fetchPixivIllust({ id: '1' }, 'u')).hashtags).toEqual([]);
  });
});

// 揃っていること自体を確かめる。3つのプラットフォームがそれぞれの場所から同じ "Alpha" を
// 返したとき、レコードに入る形が1つでなければファセットが割れる。
describe('入る形は全PF同じ', () => {
  test('先頭の # は落ちる・重複は畳まれる・素のタグ文字列になる', async () => {
    const got: Record<string, string[]> = {};

    mockFetch([['cdn.syndication.twimg.com', { text: 't', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' }, entities: { hashtags: [{ text: 'Alpha' }, { text: 'Alpha' }] } }]]);
    got.x = (await fetchXTweet(X_ID, X_URL)).hashtags;
    vi.unstubAllGlobals();

    // 先頭に '#' を付けて書く実装が現れても、入る形は変わらない
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: { author: { handle: 'alice.bsky.social', did: DID }, record: { text: 't', createdAt: '2026-01-01T00:00:00Z', tags: ['#Alpha', ' Alpha '] } } } }],
    ]);
    got.bluesky = (await fetchBlueskyPost(BSKY_ID, BSKY_URL)).hashtags;
    vi.unstubAllGlobals();

    mockFetch([['/ajax/illust/', { error: false, body: { userId: '7', pageCount: 1, urls: { original: 'https://i.pximg.net/a_p0.jpg' }, tags: { tags: [{ tag: 'Alpha' }, { tag: 'Alpha' }] } } }]]);
    got.pixiv = (await fetchPixivIllust({ id: '1' }, 'u')).hashtags;

    expect(got).toEqual({ x: ['Alpha'], bluesky: ['Alpha'], pixiv: ['Alpha'] });
  });
});
