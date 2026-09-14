import { afterEach, expect, test, vi } from 'vitest';
import { verificationHost, verificationKey } from './verification-tabs.ts';

afterEach(() => vi.unstubAllGlobals());
test('検証タブだけ接続先を持ち、同じURLの通常タブには影響しない', async () => {
  const host = 'com.hologram.host.verify.0123456789ab';
  vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ [verificationKey(10)]: host }) } } });
  expect(await verificationHost(10)).toBe(host);
  expect(await verificationHost(11)).toBeUndefined();
  expect(await verificationHost()).toBeUndefined();
});
test('設定の破損や読込失敗を通常ライブラリへの保存に切り替えない', async () => {
  vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ [verificationKey(10)]: 'bad' }) } } });
  await expect(verificationHost(10)).rejects.toThrow('検証用の接続先');
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async () => {
          throw new Error('storage failed');
        },
      },
    },
  });
  await expect(verificationHost(10)).rejects.toThrow('storage failed');
});
