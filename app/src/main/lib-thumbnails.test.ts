import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadURL: vi.fn(),
  executeJavaScript: vi.fn(),
  windows: 0,
}));

vi.mock('electron', () => ({
  protocol: { handle: vi.fn() },
  nativeImage: {},
  BrowserWindow: class {
    webContents = { executeJavaScript: mocks.executeJavaScript };
    constructor() {
      mocks.windows += 1;
    }
    loadURL = mocks.loadURL;
    isDestroyed = () => false;
    destroy = vi.fn();
  },
}));

vi.mock('./native-host.ts', () => ({ configDir: () => os.tmpdir() }));
vi.mock('./lib-config.ts', () => ({ getSaveFolder: () => null }));

import { getDelegatedThumbnail } from './lib-thumbnails.ts';

let dir: string;

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.windows = 0;
  mocks.loadURL.mockResolvedValue(undefined);
  mocks.executeJavaScript.mockResolvedValue('data:image/jpeg;base64,b2s=');
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hologram-thumbnail-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test('委譲前に入力バイト数と復号ピクセル数を制限する', async () => {
  const tooLarge = path.join(dir, 'large.webp');
  const tooManyPixels = path.join(dir, 'pixels.png');
  await fs.writeFile(tooLarge, pngHeader(1, 1));
  await fs.truncate(tooLarge, 25 * 1024 * 1024 + 1);
  await fs.writeFile(tooManyPixels, pngHeader(10_000, 5_000));

  await expect(getDelegatedThumbnail(tooLarge, 180)).resolves.toBeNull();
  await expect(getDelegatedThumbnail(tooManyPixels, 180)).resolves.toBeNull();
  expect(mocks.windows).toBe(0);
  expect(mocks.executeJavaScript).not.toHaveBeenCalled();
});

test('許容画像はファイルURLで読み、ファイル本体をスクリプトへ埋め込まない', async () => {
  const image = path.join(dir, 'small.png');
  await fs.writeFile(image, pngHeader(2, 3));

  await expect(getDelegatedThumbnail(image, 180)).resolves.toEqual(Buffer.from('ok'));
  expect(mocks.loadURL).toHaveBeenCalledWith(expect.stringMatching(/^file:/));
  const script = mocks.executeJavaScript.mock.calls[0][0] as string;
  expect(script).toContain('document.images[0]');
  expect(script).not.toContain(image);
  expect(script).not.toContain(pngHeader(2, 3).toString('base64'));
  expect(script.length).toBeLessThan(2_000);
});
