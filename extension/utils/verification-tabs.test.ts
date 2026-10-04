import { afterEach, expect, test, vi } from 'vitest';
import { verificationHost, verificationKey, setVerificationRoutingReady, VERIFICATION_TAB_CAPABILITY, VERIFICATION_TAB_CAPABILITY_KEY } from './verification-tabs.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  setVerificationRoutingReady(false);
});
test('module 読込だけでは対応を宣言せず登録完了後に Worker の印を出す', () => {
  expect((globalThis as any)[VERIFICATION_TAB_CAPABILITY_KEY]).toBeUndefined();
  setVerificationRoutingReady(true);
  expect((globalThis as any)[VERIFICATION_TAB_CAPABILITY_KEY]).toBe(VERIFICATION_TAB_CAPABILITY);
  setVerificationRoutingReady(false);
  expect((globalThis as any)[VERIFICATION_TAB_CAPABILITY_KEY]).toBeUndefined();
});

test('Worker の新しい global context でも永続化済みのタブ経路を読み戻す', async () => {
  const host = 'com.hologram.host.verify.0123456789ab';
  const get = vi.fn(async () => ({ [verificationKey(10)]: host }));
  const chrome = { storage: { local: { get } } };
  vi.stubGlobal('chrome', chrome);
  expect(await verificationHost(10)).toBe(host);
  const restartedHost = vm.runInNewContext(`const verificationKey = ${verificationKey.toString()}; (${verificationHost.toString()})`, { chrome });
  expect(await restartedHost(10)).toBe(host);
  expect(await restartedHost(11)).toBeUndefined();
  expect(get).toHaveBeenCalledTimes(3);
});
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
import vm from 'node:vm';
