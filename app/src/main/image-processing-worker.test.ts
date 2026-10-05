import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMAGE_PROCESSING_LIMITS } from './image-processing-contract';
import { processImageRequest, validateImageMetadata } from './image-processing-worker';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hologram-image-worker-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function request(input: Buffer, kind: 'thumbnail' | 'preview' | 'copy', extra = {}) {
  const inputPath = join(directory, 'input');
  const outputPath = join(directory, 'output');
  await writeFile(inputPath, input);
  return processImageRequest({ id: 'case', inputPath, outputPath, kind, ...extra });
}

describe('画像処理の境界', () => {
  it('画素数、フレーム数、合計画素数を切り詰めず拒否する', () => {
    expect(() => validateImageMetadata({ format: 'png', width: 40_000_001, height: 1 })).toThrow('pixel-limit');
    expect(() => validateImageMetadata({ format: 'gif', width: 1, height: 1, pages: 1_001 })).toThrow('frame-limit');
    expect(() => validateImageMetadata({ format: 'gif', width: 40_000, height: 1, pageHeight: 1, pages: 1_000 })).not.toThrow();
    expect(() => validateImageMetadata({ format: 'webp', width: 40_000_000, height: 1, pageHeight: 1, pages: 11 })).toThrow('pixel-limit');
  });

  it('不正要求、AVIF、不正データを拒否し出力を作らない', async () => {
    expect(await processImageRequest({ id: 'case', kind: 'preview', inputPath: 'x', outputPath: 'y', rotation: 45 })).toEqual({ id: '', ok: false, code: 'invalid-request' });
    for (const input of [Buffer.from('xxxxftypavif'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]) {
      const result = await request(input, 'preview');
      expect(result.ok).toBe(false);
      await expect(readFile(join(directory, 'output'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('入力サイズ上限を先に拒否する', async () => {
    expect(await request(Buffer.alloc(IMAGE_PROCESSING_LIMITS.inputBytes + 1), 'copy')).toMatchObject({ ok: false, code: 'input-limit' });
  });

  it('既存の出力を上書きしたり削除したりしない', async () => {
    const original = Buffer.from('existing');
    await writeFile(join(directory, 'output'), original);
    const input = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#ff000080' } })
      .png()
      .toBuffer();
    expect(await request(input, 'copy')).toMatchObject({ ok: false, code: 'processing-failed' });
    expect(await readFile(join(directory, 'output'))).toEqual(original);
  });
});

describe('表示とコピー', () => {
  it('幅指定 copy は縦横とも上限内の静止 PNG、指定なしなら原寸にする', async () => {
    for (const [width, height] of [
      [320, 180],
      [180, 320],
    ]) {
      const pages = await Promise.all(
        ['#ff000080', '#0000ff80'].map((background) =>
          sharp({ create: { width, height, channels: 4, background } })
            .png()
            .toBuffer(),
        ),
      );
      const input = await sharp(pages, { join: { animated: true } })
        .webp({ lossless: true, delay: [100, 200] })
        .toBuffer();
      const bounded = await request(input, 'copy', { width: 72 });
      expect(bounded).toMatchObject({ ok: true, frames: 1, format: 'png' });
      if (bounded.ok) expect(Math.max(bounded.width, bounded.height)).toBe(72);
      const metadata = await sharp(join(directory, 'output')).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.pages ?? 1).toBe(1);
      const pixels = await sharp(join(directory, 'output')).ensureAlpha().raw().toBuffer();
      expect(Array.from(pixels.subarray(0, 4))).toEqual([255, 0, 0, 128]);
      await rm(join(directory, 'output'));
      expect(await request(input, 'copy')).toMatchObject({ ok: true, frames: 1, format: 'png', width, height });
      await rm(join(directory, 'output'));
    }
  });
  it.each([
    { width: 640, height: 360, targetWidth: 320, targetHeight: 180 },
    { width: 360, height: 640, targetWidth: 180, targetHeight: 320 },
    { width: 100, height: 50, targetWidth: 100, targetHeight: 50 },
  ])('thumbnail は短辺180を基準にして $width × $height を縮小する', async ({ width, height, targetWidth, targetHeight }) => {
    const input = await sharp({ create: { width, height, channels: 4, background: '#ff000080' } })
      .png()
      .toBuffer();
    expect(await request(input, 'thumbnail', { width: 180 })).toMatchObject({ ok: true, width: targetWidth, height: targetHeight });
    const { data, info } = await sharp(join(directory, 'output')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(targetWidth);
    expect(info.height).toBe(targetHeight);
    expect(data[3]).toBe(128);
    expect(data.at(-1)).toBe(128);
  });

  it('極端な縦横比の thumbnail は WebP 長辺上限を超えない', async () => {
    const input = await sharp({ create: { width: 2, height: 20_000, channels: 4, background: '#ff000080' } })
      .png()
      .toBuffer();
    const result = await request(input, 'thumbnail', { width: 180 });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(16_383);
  });
  it('BOM、XML 宣言付きの SVG を透過画像へ変換する', async () => {
    const input = Buffer.from('\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="2" height="2" fill="red"/></svg>');
    expect(await request(input, 'thumbnail')).toMatchObject({ ok: true, width: 4, height: 2, frames: 1 });
    const output = await sharp(join(directory, 'output')).ensureAlpha().raw().toBuffer();
    expect(Array.from(output.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    expect(output[15]).toBe(0);
  });

  it('巨大な SVG は縮小復号へ進めず拒否する', async () => {
    const input = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><rect width="100000" height="100000" fill="red"/></svg>');
    expect(await request(input, 'thumbnail', { width: 100 })).toMatchObject({ ok: false });
    await expect(readFile(join(directory, 'output'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('SVG の絶対・相対ファイル参照と HTTP 参照を読み込まない', async () => {
    const externalImage = await sharp({ create: { width: 4, height: 2, channels: 4, background: 'red' } })
      .png()
      .toBuffer();
    const externalPath = join(directory, 'external.png');
    await writeFile(externalPath, externalImage);
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(externalImage);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address');
    try {
      for (const href of [pathToFileURL(externalPath).href, 'external.png', `http://127.0.0.1:${address.port}/external.png`]) {
        const input = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="4" height="2" fill="#00ff00"/><image href="${href}" width="4" height="2"/></svg>`);
        expect(await request(input, 'preview')).toMatchObject({ ok: true });
        const output = await sharp(join(directory, 'output')).ensureAlpha().raw().toBuffer();
        expect(Array.from(output.subarray(0, 4))).toEqual([0, 255, 0, 255]);
        await rm(join(directory, 'output'));
      }
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
  it('WebP の 65,535ms を超えるフレーム時間を回転しても保持する', async () => {
    // FFmpeg 9.0 libwebp_anim で生成した 2 フレーム。独自 RIFF 編集は使わない。
    const input = Buffer.from('UklGRoQAAABXRUJQVlA4WAoAAAACAAAAAwAAAQAAQU5JTQYAAAD/////AwBBTk1GKAAAAAAAAAAAAAMAAAEAAJBfAQJWUDhMDwAAAC8DQAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAMAAAEAACC/AgBWUDhMDwAAAC8DQAAABxDR//4HIqL/AQA=', 'base64');
    for (const rotation of [0, 90, 270]) {
      const result = await request(input, 'preview', { rotation });
      expect(result).toMatchObject({ ok: true, frames: 2, delay: [90_000, 180_000], loop: 3 });
      const metadata = await sharp(join(directory, 'output'), { animated: true }).metadata();
      expect(metadata.delay).toEqual([90_000, 180_000]);
      expect(metadata.loop).toBe(3);
      expect(metadata.pages).toBe(2);
      expect(metadata.pageHeight).toBe(rotation ? 4 : 2);
      await rm(join(directory, 'output'));
    }
  });
  it.each([
    { rotation: 0, order: [2, 1, 0, 5, 4, 3] },
    { rotation: 90, order: [0, 3, 1, 4, 2, 5] },
    { rotation: 180, order: [3, 4, 5, 0, 1, 2] },
    { rotation: 270, order: [5, 2, 4, 1, 3, 0] },
  ])('回転 $rotation 度の後に表示座標で左右反転する', async ({ rotation, order }) => {
    // 赤 緑 青 / 白 黒 透明。期待位置は表示側の S×R 行列に合わせる。
    const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0]);
    const input = await sharp(pixels, { raw: { width: 3, height: 2, channels: 4 } })
      .png()
      .toBuffer();
    const vertical = rotation === 90 || rotation === 270;
    expect(await request(input, 'copy', { rotation, flipped: true })).toMatchObject({ ok: true, width: vertical ? 2 : 3, height: vertical ? 3 : 2 });
    const output = await sharp(join(directory, 'output')).ensureAlpha().raw().toBuffer();
    expect(Array.from(output)).toEqual(order.flatMap((index) => Array.from(pixels.subarray(index * 4, index * 4 + 4))));
  });

  it('縦長の画像を WebP の寸法上限内に収める', async () => {
    const input = await sharp({ create: { width: 2, height: 20_000, channels: 4, background: 'red' } })
      .png()
      .toBuffer();
    const result = await request(input, 'preview');
    expect(result).toMatchObject({ ok: true, frames: 1 });
    if (result.ok) expect(result.height).toBeLessThanOrEqual(16_383);
  });
  it('透過 PNG のコピーは透過を保った静止 PNG になる', async () => {
    const input = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#ff000080' } })
      .png()
      .toBuffer();
    const result = await request(input, 'copy', { rotation: 90 });
    expect(result).toMatchObject({ ok: true, format: 'png', width: 2, height: 3, frames: 1 });
    const { data } = await sharp(join(directory, 'output')).raw().toBuffer({ resolveWithObject: true });
    expect(Array.from(data).filter((_value, index) => index % 4 === 3)).toEqual([128, 128, 128, 128, 128, 128]);
  });

  it('JPEG の EXIF 回転を適用してメタデータを除く', async () => {
    const input = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(await request(input, 'preview')).toMatchObject({ ok: true, width: 2, height: 3 });
    expect((await sharp(join(directory, 'output')).metadata()).orientation).toBeUndefined();
  });

  it('EXIF の回転にユーザーの回転を追加する', async () => {
    const pixels = Buffer.alloc(60 * 40 * 3);
    const colors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
      [0, 0, 0],
      [255, 255, 0],
    ];
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 60; x++) pixels.set(colors[Math.floor(y / 20) * 3 + Math.floor(x / 20)], (y * 60 + x) * 3);
    }
    const input = await sharp(pixels, { raw: { width: 60, height: 40, channels: 3 } })
      .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(await request(input, 'copy', { rotation: 90 })).toMatchObject({ ok: true, width: 60, height: 40 });
    const output = await sharp(join(directory, 'output')).ensureAlpha().raw().toBuffer();
    const topLeft = Array.from(output.subarray((10 * 60 + 10) * 4, (10 * 60 + 10) * 4 + 3));
    expect(topLeft[0]).toBeGreaterThan(250);
    expect(topLeft[1]).toBeGreaterThan(250);
    expect(topLeft[2]).toBeLessThan(5);
  });

  it.each(['gif', 'webp'] as const)('%s の全フレーム、時間、ループ、回転と透過を保つ', async (format) => {
    const pages = await Promise.all(
      ['#ff000080', '#00ff0080', '#0000ff80'].map((background) =>
        sharp({ create: { width: 4, height: 2, channels: 4, background } })
          .png()
          .toBuffer(),
      ),
    );
    const encoder = sharp(pages, { join: { animated: true } });
    const input = await (format === 'gif' ? encoder.gif({ delay: [100, 200, 300], loop: 3 }) : encoder.webp({ lossless: true, delay: [100, 200, 300], loop: 3 })).toBuffer();
    expect(await request(input, 'preview', { rotation: 90, flipped: true })).toMatchObject({ ok: true, width: 2, height: 4, frames: 3, delay: [100, 200, 300], loop: 3 });
    const output = await sharp(join(directory, 'output'), { animated: true }).metadata();
    expect(output.pages).toBe(3);
    expect(output.pageHeight).toBe(4);
    expect(output.delay).toEqual([100, 200, 300]);
    expect(output.loop).toBe(3);
    for (let page = 0; page < 3; page++) {
      const { data, info } = await sharp(join(directory, 'output'), { page, pages: 1 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(2);
      expect(info.height).toBe(4);
      expect(data[page]).toBe(255);
      expect(data[(page + 1) % 3]).toBe(0);
      // GIF は半透明を持てないので、入力 GIF 自体のアルファと比較する。
      const original = await sharp(input, { page, pages: 1 }).ensureAlpha().raw().toBuffer();
      expect(data[3]).toBe(original[3]);
    }
  });

  it.each(['gif', 'webp'] as const)('%s の thumbnail は縮小・回転しても全フレームと再生条件を保持する', async (format) => {
    const pages = await Promise.all(
      ['#ff000080', '#00ff0080', '#0000ff80'].map((background) =>
        sharp({ create: { width: 320, height: 180, channels: 4, background } })
          .png()
          .toBuffer(),
      ),
    );
    const encoder = sharp(pages, { join: { animated: true } });
    const input = await (format === 'gif' ? encoder.gif({ delay: [100, 200, 300], loop: 3 }) : encoder.webp({ lossless: true, delay: [100, 200, 300], loop: 3 })).toBuffer();
    expect(await request(input, 'thumbnail', { width: 90, rotation: 90, flipped: true })).toMatchObject({ ok: true, width: 90, height: 160, frames: 3, delay: [100, 200, 300], loop: 3 });
    const outputMetadata = await sharp(join(directory, 'output'), { animated: true }).metadata();
    expect(outputMetadata).toMatchObject({ pages: 3, width: 90, pageHeight: 160, delay: [100, 200, 300], loop: 3 });
    for (let page = 0; page < 3; page++) {
      const { data, info } = await sharp(join(directory, 'output'), { page, pages: 1 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(info).toMatchObject({ width: 90, height: 160 });
      expect(data[page]).toBe(255);
      expect(data[(page + 1) % 3]).toBe(0);
      const original = await sharp(input, { page, pages: 1 }).ensureAlpha().raw().toBuffer();
      expect(data[3]).toBe(original[3]);
      expect(data.at(-1)).toBe(original[3]);
    }
  });

  it('アニメーションの thumbnail は全フレーム、copy は先頭フレームを生成する', async () => {
    const pages = await Promise.all(
      ['red', 'blue'].map((background) =>
        sharp({ create: { width: 4, height: 2, channels: 4, background } })
          .png()
          .toBuffer(),
      ),
    );
    const input = await sharp(pages, { join: { animated: true } })
      .webp({ lossless: true, delay: [100, 200] })
      .toBuffer();
    expect(await request(input, 'thumbnail', { width: 2 })).toMatchObject({ ok: true, frames: 2, width: 4, height: 2, delay: [100, 200] });
    expect((await sharp(join(directory, 'output'), { animated: true }).metadata()).pages).toBe(2);
    await rm(join(directory, 'output'));
    expect(await request(input, 'copy')).toMatchObject({ ok: true, frames: 1, format: 'png' });
    const output = await sharp(join(directory, 'output')).raw().toBuffer();
    expect(Array.from(output.subarray(0, 3))).toEqual([255, 0, 0]);
  });
});
