// metadata.ts#fetchPostMetadata の expectedHost オプション＝オリジンの制約（SSRF）の
// テスト。API のホストが固定の X・Bluesky・pixiv は、閲覧ページのホストと独立して取得を
// 進める。fetch はスタブなので
// ネットワークは要らない。

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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

test('X は API ホストが固定＝食い違う expectedHost で止めてはいけない', async () => {
  await fetchPostMetadata('https://x.com/u/status/123', { expectedHost: 'totally-different.example' });

  expect(calls.length).toBeGreaterThan(0);
});
