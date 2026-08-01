'use strict';

// Browser-level test for the duplicate-save warning (#34), on the same
// deterministic rig as e2e-extension-offline.cts: a Playwright route serves an
// X-shaped post and its metadata from memory, and a uniquely named temporary
// Native Messaging host writes into a temporary Hologram config/library. No
// user browser profile, real native-host registration or personal library is
// read or touched.
//
// What only a real browser can show, and the reason this exists next to the
// jsdom suites: the question is answered by the REAL native host. The first
// capture writes bridge-journal.jsonl; the second capture's checkDuplicate has
// to find it through the bridge's own saved-post index and say "already saved"
// — a round trip that spans the content script, the service worker, the native
// messaging port and the host process, none of which a unit test stands up.
//
// The three answers are exercised in the order that leaves the least behind:
//   1st capture  — the library is empty, so no question is asked
//   2nd capture  — the question appears; "skip" writes nothing
//   3rd capture  — "replace" writes a record carrying `replaces` = the first
//                  capture's id (the marker; retiring the old capture is the
//                  desktop app's job and is covered by test-app-replaces.cts)

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { createNativeHostSandbox } = require('./lib-native-host-e2e.cts');

declare const chrome: any;

const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const POST_ID = '1999999999999999998';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;

const POST_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>Hologram duplicate-warning fixture</title>
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
    <p>Duplicate warning fixture post</p>
    <div class="media" data-testid="tweetPhoto" aria-label="fixture image"></div>
  </article>
</body>
</html>`;

const POST_METADATA = {
  text: 'Duplicate warning fixture post',
  user: { name: 'Hologram Fixture', screen_name: 'hologram', id_str: '131' },
  favorite_count: 3,
  conversation_count: 0,
  created_at: '2026-07-25T00:00:00.000Z',
  lang: 'ja',
  mediaDetails: [],
};

function envelopes(libraryDir: string): any[] {
  const dir = path.join(libraryDir, '.hologram-inbox', 'new');
  let names: string[];
  try {
    names = fs
      .readdirSync(dir)
      .filter((f: string) => f.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  return names.map((f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

async function waitForEnvelopes(libraryDir: string, want: number, timeoutMs = 20_000): Promise<any[]> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = envelopes(libraryDir);
    if (found.length >= want) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`only ${envelopes(libraryDir).length} inbox envelope(s) after ${timeoutMs}ms, wanted ${want}`);
}

(async () => {
  const nativeHost = createNativeHostSandbox(EXPECTED_EXTENSION_ID);
  const extensionDir = stageExtension({
    allUrls: true,
    nativeHostName: nativeHost.hostName,
    tempPrefix: 'hologram-extension-duplicate-e2e-ext-',
  });
  let browser: any = null;

  try {
    browser = await launchExtensionBrowser({ extensionDir, headless: true, viewport: { width: 1280, height: 900 } });
    if (browser.extensionId !== EXPECTED_EXTENSION_ID) {
      throw new Error(`staged extension id ${browser.extensionId} does not match native-host allow-list ${EXPECTED_EXTENSION_ID}`);
    }

    await browser.context.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url === POST_URL) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: POST_HTML });
      else if (url.startsWith('https://cdn.syndication.twimg.com/tweet-result?')) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(POST_METADATA) });
      else await route.abort();
    });

    const page = await browser.context.newPage();
    await page.goto(POST_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#capture-target').waitFor();

    // Alt+S is a browser-level command Playwright cannot press, so activation
    // goes through the same scripting.executeScript the command handler calls.
    const activate = async () => {
      const res = await browser.serviceWorker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: 'no active tab' };
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['entrypoints/capture.js'] });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      });
      if (!res.ok) throw new Error(`capture activation failed: ${res.error}`);
    };
    const choice = (which: string) => page.locator(`[data-hologram-choice="${which}"]`);
    // capture.js is single-shot and TOGGLES: while its banner is still up,
    // re-injecting it cancels the run instead of starting a new one. The banner
    // lingers ~1.5s after a result, and its cleanup flag lives in the content
    // script's isolated world where page.evaluate cannot see it — so the gap is
    // a wait, not a condition.
    const settleCapture = () => page.waitForTimeout(2500);

    // --- 1st: nothing saved yet, so no question ---------------------------
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    const first = await waitForEnvelopes(nativeHost.libraryDir, 1);
    if (await choice('copy').count()) throw new Error('the first capture of an empty library asked about a duplicate');
    await settleCapture();
    const firstId = first[0].record.captureId;
    if (first[0].record.replaces !== null) throw new Error(`an ordinary save carried a replaces marker: ${first[0].record.replaces}`);

    // --- 2nd: the question, answered "skip" -------------------------------
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await choice('skip').waitFor({ timeout: 15_000 });
    for (const which of ['copy', 'replace', 'skip']) {
      if (!(await choice(which).count())) throw new Error(`the duplicate warning is missing its "${which}" answer`);
    }
    await choice('skip').click();
    // Long enough that a save started anyway would have landed (the first one
    // took well under this) — there is no positive event for "did not save".
    await page.waitForTimeout(3000);
    if (envelopes(nativeHost.libraryDir).length !== 1) throw new Error('"skip" saved anyway');
    await settleCapture();

    // --- 3rd: the question, answered "replace" ----------------------------
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await choice('replace').waitFor({ timeout: 15_000 });
    await choice('replace').click();
    const both = await waitForEnvelopes(nativeHost.libraryDir, 2);
    const replacement = both.find((e: any) => e.record.captureId !== firstId);
    if (!replacement) throw new Error('the replacement produced no new record');
    if (replacement.record.replaces !== firstId) {
      throw new Error(`the replacement names the wrong capture: ${replacement.record.replaces} (wanted ${firstId})`);
    }

    console.log(`PASS e2e-extension-duplicate: asked twice, skipped once, ${replacement.record.captureId} replaces ${firstId}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
    nativeHost.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
