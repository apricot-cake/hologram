import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createSavedQuery } from './saved-state.ts';
import type { UnitState } from './types.ts';

describe('overlay の保存状態問い合わせ', () => {
  const logs: unknown[] = [];
  beforeEach(() => {
    logs.length = 0;
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-extension',
        lastError: undefined,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn((message: any, callback?: () => void) => {
          if (message?.type === 'logCapture') {
            logs.push(message);
            callback?.();
          }
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('問い合わせ中にユニットが別投稿へ再利用されたら古い答えを書かない', async () => {
    const unit = {} as Element;
    const state: UnitState = { url: null, saved: null, anchors: new Map() };
    const tracked = new Map([[unit, state]]);
    let answer: ((response: unknown) => void) | undefined;
    const sendMessage = vi.mocked(chrome.runtime.sendMessage);
    sendMessage.mockImplementation((_message: unknown, callback: unknown) => {
      answer = callback as (response: unknown) => void;
    });
    const onResolved = vi.fn();
    const query = createSavedQuery({
      debounceMs: 0,
      tracked,
      isVisible: () => true,
      isWanted: () => true,
      isAlive: () => true,
      getPermalink: () => 'https://x.com/old/status/1',
      getMedia: () => null,
      onResolved,
    });

    query.add(unit);
    query.scheduleQuery();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(state.url).toBe('https://x.com/old/status/1');

    state.url = 'https://x.com/new/status/2';
    answer?.({
      ok: true,
      results: {
        'https://x.com/old/status/1': { id: 'old-record', media: [] },
      },
    });

    expect(state.saved).toBeNull();
    expect(onResolved).not.toHaveBeenCalled();
    query.dispose();
  });

  test('保存状態の応答コールバック例外を診断へ記録する', async () => {
    const unit = {} as Element;
    const state: UnitState = { url: null, saved: null, anchors: new Map() };
    let answer: ((response: unknown) => void) | undefined;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((message: any, callback: any) => {
      if (message?.type === 'logCapture') {
        logs.push(message);
        callback?.();
      } else answer = callback;
    });
    const query = createSavedQuery({
      debounceMs: 0,
      tracked: new Map([[unit, state]]),
      isVisible: () => true,
      isWanted: () => true,
      isAlive: () => true,
      getPermalink: () => 'https://x.com/a/status/1',
      getMedia: () => null,
      onResolved: () => {
        throw new Error('saved repaint failed');
      },
    });
    query.add(unit);
    query.scheduleQuery();
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    answer?.({ ok: true, results: { 'https://x.com/a/status/1': { id: 'record', media: [] } } });
    expect(logs).toContainEqual(expect.objectContaining({ type: 'logCapture', entry: expect.objectContaining({ operation: 'overlay-saved-answer', error: 'saved repaint failed' }) }));
    query.dispose();
  });
});
