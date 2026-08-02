// Post-body custom emoji (:shortcode:), #290. fetch is swapped out, no network
// needed -- same mocking convention as extractor-quoted.test.ts.
//
// What's checked:
//   1. Misskey's note.emojis (a shortcode->URL map) becomes customEmojis[].
//   2. Mastodon's status.emojis[] ({shortcode, url, static_url}) becomes
//      customEmojis[], keeping `url` (the animated original) and dropping
//      `static_url`.
//   3. A note/status that used no custom emoji leaves customEmojis === [].
//   4. The pure converters (misskeyCustomEmojis/mastodonCustomEmojis) drop a
//      malformed entry instead of throwing or keeping it half-filled.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchMastodonStatus, mastodonCustomEmojis } from '../extension/utils/extractor/mastodon.ts';
import { fetchMisskeyNote, misskeyCustomEmojis } from '../extension/utils/extractor/misskey.ts';

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

describe('Misskey', () => {
  const ID = { platform: 'misskey', host: 'misskey.io', noteId: 'n1' };
  const URL_ = 'https://misskey.io/notes/n1';

  test('note.emojis（shortcode->URLのマップ）を customEmojis[] に変換する（misskey.io 実データで確認、2026-08-02）', async () => {
    mockFetch([
      [
        '/api/notes/show',
        {
          text: 'にゃっはぁ～ん:ha_to: シェードちゃんだにゃ～ん:ha_to_:',
          emojis: {
            ha_to: 'https://media.niri.la/misskey/3c417eef-aad8-45fd-b7ba-b97250a3e26e.png',
            ha_to_: 'https://media.niri.la/misskey/fe27e860-842e-4e78-a23a-6d538b19ce40.png',
          },
        },
      ],
    ]);

    const rec = await fetchMisskeyNote(ID, URL_);
    expect(rec.customEmojis).toEqual([
      { shortcode: 'ha_to', url: 'https://media.niri.la/misskey/3c417eef-aad8-45fd-b7ba-b97250a3e26e.png' },
      { shortcode: 'ha_to_', url: 'https://media.niri.la/misskey/fe27e860-842e-4e78-a23a-6d538b19ce40.png' },
    ]);
  });

  test('カスタム絵文字を使っていないノートは customEmojis が空配列（emojis キー自体が無い実データ形状）', async () => {
    mockFetch([['/api/notes/show', { text: 'plain text' }]]);

    const rec = await fetchMisskeyNote(ID, URL_);
    expect(rec.customEmojis).toEqual([]);
  });

  test('misskeyCustomEmojis は不正値（undefined・非string・空文字）を落とす', () => {
    expect(misskeyCustomEmojis(undefined)).toEqual([]);
    expect(misskeyCustomEmojis(null)).toEqual([]);
    expect(misskeyCustomEmojis({ good: 'https://x.example/g.png', bad: 123, '': 'https://x.example/empty.png' })).toEqual([{ shortcode: 'good', url: 'https://x.example/g.png' }]);
  });
});

describe('Mastodon', () => {
  const ID = { platform: 'mastodon', host: 'mstdn.jp', id: '1' };
  const URL_ = 'https://mstdn.jp/@alice/1';

  test('status.emojis[] を customEmojis[] に変換し、静止画版でなくアニメ原本の url を残す（mstdn.jp 実データで確認、2026-08-02）', async () => {
    mockFetch([
      [
        '/api/v1/statuses/',
        {
          content: '<p>ぬぬんぬ:meow_beanbag:</p>',
          emojis: [
            {
              shortcode: 'meow_beanbag',
              url: 'https://img.mstdn.jp/cache/custom_emojis/images/001/096/759/original/dd910b7429db638a.webp',
              static_url: 'https://img.mstdn.jp/cache/custom_emojis/images/001/096/759/static/dd910b7429db638a.png',
              visible_in_picker: true,
            },
          ],
        },
      ],
    ]);

    const rec = await fetchMastodonStatus(ID, URL_);
    expect(rec.customEmojis).toEqual([{ shortcode: 'meow_beanbag', url: 'https://img.mstdn.jp/cache/custom_emojis/images/001/096/759/original/dd910b7429db638a.webp' }]);
  });

  test('カスタム絵文字を使っていない投稿は customEmojis が空配列', async () => {
    mockFetch([['/api/v1/statuses/', { content: '<p>plain text</p>', emojis: [] }]]);

    const rec = await fetchMastodonStatus(ID, URL_);
    expect(rec.customEmojis).toEqual([]);
  });

  test('mastodonCustomEmojis は不正値（配列でない・shortcode/url 欠落）を落とす', () => {
    expect(mastodonCustomEmojis(undefined)).toEqual([]);
    expect(mastodonCustomEmojis([{ shortcode: 'ok', url: 'https://x.example/ok.png' }, { url: 'https://x.example/no-shortcode.png' }, { shortcode: 'no-url' }, null])).toEqual([{ shortcode: 'ok', url: 'https://x.example/ok.png' }]);
  });
});
