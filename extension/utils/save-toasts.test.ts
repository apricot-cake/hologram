// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SaveToasts } from './save-toasts.ts';
import { createI18n } from './i18n.ts';
vi.mock('./ui-root.ts', () => ({ ensureUiRoot: () => document.body }));
vi.mock('./tokens.ts', () => ({ prefersReducedMotion: () => true, motion: {}, token: () => '' }));
vi.mock('./user-gesture.ts', () => ({ userOnly: (handler: unknown) => handler }));
let toasts: SaveToasts;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { language: 'ja-JP' });
  document.body.replaceChildren();
  toasts = new SaveToasts((await createI18n()).getMessage);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test('並行保存を一つに集約し、重複した完了を数えない', () => {
  toasts.begin('a');
  toasts.begin('b');
  expect(document.querySelectorAll('[data-hologram-save-progress]')).toHaveLength(1);
  expect(document.body.textContent).toContain('保存中 2件');
  toasts.end('a', true);
  toasts.end('a', true);
  expect(document.body.textContent).toContain('保存中 1件 · 完了 1件');
  toasts.end('b', true);
  expect(document.body.textContent).toContain('2件保存しました');
  vi.advanceTimersByTime(3500);
  expect(document.querySelector('[data-hologram-save-progress]')).toBeNull();
});
test('失敗は成功と分離し、時間が経っても残り、該当分だけ再試行する', () => {
  const retryA = vi.fn(),
    retryB = vi.fn();
  toasts.begin('ok');
  toasts.end('ok', true);
  toasts.notice('a', '投稿A', '保存できませんでした', retryA);
  toasts.notice('b', '投稿B', 'アプリに接続できません', retryB);
  vi.advanceTimersByTime(10000);
  expect(document.querySelectorAll('[data-hologram-save-banner]')).toHaveLength(1);
  expect(document.querySelector('summary')?.textContent).toBe('失敗 2件');
  const retry = document.querySelector('.toast-failure button') as HTMLButtonElement;
  retry.click();
  retry.click();
  expect(retryA).toHaveBeenCalledTimes(1);
  expect(retryB).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('投稿B');
});
test('自動再試行待ちはエラーにせず、手動再試行を出さない', () => {
  toasts.notice('queued', '', '接続が戻るまで保存を待機しています', undefined, 'idle');
  vi.advanceTimersByTime(60);
  expect(document.querySelector('[role=status]')?.textContent).toContain('保存を待機');
  expect(document.body.textContent).not.toContain('再試行');
});
