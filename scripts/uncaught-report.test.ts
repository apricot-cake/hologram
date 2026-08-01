// #727: uncaught exceptions / unhandled rejections are self-reported into
// capture.log's `unknown` stage, because their only other home — the
// chrome://extensions error console — cannot be read programmatically at all.
// What this file pins down is the part that can go wrong quietly: attribution
// in a shared window (the page's own errors must never be recorded), the
// once-per-realm guard, and the promise that reporting never throws back into
// the page.

import { describe, expect, test } from 'vitest';
import type { UncaughtLogEntry } from '../extension/utils/uncaught-report';
import { installUncaughtReporting } from '../extension/utils/uncaught-report';

const OWN_ORIGIN = 'chrome-extension://abcdefghijklmnop/';

function fakeTarget() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  return {
    addEventListener(type: string, listener: (event: unknown) => void) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    emit(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    listenerCount(type: string) {
      return (listeners.get(type) ?? []).length;
    },
  };
}

function collector() {
  const entries: UncaughtLogEntry[] = [];
  return { entries, write: (entry: UncaughtLogEntry) => entries.push(entry) };
}

describe('無フィルタの文脈（サービスワーカー・拡張ページ）', () => {
  test('error イベントが unknown/fail の行になる', () => {
    const target = fakeTarget();
    const { entries, write } = collector();
    installUncaughtReporting(target, write, { context: 'background' });

    target.emit('error', { message: 'boom', filename: `${OWN_ORIGIN}background.js`, lineno: 12, error: { stack: 'Error: boom\n  at x' } });

    expect(entries).toEqual([
      {
        stage: 'unknown',
        phase: 'fail',
        uncaught: 'background',
        error: 'boom',
        stack: 'Error: boom\n  at x',
        source: `${OWN_ORIGIN}background.js:12`,
      },
    ]);
  });

  test('unhandledrejection は reason の message と stack を運ぶ', () => {
    const target = fakeTarget();
    const { entries, write } = collector();
    installUncaughtReporting(target, write, { context: 'diag' });

    target.emit('unhandledrejection', { reason: { message: 'rejected!', stack: 'Error: rejected!\n  at y' } });

    expect(entries).toEqual([{ stage: 'unknown', phase: 'fail', uncaught: 'diag', error: 'rejected!', stack: 'Error: rejected!\n  at y' }]);
  });

  test('Error でない reason（文字列）も落とさず記録する', () => {
    const target = fakeTarget();
    const { entries, write } = collector();
    installUncaughtReporting(target, write, { context: 'background' });

    target.emit('unhandledrejection', { reason: 'plain string' });

    expect(entries).toHaveLength(1);
    expect(entries[0].error).toBe('plain string');
    expect(entries[0].stack).toBeNull();
  });

  test('長大な stack は先頭だけに刈り込む', () => {
    const target = fakeTarget();
    const { entries, write } = collector();
    installUncaughtReporting(target, write, { context: 'background' });

    const stack = Array.from({ length: 40 }, (_, i) => `  at frame${i}`).join('\n');
    target.emit('error', { message: 'deep', error: { stack } });

    expect((entries[0].stack as string).split('\n')).toHaveLength(8);
  });
});

describe('content script（共有ウィンドウ＝出自フィルタ）', () => {
  test('自拡張の filename を持つエラーだけ記録する', () => {
    const target = fakeTarget();
    const { entries, write } = collector();
    installUncaughtReporting(target, write, { context: 'content', ownOrigin: OWN_ORIGIN });

    target.emit('error', { message: 'ours', filename: `${OWN_ORIGIN}resident.js`, lineno: 1 });
    target.emit('error', { message: 'the page broke', filename: 'https://x.com/app.js', lineno: 1 });

    expect(entries).toHaveLength(1);
    expect(entries[0].error).toBe('ours');
  });

  test('filename がページでも stack が自拡張を指せば記録する', () => {
    const target = fakeTarget();
    const { entries, write } = collector();
    installUncaughtReporting(target, write, { context: 'content', ownOrigin: OWN_ORIGIN });

    target.emit('error', { message: 'ours via stack', filename: 'https://x.com/', error: { stack: `Error: ours\n  at ${OWN_ORIGIN}resident.js:5:1` } });

    expect(entries).toHaveLength(1);
  });

  test('rejection は stack が自拡張を指す時だけ記録する（stack 無しは捨てる）', () => {
    const target = fakeTarget();
    const { entries, write } = collector();
    installUncaughtReporting(target, write, { context: 'content', ownOrigin: OWN_ORIGIN });

    target.emit('unhandledrejection', { reason: { message: 'ours', stack: `Error: ours\n  at ${OWN_ORIGIN}resident.js:9:1` } });
    target.emit('unhandledrejection', { reason: { message: 'the page again', stack: 'Error\n  at https://x.com/app.js:1:1' } });
    target.emit('unhandledrejection', { reason: 'bare string, no stack' });

    expect(entries).toHaveLength(1);
    expect(entries[0].error).toBe('ours');
  });

  test('origin が取れない（孤児スクリプト＝ownOrigin: null）なら何も購読しない', () => {
    const target = fakeTarget();
    const { entries, write } = collector();
    installUncaughtReporting(target, write, { context: 'content', ownOrigin: null });

    target.emit('error', { message: 'anything', filename: `${OWN_ORIGIN}resident.js` });

    expect(target.listenerCount('error')).toBe(0);
    expect(entries).toHaveLength(0);
  });
});

describe('多重インストールと安全性', () => {
  test('同じ realm への2回目のインストールは no-op（resident と Alt+S 注入の共存）', () => {
    const target = fakeTarget();
    const { entries, write } = collector();
    installUncaughtReporting(target, write, { context: 'content' });
    installUncaughtReporting(target, write, { context: 'content' });

    expect(target.listenerCount('error')).toBe(1);
    target.emit('error', { message: 'once' });
    expect(entries).toHaveLength(1);
  });

  test('write が例外を投げてもハンドラの外へ漏れない', () => {
    const target = fakeTarget();
    installUncaughtReporting(
      target,
      () => {
        throw new Error('log sink broke');
      },
      { context: 'background' },
    );

    expect(() => target.emit('error', { message: 'boom' })).not.toThrow();
    expect(() => target.emit('unhandledrejection', { reason: 'boom' })).not.toThrow();
  });
});
