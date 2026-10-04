// #727: 捕まらなかった例外と処理されなかった reject は、capture.log の `unknown` の段へ
// 自分で報告する。他に居場所となるのは chrome://extensions のエラーコンソールだけで、
// そちらはプログラムから一切読めないため。このファイルが固定するのは、黙って壊れうる部分＝
// 共有しているウィンドウでの帰属（ページ自身のエラーは決して記録してはいけない）、
// realm ごとに1回だけという防ぎ、そして報告がページへ投げ返さないという約束。

import { describe, expect, test } from 'vitest';
import type { UncaughtLogEntry } from './uncaught-report';
import { guardCaughtException, installUncaughtReporting, reportCaughtException } from './uncaught-report';

const OWN_ORIGIN = 'chrome-extension://abcdefghijklmnop/';

function fakeTarget() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  return {
    addEventListener(type: string, listener: (event: unknown) => void) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
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
  test('同じ realm への2回目のインストールは no-op（resident と一括取り込みの共存）', () => {
    const target = fakeTarget();
    const { entries, write } = collector();
    installUncaughtReporting(target, write, { context: 'content' });
    installUncaughtReporting(target, write, { context: 'content' });

    expect(target.listenerCount('error')).toBe(1);
    target.emit('error', { message: 'once' });
    expect(entries).toHaveLength(1);
  });

  test('dispose 後は listener を残さず再インストールできる', () => {
    const target = fakeTarget();
    const { write } = collector();
    const dispose = installUncaughtReporting(target, write, { context: 'background' });
    dispose();
    expect(target.listenerCount('error')).toBe(0);
    installUncaughtReporting(target, write, { context: 'background' });
    expect(target.listenerCount('error')).toBe(1);
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

describe('明示的に捕捉した自拡張の例外', () => {
  test('共有 window の偽装イベントを信頼せず catch の値だけを記録する', () => {
    const { entries, write } = collector();
    reportCaughtException(write, 'content', new Error('startup failed'), 'resident-start');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ error: 'startup failed', operation: 'resident-start' });
  });

  test('イベントの同期例外と非同期 rejection をどちらも記録する', async () => {
    const { entries, write } = collector();
    guardCaughtException(write, 'content', 'click', () => {
      throw new Error('sync');
    })();
    guardCaughtException(write, 'content', 'observer', async () => {
      throw new Error('async');
    })();
    await Promise.resolve();
    await Promise.resolve();
    expect(entries.map((entry) => entry.operation)).toEqual(['click', 'observer']);
  });
});
