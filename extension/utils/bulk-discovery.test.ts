// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startBulkDiscovery } from './bulk-discovery.ts';

vi.mock('./capture-log.ts', () => ({ logSaveEvent: mocks.log }));
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), start: vi.fn(), reserve: vi.fn(), log: vi.fn() }));
vi.mock('./bulk-entry.ts', () => ({ startBulkEntry: mocks.start, reserveBulkEntry: mocks.reserve }));
vi.mock('./extractor/index.ts', () => ({ getContentSite: () => ({ isBulkCapturePage: async () => true }) }));
vi.mock('./i18n.ts', () => ({ createI18n: async () => ({ getMessage: (key: string) => key }) }));
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

let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('chrome', { storage: { local: { get: mocks.get, set: mocks.set } } });
  mocks.get.mockResolvedValue({});
  mocks.set.mockResolvedValue(undefined);
  mocks.start.mockResolvedValue(undefined);
  mocks.reserve.mockImplementation(() => ({ owner: Symbol('test'), cancel: vi.fn() }));
  history.replaceState(null, '', '/i/history');
});
afterEach(() => {
  cleanup?.();
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function show() {
  cleanup = startBulkDiscovery();
  await vi.waitFor(() => expect(document.querySelector('[data-hologram-bulk-discovery]')).not.toBeNull());
}
function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent === text || el.getAttribute('aria-label') === text)!;
  button.onclick?.call(button, { isTrusted: true, preventDefault() {}, stopPropagation() {} } as unknown as PointerEvent);
}
it('履歴URLでもブックマークの案内と二つの操作を表示する', async () => {
  await show();
  expect(document.body.textContent).toContain('bulkIntro');
  expect(document.querySelector('.bulk-description')).toBeNull();
  expect(document.querySelector('.bulk-actions')?.children).toHaveLength(2);
  expect(mocks.start).not.toHaveBeenCalled();
});
it('閉じる操作では永続的な非表示設定を変更しない', async () => {
  await show();
  click('bulkCloseIntro');
  expect(document.querySelector('[data-hologram-bulk-discovery]')).toBeNull();
  expect(mocks.set).not.toHaveBeenCalled();
});
it('今後表示しないを保存する', async () => {
  await show();
  click('bulkNeverShow');
  expect(mocks.set).toHaveBeenCalledWith({ bulkDiscoveryDismissed: true });
  expect(mocks.start).not.toHaveBeenCalled();
});
it('開始操作だけが取り込みを開始する', async () => {
  await show();
  click('bulkStart');
  expect(mocks.start).toHaveBeenCalledOnce();
});
it('案内の初期化と開始の失敗は自分の catch から診断する', async () => {
  mocks.get.mockRejectedValueOnce(new Error('storage unavailable'));
  cleanup = startBulkDiscovery();
  await vi.waitFor(() => expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ error: 'storage unavailable', operation: 'bulk-discovery-check' })));
  cleanup();
  mocks.start.mockRejectedValueOnce(new Error('start unavailable'));
  await show();
  click('bulkStart');
  await vi.waitFor(() => expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ error: 'start unavailable', operation: 'bulk-discovery-start' })));
});
it('開始操作が競合しても一つの予約だけを起動する', async () => {
  await show();
  const firstCleanup = cleanup;
  if (!firstCleanup) throw new Error('最初の discovery cleanup が設定されていません');
  cleanup = startBulkDiscovery();
  await vi.waitFor(() => expect(document.querySelectorAll('[data-hologram-bulk-discovery]')).toHaveLength(2));
  const reservation = { owner: Symbol('test'), cancel: vi.fn() };
  mocks.reserve.mockReturnValueOnce(reservation).mockReturnValue(undefined);
  const starts = [...document.querySelectorAll('button')].filter((el) => el.textContent === 'bulkStart');
  for (const button of starts) {
    button.onclick?.call(button, { isTrusted: true, preventDefault() {}, stopPropagation() {} } as unknown as PointerEvent);
  }
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.start).toHaveBeenCalledWith(reservation);
  expect(reservation.cancel).not.toHaveBeenCalled();
  firstCleanup();
});
