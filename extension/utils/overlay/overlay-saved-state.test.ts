import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createSavedQuery } from './saved-state.ts';
import type { UnitState } from './types.ts';

describe('overlay の保存状態問い合わせ', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-extension',
        lastError: undefined,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('投稿 URL は解決するがライブラリ履歴は問い合わせない', async () => {
    const unit = {} as Element;
    const state: UnitState = { url: null, saved: null, anchors: new Map() };
    const tracked = new Map([[unit, state]]);
    const sendMessage = vi.mocked(chrome.runtime.sendMessage);
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
    await vi.waitFor(() => expect(state.url).toBe('https://x.com/old/status/1'));
    expect(state.url).toBe('https://x.com/old/status/1');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(state.saved).toBeNull();
    expect(onResolved).not.toHaveBeenCalled();
    query.dispose();
  });
});
