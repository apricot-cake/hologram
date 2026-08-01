'use strict';

// Reproduction and recovery, in a real browser, of "a save never finishes and
// stays stuck processing" (#507).
// Disposable Chromium, disposable native host registration, disposable library
// = touches neither the user's profile nor the real library (same setup as e2e-extension-duplicate).
//
// The jsdom side (capture-timeout.test.ts) covers the content script's
// watchdog. What this covers is **the service worker side's budget** — in the
// shape closest to the reported symptom, does the save finish when a platform
// API "never returns"? The route is left held, neither fulfilled nor aborted =
// from the extension's point of view, a peer that's connected but silent.
//
// On this rig before the fix, the banner stayed stuck at busy forever, and
// capture.log only had the activate line, with neither success nor failure ever recorded (measured directly).

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { createNativeHostSandbox } = require('./lib-native-host-e2e.cts');

declare const chrome: any;

const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const POST_ID = '1999999999999999997';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;

// The metadata cap is 20 seconds. To avoid missing it, wait a bit over twice that.
const WAIT_FOR_END_MS = 45_000;

const POST_HTML = `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>Hologram timeout fixture</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: start center; padding: 80px; background: #f4f7fa; font-family: system-ui, sans-serif; }
  article { width: 640px; min-height: 360px; padding: 32px; border: 1px solid #ccd6dd; border-radius: 20px; background: white; color: #17202a; }
  .media { height: 220px; margin-top: 24px; border-radius: 16px; background: linear-gradient(135deg, #73c7ff, #9c7cff); }
</style>
</head>
<body>
  <article id="capture-target" data-testid="tweet">
    <a href="/hologram/status/${POST_ID}"><time datetime="2026-07-29T00:00:00.000Z">2026-07-29</time></a>
    <p>Timeout fixture post</p>
    <div class="media" data-testid="tweetPhoto" aria-label="fixture image"></div>
  </article>
</body>
</html>`;

function captureLogEntries(configDir: string): any[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(configDir, 'capture.log'), 'utf8');
  } catch {
    return [];
  }
  return text
    .trim()
    .split(/\r?\n/)
    .map((line: string) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

(async () => {
  const nativeHost = createNativeHostSandbox(EXPECTED_EXTENSION_ID);
  const extensionDir = stageExtension({
    allUrls: true,
    nativeHostName: nativeHost.hostName,
    tempPrefix: 'hologram-extension-timeout-e2e-ext-',
  });
  let browser: any = null;

  try {
    browser = await launchExtensionBrowser({ extensionDir, headless: true, viewport: { width: 1280, height: 900 } });
    if (browser.extensionId !== EXPECTED_EXTENSION_ID) {
      throw new Error(`staged extension id ${browser.extensionId} does not match native-host allow-list ${EXPECTED_EXTENSION_ID}`);
    }

    // The stall. Held rather than aborted, because an aborted fetch REJECTS —
    // the save has always ended on that. What had no end was a request that
    // stays open, which is what a wedged connection actually looks like.
    const held: any[] = [];
    await browser.context.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url === POST_URL) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: POST_HTML });
      else if (url.startsWith('https://cdn.syndication.twimg.com/tweet-result?')) held.push(route);
      else await route.abort();
    });

    const page = await browser.context.newPage();
    await page.goto(POST_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#capture-target').waitFor();

    // Alt+S is a browser-level command Playwright cannot press, so activation
    // goes through the same scripting.executeScript the command handler calls.
    const activated = await browser.serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: 'no active tab' };
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['entrypoints/capture.js'] });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    });
    if (!activated.ok) throw new Error(`capture activation failed: ${activated.error}`);

    // #44: the banner lives in the shared ShadowRoot. Playwright's CSS engine
    // pierces open shadow roots, so a locator still finds it — but
    // document.querySelector inside page.evaluate does not, which is why the
    // waits below go through a locator too.
    const bannerState = () => page.locator('[data-hologram-capture-banner]').getAttribute('data-state');

    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await page.locator('[data-hologram-capture-banner][data-state="busy"]').waitFor({ timeout: 15_000 });

    const startedAt = Date.now();
    await page.locator('[data-hologram-capture-banner][data-state="error"]').waitFor({ timeout: WAIT_FOR_END_MS });
    const endedAfterMs = Date.now() - startedAt;

    const state = await bannerState();
    if (state !== 'error') throw new Error(`the save ended in state "${state}", wanted "error"`);

    // The next move must be legible = don't just leave it at "the save failed" (#507's requirement).
    const shown = (await page.locator('[data-hologram-capture-banner]').textContent()) || '';
    if (!/try again|もう一度/i.test(shown)) throw new Error(`the failure banner offers no next step: ${shown}`);

    // It must be traceable afterward = the stuck leg stays in capture.log. It
    // doesn't land at the same time as the banner but a bit later = it's the
    // host that writes this line, and starting it up takes 1-2 seconds on Windows.
    let entries: any[] = [];
    let failure: any = null;
    for (const started = Date.now(); Date.now() - started < 15_000; ) {
      entries = captureLogEntries(nativeHost.configDir);
      failure = entries.find((e: any) => e.phase === 'fail' && /timed out/i.test(String(e.error || '')));
      if (failure) break;
      await page.waitForTimeout(250);
    }
    if (!failure) throw new Error(`no timeout recorded in capture.log: ${JSON.stringify(entries)}`);
    if (entries.some((e: any) => e.stage === 'bridge' && e.phase === 'ok')) throw new Error('a save was written despite the metadata fetch never answering');

    for (const route of held) await route.abort().catch(() => {});

    console.log(`PASS e2e-extension-timeout: the save ended after ${(endedAfterMs / 1000).toFixed(1)}s at stage=${failure.stage} (${failure.error})`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
    nativeHost.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
