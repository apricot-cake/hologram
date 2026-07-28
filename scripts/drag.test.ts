// ネイティブホストのドラッグ保存（イラストレコード）テスト。fetch を差し替えるので
// ネットワーク不要。handleSaveDragged が、ドラッグされた画像を主画像 <base>.<ext>
// （JPEG 以外でも可）として落とし、media[] は空のまま、API 由来のメタデータを保ち、
// pixiv の Referer を送り、失敗時に孤児を残さないことを見る。

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

// bridge.cts は読み込み時に configDir を解決するので、config.json を先に置いてから
// 動的 import する（setup が用意した HOLOGRAM_CONFIG_DIR のサンドボックスを使う）。
let handleSaveDragged: any;
let saveFolder: string;

beforeAll(async () => {
  const configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  saveFolder = path.join(configDir, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  ({ handleSaveDragged } = await import('../native-host/bridge.cts'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('成功時', () => {
  let sentHeaders: any;
  let res: any;

  beforeAll(async () => {
    // 本物の Response を返す＝取得は本文をストリームで受けてディスクへ流す（#389）
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

  test('レコードは image を持ち、media は空（ライトボックスの重複を作らない）', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000000-ab01.json'), 'utf8'));
    expect(envelope.record.image).toBe('1717500000000-ab01.png');
    expect(envelope.record.media).toEqual([]);
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
    // 一時ファイルも残らない（本文を1バイトも書く前に落ちる経路）
    expect(fs.readdirSync(saveFolder).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
