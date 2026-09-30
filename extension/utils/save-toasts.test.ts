// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SaveToasts } from './save-toasts.ts';
import { createI18n } from './i18n.ts';
import { Check, LoaderCircle, X, createElement } from 'lucide';
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
  expect(document.body.textContent).toContain('保存中 1件');
  toasts.end('b', true);
  expect(document.body.textContent).toContain('2件保存しました');
  vi.advanceTimersByTime(1999);
  expect(document.querySelector('[data-hologram-save-progress]')).not.toBeNull();
  vi.advanceTimersByTime(1);
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
  expect(document.querySelector('[data-hologram-save-banner] .label')?.textContent).toBe('2件保存できませんでした');
  expect(document.querySelector<HTMLElement>('[data-hologram-toast-details]')?.hidden).toBe(true);
  (document.querySelector('.toast-details-toggle') as HTMLButtonElement).click();
  expect(document.querySelector<HTMLElement>('[data-hologram-toast-details]')?.hidden).toBe(false);
  const retry = document.querySelector('.toast-failure button') as HTMLButtonElement;
  retry.click();
  retry.click();
  expect(retryA).toHaveBeenCalledTimes(1);
  expect(retryB).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('アプリに接続できません');
  expect(document.querySelector<HTMLElement>('[data-hologram-toast-details]')?.hidden).toBe(false);
});

test('詳細は通知を置き換え、閉じると通知全体が消える', () => {
  toasts.notice('a', '投稿A', '動画を保存できませんでした', undefined, 'partial', { url: 'https://example.com/post/1', savedSummary: '本文は保存済み' });
  const toggle = document.querySelector<HTMLButtonElement>('.toast-details-toggle')!;
  const panel = document.querySelector<HTMLElement>('[data-hologram-toast-details]')!;
  toggle.click();
  expect(panel.hidden).toBe(false);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector<HTMLElement>('[data-hologram-save-banner]')?.hidden).toBe(true);
  expect(panel.textContent).toContain('本文は保存済み');
  expect(panel.textContent).not.toContain('投稿A');
  expect(panel.querySelector('a')?.href).toBe('https://example.com/post/1');
  panel.querySelector<HTMLButtonElement>('.toast-close')!.click();
  expect(document.querySelector('[data-hologram-toast-details]')).toBeNull();
  expect(document.querySelector('[data-hologram-save-banner]')).toBeNull();
});
test('自動再試行待ちはエラーにせず、手動再試行を出さない', () => {
  toasts.notice('queued', '', '接続が戻るまで保存を待機しています', undefined, 'idle');
  vi.advanceTimersByTime(60);
  expect(document.querySelector('[role=status]')?.textContent).toContain('保存を待機');
  expect(document.body.textContent).not.toContain('再試行');
  vi.advanceTimersByTime(1939);
  expect(document.querySelector('[data-hologram-save-banner]')).not.toBeNull();
  vi.advanceTimersByTime(1);
  expect(document.querySelector('[data-hologram-save-banner]')).toBeNull();
});

test('一部保存は登録後に読み上げ、詳細へフォーカスを移す', () => {
  toasts.notice('partial', '', '動画を保存できませんでした', undefined, 'partial', { url: 'https://example.com/post' });
  const surface = document.querySelector<HTMLElement>('[data-hologram-save-banner]')!;
  expect(surface.getAttribute('role')).toBe('status');
  expect(surface.querySelector('.label')?.textContent).toBe('');
  vi.advanceTimersByTime(50);
  expect(surface.querySelector('.label')?.textContent).toBe('動画を保存できませんでした');
  surface.querySelector<HTMLButtonElement>('.toast-details-toggle')!.click();
  expect(document.activeElement).toBe(document.querySelector('[data-hologram-toast-details] .toast-close'));
});

test('更新案内は保存失敗の件数に混ぜず、操作案内を直接表示する', () => {
  toasts.notice('save', '', '保存できませんでした', vi.fn(), 'error', { url: 'https://example.com/post' });
  toasts.notice('reload', '', 'ページを再読み込みしてください');
  vi.advanceTimersByTime(50);
  expect(document.querySelectorAll('[data-hologram-save-banner]')).toHaveLength(2);
  expect(document.body.textContent).toContain('ページを再読み込みしてください');
  expect(document.body.textContent).not.toContain('2件保存できませんでした');
});

test('保存中は消さず、最後の保存完了から2秒後に消す', () => {
  toasts.begin('a');
  vi.advanceTimersByTime(10000);
  expect(document.querySelector('[data-hologram-save-progress]')).not.toBeNull();
  toasts.end('a', true);
  vi.advanceTimersByTime(500);
  toasts.begin('b');
  vi.advanceTimersByTime(1000);
  expect(document.body.textContent).toContain('保存中 1件');
  toasts.end('b', true);
  vi.advanceTimersByTime(1999);
  expect(document.querySelector('[data-hologram-save-progress]')).not.toBeNull();
  vi.advanceTimersByTime(1);
  expect(document.querySelector('[data-hologram-save-progress]')).toBeNull();
});

test('保存中と成功には閉じるボタンを表示せず、読み上げ用の文言は一つにする', () => {
  toasts.begin('focus');
  expect(document.querySelector('[data-hologram-save-progress] button')).toBeNull();
  toasts.end('focus', true);
  expect(document.querySelector('[data-hologram-save-progress] button')).toBeNull();
  expect(document.querySelectorAll('[data-hologram-save-progress] .label > span:not([aria-hidden])')).toHaveLength(1);
  vi.advanceTimersByTime(2000);
  expect(document.querySelector('[data-hologram-save-progress]')).toBeNull();
});

test('保存中・成功・失敗・閉じるに Lucide を表示する', () => {
  toasts.begin('icon-test');
  expect(document.querySelector('[data-hologram-save-progress] .badge svg')?.innerHTML).toBe(createElement(LoaderCircle).innerHTML);
  toasts.end('icon-test', true);
  expect(document.querySelector('[data-hologram-save-progress] .badge svg')?.innerHTML).toBe(createElement(Check).innerHTML);
  toasts.notice('failure', '', '保存できませんでした');
  expect(document.querySelector('[data-hologram-save-banner] .toast-close svg')?.innerHTML).toBe(createElement(X).innerHTML);
  expect(document.querySelector('[data-hologram-save-banner] .badge svg')?.innerHTML).toBe(createElement(X).innerHTML);
});
