'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { waitFor } = require('./lib-wait.cts');
const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const NATIVE_HOST_PROFILE_KEY = 'nativeHost.profile.v1';
const DEVELOPMENT_NATIVE_HOST_PROFILE = 'development';

async function extensionWorker(context: any): Promise<any> {
  let worker: any;
  await waitFor(
    '開発用拡張機能の Service Worker',
    async () => {
      for (const candidate of context.serviceWorkers()) {
        if (!candidate.url().startsWith(`chrome-extension://${EXPECTED_EXTENSION_ID}/`)) continue;
        try {
          await candidate.evaluate(async () => (globalThis as any).chrome.storage.local.get('nativeHost.profile.v1'));
          worker = candidate;
          return true;
        } catch {
          /* 再読み込みで終了中の worker は使わない。 */
        }
      }
      return false;
    },
    { timeoutMs: 5000, pollMs: 100 },
  );
  return worker;
}

async function configureDevelopmentExtension(extensionDir: string, context: any, browser = context.browser()): Promise<{ id: string; path: string }> {
  const absolute = path.resolve(extensionDir);
  if (!fs.existsSync(path.join(absolute, 'manifest.json'))) throw new Error(`共有リリースビルドがありません: ${absolute}`);
  const cdp = await browser.newBrowserCDPSession();
  try {
    const first = await cdp.send('Extensions.loadUnpacked', { path: absolute });
    if (first?.id !== EXPECTED_EXTENSION_ID) throw new Error(`読み込んだ拡張機能 ID が違います: ${first?.id || 'unknown'}`);
    const worker = await extensionWorker(context);
    await worker.evaluate(
      async ({ key, value }: { key: string; value: string }) => {
        await (globalThis as any).chrome.storage.local.set({ [key]: value });
      },
      { key: NATIVE_HOST_PROFILE_KEY, value: DEVELOPMENT_NATIVE_HOST_PROFILE },
    );
    const second = await cdp.send('Extensions.loadUnpacked', { path: absolute });
    if (second?.id !== EXPECTED_EXTENSION_ID) throw new Error('開発用プロファイルで拡張機能を再読み込みできませんでした');
    const { extensions } = await cdp.send('Extensions.getExtensions');
    const loaded = extensions?.find((extension: any) => extension.id === EXPECTED_EXTENSION_ID);
    if (!loaded?.enabled || path.resolve(loaded.path).toLowerCase() !== absolute.toLowerCase()) throw new Error(`開発用プロファイルが共有リリースビルドを読み込んでいません: ${loaded?.path || 'not loaded'}`);
    const verifyWorker = await extensionWorker(context);
    const data = await verifyWorker.evaluate(async (key: string) => (globalThis as any).chrome.storage.local.get(key), NATIVE_HOST_PROFILE_KEY);
    if (data?.[NATIVE_HOST_PROFILE_KEY] !== DEVELOPMENT_NATIVE_HOST_PROFILE) throw new Error('開発用 Native Host のプロファイル設定を確認できませんでした');
    return { id: EXPECTED_EXTENSION_ID, path: absolute };
  } finally {
    await cdp.detach();
  }
}

function selectDevelopmentPages(pages: any[], matches: string[]): any[] {
  return pages.filter((page) => {
    try {
      const url = new URL(page.url());
      return /^https?:$/.test(url.protocol) && matches.includes(`${url.origin}/*`);
    } catch {
      return false;
    }
  });
}

async function reloadDevelopmentPages(extensionDir: string, context: any): Promise<number> {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  const matches = (manifest.content_scripts || []).flatMap((script: { matches?: string[] }) => script.matches || []);
  const pages = selectDevelopmentPages(context.pages(), matches);
  const results = await Promise.allSettled(pages.map((page) => page.reload({ waitUntil: 'load', timeout: 15_000 })));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      `開発用Chromeのサイト再読み込みに ${failures.length} 件失敗しました`,
    );
  return pages.length;
}
module.exports = { DEVELOPMENT_NATIVE_HOST_PROFILE, EXPECTED_EXTENSION_ID, NATIVE_HOST_PROFILE_KEY, extensionWorker, configureDevelopmentExtension, reloadDevelopmentPages, selectDevelopmentPages };
