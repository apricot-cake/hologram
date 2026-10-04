import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { IpcContext } from './ipc-context.ts';
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), frame: vi.fn(), prepare: vi.fn() }));
vi.mock('./activity-ipc.ts', () => ({ ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler) } }));
vi.mock('./lib-archive.ts', () => ({ readUgoiraFrame: mocks.frame, ugoiraFramesPresent: vi.fn() }));
vi.mock('./image-processing.ts', () => ({ prepareImageBytes: mocks.prepare, getPreparedImage: vi.fn() }));
vi.mock('./lib-metadata-backfill.ts', () => ({ applyCachedMetadata: vi.fn() }));
import { register } from './ipc-posts.ts';
let directory: string;
let safeOutput: string;
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hologram-ugoira-safe-frame-'));
  safeOutput = path.join(directory, 'safe.png');
  await fs.writeFile(safeOutput, 'safe-frame-output');
  mocks.frame.mockResolvedValue(Buffer.from('untrusted-frame-input'));
  mocks.prepare.mockResolvedValue({ path: safeOutput, mime: 'image/png', width: 32, height: 48 });
  register({ resolveInFolder: (file: string) => path.join(directory, file) } as unknown as IpcContext);
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});
const readFrame = (file = 'animation.zip') => mocks.handlers.get('ugoira-frame')!(undefined, file, '000001.jpg');

test('うごイラの原本フレームは共通境界を通し派生 PNG とその実寸を返す', async () => {
  const result = await readFrame();
  expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('untrusted-frame-input'), { kind: 'copy' });
  expect(result).toEqual({ bytes: new Uint8Array(Buffer.from('safe-frame-output')), width: 32, height: 48 });
});

test.each([null, { path: 'original.avif', mime: 'image/avif', width: 32, height: 48 }])('フレーム変換失敗や原本 AVIF の応答を renderer へ渡さない', async (prepared) => {
  mocks.prepare.mockResolvedValue(prepared);
  expect(await readFrame()).toBeNull();
});

test('派生 PNG が欠落した場合も原本へ戻さない', async () => {
  await fs.unlink(safeOutput);
  expect(await readFrame()).toBeNull();
});

test('ZIP 以外をアーカイブフレームの入口へ渡さない', async () => {
  expect(await readFrame('image.jpg')).toBeNull();
  expect(mocks.frame).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});
