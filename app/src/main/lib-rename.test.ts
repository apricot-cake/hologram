import fs from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';
import { renameWithoutOverwrite } from './lib-rename.ts';

const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
const locked = Object.assign(new Error('locked'), { code: 'EPERM' });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('Windows の一時的な移動拒否を待って再試行する', async () => {
  vi.useFakeTimers();
  const lstat = vi.spyOn(fs, 'lstat').mockRejectedValue(missing);
  const rename = vi
    .spyOn(fs, 'rename')
    .mockRejectedValueOnce(locked)
    .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))
    .mockResolvedValue(undefined);
  const result = renameWithoutOverwrite('source', 'destination', 'win32');
  await vi.runAllTimersAsync();
  await result;
  expect(rename).toHaveBeenCalledTimes(3);
  expect(lstat).toHaveBeenCalledTimes(3);
});

test('恒久的な移動拒否は3秒以内の待機で失敗を返す', async () => {
  vi.useFakeTimers();
  vi.spyOn(fs, 'lstat').mockRejectedValue(missing);
  const rename = vi.spyOn(fs, 'rename').mockRejectedValue(locked);
  const started = Date.now();
  const result = expect(renameWithoutOverwrite('source', 'destination', 'win32')).rejects.toBe(locked);
  await vi.runAllTimersAsync();
  await result;
  expect(Date.now() - started).toBe(3_000);
  expect(rename.mock.calls.length).toBeGreaterThan(1);
});

test('再試行中に宛先が作られたら上書きせず止める', async () => {
  vi.useFakeTimers();
  vi.spyOn(fs, 'lstat')
    .mockRejectedValueOnce(missing)
    .mockResolvedValue({} as Awaited<ReturnType<typeof fs.lstat>>);
  const rename = vi.spyOn(fs, 'rename').mockRejectedValue(locked);
  const result = expect(renameWithoutOverwrite('source', 'destination', 'win32')).rejects.toThrow('target already exists');
  await vi.runAllTimersAsync();
  await result;
  expect(rename).toHaveBeenCalledOnce();
});

test('Windows 以外の拒否と無関係な失敗は待たずに返す', async () => {
  vi.useFakeTimers();
  vi.spyOn(fs, 'lstat').mockRejectedValue(missing);
  const rename = vi.spyOn(fs, 'rename').mockRejectedValue(locked);
  await expect(renameWithoutOverwrite('source', 'destination', 'linux')).rejects.toBe(locked);
  expect(rename).toHaveBeenCalledOnce();
  rename.mockClear().mockRejectedValue(missing);
  await expect(renameWithoutOverwrite('source', 'destination', 'win32')).rejects.toBe(missing);
  expect(rename).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
