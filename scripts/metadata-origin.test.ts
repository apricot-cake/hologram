// metadata.ts#fetchPostMetadata の expectedHost オプション＝オリジンの制約（SSRF）の
// テスト。Misskey は API のホストを投稿の URL から導くので、悪意あるページが
// 拡張機能の特権つき fetch を任意のホストへ向けられてしまう。expectedHost を渡したときは、
// インスタンスのホストがそれと一致しなければ fetch を進めてはいけない。一致すれば進める
// （API のホストが固定の X・Bluesky・pixiv も同じく進める）。fetch はスタブなので
// ネットワークは要らない。

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

test('X は API ホストが固定＝食い違う expectedHost で止めてはいけない', async () => {
  await fetchPostMetadata('https://x.com/u/status/123', { expectedHost: 'totally-different.example' });

  expect(calls.length).toBeGreaterThan(0);
});
