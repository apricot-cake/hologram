// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ capture: vi.fn(), page: vi.fn(), i18n: vi.fn(), set: vi.fn() }));
vi.mock('./bulk-capture.ts', () => ({ startBulkCapture: mocks.capture }));
vi.mock('./extractor/index.ts', () => ({ getContentSite: () => ({ isBulkCapturePage: mocks.page }) }));
vi.mock('./i18n.ts', () => ({ createI18n: mocks.i18n }));
vi.mock('./status-surface.ts', () => ({
  StatusSurface: class {
    el = document.createElement('div');
    label = this.el.appendChild(document.createElement('div'));
    setState() {}
    slot(el: HTMLElement) {
      this.el.append(el);
    }
    mount() {
      document.body.append(this.el);
    }
    enter() {}
    remove() {
      this.el.remove();
    }
  },
}));

import { startBulkDiscovery } from './bulk-discovery.ts';
import { startBulkEntry } from './bulk-entry.ts';

beforeEach(() => {
  vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({}), set: mocks.set } } });
  mocks.set.mockResolvedValue(undefined);
  mocks.i18n.mockResolvedValue({ getMessage: (key: string) => key });
  history.replaceState(null, '', '/i/history');
});
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each(['page', 'i18n'] as const)('discovery teardownは待機中%s setupをcancelし、解決後も開始せずretryできる', async (stage) => {
  let finishSetup!: () => void;
  mocks.page.mockResolvedValue(true);
  if (stage === 'page') mocks.page.mockResolvedValueOnce(true).mockReturnValueOnce(new Promise<boolean>((resolve) => (finishSetup = () => resolve(true))));
  else {
    mocks.i18n.mockResolvedValueOnce({ getMessage: (key: string) => key }).mockReturnValueOnce(new Promise((resolve) => (finishSetup = () => resolve({ getMessage: (key: string) => key }))));
  }
  const cleanup = startBulkDiscovery();
  await vi.waitFor(() => expect(document.querySelector('[data-hologram-bulk-discovery]')).not.toBeNull());
  const start = [...document.querySelectorAll('button')].find((button) => button.textContent === 'bulkStart');
  if (!start) throw new Error('開始ボタンがありません');
  start.onclick?.call(start, { isTrusted: true, preventDefault() {}, stopPropagation() {} } as unknown as PointerEvent);
  cleanup();
  finishSetup();
  await expect(startBulkEntry()).resolves.toBe(true);
  expect(mocks.capture).toHaveBeenCalledOnce();
});
