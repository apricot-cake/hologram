// Poll (survey) capture (#179). fetch is swapped out, no network needed — same
// mocking convention as extractor-quoted.test.ts.
//
// The X fixture is not invented: it is the binding_values shape a live
// cdn.syndication.twimg.com response carries for a poll tweet, measured
// 2026-08-02 (a poll is a legacy CARD there, not a field of the tweet). The
// Misskey and Mastodon fixtures follow the registered canary samples
// (scripts/canary/snapshots/{misskey,mastodon}.json's 'poll' label).
//
// What's checked per platform:
//   1. A post with a poll fills rec.poll with the choices in the platform's own
//      order, the tallies as numbers, and the deadline as ISO.
//   2. A post without one leaves rec.poll null — including a post carrying a
//      DIFFERENT kind of card on X, where "has a card" is not "has a poll".
//   3. A withheld tally stays null rather than becoming 0 (Mastodon hides
//      results until the viewer votes; we never vote).

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

  // Every value in an X card is a typed box ({string_value, type}); the counts
  // are decimal STRINGS even though they are numbers.
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
      // X's card has no multi-select flag and no distinct-voter count — the
      // no-signal null, never a guessed false/0.
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
    // No end_datetime_utc in this card — absent, not fabricated.
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
      // Misskey reports no distinct-voter count.
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
      // Distinct voters, which differs from the 46 votes cast on a
      // multiple-choice poll — the one platform that reports it.
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
  // app.bsky.feed.post's embed union is images / video / gallery / external /
  // record / recordWithMedia (bluesky-social/atproto lexicons, read
  // 2026-08-02) — there is no poll on the platform at all, so this extractor
  // never fills the field. Asserted rather than assumed: #179's own opening
  // line lists Bluesky among the platforms with polls.
  test('Bluesky には投票機能が無いので poll は常に null', async () => {
    mockFetch([
      ['resolveHandle', { did: 'did:plc:alice' }],
      ['getPostThread', { thread: { post: { author: { handle: 'alice.bsky.social', did: 'did:plc:alice' }, record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z' } } } }],
    ]);

    const rec = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk');
    expect(rec.poll).toBeNull();
  });
});
