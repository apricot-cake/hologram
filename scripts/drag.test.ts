// Test for the native host's drag-save (illustration record). fetch is swapped
// out, so no network needed. Checks that handleSaveDragged drops the dragged
// image as the main image <base>.<ext> (even for non-JPEG formats), leaves
// media[] empty, preserves API-sourced metadata, sends pixiv's Referer, and leaves no orphan on failure.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

// Since bridge.mts resolves configDir at load time, place config.json first and
// then do a dynamic import (using the HOLOGRAM_CONFIG_DIR sandbox that setup prepared).
let handleSaveDragged: any;
let saveFolder: string;

beforeAll(async () => {
  const configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  saveFolder = path.join(configDir, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  ({ handleSaveDragged } = await import('../native-host/bridge.mts'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('成功時', () => {
  let sentHeaders: any;
  let res: any;

  beforeAll(async () => {
    // Returns a real Response = fetching streams the body straight to disk (#389)
    vi.stubGlobal('fetch', async (_url: string, opts: any) => {
      sentHeaders = opts?.headers;
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    });

    res = await handleSaveDragged({
      captureId: '1717500000000-ab01',
      imageUrl: 'https://i.pximg.net/img-original/x/555_p0.png',
      imageReferer: 'https://www.pixiv.net/',
      metadata: {
        url: 'https://www.pixiv.net/artworks/555',
        platform: 'pixiv',
        title: 'T',
        screenName: '77',
        hashtags: ['a'],
        tags: [],
        likes: 5,
        media: [{ url: 'should-be-overridden' }],
      },
    });
  });

  test('ack が返る', () => {
    expect(res.ok).toBe(true);
  });

  test('主画像は <base>.png（JPEG 以外でも）', () => {
    expect(res.file).toBe('1717500000000-ab01.png');
  });

  test('png と inbox エンベロープがディスクに書かれる（sidecar は書かれない）', () => {
    expect(fs.existsSync(path.join(saveFolder, '1717500000000-ab01.png'))).toBe(true);
    expect(fs.existsSync(path.join(saveFolder, '1717500000000-ab01.json'))).toBe(false);
    expect(fs.existsSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000000-ab01.json'))).toBe(true);
  });

  // media is "the one picture that was dropped" = a record of which picture
  // this record holds (#334). It overrides whatever media[] the caller
  // announced = what this save actually has is only the one pointed-to
  // picture, not the whole post. Since the lightbox reads media if present and
  // falls back to image otherwise (records.ts's artworkFile/groupFilesOf), the
  // two pointing at the same single picture never create a duplicate.
  test('レコードは image と、落とした1枚だけの media を持つ', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000000-ab01.json'), 'utf8'));
    expect(envelope.record.image).toBe('1717500000000-ab01.png');
    expect(envelope.record.media).toHaveLength(1);
    expect(envelope.record.media[0]).toMatchObject({ url: 'https://i.pximg.net/img-original/x/555_p0.png', file: '1717500000000-ab01.png' });
  });

  test('ack はその絵の URL を返す（保存直後のバッジが絵単位で答えられる）', () => {
    expect(res.media).toEqual(['https://i.pximg.net/img-original/x/555_p0.png']);
  });

  test('API 由来のメタデータが保たれる', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000000-ab01.json'), 'utf8'));
    expect(envelope.record).toMatchObject({ platform: 'pixiv', title: 'T', screenName: '77', likes: 5 });
  });

  test('主画像のダウンロードに pixiv の Referer を付ける', () => {
    expect(sentHeaders.Referer).toBe('https://www.pixiv.net/');
  });
});

describe('失敗時', () => {
  test('未対応の content-type は throw し、孤児 inbox エンベロープを残さない', async () => {
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('x'), { status: 200, headers: { 'content-type': 'text/html' } }));

    await expect(handleSaveDragged({ captureId: '1717500000001-ab02', imageUrl: 'https://x/y', metadata: {} })).rejects.toThrow();
    expect(fs.existsSync(path.join(saveFolder, '1717500000001-ab02.json'))).toBe(false);
    expect(fs.existsSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000001-ab02.json'))).toBe(false);
    // No temp file is left behind either (this path fails before writing even one byte of the body)
    expect(fs.readdirSync(saveFolder).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
