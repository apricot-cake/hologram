// #727: 捕まらなかった例外と処理されなかった reject は、capture.log の `unknown` の段へ
// 自分で報告する。他に居場所となるのは chrome://extensions のエラーコンソールだけで、
// そちらはプログラムから一切読めないため。このファイルが固定するのは、黙って壊れうる部分＝
// realm ごとに1回だけという防ぎ、そして報告がページへ投げ返さないという約束。

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { UncaughtLogEntry } from './uncaught-report';
import { installUncaughtReporting } from './uncaught-report';

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

describe('多重インストールと安全性', () => {
  test('同じ realm への2回目のインストールは no-op', () => {
    const target = fakeTarget();
    const { entries, write } = collector();
    installUncaughtReporting(target, write, { context: 'background' });
    installUncaughtReporting(target, write, { context: 'background' });

    expect(target.listenerCount('error')).toBe(1);
    target.emit('error', { message: 'once' });
    expect(entries).toHaveLength(1);
  });

  test('content script はページで偽装できる error イベントを購読しない', () => {
    for (const entrypoint of ['../entrypoints/resident.content.ts', '../entrypoints/bulk.ts']) {
      const source = readFileSync(new URL(entrypoint, import.meta.url), 'utf8');
      expect(source).not.toContain('installUncaughtReporting');
    }
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
