// 投稿本文のカスタム絵文字 (:shortcode:)、#290。fetch は差し替えるのでネットワークは
// 要らない＝モックの作法は extractor-quoted.test.ts と同じ。
//
// 見るもの:
//   1. Misskey の note.emojis（shortcode → URL のマップ）が customEmojis[] になる。
//   2. カスタム絵文字を使っていないノートでは customEmojis === [] のまま。
//   3. 純粋な変換関数 misskeyCustomEmojis が、壊れた項目を
//      throw もせず中途半端に残しもせず落とす。

import { afterEach, describe, expect, test, vi } from 'vitest';
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
