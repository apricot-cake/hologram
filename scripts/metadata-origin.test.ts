// Tests for metadata.ts#fetchPostMetadata's expectedHost option = origin constraint
// (SSRF) tests. Misskey/Mastodon derive the API host from the post URL, so a
// malicious page could point the extension's privileged fetch at an arbitrary host.
// When expectedHost is passed, fetch must not proceed if the instance's host doesn't
// match it. It proceeds if they match (and also for X/Bluesky/pixiv, whose API host
// is fixed). fetch is stubbed; no network needed.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchPostMetadata } from '../extension/utils/extractor/index.ts';

let calls: string[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (url: unknown) => {
    calls.push(String(url));
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Misskey', () => {
  test('ホストが食い違えば fetch しない（platform の判定は残る）', async () => {
    const r = await fetchPostMetadata('https://evil.example/notes/abc', { expectedHost: 'misskey.io' });

    expect(r.platform).toBe('misskey');
    expect(calls).toEqual([]);
  });

  test('ホストが一致すれば fetch する', async () => {
    await fetchPostMetadata('https://misskey.io/notes/abc', { expectedHost: 'misskey.io' });

    expect(calls.some((u) => u.includes('misskey.io/api/notes/show'))).toBe(true);
  });

  test('expectedHost を渡さなければ制約なし', async () => {
    await fetchPostMetadata('https://misskey.io/notes/abc');

    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('Mastodon', () => {
  test('ホストが食い違えば fetch しない', async () => {
    const r = await fetchPostMetadata('https://evil.example/@u/12345', { expectedHost: 'mastodon.social' });

    expect(r.platform).toBe('mastodon');
    expect(calls).toEqual([]);
  });

  test('ホストが一致すれば fetch する', async () => {
    await fetchPostMetadata('https://mastodon.social/@u/12345', { expectedHost: 'mastodon.social' });

    expect(calls.some((u) => u.includes('mastodon.social/api/v1/statuses/'))).toBe(true);
  });
});

test('X は API ホストが固定＝食い違う expectedHost で止めてはいけない', async () => {
  await fetchPostMetadata('https://x.com/u/status/123', { expectedHost: 'totally-different.example' });

  expect(calls.length).toBeGreaterThan(0);
});
