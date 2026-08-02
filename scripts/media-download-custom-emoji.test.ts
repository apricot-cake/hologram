// downloadCustomEmojis (#290): the shared custom-emoji store, unit-tested
// in-process (no subprocess spawn needed -- media-download.cts is a plain
// module, same reasoning avatar-fill.test.ts gives for testing
// pixivRefererFor directly). fetch is stubbed (vi.stubGlobal), same
// convention as extractor-quoted.test.ts.
//
// What's checked:
//   1. A new emoji URL downloads into emoji/<hash>.<ext> and the descriptor's
//      `file` points at it.
//   2. A SECOND entry with the SAME url is not re-fetched (dedup by URL hash,
//      same store convention as downloadAvatar).
//   3. A malformed entry (no shortcode / no url) is skipped, not thrown on.
//   4. A failed fetch leaves that one entry's `file` null without dropping
//      the others or throwing (best-effort, same as every other download here).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { downloadCustomEmojis } from '../native-host/media-download.cts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let tmp: string;
let fetchCalls: string[];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-emoji-'));
  fetchCalls = [];
  vi.stubGlobal('fetch', async (url: unknown) => {
    const u = String(url);
    fetchCalls.push(u);
    if (u.endsWith('/ha_to.png')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    return new Response('no', { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('downloadCustomEmojis', () => {
  const hash = crypto.createHash('sha1').update('https://h.example/ha_to.png').digest('hex').slice(0, 16);

  test('新規URLは emoji/<hash>.<ext> へダウンロードされ file が埋まる', async () => {
    const out = await downloadCustomEmojis([{ shortcode: 'ha_to', url: 'https://h.example/ha_to.png' }], tmp);
    expect(out).toEqual([{ shortcode: 'ha_to', url: 'https://h.example/ha_to.png', file: `emoji/${hash}.png` }]);
    expect(fs.existsSync(path.join(tmp, 'emoji', `${hash}.png`))).toBe(true);
  });

  test('同じURLの2件目は再取得しない（共有ストアの重複排除）', async () => {
    const entries = [
      { shortcode: 'ha_to', url: 'https://h.example/ha_to.png' },
      { shortcode: 'ha_to_alt_name', url: 'https://h.example/ha_to.png' },
    ];
    const out = await downloadCustomEmojis(entries, tmp);
    expect(out.map((e) => e.file)).toEqual([`emoji/${hash}.png`, `emoji/${hash}.png`]);
    expect(fetchCalls.filter((u) => u.endsWith('/ha_to.png'))).toHaveLength(1);
  });

  test('shortcode か url が欠けたエントリはスキップする（例外にしない）', async () => {
    const out = await downloadCustomEmojis([{ shortcode: '', url: 'https://h.example/ha_to.png' }, { shortcode: 'no-url' }, null, 'not an object'] as any, tmp);
    expect(out).toEqual([]);
  });

  test('取得失敗のエントリは file: null になり、他のエントリや呼び出し自体は失敗しない', async () => {
    const out = await downloadCustomEmojis(
      [
        { shortcode: 'missing', url: 'https://h.example/does-not-exist.png' },
        { shortcode: 'ha_to', url: 'https://h.example/ha_to.png' },
      ],
      tmp,
    );
    expect(out).toEqual([
      { shortcode: 'missing', url: 'https://h.example/does-not-exist.png', file: null },
      { shortcode: 'ha_to', url: 'https://h.example/ha_to.png', file: `emoji/${hash}.png` },
    ]);
  });

  test('空・非配列は空配列を返す', async () => {
    expect(await downloadCustomEmojis([], tmp)).toEqual([]);
    expect(await downloadCustomEmojis(undefined, tmp)).toEqual([]);
    expect(await downloadCustomEmojis(null, tmp)).toEqual([]);
  });
});
