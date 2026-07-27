// V2 — ブリッジによるオリジナルメディアの取得: 検証・ディスクへの書き込み・
// best-effort の取りこぼし・sidecar の `media[]`。global.fetch を差し替えてプロセス内で
// 走る（ネットワークも TLS も無し）。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

// 有効な 1x1 PNG（ブリッジが見るのは content-type だけ）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

const realFetch = global.fetch;
// 直近のリクエストを覚えておき、Referer（pixiv）を転送したかを見られるようにする
let lastFetch: { url: string; headers: any } | null = null;

let saveFolder: string;
let handleSave: any;
let downloadMedia: any;
let downloadAvatar: any;

beforeAll(async () => {
  const configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  saveFolder = path.join(configDir, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  // handleSave は自分で mkdir するが、downloadMedia を直接呼ぶ経路にも要る
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  global.fetch = (async (url: unknown, opts: any) => {
    const u = String(url);
    lastFetch = { url: u, headers: opts?.headers || null };
    if (u.endsWith('/img.png')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    if (u.endsWith('/photo.jpg')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    if (u.endsWith('/page.html')) return new Response('<html>no</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (u.endsWith('/big.png')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(99 * 1024 * 1024) } });
    if (u.endsWith('/clip.mp4')) return new Response(Buffer.from('fake-mp4-bytes'), { status: 200, headers: { 'content-type': 'video/mp4' } });
    if (u.endsWith('/huge.mp4')) return new Response(Buffer.from('fake-mp4-bytes'), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(300 * 1024 * 1024) } });
    if (u.endsWith('/poster.jpg')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } }); // 中身は問わない
    if (u.endsWith('/missing')) return new Response('nope', { status: 404 });
    return new Response('nope', { status: 500 });
  }) as typeof fetch;

  ({ handleSave, downloadMedia, downloadAvatar } = await import('../native-host/bridge.cts'));
});

afterAll(() => {
  global.fetch = realFetch;
});

const onDisk = (rel: string) => fs.existsSync(path.join(saveFolder, rel));

describe('downloadMedia: 有効な画像だけ残る', () => {
  const base = '1717500000000-aaaa';
  let saved: any[];

  beforeAll(async () => {
    saved = await downloadMedia(
      [
        { url: 'https://h/img.png', alt: 'pic', width: 1, height: 1 },
        { url: 'https://h/page.html', alt: null }, // content-type 違い → 落とす
        { url: 'https://h/photo.jpg', alt: null, width: 2, height: 3 },
        { url: 'https://h/big.png', alt: null }, // 申告サイズ超過 → 落とす
        { url: 'https://h/missing', alt: null }, // 404 → 落とす
        { url: 'http://h/img.png', alt: null }, // https でない → fetch すらしない
      ],
      saveFolder,
      base,
    );
  });

  test('残るのは2件', () => {
    expect(saved).toHaveLength(2);
  });

  test('残った2件がディスクに書かれる', () => {
    expect(onDisk(`${base}-media-0.png`)).toBe(true);
    expect(onDisk(`${base}-media-2.jpg`)).toBe(true);
  });

  test('落とした4件は1つもファイルを作らない', () => {
    const leaked = [`${base}-media-1.html`, `${base}-media-1.png`, `${base}-media-3.png`, `${base}-media-4.png`, `${base}-media-5.png`].filter(onDisk);
    expect(leaked).toEqual([]);
  });

  test('記述子が file・alt・寸法を運ぶ', () => {
    expect(saved[0]).toMatchObject({ file: `${base}-media-0.png`, alt: 'pic', width: 1 });
  });
});

// X/Misskey/Mastodon では動画は1投稿に高々1件なので、ケースごとに base を分ける
// （共有すると添字の無い <base>-poster.<ext> が衝突する）
describe('動画・GIF エントリ（#119 St1）', () => {
  test('動画: 本体とポスターの両方が書かれ、type/posterFile が記録される', async () => {
    const base = '1717500000000-vid1';
    const saved = await downloadMedia([{ url: 'https://h/clip.mp4', alt: 'clip', width: 100, height: 200, type: 'video', poster: 'https://h/poster.jpg' }], saveFolder, base);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ file: `${base}-media-0.mp4`, type: 'video', posterFile: `${base}-poster.jpg` });
    expect(onDisk(saved[0].file)).toBe(true);
    expect(onDisk(saved[0].posterFile)).toBe(true);
  });

  test('サイズ超過の動画は静止画へ降格する（ポスターが file になり type は付かない）', async () => {
    const base = '1717500000000-vid2';
    const saved = await downloadMedia([{ url: 'https://h/huge.mp4', alt: null, type: 'video', poster: 'https://h/poster.jpg' }], saveFolder, base);

    expect(saved).toHaveLength(1);
    expect(saved[0].file).toBe(`${base}-poster.jpg`);
    expect(saved[0].type).toBeUndefined();
    expect(onDisk(saved[0].file)).toBe(true);
  });

  test('ポスター URL の無い GIF は動画だけ保存し posterFile は付かない', async () => {
    const base = '1717500000000-vid3';
    const saved = await downloadMedia([{ url: 'https://h/clip.mp4', alt: null, type: 'gif' }], saveFolder, base);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ file: `${base}-media-0.mp4`, type: 'gif' });
    expect(saved[0].posterFile).toBeUndefined();
  });

  test('動画もポスターも失敗したら項目ごと落とす', async () => {
    const saved = await downloadMedia([{ url: 'https://h/missing', alt: null, type: 'video', poster: 'https://h/missing' }], saveFolder, '1717500000000-vid4');

    expect(saved).toHaveLength(0);
  });
});

describe('downloadAvatar（共有ストア avatars/<urlhash>.<ext>）', () => {
  const avHash = (u: string) => crypto.createHash('sha1').update(u).digest('hex').slice(0, 16);

  test('avatars/<urlhash>.jpg を書く', async () => {
    const avFile = await downloadAvatar('https://h/photo.jpg', undefined, saveFolder);

    expect(avFile).toBe(`avatars/${avHash('https://h/photo.jpg')}.jpg`);
    expect(onDisk(avFile)).toBe(true);
  });

  test('null は null', async () => {
    expect(await downloadAvatar(null, undefined, saveFolder)).toBeNull();
  });

  test('404 は null', async () => {
    expect(await downloadAvatar('https://h/missing', undefined, saveFolder)).toBeNull();
  });

  test('同じ URL は既存ファイルを使い回す（fetch しない）', async () => {
    const first = await downloadAvatar('https://h/photo.jpg', undefined, saveFolder);
    lastFetch = null;

    expect(await downloadAvatar('https://h/photo.jpg', undefined, saveFolder)).toBe(first);
    expect(lastFetch).toBeNull();
  });

  test('pixiv の Referer を転送する', async () => {
    await downloadAvatar('https://h/img.png', 'https://www.pixiv.net/', saveFolder);

    expect(lastFetch?.headers?.Referer).toBe('https://www.pixiv.net/');
  });
});

describe('handleSave（end-to-end）: inbox エンベロープは実際に落ちたものを映す', () => {
  let ack: any;
  let rec: any;

  beforeAll(async () => {
    ack = await handleSave({
      type: 'save',
      captureId: '1717500000000-bbbb',
      image: jpegB64,
      metadata: {
        url: 'https://x.com/u/status/1',
        platform: 'x',
        text: 'hi',
        avatar: 'https://h/img.png',
        media: [
          { url: 'https://h/img.png', alt: 'pic', width: 1, height: 1 },
          { url: 'https://h/missing', alt: null }, // 落ちるが保存自体は失敗させない
        ],
      },
    });
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', ack.file.replace(/\.jpg$/, '.json')), 'utf8'));
    rec = envelope.record;
  });

  test('メディア1件が失敗しても ack は ok・mediaCount は 1', () => {
    expect(ack).toMatchObject({ ok: true, mediaCount: 1 });
  });

  test('エンベロープの media は1件で、そのファイルが実在する', () => {
    expect(rec.media).toHaveLength(1);
    expect(onDisk(rec.media[0].file)).toBe(true);
  });

  test('スクリーンショットの jpg も書かれる', () => {
    expect(onDisk(ack.file)).toBe(true);
  });

  test('エンベロープの avatarFile が実在する', () => {
    expect(onDisk(rec.avatarFile)).toBe(true);
  });
});
