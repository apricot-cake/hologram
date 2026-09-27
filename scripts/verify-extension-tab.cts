'use strict';
// ログイン済みの開発用 Chrome に、検証専用の保存先を持つタブを開く。
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const url = process.argv[2];
if (!url || !/^https:\/\/(?:x\.com|twitter\.com|bsky\.app|www\.pixiv\.net)\//.test(url)) throw new Error('検証する投稿の HTTPS URL を指定してください。');

async function main() {
  execFileSync(process.execPath, [path.join(root, 'scripts/sandbox-app.cts'), 'start'], { cwd: root, stdio: 'inherit', windowsHide: true });
  const configDir = path.join(root, '.sandbox/config');
  const config = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
  const library = path.resolve(config.saveFolder);
  if (library !== path.join(root, '.sandbox/library')) throw new Error('検証用アプリの保存先が一致しません。');
  const instance = JSON.parse(fs.readFileSync(path.join(root, '.sandbox/instance.json'), 'utf8'));
  const app = await chromium.connectOverCDP(`http://127.0.0.1:${instance.port}`);
  try {
    const result = await app
      .contexts()[0]
      .pages()[0]
      .evaluate(async () => (globalThis as any).hologram.listPosts());
    if (path.resolve(result.saveFolder) !== library) throw new Error('検証用アプリの接続先が一致しません。');
  } finally {
    await app.close();
  }
  const host = `com.hologram.host.verify.${createHash('sha256').update(configDir).digest('hex').slice(0, 12)}`;
  process.env.HOLOGRAM_CONFIG_DIR = configDir;
  process.env.HOLOGRAM_NATIVE_HOST_NAME = host;
  const installer = require('../native-host/install.mts');
  installer.install({ extensionId: 'keggmjkemfcekcffohnpaojacdakpejh' });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  try {
    const context = browser.contexts()[0];
    const worker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://keggmjkemfcekcffohnpaojacdakpejh/'));
    if (!worker) throw new Error('開発用 Chrome の Hologram 拡張機能を起動してください。');
    const tabId = await worker.evaluate(
      async ({ url, host }) => {
        const chrome = (globalThis as any).chrome;
        const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
        await chrome.storage.local.set({ [`verification.tab.${tab.id}`]: host });
        await chrome.action.setBadgeText({ tabId: tab.id, text: 'TEST' });
        await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#985800' });
        await chrome.action.setTitle({ tabId: tab.id, title: 'Hologram — 検証用ライブラリ' });
        await chrome.tabs.update(tab.id, { url });
        return tab.id;
      },
      { url, host },
    );
    console.log(`検証タブ: ${tabId}\n保存先: ${library}\n通常タブの保存先は変更していません。`);
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
