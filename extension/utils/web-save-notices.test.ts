// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { installWebSaveNotices } from './web-save-notices.ts';

const ui = vi.hoisted(() => ({ begin: vi.fn(), end: vi.fn(), notice: vi.fn(), clearFailure: vi.fn() }));
vi.mock('./save-toasts.ts', () => ({
  SaveToasts: class {
    begin = ui.begin;
    end = ui.end;
    notice = ui.notice;
    clearFailure = ui.clearFailure;
  },
}));
let listener: (message: unknown, sender: unknown) => void;
const sendMessage = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension',
      sendMessage,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
  });
  installWebSaveNotices();
});
async function deliver(result?: unknown, sender = { id: 'extension' }) {
  listener({ type: 'webSaveNotice', token: 'opaque', url: 'https://example.com/post', result }, sender);
  await vi.waitFor(() => expect(ui.begin.mock.calls.length + ui.end.mock.calls.length).toBeGreaterThan(0));
}
test('保存中から成功へ同じ通知を更新する', async () => {
  await deliver();
  await deliver({ ok: true, metaOk: true });
  expect(ui.begin).toHaveBeenCalledWith('opaque');
  expect(ui.end).toHaveBeenCalledWith('opaque', true);
  expect(ui.notice).not.toHaveBeenCalled();
});
test('一部保存は元のページと保存内容を示し、URLではなく発行済みトークンで再試行する', async () => {
  await deliver({ ok: true, metaOk: false, acquisitionIssues: [{ scope: 'post', reason: 'invalidResponse' }], savedContent: { text: false, profile: false, media: 1 } });
  expect(ui.end).toHaveBeenCalledWith('opaque', false);
  expect(ui.notice).toHaveBeenCalledWith('opaque', '', expect.any(String), expect.any(Function), 'partial', { url: 'https://example.com/post', savedSummary: expect.any(String) });
  sendMessage.mockResolvedValue({ ok: true });
  ui.notice.mock.calls[0]![3]();
  expect(sendMessage).toHaveBeenCalledWith({ type: 'retryWebSave', token: 'opaque' });
});
test('拡張機能以外からの通知は表示しない', async () => {
  listener({ type: 'webSaveNotice', token: 'opaque' }, { id: 'other' });
  await Promise.resolve();
  expect(ui.begin).not.toHaveBeenCalled();
});
