// downloadLinkCardThumbnail（#181）＝OGP カードのサムネイル。同一プロセス内で
// 単体テストする（子プロセスを起こす必要は無い。media-download.mts はただの
// モジュールで、media-download-custom-emoji.test.ts と同じ理屈）。fetch は
// vi.stubGlobal で差し替える。これもそのファイルと同じ作法。
//
// 確かめること:
//   1. サムネイルは <base>-linkcard.<ext> へダウンロードされ、返るファイル名が
//      それを指す（共有の avatars/emoji ストアと違ってレコードごと。理由はこの
//      関数自身のコメントを参照）。
//   2. 取得に失敗したら例外を投げずに null を返す（ここの他のダウンロードと同じ
//      く、できる範囲で）。
//   3. Referer ヘッダを一切付けない＝#181 自身の設計点（カードのサムネイルは常に
//      プラットフォーム自身の CDN から来る。リンク先の記事のオリジンからは来ない
//      ので、オリジンをまたぐ Referer の漏れは起きえない）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { downloadLinkCardThumbnail } from './media-download.mts';

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
