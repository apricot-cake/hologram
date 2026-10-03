import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadURL: vi.fn(),
  executeJavaScript: vi.fn(),
  protocolHandler: null as ((request: Request) => Promise<Response>) | null,
  createFromPath: vi.fn(),
  configDir: '',
  saveFolder: '',
  windows: 0,
}));

vi.mock('electron', () => ({
  protocol: {
    handle: vi.fn((_scheme: string, handler: (request: Request) => Promise<Response>) => {
      mocks.protocolHandler = handler;
    }),
  },
  nativeImage: { createFromPath: mocks.createFromPath },
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

vi.mock('./native-host.ts', () => ({ configDir: () => mocks.configDir || os.tmpdir() }));
vi.mock('./lib-config.ts', () => ({ getSaveFolder: () => mocks.saveFolder || null }));

import { getDelegatedThumbnail, registerImageProtocol } from './lib-thumbnails.ts';

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
  mocks.configDir = dir;
  mocks.saveFolder = dir;
  mocks.protocolHandler = null;
  mocks.createFromPath.mockReturnValue({
    isEmpty: () => false,
    getSize: () => ({ width: 2, height: 3 }),
    resize: vi.fn(),
    toJPEG: () => Buffer.from('thumbnail'),
  });
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

function jpegHeader(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

async function requestThumbnail(name: string): Promise<Response> {
  registerImageProtocol({ resolveInFolder: (relative) => path.join(dir, relative) });
  expect(mocks.protocolHandler).not.toBeNull();
  return mocks.protocolHandler!(new Request(`asset:///${name}?w=64`));
}

test('PNG/JPEG は nativeImage の同期復号より前に共通予算で拒否する', async () => {
  const huge = path.join(dir, 'huge.jpg');
  const pixels = path.join(dir, 'pixels.png');
  await fs.writeFile(huge, jpegHeader(1, 1));
  await fs.truncate(huge, 25 * 1024 * 1024 + 1);
  await fs.writeFile(pixels, pngHeader(10_000, 5_000));

  expect((await requestThumbnail('huge.jpg')).status).toBe(422);
  expect((await requestThumbnail('pixels.png')).status).toBe(422);
  expect(mocks.createFromPath).not.toHaveBeenCalled();
});

test('破損または復号失敗した画像を原画像の bytes へフォールバックしない', async () => {
  await fs.writeFile(path.join(dir, 'broken.jpg'), Buffer.from('not an image'));
  expect((await requestThumbnail('broken.jpg')).status).toBe(422);
  expect(mocks.createFromPath).not.toHaveBeenCalled();

  await fs.writeFile(path.join(dir, 'decode-failure.jpg'), jpegHeader(2, 3));
  mocks.createFromPath.mockReturnValueOnce({ isEmpty: () => true });
  const failed = await requestThumbnail('decode-failure.jpg');
  expect(failed.status).toBe(422);
  expect(await failed.text()).toBe('Thumbnail unavailable');
});

test('通常のアバター相当の JPEG は 64px サムネイルを返す', async () => {
  await fs.writeFile(path.join(dir, 'avatar.jpg'), jpegHeader(2, 3));
  const response = await requestThumbnail('avatar.jpg');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/jpeg');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('thumbnail'));
});
