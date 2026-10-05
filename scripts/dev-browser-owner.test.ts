import { expect, test, vi } from 'vitest';
const { createOwner } = require('./dev-browser-owner.cts');
const options = { profile: 'dedicated', executablePath: 'chrome' };

test('親の切断で停止した診断 callback を待たず context を通常終了する', async () => {
  const close = vi.fn(async () => {});
  const context = { close, browser: () => ({}) };
  const owner = createOwner({ options: () => options, launch: async () => context, load: () => ({ run: () => new Promise(() => {}) }) });
  await owner.operation('start', options);
  void owner.operation('run', { modulePath: 'test', args: [] });
  await owner.abort();
  expect(close).toHaveBeenCalledOnce();
  await expect(owner.operation('configure', {})).rejects.toThrow('終了しています');
});

test('起動中に親が切断した場合も起動完了した context を残さない', async () => {
  let complete: any;
  const close = vi.fn(async () => {});
  const owner = createOwner({
    options: () => options,
    launch: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  const launching = owner.operation('start', options);
  const aborted = owner.abort();
  complete({ close });
  await expect(launching).rejects.toThrow('親プロセスが終了');
  await aborted;
  expect(close).toHaveBeenCalledOnce();
});

test('callback の失敗後も close 操作が同じ context を終了する', async () => {
  const close = vi.fn(async () => {});
  const context = { close, browser: () => ({}) };
  const owner = createOwner({
    options: () => options,
    launch: async () => context,
    load: () => ({
      run: async () => {
        throw new Error('diagnostic failed');
      },
    }),
  });
  await owner.operation('start', options);
  await expect(owner.operation('run', { modulePath: 'test', args: [] })).rejects.toThrow('diagnostic failed');
  await owner.operation('close', {});
  await owner.abort();
  expect(close).toHaveBeenCalledOnce();
});

test('検証タブと binding を削除してから context を閉じる', async () => {
  const events: string[] = [];
  const scope = globalThis as any;
  const previous = scope.chrome;
  scope.chrome = {
    tabs: {
      get: async () => ({}),
      remove: async (id) => {
        events.push(`tab:${id}`);
      },
    },
    storage: {
      local: {
        remove: async (key) => {
          events.push(key);
        },
      },
    },
  };
  const context = {
    close: async () => {
      events.push('close');
    },
    browser: () => ({}),
  };
  const worker = { evaluate: (fn, args) => fn(args) };
  const run = vi.fn(async () => ({}));
  const owner = createOwner({ options: () => options, launch: async () => context, extensionWorker: async () => worker, verify: async () => 9, load: () => ({ run }) });
  try {
    await owner.operation('start', options);
    await owner.operation('verify', { url: 'url', host: 'host' });
    await owner.operation('run', { modulePath: 'test', args: ['arg'] });
    expect(run).toHaveBeenCalledWith({ context, browser: {}, args: ['arg'], verificationTabs: [9] });
    await owner.operation('close', {});
    expect(events).toEqual(['tab:9', 'verification.tab.9', 'close']);
  } finally {
    scope.chrome = previous;
  }
});
