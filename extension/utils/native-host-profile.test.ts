import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEVELOPMENT_NATIVE_HOST_PROFILE, DEV_NATIVE_HOST, getNativeHost, nativeHostForProfile, RELEASE_NATIVE_HOST } from './native-host.ts';

const originalChrome = globalThis.chrome;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome });
});

describe('プロファイルごとの Native Host 選択', () => {
  test('設定がない日常用プロファイルはリリース host を使う', () => {
    expect(nativeHostForProfile(undefined)).toBe(RELEASE_NATIVE_HOST);
    expect(nativeHostForProfile('unknown')).toBe(RELEASE_NATIVE_HOST);
  });

  test('development と明示したプロファイルだけ開発 host を使う', () => {
    expect(nativeHostForProfile(DEVELOPMENT_NATIVE_HOST_PROFILE)).toBe(DEV_NATIVE_HOST);
  });

  test('接続時に chrome.storage.local のプロファイル設定を読む', async () => {
    const get = vi.fn((_key: string, callback: (stored: Record<string, unknown>) => void) => callback({ 'nativeHost.profile.v1': DEVELOPMENT_NATIVE_HOST_PROFILE }));
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { lastError: undefined }, storage: { local: { get } } },
    });

    await expect(getNativeHost()).resolves.toBe(DEV_NATIVE_HOST);
    expect(get).toHaveBeenCalledWith('nativeHost.profile.v1', expect.any(Function));
  });

  test('設定の読み取りに失敗した場合も日常用 host へ安全に倒す', async () => {
    const get = vi.fn((_key: string, callback: (stored: Record<string, unknown>) => void) => callback({}));
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { lastError: { message: 'unavailable' } }, storage: { local: { get } } },
    });

    await expect(getNativeHost()).resolves.toBe(RELEASE_NATIVE_HOST);
  });
});
