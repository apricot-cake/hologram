// ユニットテスト（fetch を差し替え・ネットワーク非使用）: Mastodon レコードは
// Mastodon 形式の canonical URL をそのまま持つが、非 Mastodon ソフト（Lemmy/PieFed
// など）から連合してきた投稿は canonical URL が status として開けないため、取り込み時の
// インスタンス URL へフォールバックする。

import { afterEach, expect, test, vi } from 'vitest';
import { fetchPostMetadata } from '../extension/utils/metadata';

function mockStatus(statusUrl: string) {
  vi.stubGlobal('fetch', async (u: unknown) => {
    if (String(u).includes('/api/v1/statuses/')) {
      return {
        ok: true,
        json: async () => ({
          url: statusUrl,
          content: '<p>hi</p>',
          created_at: '2026-01-01T00:00:00Z',
          account: { acct: 'a', username: 'a', id: '1' },
          media_attachments: [],
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
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
