// Unit tests (fetch stubbed, no network use): a Mastodon record keeps a
// Mastodon-format canonical URL as-is, but for a post federated in from
// non-Mastodon software (Lemmy/PieFed, etc.) the canonical URL doesn't open as a
// status, so it falls back to the instance URL used at ingest time.

import { afterEach, expect, test, vi } from 'vitest';
import { fetchPostMetadata } from '../extension/utils/extractor/index.ts';

// Returns a real Response = metadata.ts reads the response body exactly once, stacks
// it into the raw-source layer (#292), then JSON.parses it. A hand-rolled mock that
// only has json() wouldn't go through that path.
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
