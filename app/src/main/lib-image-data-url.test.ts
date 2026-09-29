import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_IMAGE_DATA_URL_BYTES, readBoundedImageDataUrl } from './lib-image-data-url.ts';

const dirs: string[] = [];

function png(width: number, height: number, bytes = 24): Buffer {
  const result = Buffer.alloc(bytes);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(result);
  result.writeUInt32BE(13, 8);
  result.write('IHDR', 12, 'ascii');
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  return result;
}

async function fixture(contents: Buffer): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hologram-image-url-'));
  dirs.push(dir);
  const file = path.join(dir, 'image.png');
  await fs.promises.writeFile(file, contents);
  return file;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

describe('readBoundedImageDataUrl', () => {
  it('encodes an image within the byte and pixel budgets', async () => {
    const contents = png(1200, 800);
    const file = await fixture(contents);

    await expect(readBoundedImageDataUrl(file, 'image/png')).resolves.toBe(`data:image/png;base64,${contents.toString('base64')}`);
  });

  it('rejects an image whose decoded canvas would exceed the pixel budget', async () => {
    const file = await fixture(png(12000, 12000));

    await expect(readBoundedImageDataUrl(file, 'image/png')).resolves.toBeNull();
  });

  it('rejects an oversized file before reading it into memory', async () => {
    const file = await fixture(png(1200, 800));
    await fs.promises.truncate(file, MAX_IMAGE_DATA_URL_BYTES + 1);

    await expect(readBoundedImageDataUrl(file, 'image/png')).resolves.toBeNull();
  });
});
