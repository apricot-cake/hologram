'use strict';

// Deterministic browser-level capture test. A Playwright route serves an
// X-shaped post and its metadata response entirely from memory, while a
// uniquely named temporary Native Messaging host writes into a temporary
// Hologram config/library. The exercised path is the production path:
//
//   capture content script -> extension service worker -> native messaging
//   bridge -> JPEG + inbox envelope on disk (#5 St6 / #299 — sidecar direct
//   writes were replaced by the durable .hologram-inbox/new queue)
//
// No user browser profile, real native-host registration, or library is read
// or modified.

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { createNativeHostSandbox } = require('./lib-native-host-e2e.cts');

declare const chrome: any;

const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const POST_ID = '1999999999999999999';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;

const POST_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>Hologram offline capture fixture</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: start center; padding: 80px; background: #f4f7fa; font-family: system-ui, sans-serif; }
    article { width: 640px; min-height: 360px; padding: 32px; border: 1px solid #ccd6dd; border-radius: 20px; background: white; color: #17202a; }
    .media { height: 220px; margin-top: 24px; border-radius: 16px; background: linear-gradient(135deg, #73c7ff, #9c7cff); }
  </style>
</head>
<body>
  <article id="capture-target" data-testid="tweet">
    <a href="/hologram/status/${POST_ID}"><time datetime="2026-07-25T00:00:00.000Z">2026-07-25</time></a>
    <p>Offline fixture post</p>
    <div class="media" data-testid="tweetPhoto" aria-label="fixture image"></div>
  </article>
</body>
</html>`;

const POST_METADATA = {
  text: 'Offline fixture post',
  user: {
    name: 'Hologram Fixture',
    screen_name: 'hologram',
    id_str: '131',
  },
  favorite_count: 13,
  conversation_count: 1,
  created_at: '2026-07-25T00:00:00.000Z',
  lang: 'ja',
  mediaDetails: [],
};

async function waitForCapture(libraryDir: string, timeoutMs = 20_000): Promise<{ jpg: string; envelope: string }> {
  const inboxNewDir = path.join(libraryDir, '.hologram-inbox', 'new');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const jpg = fs.readdirSync(libraryDir).find((file) => file.endsWith('.jpg'));
    let envelope: string | undefined;
    try {
      envelope = fs.readdirSync(inboxNewDir).find((file) => file.endsWith('.json'));
    } catch {
      envelope = undefined; // inbox dir not created yet
    }
    if (jpg && envelope) return { jpg, envelope };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('native host did not land a JPEG and inbox envelope within 20 seconds');
}

(async () => {
  const nativeHost = createNativeHostSandbox(EXPECTED_EXTENSION_ID);
  const extensionDir = stageExtension({
    allUrls: true,
    nativeHostName: nativeHost.hostName,
    tempPrefix: 'hologram-extension-offline-e2e-ext-',
  });
  let browser: any = null;

  try {
    browser = await launchExtensionBrowser({
      extensionDir,
      headless: true,
      viewport: { width: 1280, height: 900 },
    });
    if (browser.extensionId !== EXPECTED_EXTENSION_ID) {
      throw new Error(`staged extension id ${browser.extensionId} does not match native-host allow-list ${EXPECTED_EXTENSION_ID}`);
    }

    await browser.context.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url === POST_URL) {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: POST_HTML });
      } else if (url.startsWith('https://cdn.syndication.twimg.com/tweet-result?')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(POST_METADATA) });
      } else {
        await route.abort();
      }
    });

    const page = await browser.context.newPage();
    await page.goto(POST_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#capture-target').waitFor();

    const activation = await browser.serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: 'no active tab' };
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    });
    if (!activation.ok) throw new Error(`capture activation failed: ${activation.error}`);

    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    const landed = await waitForCapture(nativeHost.libraryDir);
    const envelope = JSON.parse(fs.readFileSync(path.join(nativeHost.libraryDir, '.hologram-inbox', 'new', landed.envelope), 'utf8'));
    const jpeg = fs.readFileSync(path.join(nativeHost.libraryDir, landed.jpg));
    if (envelope.format !== 'hologram-inbox' || envelope.version !== 1) throw new Error(`unexpected envelope shape: ${JSON.stringify(envelope)}`);
    const record = envelope.record;
    if (record.url !== POST_URL) throw new Error(`saved URL mismatch: ${record.url}`);
    if (record.platform !== 'x') throw new Error(`saved platform mismatch: ${record.platform}`);
    if (record.text !== POST_METADATA.text) throw new Error(`mocked metadata did not cross the service worker: ${record.text}`);
    if (record.image !== landed.jpg) throw new Error(`envelope image mismatch: ${record.image} / ${landed.jpg}`);
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('landed image is not a JPEG');

    const bridgeLog = fs.readFileSync(path.join(nativeHost.configDir, 'bridge.log'), 'utf8');
    const captureLog = fs.readFileSync(path.join(nativeHost.configDir, 'capture.log'), 'utf8');
    if (!bridgeLog.includes('recv type=save')) throw new Error('bridge log has no native save message');
    if (!captureLog.includes('"stage":"bridge"') || !captureLog.includes('"phase":"ok"')) {
      throw new Error('capture log has no successful bridge outcome');
    }

    console.log(`PASS e2e-extension-offline: ${landed.jpg} + .hologram-inbox/new/${landed.envelope}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
    nativeHost.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
