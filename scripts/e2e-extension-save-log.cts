'use strict';

// Checks, on a real browser and a real native host, that "just activated" and
// "a save started and never finished" can be told apart in capture.log (#519).
//
// These two used to produce the same record = both had a single activate line
// with nothing following it. A session that read the log misdiagnosed this
// three times in a row, and once even issued a false warning to the user and
// had to retract it. So the acceptance criterion is "distinguishable from the
// log alone", and there's no way to verify that other than **actually running
// both and lining up the records** = this script does both in a single run and prints both records.
//
// Same rig as e2e-extension-timeout = disposable Chromium, disposable native
// host registration, disposable library — touches neither the user's profile
// nor the real library.
//
// The jsdom side (scripts/save-log.test.ts) checks this same distinction with
// the content script alone. The only thing that can be seen here is **whether
// the line actually makes it to disk through the host's process**.

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { createNativeHostSandbox } = require('./lib-native-host-e2e.cts');

declare const chrome: any;

const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const POST_ID = '1999999999999999996';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;

// The metadata cap is 20 seconds. Wait a bit over twice that to avoid missing it.
const WAIT_FOR_END_MS = 45_000;
// Time until the host's process wakes up and finishes writing one line (takes 1-2 seconds on Windows).
const WAIT_FOR_LOG_MS = 20_000;

const POST_HTML = `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>Hologram save-log fixture</title>
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
    <p>Save-log fixture post</p>
    <div class="media" data-testid="tweetPhoto" aria-label="fixture image"></div>
  </article>
</body>
</html>`;

const POST_METADATA = {
  text: 'Save-log fixture post',
  user: { name: 'Hologram Fixture', screen_name: 'hologram', id_str: '131' },
  favorite_count: 1,
  conversation_count: 0,
  created_at: '2026-07-29T00:00:00.000Z',
  lang: 'ja',
  mediaDetails: [],
};

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

// Renders one entry into a single readable line = this printout is the actual evidence that "the two look different".
function render(entry: any): string {
  const bits = [`${entry.stage}/${entry.phase}`];
  if (entry.saveId) bits.push(`saveId=${entry.saveId}`);
  if (Array.isArray(entry.reached)) bits.push(`reached=[${entry.reached.join(',')}]`);
  if (entry.error) bits.push(`error=${String(entry.error).slice(0, 60)}`);
  return `    ${entry.ts} ${bits.join(' ')}`;
}

async function waitForLog(configDir: string, from: number, predicate: (entries: any[]) => boolean, page: any): Promise<any[]> {
  let entries: any[] = [];
  for (const started = Date.now(); Date.now() - started < WAIT_FOR_LOG_MS; ) {
    entries = captureLogEntries(configDir).slice(from);
    if (predicate(entries)) return entries;
    await page.waitForTimeout(250);
  }
  return entries;
}

(async () => {
  const nativeHost = createNativeHostSandbox(EXPECTED_EXTENSION_ID);
  const extensionDir = stageExtension({
    allUrls: true,
    nativeHostName: nativeHost.hostName,
    tempPrefix: 'hologram-extension-save-log-e2e-ext-',
  });
  let browser: any = null;

  try {
    browser = await launchExtensionBrowser({ extensionDir, headless: true, viewport: { width: 1280, height: 900 } });
    if (browser.extensionId !== EXPECTED_EXTENSION_ID) {
      throw new Error(`staged extension id ${browser.extensionId} does not match native-host allow-list ${EXPECTED_EXTENSION_ID}`);
    }

    // Make the metadata fetch, in case (2), a peer that "stays connected but
    // silent", and in case (3), a peer that answers normally. abort would end
    // the save (since it rejects) = the only way to create a save that never
    // finishes is to keep holding the route open.
    const held: any[] = [];
    let stallMetadata = true;
    await browser.context.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url === POST_URL) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: POST_HTML });
      else if (!url.startsWith('https://cdn.syndication.twimg.com/tweet-result?')) await route.abort();
      else if (stallMetadata) held.push(route);
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(POST_METADATA) });
    });

    const page = await browser.context.newPage();
    await page.goto(POST_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#capture-target').waitFor();

    // Alt+S is a browser-side command that Playwright can't press, so inject
    // via the same scripting.executeScript that the command handler calls.
    const activate = async () => {
      // Wait for the previous round to finish cleaning up. Re-injecting
      // capture.js is a toggle that "ends whichever round is running"
      // (__snsPostSaveCleanup), so if it's injected before the failure display
      // disappears, a new round won't start and it'll just close the previous one.
      await page.locator('[data-hologram-capture-banner]').waitFor({ state: 'detached', timeout: 15_000 });
      const done = await browser.serviceWorker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: 'no active tab' };
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['entrypoints/capture.js'] });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      });
      if (!done.ok) throw new Error(`capture activation failed: ${done.error}`);
      await page.locator('[data-hologram-capture-banner][data-state="active"]').waitFor({ timeout: 15_000 });
    };

    // === (1) opened the UI and closed it without saving =====================================
    await activate();
    await page.keyboard.press('Escape');

    const opened = await waitForLog(nativeHost.configDir, 0, (e) => e.some((x: any) => x.phase === 'cancel'), page);
    const cancel = opened.find((e: any) => e.phase === 'cancel');
    if (!cancel) throw new Error(`case 1 wrote no cancel line: ${JSON.stringify(opened)}`);
    if (cancel.stage !== 'select') throw new Error(`case 1 cancelled at stage=${cancel.stage}, wanted select (nothing was chosen)`);
    if (opened.some((e: any) => e.stage === 'save' && e.phase === 'begin')) throw new Error('case 1 announced a save that never happened');
    if (opened.some((e: any) => e.phase === 'fail')) throw new Error(`case 1 recorded a failure: ${JSON.stringify(opened)}`);

    const afterCase1 = captureLogEntries(nativeHost.configDir).length;

    // === (2) started a save and it stalled partway through =====================================
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await page.locator('[data-hologram-capture-banner][data-state="busy"]').waitFor({ timeout: 15_000 });

    // The fact that it started is on disk **before entering the wait** = without this, it can't be distinguished from case (1).
    const begun = await waitForLog(nativeHost.configDir, afterCase1, (e) => e.some((x: any) => x.stage === 'save' && x.phase === 'begin'), page);
    const begin = begun.find((e: any) => e.stage === 'save' && e.phase === 'begin');
    if (!begin) throw new Error(`case 2 never announced its save: ${JSON.stringify(begun)}`);
    if (!begin.saveId) throw new Error('the begin line carries no saveId, so nothing can be tied to it');

    await page.locator('[data-hologram-capture-banner][data-state="error"]').waitFor({ timeout: WAIT_FOR_END_MS });

    const stalled = await waitForLog(nativeHost.configDir, afterCase1, (e) => e.some((x: any) => x.phase === 'fail'), page);
    const failure = stalled.find((e: any) => e.phase === 'fail');
    if (!failure) throw new Error(`case 2 recorded no failure: ${JSON.stringify(stalled)}`);
    if (failure.saveId !== begin.saveId) throw new Error(`the failure (saveId=${failure.saveId}) cannot be tied to the begin (saveId=${begin.saveId})`);
    if (stalled.some((e: any) => e.phase === 'cancel')) throw new Error('case 2 claims the user gave up; nobody did');
    if (stalled.some((e: any) => e.stage === 'bridge' && e.phase === 'ok')) throw new Error('a save was written despite the metadata fetch never answering');

    // How far it got = screenshot and crop finished, and it stalled at metadata.
    // This is exactly the question #507's investigation couldn't answer.
    if (failure.stage !== 'metadata') throw new Error(`the failure names stage=${failure.stage}, wanted metadata`);
    const reached = Array.isArray(failure.reached) ? failure.reached : [];
    if (reached.join(',') !== 'capture,crop') throw new Error(`the failure says it reached [${reached.join(',')}], wanted [capture,crop]`);

    for (const route of held) await route.abort().catch(() => {});
    const afterCase2 = captureLogEntries(nativeHost.configDir).length;

    // === (3) a save that finished normally ==============================================
    // The control case = a stalled save can be read as "stalled" only because a
    // finished save can be read as "finished" — the distinction only holds once
    // both are seen from a single record. Also checks that the two lines the
    // host writes (received / finished writing) carry the saveId the extension assigned.
    stallMetadata = false;
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await page.locator('[data-hologram-capture-banner][data-state="success"]').waitFor({ timeout: WAIT_FOR_END_MS });

    const done = await waitForLog(nativeHost.configDir, afterCase2, (e) => e.some((x: any) => x.stage === 'bridge' && x.phase === 'ok'), page);
    const ids = new Set(done.filter((e: any) => e.saveId).map((e: any) => e.saveId));
    if (ids.size !== 1) throw new Error(`case 3 spread over ${ids.size} save ids, wanted 1: ${JSON.stringify(done)}`);
    const trail = done.map((e: any) => `${e.stage}/${e.phase}`);
    // The host receiving it and the host finishing writing it are separate
    // lines = this lets "never reached the host" and "the host had it but it
    // never finished" be told apart (a question #507 couldn't answer).
    for (const wanted of ['save/begin', 'bridge/begin', 'bridge/ok']) {
      if (!trail.includes(wanted)) throw new Error(`case 3 is missing the ${wanted} line: ${trail.join(' → ')}`);
    }
    if (done.some((e: any) => e.phase === 'fail' || e.phase === 'cancel')) throw new Error(`case 3 recorded trouble: ${JSON.stringify(done)}`);

    const all = captureLogEntries(nativeHost.configDir);
    console.log('  ① UI を開いて保存せずに閉じた:');
    for (const e of all.slice(0, afterCase1)) console.log(render(e));
    console.log('  ② 保存を始めて途中で止まった:');
    for (const e of all.slice(afterCase1, afterCase2)) console.log(render(e));
    console.log('  ③ 保存が普通に終わった（対照）:');
    for (const e of all.slice(afterCase2)) console.log(render(e));
    console.log(`PASS e2e-extension-save-log: the three read differently — ① ${cancel.stage}/${cancel.phase} with no save announced, ② save/begin then ${failure.stage}/${failure.phase} having reached [${reached.join(',')}], ③ ${trail.join(' → ')} under one saveId`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
    nativeHost.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
