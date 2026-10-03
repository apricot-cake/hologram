// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startBulkEntry } from './bulk-entry.ts';

const mocks = vi.hoisted(() => ({ isBulkCapturePage: vi.fn(), start: vi.fn() }));
vi.mock('./bulk-capture.ts', () => ({ startBulkCapture: mocks.start }));
vi.mock('./extractor/index.ts', () => ({
  getContentSite: () => ({ platform: 'x', isBulkCapturePage: mocks.isBulkCapturePage }),
}));
vi.mock('./i18n.ts', () => ({ createI18n: async () => ({ getMessage: (key: string) => key }) }));

beforeEach(() => {
  delete window.__snsPostSaveCleanup;
  window.__snsPostSaveActive = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

it('非同期のページ判定中でも二度目の起動が保留中のセッションを停止する', async () => {
  let resolvePage!: (value: boolean) => void;
  mocks.isBulkCapturePage.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      resolvePage = resolve;
    }),
  );

  const first = startBulkEntry();
  expect(window.__snsPostSaveActive).toBe(true);
  expect(window.__snsPostSaveCleanup).toBeTypeOf('function');

  await startBulkEntry();
  resolvePage(true);
  await first;

  expect(mocks.start).not.toHaveBeenCalled();
  expect(window.__snsPostSaveActive).toBe(false);
  expect(window.__snsPostSaveCleanup).toBeUndefined();
});
