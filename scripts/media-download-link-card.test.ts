// downloadLinkCardThumbnail (#181): the OGP card's thumbnail, unit-tested
// in-process (no subprocess spawn needed — media-download.cts is a plain
// module, same reasoning media-download-custom-emoji.test.ts gives). fetch is
// stubbed (vi.stubGlobal), same convention as that file.
//
// What's checked:
//   1. The thumbnail downloads into <base>-linkcard.<ext> and the returned
//      file name points at it (per-record, unlike the shared avatars/emoji
//      stores — see this function's own comment for why).
//   2. A failed fetch returns null without throwing (best-effort, same as
//      every other download here).
//   3. No Referer header is ever attached — #181's own design point (the
//      card's thumbnail always comes from the PLATFORM's own CDN, never the
//      linked article's origin, so no cross-origin Referer leak can occur).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { downloadLinkCardThumbnail } from '../native-host/media-download.cts';

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

let tmp: string;
let seenHeaders: (HeadersInit | undefined)[];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-linkcard-'));
  seenHeaders = [];
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    seenHeaders.push(init?.headers);
    const u = String(url);
    if (u.endsWith('/thumb.jpg')) return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return new Response('no', { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('downloadLinkCardThumbnail', () => {
  test('サムネは <base>-linkcard.<ext> へダウンロードされる（記事ごとの個別ファイル）', async () => {
    const file = await downloadLinkCardThumbnail('https://pbs.twimg.com/card_img/1/thumb.jpg', tmp, 'cap-1');
    expect(file).toBe('cap-1-linkcard.jpg');
    expect(fs.existsSync(path.join(tmp, 'cap-1-linkcard.jpg'))).toBe(true);
  });

  test('Referer は一切付けない（プラットフォーム自身のCDNなので不要 — #181 セキュリティレビュー対応）', async () => {
    await downloadLinkCardThumbnail('https://pbs.twimg.com/card_img/1/thumb.jpg', tmp, 'cap-2');
    expect(seenHeaders).toEqual([undefined]);
  });

  test('取得失敗は null を返す（例外にしない）', async () => {
    const file = await downloadLinkCardThumbnail('https://pbs.twimg.com/card_img/1/missing.jpg', tmp, 'cap-3');
    expect(file).toBeNull();
  });
});
