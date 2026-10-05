// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { watchResidentReplacement } from './resident-replacement.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('分離ワールドをまたぐ常駐世代の交代', () => {
  test('再注入は失効した複数の旧世代を同期的に撤去し、生きた世代を残す', () => {
    const first = { id: 'extension-id' as string | undefined };
    const second = { id: 'extension-id' as string | undefined };
    const removed: string[] = [];
    const makeOld = (runtime: typeof first, name: string) => {
      const control = document.createElement('button');
      document.body.append(control);
      let stop: () => void;
      const dispose = () => {
        control.remove();
        removed.push(name);
        stop();
      };
      stop = watchResidentReplacement(document, runtime, dispose);
      cleanups.push(stop);
      return control;
    };
    const firstControl = makeOld(first, 'first');
    const secondControl = makeOld(second, 'second');
    expect(firstControl.isConnected).toBe(true);
    first.id = undefined;
    second.id = undefined;
    const current = vi.fn();
    cleanups.push(watchResidentReplacement(document, { id: 'extension-id' }, current));
    expect(removed).toEqual(['first', 'second']);
    expect(firstControl.isConnected).toBe(false);
    expect(secondControl.isConnected).toBe(false);
    expect(current).not.toHaveBeenCalled();
  });

  test('ページの偽造通知は生きた世代を停止できず、解除後は失効しても呼ばない', () => {
    const runtime = { id: 'extension-id' as string | undefined };
    const dispose = vi.fn();
    const stop = watchResidentReplacement(document, runtime, dispose);
    cleanups.push(stop);
    document.dispatchEvent(new Event('hologram:resident-replaced'));
    expect(dispose).not.toHaveBeenCalled();
    stop();
    runtime.id = undefined;
    document.dispatchEvent(new Event('hologram:resident-replaced'));
    expect(dispose).not.toHaveBeenCalled();
  });
});
