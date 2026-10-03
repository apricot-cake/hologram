// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ capture: vi.fn(), page: vi.fn(), i18n: vi.fn() }));
vi.mock('./bulk-capture.ts', () => ({ startBulkCapture: mocks.capture }));
vi.mock('./extractor/index.ts', () => ({ getContentSite: () => ({ isBulkCapturePage: mocks.page }) }));
vi.mock('./i18n.ts', () => ({ createI18n: mocks.i18n }));

import { reserveBulkEntry, startBulkEntry } from './bulk-entry.ts';

afterEach(() => {
  delete window.__snsPostSaveCleanup;
  vi.clearAllMocks();
});

it('setup中の二重activationを一つのsessionにまとめる', async () => {
  let finish!: (value: boolean) => void;
  mocks.page.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
  mocks.i18n.mockResolvedValue({ getMessage: vi.fn() });
  const first = startBulkEntry();
  const second = startBulkEntry();
  finish(true);
  expect(await Promise.all([first, second])).toEqual([true, false]);
  expect(mocks.capture).toHaveBeenCalledOnce();
});

it.each(['page', 'i18n'] as const)('%s setupのreject後に再試行できる', async (stage) => {
  mocks.page.mockResolvedValue(true);
  mocks.i18n.mockResolvedValue({ getMessage: vi.fn() });
  mocks[stage].mockRejectedValueOnce(new Error(`${stage} failed`));
  await expect(startBulkEntry()).rejects.toThrow(`${stage} failed`);
  await expect(startBulkEntry()).resolves.toBe(true);
  expect(mocks.capture).toHaveBeenCalledOnce();
});

it('実行中のsessionを二重activationで停止しない', async () => {
  const cleanup = vi.fn();
  window.__snsPostSaveCleanup = cleanup;
  await expect(startBulkEntry()).resolves.toBe(false);
  expect(cleanup).not.toHaveBeenCalled();
  expect(mocks.capture).not.toHaveBeenCalled();
});

it('setup中のuser cancelは起動せず次の開始を予約できる', async () => {
  let finish!: (value: boolean) => void;
  mocks.page.mockReturnValueOnce(new Promise<boolean>((resolve) => (finish = resolve))).mockResolvedValue(true);
  mocks.i18n.mockResolvedValue({ getMessage: vi.fn() });
  const reservation = reserveBulkEntry();
  if (!reservation) throw new Error('予約を取得できませんでした');
  const canceled = startBulkEntry(reservation);
  reservation.cancel();
  finish(true);
  await expect(canceled).resolves.toBe(false);
  await expect(startBulkEntry()).resolves.toBe(true);
  expect(mocks.capture).toHaveBeenCalledOnce();
});
