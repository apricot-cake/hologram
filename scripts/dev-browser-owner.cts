'use strict';
const { developmentOptions, launchDevelopmentContext } = require('./lib-dev-browser.cts');
const { configureDevelopmentExtension, reloadDevelopmentPages, extensionWorker } = require('./lib-extension-profile.cts');
const { createVerificationTab } = require('./lib-verification-tab.cts');

function createOwner(dependencies: any = {}): any {
  let context: any;
  let initialized = false;
  let aborted = false;
  let closing: Promise<void> | undefined;
  let launching: Promise<any> | undefined;
  const verificationTabs = new Set<number>();
  const workerFor = dependencies.extensionWorker || extensionWorker;

  async function closeContext(): Promise<void> {
    if (closing) return closing;
    if (!context) return;
    const current = context;
    closing = (async () => {
      try {
        if (verificationTabs.size) {
          const worker = await workerFor(current);
          await worker.evaluate(
            async (ids: number[]) => {
              const chrome = (globalThis as any).chrome;
              for (const id of ids) {
                try {
                  await chrome.tabs.get(id);
                } catch {
                  await chrome.storage.local.remove(`verification.tab.${id}`);
                  continue;
                }
                await chrome.tabs.remove(id);
                await chrome.storage.local.remove(`verification.tab.${id}`);
              }
            },
            [...verificationTabs],
          );
          verificationTabs.clear();
        }
      } finally {
        await current.close();
        context = undefined;
      }
    })();
    return closing;
  }

  async function abort(): Promise<void> {
    aborted = true;
    // callback が停止していても Chrome を閉じる。起動途中なら start の完了時に閉じる。
    await closeContext();
    if (launching) await launching.catch(() => {});
  }

  async function operation(name: string, args: any): Promise<any> {
    if (name === 'start') {
      if (initialized || aborted) throw new Error('開発用 Chrome は起動済みか終了しています');
      initialized = true;
      const expected = (dependencies.options || developmentOptions)();
      if (args.profile !== expected.profile || args.executablePath !== expected.executablePath) throw new Error('開発用 Chrome の起動設定が一致しません');
      launching = Promise.resolve((dependencies.launch || launchDevelopmentContext)(args)).then(async (started) => {
        context = started;
        if (aborted) {
          await closeContext();
          throw new Error('親プロセスが終了したため開発用 Chrome を閉じました');
        }
        return { profile: args.profile, transport: 'pipe' };
      });
      return launching;
    }
    if (name === 'close') {
      await closeContext();
      return { closed: true };
    }
    if (!context || aborted || closing) throw new Error('開発用 Chrome は未起動か終了しています');
    if (name === 'configure') return (dependencies.configure || configureDevelopmentExtension)(args.output, context);
    if (name === 'reload') return (dependencies.reload || reloadDevelopmentPages)(args.output, context);
    if (name === 'verify') {
      const id = await (dependencies.verify || createVerificationTab)(await workerFor(context), args.url, args.host);
      verificationTabs.add(id);
      return id;
    }
    if (name === 'marker') {
      const worker = await workerFor(context);
      return worker.evaluate(async () => (globalThis as any).chrome.tabs.create({ url: `data:text/html;charset=utf-8,${encodeURIComponent('<title>Hologram 開発プロファイル</title><main>Hologram 開発プロファイル</main>')}`, active: false }));
    }
    if (name === 'run') {
      const callback = (dependencies.load || require)(args.modulePath);
      if (typeof callback.run !== 'function') throw new Error('診断モジュールは run({ context, browser, args }) を export してください');
      return callback.run({ context, browser: context.browser(), args: args.args, verificationTabs: [...verificationTabs] });
    }
    throw new Error(`開発用 Chrome の操作が不明です: ${name}`);
  }
  return { operation, abort, closeContext };
}

if (require.main === module) {
  if (!process.send) throw new Error('開発用 Chrome の所有者は継承 IPC から起動してください');
  const owner = createOwner();
  let queue = Promise.resolve();
  // 同じコンソールの Ctrl+C は親が受け取り、close 操作を IPC で送る。
  process.on('SIGINT', () => {});
  process.on('message', (message: any) => {
    queue = queue.then(async () => {
      try {
        const result = await owner.operation(message.operation, message.args);
        if (process.connected) process.send?.({ id: message.id, result });
      } catch (error) {
        if (process.connected) process.send?.({ id: message.id, error: error instanceof Error ? error.stack : String(error) });
      }
    });
  });
  process.on('disconnect', () => {
    void owner.abort().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  });
}
module.exports = { createOwner };
