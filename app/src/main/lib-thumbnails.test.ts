import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadURL: vi.fn(),
  executeJavaScript: vi.fn(),
  protocolHandler: null as ((request: Request) => Promise<Response>) | null,
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
  mocks.executeJavaScript.mockImplementation(async (script: string) => (script.includes('type: "image/png"') ? 'data:image/png;base64,b2s=' : 'data:image/jpeg;base64,b2s='));
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hologram-thumbnail-'));
  mocks.configDir = dir;
  mocks.saveFolder = dir;
  mocks.protocolHandler = null;
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test('委譲前に入力バイト数と復号ピクセル数を制限する', async () => {
  const tooLarge = path.join(dir, 'large.webp');
  const tooManyPixels = path.join(dir, 'pixels.png');
  await fs.writeFile(tooLarge, pngHeader(1, 1));
  await fs.truncate(tooLarge, 512 * 1024 * 1024 + 1);
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
  expect(script).toContain('new Image()');
  expect(script).toContain('small.png');
  expect(script).not.toContain(pngHeader(2, 3).toString('base64'));
  expect(script.length).toBeLessThan(2_000);
});

function jpegHeader(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function jpegWithLargeMetadata(width: number, height: number): Buffer {
  const segments: Buffer[] = [Buffer.from([0xff, 0xd8])];
  for (let i = 0; i < 5; i++) {
    const app = Buffer.alloc(65_535);
    app[0] = 0xff;
    app[1] = i % 2 ? 0xe1 : 0xe2;
    app.writeUInt16BE(65_533, 2);
    segments.push(app);
  }
  segments.push(jpegHeader(width, height).subarray(2));
  return Buffer.concat(segments);
}

async function requestThumbnail(name: string): Promise<Response> {
  registerImageProtocol({ resolveInFolder: (relative) => path.join(dir, relative) });
  expect(mocks.protocolHandler).not.toBeNull();
  return mocks.protocolHandler!(new Request(`asset:///${name}?w=64`));
}

test('総入力とピクセル予算を超える画像は Chromium 復号より前に拒否する', async () => {
  const huge = path.join(dir, 'huge.jpg');
  const pixels = path.join(dir, 'pixels.png');
  await fs.writeFile(huge, jpegHeader(1, 1));
  await fs.truncate(huge, 512 * 1024 * 1024 + 1);
  await fs.writeFile(pixels, pngHeader(10_000, 5_000));

  expect((await requestThumbnail('huge.jpg')).status).toBe(422);
  expect((await requestThumbnail('pixels.png')).status).toBe(422);
  expect(mocks.windows).toBe(0);
});

test('破損または復号失敗した画像を原画像の bytes へフォールバックしない', async () => {
  await fs.writeFile(path.join(dir, 'broken.jpg'), Buffer.from('not an image'));
  expect((await requestThumbnail('broken.jpg')).status).toBe(422);

  await fs.writeFile(path.join(dir, 'decode-failure.jpg'), jpegHeader(2, 3));
  mocks.executeJavaScript.mockResolvedValueOnce(null);
  const failed = await requestThumbnail('decode-failure.jpg');
  expect(failed.status).toBe(422);
  expect(await failed.text()).toBe('Thumbnail unavailable');
});

test('通常のアバター相当の JPEG は 64px サムネイルを返す', async () => {
  await fs.writeFile(path.join(dir, 'avatar.jpg'), jpegHeader(2, 3));
  const response = await requestThumbnail('avatar.jpg');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/jpeg');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('ok'));
});

test('25MiB を超えても総予算内の JPEG は安全な委譲経路で縮小する', async () => {
  const file = path.join(dir, 'large-valid.jpg');
  await fs.writeFile(file, jpegHeader(640, 480));
  await fs.truncate(file, 25 * 1024 * 1024 + 1);
  const response = await requestThumbnail('large-valid.jpg');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/jpeg');
  expect(mocks.executeJavaScript).toHaveBeenCalledOnce();
});

test('256KiB を超える JPEG metadata を増分走査して SOF を見つける', async () => {
  await fs.writeFile(path.join(dir, 'metadata.jpg'), jpegWithLargeMetadata(640, 480));
  expect((await requestThumbnail('metadata.jpg')).status).toBe(200);
  expect(mocks.executeJavaScript).toHaveBeenCalledOnce();
});

test('透過しうる PNG/WebP/SVG は PNG サムネイルとして返す', async () => {
  await fs.writeFile(path.join(dir, 'alpha.png'), pngHeader(2, 3));
  const response = await requestThumbnail('alpha.png');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(mocks.executeJavaScript.mock.calls[0][0]).toContain('type: "image/png"');
});

test('GIF はアニメーションを潰さず、検査済み原本を返す', async () => {
  const gif = Buffer.from('47494638396102000300800000000000ffffff2c00000000020003000002024401003b', 'hex');
  await fs.writeFile(path.join(dir, 'avatar.gif'), gif);
  const response = await requestThumbnail('avatar.gif');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/gif');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(gif);
  expect(mocks.executeJavaScript).not.toHaveBeenCalled();
});

test('animation WebP も静止 PNG へ潰さず、検査済み原本を返す', async () => {
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'ascii');
  webp.writeUInt32LE(22, 4);
  webp.write('WEBP', 8, 'ascii');
  webp.write('VP8X', 12, 'ascii');
  webp.writeUInt32LE(10, 16);
  webp[20] = 0x02;
  webp[24] = 1;
  webp[27] = 2;
  await fs.writeFile(path.join(dir, 'avatar.webp'), webp);
  const response = await requestThumbnail('avatar.webp');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/webp');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(webp);
  expect(mocks.executeJavaScript).not.toHaveBeenCalled();
});

test('SVG は寸法予算を検査し、文書ではなく img として PNG 化する', async () => {
  await fs.writeFile(path.join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><script>throw 1</script><rect width="32" height="24"/></svg>');
  const response = await requestThumbnail('icon.svg');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(mocks.loadURL.mock.calls[0][0]).toContain('decode-shell.html');
  expect(mocks.loadURL.mock.calls[0][0]).not.toContain('icon.svg');
  expect(mocks.executeJavaScript.mock.calls[0][0]).toContain('new Image()');

  await fs.writeFile(path.join(dir, 'huge.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="5000"/>');
  expect((await requestThumbnail('huge.svg')).status).toBe(422);
});
