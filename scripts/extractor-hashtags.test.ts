// 構造化ハッシュタグ（サイドカーの `hashtags`）を5プラットフォームで揃える（#177）。
// fetch は差し替え・ネットワーク不要。
//
// 見るのは2つだけ:
//   1. 各PFの応答の「そのPFなりの置き場」から取れること
//      （X=entities.hashtags[].text ＋ 無い時は本文からの拾い直し／
//        Bluesky=record.facets の tag ファセット ＋ record.tags[]／
//        Misskey=note.tags[]／Mastodon=tags[].name／pixiv=tags.tags[].tag）
//   2. **入る形が全PFで同じ**こと＝先頭の `#` を持たない素のタグ・重複なし。
//      ここが揃っていないとファセットで同じタグが2つに割れる。字形（大小・全半角）の
//      正規化は #197 の射程なので、ここでは「素材のまま」を確認するに留める。
// タグの無い投稿が空配列になることも各PFで見る（`null` や `['']` にしない）。

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchBlueskyPost } from '../extension/utils/extractor/bluesky.ts';
import { fetchMastodonStatus } from '../extension/utils/extractor/mastodon.ts';
import { fetchMisskeyNote } from '../extension/utils/extractor/misskey.ts';
import { fetchPixivIllust } from '../extension/utils/extractor/pixiv.ts';
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

const X_ID = { platform: 'x', id: '123', screenName: 'alice' };
const X_URL = 'https://x.com/alice/status/123';
const DID = 'did:plc:abc';
const BSKY_ID = { platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' };
const BSKY_URL = 'https://bsky.app/profile/alice.bsky.social/post/rk';

// entities は「無い＝タグが無い」ではない（実保存の原本でも、タグの無い投稿の
// entities は urls / user_mentions / media しか持たない）＝欠けていたら本文を読む。
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

  // URL の断片色指定やアンカーを拾うと、誰も打っていないタグがファセットに並ぶ
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

  // record.tags[] はレキシコンの「本文・ファセット以外に付ける追加のハッシュタグ」
  test('record.tags[] も同じ投稿のタグとして合流する', async () => {
    stub({
      facets: [{ index: { byteStart: 0, byteEnd: 5 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'Alpha' }] }],
      tags: ['Beta', 'Alpha'], // 同じタグが両方にあっても1つ
    });

    expect((await fetchBlueskyPost(BSKY_ID, BSKY_URL)).hashtags).toEqual(['Alpha', 'Beta']);
  });

  test('タグの無い投稿は空配列', async () => {
    stub({});

    expect((await fetchBlueskyPost(BSKY_ID, BSKY_URL)).hashtags).toEqual([]);
  });
});

describe('Misskey', () => {
  const ID = { platform: 'misskey', host: 'misskey.io', noteId: 'n1' };
  const URL_ = 'https://misskey.io/notes/n1';

  test('note.tags[] から取る', async () => {
    mockFetch([['/api/notes/show', { text: 'hi', tags: ['illust', 'イラスト'] }]]);

    expect((await fetchMisskeyNote(ID, URL_)).hashtags).toEqual(['illust', 'イラスト']);
  });

  test('tags が無い投稿は空配列', async () => {
    mockFetch([['/api/notes/show', { text: 'hi' }]]);

    expect((await fetchMisskeyNote(ID, URL_)).hashtags).toEqual([]);
  });
});

describe('Mastodon', () => {
  const ID = { platform: 'mastodon', host: 'mastodon.social', id: '1' };
  const URL_ = 'https://mastodon.social/@u/1';

  test('tags[].name から取る（url は捨てる）', async () => {
    mockFetch([
      [
        '/api/v1/statuses/',
        {
          content: '<p>hi</p>',
          tags: [
            { name: 'illustration', url: 'https://mastodon.social/tags/illustration' },
            { name: 'イラスト', url: 'https://mastodon.social/tags/イラスト' },
          ],
        },
      ],
    ]);

    expect((await fetchMastodonStatus(ID, URL_)).hashtags).toEqual(['illustration', 'イラスト']);
  });

  test('タグの無い投稿は空配列', async () => {
    mockFetch([['/api/v1/statuses/', { content: '<p>hi</p>', tags: [] }]]);

    expect((await fetchMastodonStatus(ID, URL_)).hashtags).toEqual([]);
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

// 揃っていること自体の確認。同じ「Alpha」を4PFがそれぞれの置き場で返した時、
// レコードに入る形が1つでなければファセットが割れる。
describe('入る形は全PF同じ', () => {
  test('先頭の # は落ちる・重複は畳まれる・素のタグ文字列になる', async () => {
    const got: Record<string, string[]> = {};

    mockFetch([['cdn.syndication.twimg.com', { text: 't', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' }, entities: { hashtags: [{ text: 'Alpha' }, { text: 'Alpha' }] } }]]);
    got.x = (await fetchXTweet(X_ID, X_URL)).hashtags;
    vi.unstubAllGlobals();

    // '#' 付きで書く実装が現れても、入る形は変わらない
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: { author: { handle: 'alice.bsky.social', did: DID }, record: { text: 't', createdAt: '2026-01-01T00:00:00Z', tags: ['#Alpha', ' Alpha '] } } } }],
    ]);
    got.bluesky = (await fetchBlueskyPost(BSKY_ID, BSKY_URL)).hashtags;
    vi.unstubAllGlobals();

    mockFetch([['/api/notes/show', { text: 't', tags: ['Alpha', 'Alpha'] }]]);
    got.misskey = (await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'n1' }, 'https://misskey.io/notes/n1')).hashtags;
    vi.unstubAllGlobals();

    mockFetch([['/api/v1/statuses/', { content: '<p>t</p>', tags: [{ name: 'Alpha' }, { name: 'Alpha' }] }]]);
    got.mastodon = (await fetchMastodonStatus({ platform: 'mastodon', host: 'mastodon.social', id: '1' }, 'https://mastodon.social/@u/1')).hashtags;
    vi.unstubAllGlobals();

    mockFetch([['/ajax/illust/', { error: false, body: { userId: '7', pageCount: 1, urls: { original: 'https://i.pximg.net/a_p0.jpg' }, tags: { tags: [{ tag: 'Alpha' }, { tag: 'Alpha' }] } } }]]);
    got.pixiv = (await fetchPixivIllust({ id: '1' }, 'u')).hashtags;

    expect(got).toEqual({ x: ['Alpha'], bluesky: ['Alpha'], misskey: ['Alpha'], mastodon: ['Alpha'], pixiv: ['Alpha'] });
  });
});
