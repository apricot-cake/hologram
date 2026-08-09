// アンケートの取得 (#179)。fetch を差し替えるのでネットワークは要らない＝モックの
// 作法は extractor-quoted.test.ts と同じ。
//
// X のフィクスチャは作り物ではない。アンケートのツイートに対して実際の
// cdn.syndication.twimg.com の応答が持つ binding_values の形で、2026-08-02 に実測した
// （X ではアンケートはツイートの欄ではなく legacy の CARD）。Misskey と Mastodon の
// フィクスチャは、登録済みのカナリアのサンプル
// （scripts/canary/snapshots/{misskey,mastodon}.json の 'poll' ラベル）に従う。
//
// プラットフォームごとに確かめること:
//   1. アンケートのある投稿は、rec.poll に選択肢をそのプラットフォーム自身の順で、
//      票数を数値で、締切を ISO で埋める。
//   2. 無い投稿は rec.poll を null のままにする。X で別種のカードを持つ投稿も含む
//      ＝「カードがある」は「アンケートがある」ではない。
//   3. 伏せられた票数は 0 にせず null のまま（Mastodon は閲覧者が投票するまで結果を
//      隠す。こちらは投票しない）。

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

  // X のカードの値はどれも型付きの箱（{string_value, type}）に入っている。票数も、
  // 数であるにもかかわらず10進の STRING で来る。
  const pollCard = {
    name: 'poll2choice_text_only',
    url: 'card://2',
    binding_values: {
      choice1_label: { string_value: 'Yes', type: 'STRING' },
      choice1_count: { string_value: '10063044', type: 'STRING' },
      choice2_label: { string_value: 'No', type: 'STRING' },
      choice2_count: { string_value: '7439347', type: 'STRING' },
      end_datetime_utc: { string_value: '2022-12-19T11:20:32Z', type: 'STRING' },
      counts_are_final: { boolean_value: true, type: 'BOOLEAN' },
      duration_minutes: { string_value: '720', type: 'STRING' },
    },
  };

  test('poll カードから選択肢・票数・締切を取る', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'which one?', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' }, card: pollCard }]]);

    const rec = await fetchXTweet(ID, URL_);
    expect(rec.poll).toEqual({
      choices: [
        { text: 'Yes', votes: 10063044 },
        { text: 'No', votes: 7439347 },
      ],
      // X のカードには複数選択の印も、実人数の投票者数も無い。信号が無いことを表す
      // null であって、推測した false や 0 ではない。
      multiple: null,
      expiresAt: '2022-12-19T11:20:32.000Z',
      votersCount: null,
    });
  });

  test('4択でも選択肢の数はカード名でなく実際の binding_values で決まる', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'pick one',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          card: {
            name: 'poll4choice_text_only',
            binding_values: {
              choice1_label: { string_value: 'A', type: 'STRING' },
              choice1_count: { string_value: '1', type: 'STRING' },
              choice2_label: { string_value: 'B', type: 'STRING' },
              choice2_count: { string_value: '2', type: 'STRING' },
              choice3_label: { string_value: 'C', type: 'STRING' },
              choice3_count: { string_value: '3', type: 'STRING' },
              choice4_label: { string_value: 'D', type: 'STRING' },
              choice4_count: { string_value: '4', type: 'STRING' },
            },
          },
        },
      ],
    ]);

    const rec = await fetchXTweet(ID, URL_);
    expect(rec.poll?.choices.map((c) => c.text)).toEqual(['A', 'B', 'C', 'D']);
    // このカードに end_datetime_utc は無い＝でっち上げず、無いままにする。
    expect(rec.poll?.expiresAt).toBeNull();
  });

  test('poll でないカード（リンクプレビュー等）は poll にしない', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'a link', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' }, card: { name: 'summary_large_image', binding_values: { title: { string_value: 'A page', type: 'STRING' } } } }]]);

    expect((await fetchXTweet(ID, URL_)).poll).toBeNull();
  });

  test('カードの無い投稿は poll が null', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'solo', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' } }]]);

    expect((await fetchXTweet(ID, URL_)).poll).toBeNull();
  });
});

describe('Misskey', () => {
  const ID = { platform: 'misskey', host: 'misskey.io', noteId: 'n1' };
  const URL_ = 'https://misskey.io/notes/n1';

  test('note.poll から選択肢・票数・複数選択可否・締切を取る（isVoted は保存しない）', async () => {
    mockFetch([
      [
        '/api/notes/show',
        {
          text: 'どっち派？',
          poll: {
            multiple: true,
            expiresAt: '2026-01-02T00:00:00Z',
            choices: [
              { text: 'きのこ', votes: 12, isVoted: false },
              { text: 'たけのこ', votes: 34, isVoted: false },
            ],
          },
        },
      ],
    ]);

    const rec = await fetchMisskeyNote(ID, URL_);
    expect(rec.poll).toEqual({
      choices: [
        { text: 'きのこ', votes: 12 },
        { text: 'たけのこ', votes: 34 },
      ],
      multiple: true,
      expiresAt: '2026-01-02T00:00:00.000Z',
      // Misskey は実人数の投票者数を返さない。
      votersCount: null,
    });
  });

  test('締切の無いアンケートは expiresAt が null', async () => {
    mockFetch([['/api/notes/show', { text: 'いつまでも', poll: { multiple: false, expiresAt: null, choices: [{ text: 'はい', votes: 1 }] } }]]);

    expect((await fetchMisskeyNote(ID, URL_)).poll?.expiresAt).toBeNull();
  });

  test('アンケートの無いノートは poll が null', async () => {
    mockFetch([['/api/notes/show', { text: 'ただのノート' }]]);

    expect((await fetchMisskeyNote(ID, URL_)).poll).toBeNull();
  });
});

describe('Mastodon', () => {
  const ID = { platform: 'mastodon', host: 'mastodon.social', id: '1' };
  const URL_ = 'https://mastodon.social/@alice/1';

  test('status.poll から選択肢・票数・投票者数・締切を取る', async () => {
    mockFetch([
      [
        '/api/v1/statuses/',
        {
          content: '<p>which?</p>',
          poll: {
            id: '7',
            expires_at: '2026-01-02T00:00:00Z',
            expired: false,
            multiple: true,
            votes_count: 46,
            voters_count: 30,
            options: [
              { title: 'Yes', votes_count: 12 },
              { title: 'No', votes_count: 34 },
            ],
            emojis: [],
          },
        },
      ],
    ]);

    const rec = await fetchMastodonStatus(ID, URL_);
    expect(rec.poll).toEqual({
      choices: [
        { text: 'Yes', votes: 12 },
        { text: 'No', votes: 34 },
      ],
      multiple: true,
      expiresAt: '2026-01-02T00:00:00.000Z',
      // 実人数の投票者数。複数選択のアンケートで投じられた46票とは別の数で、
      // これを返すのはこのプラットフォームだけ。
      votersCount: 30,
    });
  });

  test('結果非公開のアンケートは票数が null（0 にしない）', async () => {
    mockFetch([
      [
        '/api/v1/statuses/',
        {
          content: '<p>hidden</p>',
          poll: {
            multiple: false,
            expires_at: null,
            options: [
              { title: 'Yes', votes_count: null },
              { title: 'No', votes_count: null },
            ],
          },
        },
      ],
    ]);

    const rec = await fetchMastodonStatus(ID, URL_);
    expect(rec.poll?.choices).toEqual([
      { text: 'Yes', votes: null },
      { text: 'No', votes: null },
    ]);
  });

  test('アンケートの無い投稿は poll が null（poll: null で返ってくる）', async () => {
    mockFetch([['/api/v1/statuses/', { content: '<p>plain</p>', poll: null }]]);

    expect((await fetchMastodonStatus(ID, URL_)).poll).toBeNull();
  });
});

describe('Bluesky', () => {
  // app.bsky.feed.post の embed の union は images / video / gallery / external /
  // record / recordWithMedia（bluesky-social/atproto の lexicon、2026-08-02 に確認）。
  // そもそもプラットフォームにアンケートが無いので、この extractor はこの欄を埋めない。
  // 決めつけずアサーションで置く理由は、#179 の冒頭がアンケートのあるプラットフォームと
  // して Bluesky を挙げているため。
  test('Bluesky には投票機能が無いので poll は常に null', async () => {
    mockFetch([
      ['resolveHandle', { did: 'did:plc:alice' }],
      ['getPostThread', { thread: { post: { author: { handle: 'alice.bsky.social', did: 'did:plc:alice' }, record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z' } } } }],
    ]);

    const rec = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk');
    expect(rec.poll).toBeNull();
  });
});
