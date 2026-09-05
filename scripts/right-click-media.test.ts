// native host の右クリック画像保存のテスト。fetch は差し替えるので
// ネットワークは要らない。handleSaveMedia が、選ばれた画像を主画像 <base>.<ext>
// として落とすこと（JPEG 以外の形式でも）、media[] をその1枚にすること、API 由来のメタ
// データを保つこと、pixiv の Referer を送ること、失敗時に孤児を残さないことを見る。

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

// bridge.mts は読み込み時に configDir を解決するので、先に config.json を置いてから動的に
// import する（setup が用意した HOLOGRAM_CONFIG_DIR のサンドボックスを使う）。
let handleSaveMedia: any;
let saveFolder: string;

beforeAll(async () => {
  const configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  saveFolder = path.join(configDir, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  ({ handleSaveMedia } = await import('../native-host/bridge.mts'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('成功時', () => {
  let sentHeaders: any;
  let res: any;

  beforeAll(async () => {
    // 本物の Response を返す＝取得は本文をそのままディスクへ流す (#389)
    vi.stubGlobal('fetch', async (_url: string, opts: any) => {
      sentHeaders = opts?.headers;
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    });

    res = await handleSaveMedia({
      captureId: '1717500000000-ab01',
      mediaUrl: 'https://i.pximg.net/img-original/x/555_p0.png',
      mediaReferer: 'https://www.pixiv.net/',
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
    expect(res.file).toBe('items/1717500000000-ab01/1717500000000-ab01.png');
  });

  test('png と inbox エンベロープがディスクに書かれる（sidecar は書かれない）', () => {
    expect(fs.existsSync(path.join(saveFolder, 'items', '1717500000000-ab01', '1717500000000-ab01.png'))).toBe(true);
    expect(fs.existsSync(path.join(saveFolder, '1717500000000-ab01.json'))).toBe(false);
    expect(fs.existsSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000000-ab01.json'))).toBe(true);
  });

  // media は「落とした1枚」＝このレコードがどの絵を持っているかの記録 (#334)。呼び出し側が
  // 名乗った media[] を上書きする＝この保存が実際に持つのは、投稿全体ではなく指された1枚だけ。
  // ライトボックスは media があればそれを読み、無ければ image へ落ちる（records.ts の
  // artworkFile/groupFilesOf）ので、両者が同じ1枚を指していても重複は生まれない。
  test('レコードは image と、落とした1枚だけの media を持つ', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000000-ab01.json'), 'utf8'));
    expect(envelope.record.image).toBe('items/1717500000000-ab01/1717500000000-ab01.png');
    expect(envelope.record.media).toHaveLength(1);
    expect(envelope.record.media[0]).toMatchObject({ url: 'https://i.pximg.net/img-original/x/555_p0.png', file: 'items/1717500000000-ab01/1717500000000-ab01.png' });
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

    await expect(handleSaveMedia({ captureId: '1717500000001-ab02', mediaUrl: 'https://x/y', metadata: {} })).rejects.toThrow();
    expect(fs.existsSync(path.join(saveFolder, '1717500000001-ab02.json'))).toBe(false);
    expect(fs.existsSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000001-ab02.json'))).toBe(false);
    // 一時ファイルも残らない（この経路は本文を1バイトも書く前に失敗する）
    expect(fs.readdirSync(saveFolder).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
