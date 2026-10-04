import vm from 'node:vm';
import { expect, test, vi } from 'vitest';
import { createVerificationTab, VERIFICATION_TAB_CAPABILITY, VERIFICATION_TAB_CAPABILITY_KEY } from './lib-verification-tab.cts';

const url = 'https://x.com/alice/status/123';
const host = 'com.hologram.host.verify.0123456789ab';
const key = 'verification.tab.42';

function environment(capability: unknown = VERIFICATION_TAB_CAPABILITY) {
  const stored: Record<string, string> = { 'verification.tab.99': 'com.hologram.host.verify.abcdef012345', ordinaryPreference: 'unchanged' };
  const calls: string[] = [];
  const chrome = {
    tabs: {
      create: vi.fn(async (_args: unknown): Promise<{ id?: number }> => {
        calls.push('create');
        return { id: 42 };
      }),
      update: vi.fn(async (_id: number, _args: unknown) => {
        calls.push('navigate');
      }),
      remove: vi.fn(async (_id: number) => {
        calls.push('close');
      }),
    },
    storage: {
      local: {
        set: vi.fn(async (values: Record<string, string>) => {
          calls.push('persist');
          Object.assign(stored, values);
        }),
        get: vi.fn(async (_key: string) => {
          calls.push('readback');
          return { ...stored };
        }),
        remove: vi.fn(async (name: string) => {
          delete stored[name];
        }),
      },
    },
    action: {
      setBadgeText: vi.fn(async (_args: unknown) => {}),
      setBadgeBackgroundColor: vi.fn(async (_args: unknown) => {}),
      setTitle: vi.fn(async (_args: unknown) => {}),
    },
  };
  const scope: Record<string, unknown> = { chrome, [VERIFICATION_TAB_CAPABILITY_KEY]: capability };
  const worker = {
    // Serializing into a distinct context also detects accidental closure use.
    evaluate: vi.fn(async (fn: (...args: any[]) => any, args: unknown) => vm.runInNewContext(`(${fn.toString()})(args)`, Object.assign(scope, { args }))),
  };
  return { worker, chrome, stored, calls, scope };
}

test('対応検査から作成まで同じ evaluate で行い binding 確認後だけ背面遷移する', async () => {
  const env = environment();
  expect(await createVerificationTab(env.worker, url, host)).toBe(42);
  expect(env.worker.evaluate).toHaveBeenCalledOnce();
  expect(env.chrome.tabs.create).toHaveBeenCalledWith({ url: 'about:blank', active: false });
  expect(env.calls).toEqual(['create', 'persist', 'readback', 'navigate']);
  expect(env.chrome.tabs.update).toHaveBeenCalledWith(42, { url });
  expect(env.stored).toEqual({ [key]: host, 'verification.tab.99': 'com.hologram.host.verify.abcdef012345', ordinaryPreference: 'unchanged' });
});

test('Worker が無い場合は評価もタブ作成もしない', async () => {
  await expect(createVerificationTab(undefined, url, host)).rejects.toThrow('拡張機能を起動');
});

test.each([undefined, 'old-version'])('古い Worker の能力 %s ではタブを作らない', async (capability) => {
  const env = environment(capability);
  // Default parameters treat undefined as ready; explicitly model no marker.
  env.scope[VERIFICATION_TAB_CAPABILITY_KEY] = capability;
  await expect(createVerificationTab(env.worker, url, host)).rejects.toThrow('隔離に対応');
  expect(env.chrome.tabs.create).not.toHaveBeenCalled();
  expect(env.chrome.tabs.update).not.toHaveBeenCalled();
});

test('storage.set 失敗では投稿へ遷移せず作成した空タブだけ閉じる', async () => {
  const env = environment();
  env.chrome.storage.local.set.mockRejectedValueOnce(new Error('storage failed'));
  await expect(createVerificationTab(env.worker, url, host)).rejects.toThrow('storage failed');
  expect(env.chrome.tabs.update).not.toHaveBeenCalled();
  expect(env.chrome.tabs.remove).toHaveBeenCalledWith(42);
  expect(env.chrome.action.setBadgeText).not.toHaveBeenCalled();
});

test('storage 読戻しで binding が無ければ遷移しない', async () => {
  const env = environment();
  env.chrome.storage.local.get.mockResolvedValueOnce({});
  await expect(createVerificationTab(env.worker, url, host)).rejects.toThrow('接続先を保存');
  expect(env.chrome.tabs.update).not.toHaveBeenCalled();
  expect(env.chrome.tabs.remove).toHaveBeenCalledWith(42);
});

test('保存中にルーティング能力の印が失われた場合は URL 遷移しない', async () => {
  const env = environment();
  env.chrome.storage.local.set.mockImplementationOnce(async (values) => {
    Object.assign(env.stored, values);
    delete env.scope[VERIFICATION_TAB_CAPABILITY_KEY];
  });
  await expect(createVerificationTab(env.worker, url, host)).rejects.toThrow('隔離に対応');
  expect(env.chrome.tabs.update).not.toHaveBeenCalled();
  expect(env.chrome.tabs.remove).toHaveBeenCalledWith(42);
});

test('不正な検証 host はタブ作成前に拒否する', async () => {
  const env = environment();
  await expect(createVerificationTab(env.worker, url, 'com.hologram.host')).rejects.toThrow('接続先が無効');
  expect(env.chrome.tabs.create).not.toHaveBeenCalled();
});

test('作成 API が tab id を返さなければ保存も遷移もしない', async () => {
  const env = environment();
  env.chrome.tabs.create.mockResolvedValueOnce({});
  await expect(createVerificationTab(env.worker, url, host)).rejects.toThrow('タブを作成');
  expect(env.chrome.storage.local.set).not.toHaveBeenCalled();
  expect(env.chrome.tabs.update).not.toHaveBeenCalled();
});

test('Worker context の破棄で評価が中断しても別評価で URL 遷移を再試行しない', async () => {
  const env = environment();
  env.worker.evaluate.mockRejectedValueOnce(new Error('Execution context was destroyed'));
  await expect(createVerificationTab(env.worker, url, host)).rejects.toThrow('context was destroyed');
  expect(env.worker.evaluate).toHaveBeenCalledOnce();
  expect(env.chrome.tabs.update).not.toHaveBeenCalled();
});

test('遷移失敗後にタブを閉じられなくても保存先 binding を消さない', async () => {
  const env = environment();
  env.chrome.tabs.update.mockRejectedValueOnce(new Error('navigation failed'));
  env.chrome.tabs.remove.mockRejectedValueOnce(new Error('close failed'));
  await expect(createVerificationTab(env.worker, url, host)).rejects.toThrow('navigation failed');
  expect(env.stored[key]).toBe(host);
  expect(env.chrome.storage.local.remove).not.toHaveBeenCalled();
});
