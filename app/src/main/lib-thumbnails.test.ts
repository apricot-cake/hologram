import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { assetSecurityHeaders } from './asset-headers.ts';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  protocolHandler: null as ((request: Request) => Promise<Response>) | null,
  saveFolder: '',
}));
vi.mock('electron', () => ({
  protocol: {
    handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => {
      mocks.protocolHandler = handler;
    },
  },
}));
vi.mock('./lib-config.ts', () => ({ getSaveFolder: () => mocks.saveFolder || null }));
vi.mock('./image-processing.ts', () => ({ getPreparedImage: mocks.prepare }));
import { registerImageProtocol } from './lib-thumbnails.ts';
let dir: string;
let safePath: string;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hologram-asset-prepared-'));
  safePath = path.join(dir, 'safe-output.webp');
  await fs.writeFile(safePath, 'safe-derived-image');
  mocks.saveFolder = dir;
  mocks.prepare.mockResolvedValue({ path: safePath, mime: 'image/webp', width: 64, height: 64, frames: 1, avif: false });
  registerImageProtocol({ resolveInFolder: (relative) => (relative === 'forbidden.jpg' ? null : path.join(dir, relative)) });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
function request(name: string, query = '', init?: RequestInit) {
  return mocks.protocolHandler!(new Request(`asset://img/${encodeURIComponent(name)}${query ? '?' + query : ''}`, init));
}
function expectSecurity(response: Response) {
  for (const [header, value] of Object.entries(assetSecurityHeaders())) expect(response.headers.get(header)).toBe(value);
}

test.each(['jpg', 'png', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'svg'])('%s の原本を直接配信せず共通境界の出力を使う', async (extension) => {
  await fs.writeFile(path.join(dir, `input.${extension}`), 'untrusted-original');
  const response = await request(`input.${extension}`, 'w=64');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/webp');
  expect(await response.text()).toBe('safe-derived-image');
  expect(mocks.prepare).toHaveBeenCalledWith(path.join(dir, `input.${extension}`), { kind: 'thumbnail', width: 64, rotation: 0, flipped: false });
  expectSecurity(response);
});

test('幅なし GIF のアニメーションは preview の全フレーム出力を配信する', async () => {
  mocks.prepare.mockResolvedValue({ path: safePath, mime: 'image/webp', width: 100, height: 120, frames: 3, avif: false });
  const response = await request('animation.gif');
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('safe-derived-image');
  expect(mocks.prepare).toHaveBeenCalledWith(path.join(dir, 'animation.gif'), { kind: 'preview', rotation: 0, flipped: false });
});

test('AVIF の幅なし表示は検証済み snapshot の bytes と MIME を配信する', async () => {
  const snapshot = path.join(dir, 'validated-snapshot.avif');
  await fs.writeFile(snapshot, 'validated-avif-snapshot');
  await fs.writeFile(path.join(dir, 'animation.avif'), 'changed-original');
  mocks.prepare.mockResolvedValue({ path: snapshot, mime: 'image/avif', width: 100, height: 120, frames: 4, avif: true });
  const response = await request('animation.avif');
  expect(response.headers.get('content-type')).toBe('image/avif');
  expect(await response.text()).toBe('validated-avif-snapshot');
});

test.each(['', 'w=64'])('共通境界の拒否後は原本へ戻らない: %s', async (query) => {
  await fs.writeFile(path.join(dir, 'broken.png'), 'original-must-never-be-sent');
  mocks.prepare.mockResolvedValue(null);
  const response = await request('broken.png', query);
  expect(response.status).toBe(422);
  expect(await response.text()).toBe('Image unavailable');
  expectSecurity(response);
});

test('派生物の読み取りに失敗しても原本へ戻らない', async () => {
  await fs.writeFile(path.join(dir, 'image.png'), 'original-must-never-be-sent');
  await fs.unlink(safePath);
  const response = await request('image.png');
  expect(response.status).toBe(500);
  expectSecurity(response);
});

test.each(['w=', 'w=0', 'w=-1', 'w=721', 'w=64junk', 'w=64.5', 'w=6.4e1', 'w=%2064', 'w=%2B64', 'w=Infinity', 'w=9007199254740993', 'w=64&w=32', 'w=64&%77=64', 'rotate=45', 'rotate=90&rotate=180', 'flip=2', 'flip=1&flip=0'])('不正な query を復号前に拒否する: %s', async (query) => {
  const response = await request('image.png', query);
  expect(response.status).toBe(400);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expectSecurity(response);
});

test('回転・反転指定を共通境界へ渡す', async () => {
  expect((await request('image.png', 'rotate=270&flip=1')).status).toBe(200);
  expect(mocks.prepare).toHaveBeenCalledWith(path.join(dir, 'image.png'), { kind: 'preview', rotation: 270, flipped: true });
});

test('画像の Range と HEAD は安全な出力の寸法・bytes を使う', async () => {
  const partial = await request('image.png', '', { headers: { range: 'bytes=5-11' } });
  expect(partial.status).toBe(206);
  expect(partial.headers.get('content-range')).toBe('bytes 5-11/18');
  expect(await partial.text()).toBe('derived');
  const head = await request('image.png', '', { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(head.headers.get('content-length')).toBe('18');
  expect(await head.text()).toBe('');
  const unavailable = await request('image.png', '', { headers: { range: 'bytes=100-' } });
  expect(unavailable.status).toBe(416);
  expect(unavailable.headers.get('content-range')).toBe('bytes */18');
  expectSecurity(unavailable);
});

test.each(['mp4', 'webm', 'mov', 'm4v', 'zip'])('非画像 %s は不正な画像 query を無視して原本 Range を保持する', async (extension) => {
  await fs.writeFile(path.join(dir, `input.${extension}`), 'original-video');
  const response = await request(`input.${extension}`, 'w=invalid&w=64&rotate=45&flip=2', { headers: { range: 'bytes=9-13' } });
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 9-13/14');
  expect(await response.text()).toBe('video');
  expect(mocks.prepare).not.toHaveBeenCalled();
  expectSecurity(response);
});

test.each(['forbidden.jpg', 'missing.mp4'])('パス拒否と欠落応答も CSP を返す: %s', async (name) => {
  const response = await request(name);
  expect(response.status).toBe(name === 'forbidden.jpg' ? 403 : 500);
  expectSecurity(response);
});

test('保存先なしの応答も CSP を返す', async () => {
  mocks.saveFolder = '';
  const response = await request('image.jpg');
  expect(response.status).toBe(404);
  expectSecurity(response);
});
