// 単体テスト（fetch は差し替え、ネットワークは使わない）。Mastodon のレコードは Mastodon 形式
// の canonical URL をそのまま保つ。ただし Mastodon 以外のソフトウェア（Lemmy・PieFed など）
// から連合してきた投稿では canonical URL がステータスとして開かないので、取り込み時に使った
// インスタンスの URL へ退避する。

import { afterEach, expect, test, vi } from 'vitest';
import { fetchPostMetadata } from '../extension/utils/extractor/index.ts';

// 本物の Response を返す＝ metadata.ts は応答の本文をちょうど1回読み、raw payload の層へ
// 積んでから（#292）JSON.parse する。json() しか持たない手作りのモックでは、その経路を
// 通らない。
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockStatus(statusUrl: string) {
  vi.stubGlobal('fetch', async (u: unknown) => {
    if (String(u).includes('/api/v1/statuses/')) {
      return jsonRes({
        url: statusUrl,
        content: '<p>hi</p>',
        created_at: '2026-01-01T00:00:00Z',
        account: { acct: 'a', username: 'a', id: '1' },
        media_attachments: [],
      });
    }
    return jsonRes({}, 404);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('連合してきた Lemmy の canonical は捨て、取り込み時のインスタンス URL を保つ', async () => {
  const captured = 'https://mastodon.social/@hitstun@feddit.online/113';
  mockStatus('https://feddit.online/c/FloatingIsFun/p/1744781/welcome-to-hell');

  expect((await fetchPostMetadata(captured)).url).toBe(captured);
});

test('Mastodon 形式の canonical（別のホームインスタンス）は canonical を保つ', async () => {
  mockStatus('https://other.example/@bob/999');

  expect((await fetchPostMetadata('https://mastodon.social/@bob/200')).url).toBe('https://other.example/@bob/999');
});

test('同一インスタンスの canonical はそのまま', async () => {
  mockStatus('https://mastodon.social/@bob/200');

  expect((await fetchPostMetadata('https://mastodon.social/@bob/200')).url).toBe('https://mastodon.social/@bob/200');
});
