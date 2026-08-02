'use strict';

// Reproduction of #594 = **actually reload the extension and orphan a tab that's left open**.
//
// When the extension reloads (after release, this happens via Chrome's
// auto-update), an already-open tab's resident content script loses its
// connection to the extension. The UI stays on the page, but calling `chrome.*`
// throws a synchronous exception. **This situation can be produced for real in
// a disposable Chromium** (`chrome.runtime.reload()`), so this test measures
// the real thing rather than simulating it.
//
// Two layers are checked here:
//
// **(1) the platform's assumptions** (the design leans on these — extension/utils/extension-context.ts)
//   `chrome.runtime.id` turns falsy, and **reading it doesn't throw**.
//   `sendMessage` / `storage.local.get` **throw synchronously**.
//   `onMessage.addListener` / `removeListener` **don't throw**.
//   Warning: if these break, there's no mouth left to detect it with, but all
//   of layer (2)'s wiring tests would still pass green = this is the only place
//   that would notice Chrome changed its behavior. Same division of labor as
//   #269's e2e-extension-inject-failure.cts.
//   To peek into the orphaned side's isolated world, **a single content script
//   dedicated to measurement is added to the same extension** at staging time
//   (since content scripts of the same extension share an isolated world, what
//   resident.js sees can be read as-is). This doesn't ship in the release build.
//
// **(2) the failure mode itself**
//   When clicked (tab A): no exception gets thrown, **"reload this page"
//     appears — not "the save was aborted because it never finished"** —, the
//     corner control disappears, and no separate banner shows up late even past the ack deadline (SAVE_ACK_MS).
//   When not clicked (tab B): the UI disappears **silently** with just a scroll
//     (no banner shown = #154 charter item 2. This is the basis for rejecting a
//     design where every tab gets notified on every auto-update).
//   While a bulk intake is running (tab C, #646): the progress banner switches
//     to "reload this page" and the run ends. **A bulk intake keeps running for
//     minutes at a time** = it's the path most likely to run into an
//     auto-update, and #594's fix hadn't covered this path.
//
//   node scripts/e2e-extension-orphan.cts

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { fixtureHtml } = require('./lib-overlay-e2e.cts');

// The exact text from i18n.ts. The one that should show up, and the one that shouldn't (the misleading text that used to show before #594).
const RELOAD_NOTICE = '拡張機能が更新されました。このページを再読み込みしてください';
const TIMEOUT_NOTICE = '保存が終わらないため中止しました。もう一度お試しください（繰り返す場合は Chrome を再起動）';

// Reports by touching the same chrome that resident.js sees, from the orphaned
// side's isolated world. The result of touching it is placed on
// <html data-orphan-probe> = the only path readable from the page's main world.
const PROBE_JS = `
(() => {
  const snapshot = () => {
    const out = { runtime: typeof chrome.runtime, id: null, idThrew: null, sendThrew: null, storageThrew: null, listenerThrew: null };
    try { out.id = (chrome.runtime && chrome.runtime.id) || null; } catch (e) { out.idThrew = String((e && e.message) || e); }
    try { chrome.runtime.sendMessage({ type: 'hologramOrphanProbe' }, () => void chrome.runtime.lastError); } catch (e) { out.sendThrew = String((e && e.message) || e); }
    try { chrome.storage.local.get('hologramOrphanProbe', () => void chrome.runtime.lastError); } catch (e) { out.storageThrew = String((e && e.message) || e); }
    try { const f = () => {}; chrome.runtime.onMessage.addListener(f); chrome.runtime.onMessage.removeListener(f); } catch (e) { out.listenerThrew = String((e && e.message) || e); }
    return out;
  };
  const report = () => { try { document.documentElement.setAttribute('data-orphan-probe', JSON.stringify(snapshot())); } catch {} };
  report();
  setInterval(report, 400);
})();
`;

// The bulk intake (#362) starts on the bookmarks list and nowhere else, and it
// is started by its own gesture — Alt+Shift+S — which is a browser accelerator
// no page-level input can reach. So the run is started the way background.ts
// starts it, from the worker: the flag first, then the capture entrypoint.
const START_BULK_JS = `
(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://x.com/i/bookmarks*' });
  if (!tab || !tab.id) throw new Error('the bookmarks tab is not visible to the worker');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.__hologramAutoCapture = true; } });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
  return tab.id;
})()
`;

// One more row arrives in the list — the event the intake is built around (it
// reads a permalink the instant a row mounts). Written from the PAGE's world on
// purpose: it has to be the list growing under the run, not the run being poked.
const MOUNT_ROW_JS = `(() => {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  article.innerHTML = '<a href="/zoe/status/9901"><time datetime="2026-07-01T00:00:00Z">now</time></a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/ZZZ.jpg"></div>';
  document.getElementById('feed').appendChild(article);
  return document.querySelectorAll('[data-testid="tweet"]').length;
})()`;

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const FIXTURE_URL = 'https://x.com/home';
// The bulk intake refuses to start anywhere else (isXBookmarksPage), and the
// same fixture serves both: the bookmarks list is a feed of the same rows.
const BOOKMARKS_URL = 'https://x.com/i/bookmarks';

async function openFeed(context: any, url: string = FIXTURE_URL): Promise<any> {
  const page = await context.newPage();
  await page.route('**/*', async (route: any) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.url() === url) await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml('x') });
    else await route.abort();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tweetPhoto"]');
  await wait(900); // document_idle startup, first scan, first badge query
  return page;
}

const overlayState = (page: any) =>
  page.evaluate(() => ({
    controls: document.querySelectorAll('[data-hologram-overlay]').length,
    banner: document.querySelector('hologram-extension-ui')?.shadowRoot?.querySelector('[data-hologram-save-banner]')?.textContent || null,
  }));

// The intake's own surface. `stop` counts the button the run offers while it is
// running: setState drops whatever the previous state had slotted, so a run that
// has ended cannot still be offering it.
const bulkState = (page: any) =>
  page.evaluate(() => {
    const root = document.querySelector('hologram-extension-ui')?.shadowRoot;
    return {
      banner: root?.querySelector('[data-hologram-bulk-label]')?.textContent || null,
      stop: root?.querySelectorAll('[data-hologram-bulk-banner] button').length ?? 0,
    };
  });

(async () => {
  const extensionDir = stageExtension({
    tempPrefix: 'hologram-orphan-e2e-',
    // Only so the worker can inject capture.js into the bookmarks tab below.
    // In real use that injection rides on the activeTab grant Alt+Shift+S
    // carries, and a test cannot press a browser accelerator. Nothing about the
    // intake's own behaviour changes with the wider permission — it neither
    // reads it nor takes a different path.
    allUrls: true,
    // Never the production name: this development machine HAS com.hologram.host
    // registered for Chromium too, and a press that got as far as the host would
    // be writing into the real library.
    nativeHostName: `com.hologram.host.orphan_e2e_${process.pid}`,
  });
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
  fs.writeFileSync(path.join(extensionDir, 'probe.js'), PROBE_JS, 'utf8');
  manifest.content_scripts.push({ matches: ['https://x.com/*'], js: ['probe.js'], run_at: 'document_idle' });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const browser = await launchExtensionBrowser({ extensionDir, headless: true, viewport: { width: 1280, height: 960 }, locale: 'ja-JP' });
  const pageErrors: string[] = [];
  try {
    // Tab A presses; tab B only scrolls. Two tabs because the two halves of the
    // design are mutually exclusive on ONE tab: whichever happens first takes the
    // UI away, and then the other has nothing left to act on.
    const pressTab = await openFeed(browser.context);
    pressTab.on('pageerror', (error: any) => pageErrors.push(String(error?.message || error)));
    const scrollTab = await openFeed(browser.context);
    scrollTab.on('pageerror', (error: any) => pageErrors.push(String(error?.message || error)));

    const photo = await pressTab.$('[data-testid="tweetPhoto"]');
    const box = await photo.boundingBox();
    if (!box) throw new Error('fixture photo has no layout box');
    await pressTab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await pressTab.waitForSelector('[data-hologram-overlay]', { timeout: 4000 });
    check(true, 'baseline: the hover save button is drawn while the extension is alive');

    // A third tab with a bulk intake RUNNING on it (#646). Started before the
    // reload, because that is the situation: a run lasts minutes and the update
    // lands in the middle of one.
    const bulkTab = await openFeed(browser.context, BOOKMARKS_URL);
    bulkTab.on('pageerror', (error: any) => pageErrors.push(String(error?.message || error)));
    await browser.serviceWorker.evaluate(START_BULK_JS);
    await bulkTab.waitForSelector('[data-hologram-bulk-banner]', { timeout: 6000 });
    const bulkBefore = await bulkState(bulkTab);
    check(bulkBefore.banner !== RELOAD_NOTICE && bulkBefore.stop === 1, `baseline: the intake is running and offering its stop button (${JSON.stringify(bulkBefore)})`);

    // --- orphan every tab for real ------------------------------------------
    // The call kills the worker that is running it, so the evaluate never returns.
    await browser.serviceWorker.evaluate('chrome.runtime.reload()').catch(() => {});
    await wait(2500);

    // --- #657: the platform actually RELOADED, it didn't just disable ------
    // A disabled extension produces the exact same orphaning symptoms this
    // file checks below (no live extension left to talk to from the old
    // tabs), so without this check the whole file would go green whether
    // Chrome reloaded the extension or silently disabled it instead — which
    // is exactly what happened before #657 (Chrome 137+ dropped
    // `--load-extension`, and the disposable Chromium this test drives
    // disabled the extension on `reload()` rather than reloading it). A new,
    // enabled service worker for the same extension ID is the one signal that
    // tells the two apart.
    const isReplacementWorker = (worker: any) => worker.url().startsWith(`chrome-extension://${browser.extensionId}/`) && worker !== browser.serviceWorker;
    const reloaded = browser.context.serviceWorkers().find(isReplacementWorker) || (await browser.context.waitForEvent('serviceworker', { predicate: isReplacementWorker, timeout: 5000 }).catch(() => null));
    check(!!reloaded, 'a new service worker started after reload() — chrome.runtime.reload() reloaded the extension rather than disabling it (#657)');
    if (reloaded) {
      const self = await reloaded.evaluate('chrome.management.getSelf()').catch((error: any) => ({ error: String(error) }));
      check(self?.enabled === true, `the reloaded extension reports enabled:true — it was not left disabled (${JSON.stringify(self)})`);
    }

    // --- ① the platform premises --------------------------------------------
    const probe = JSON.parse((await pressTab.evaluate(() => document.documentElement.getAttribute('data-orphan-probe'))) || '{}');
    check(probe.runtime === 'object', `chrome.runtime is still an object in the orphaned world (got ${probe.runtime})`);
    check(!probe.id && probe.idThrew === null, `chrome.runtime.id went falsy WITHOUT throwing — this is the detector (id ${JSON.stringify(probe.id)}, threw ${JSON.stringify(probe.idThrew)})`);
    check(/invalidated/i.test(probe.sendThrew || ''), `chrome.runtime.sendMessage throws synchronously (${JSON.stringify(probe.sendThrew)})`);
    check(/invalidated/i.test(probe.storageThrew || ''), `chrome.storage.local.get throws synchronously (${JSON.stringify(probe.storageThrew)})`);
    check(probe.listenerThrew === null, `runtime.onMessage add/removeListener do NOT throw — Chrome has already dropped them (${JSON.stringify(probe.listenerThrew)})`);

    // --- ② the press --------------------------------------------------------
    const before = await overlayState(pressTab);
    check(before.controls > 0, `the injected UI is still on the page after the reload — this is the bug's whole premise (${before.controls} controls)`);

    const control = await pressTab.$('[data-hologram-overlay]');
    if (!control) throw new Error('no corner control to press');
    await control.click();
    await wait(600);
    const pressed = await overlayState(pressTab);
    check(pageErrors.length === 0, `pressing an orphaned save button throws nothing into the page (${JSON.stringify(pageErrors)})`);
    check(pressed.banner === RELOAD_NOTICE, `the banner names the repair that works — reload THIS page (got ${JSON.stringify(pressed.banner)})`);
    check(pressed.controls === 0, `the stale controls are gone, so there is nothing left to press again (${pressed.controls} remain)`);

    // Past SAVE_ACK_MS (deadline.ts): the timer armed by startSaveDeadline used
    // to be the only survivor of the throw, and it is what reported a timeout on
    // a healthy extension nine seconds later.
    await wait(12_000);
    const late = await overlayState(pressTab);
    check(late.banner !== TIMEOUT_NOTICE, `no late timeout banner blames the host for an extension that was merely updated (got ${JSON.stringify(late.banner)})`);
    check(pageErrors.length === 0, `still nothing thrown once the save deadline has passed (${JSON.stringify(pageErrors)})`);

    // --- ② the tab nobody pressed anything on -------------------------------
    //
    // Measured by HOVERING rather than by counting what is already on screen:
    // the control is drawn on the picture under the pointer, so scrolling takes
    // it away all by itself (the picture leaves the pointer) and a
    // before/after count would go to zero whether or not this issue was ever
    // fixed. Asking for a fresh one AFTER the scroll is the question with only
    // one answer — a live overlay draws it, a torn-down one cannot.
    //
    // ⚠️The picture has to be one that is ON SCREEN NOW. Aiming at the first
    // photo in the document would, after the scroll below, aim above the
    // viewport — the pointer would land on nothing, no control would be drawn,
    // and this check would pass whether or not anything was fixed (it did, on
    // the first version of this file).
    const hoverControlCount = async (page: any) => {
      const index = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('[data-testid="tweetPhoto"]')];
        return boxes.findIndex((el) => {
          const r = el.getBoundingClientRect();
          return r.top > 8 && r.bottom < innerHeight - 8 && r.width > 0;
        });
      });
      if (index < 0) throw new Error('no fixture photo is fully on screen to hover');
      const rect = await (await page.$$('[data-testid="tweetPhoto"]'))[index].boundingBox();
      await page.mouse.move(5, 5);
      await wait(150);
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await wait(700);
      return (await overlayState(page)).controls;
    };

    check((await hoverControlCount(scrollTab)) > 0, 'the untouched tab still draws its (now useless) save button after the reload — the bug as reported');

    await scrollTab.mouse.move(5, 5);
    for (let i = 0; i < 6; i++) {
      await scrollTab.mouse.wheel(0, 400);
      await wait(120);
    }
    await wait(1200);
    const stillDraws = await hoverControlCount(scrollTab);
    const scrolled = await overlayState(scrollTab);
    check(stillDraws === 0, `after scrolling, the orphaned overlay draws nothing at all — it took itself off the page (${stillDraws} drawn)`);
    check(scrolled.banner === null, `…and said nothing while doing it — an auto-update must not toast every open timeline (got ${JSON.stringify(scrolled.banner)})`);
    check(pageErrors.length === 0, `nothing thrown on the passive path either (${JSON.stringify(pageErrors)})`);

    // --- ② the bulk intake that was running when the update landed (#646) ----
    //
    // Last on purpose: this is the section that produces uncaught errors on the
    // unfixed code, and the checks above read the same `pageErrors` array.
    //
    // The trigger is a ROW MOUNTING, not a scroll or a click, because that is
    // the intake's only input — it reads a permalink the instant a row appears
    // and asks the library whether that post is already saved. That question is
    // the sendMessage this issue is about. By now more than SAVED_QUERY_TIMEOUT_MS
    // has passed since the reload, so the batch that was in flight before it has
    // long since given up and cleared the "a question is out" latch; without
    // that the run would decline to ask again and nothing would be measured.
    const rows = await bulkTab.evaluate(MOUNT_ROW_JS);
    check(rows > 8, `a new row mounted in the bookmark list, which is the intake's only input (${rows} rows)`);
    await wait(1500);
    const bulkAfter = await bulkState(bulkTab);
    check(pageErrors.length === 0, `the running intake asks about the new row without throwing into the page (${JSON.stringify(pageErrors)})`);
    check(bulkAfter.banner === RELOAD_NOTICE, `the progress banner became the reload notice — the run was cut off by an update, not by anything the user or the library did (got ${JSON.stringify(bulkAfter.banner)})`);
    check(bulkAfter.stop === 0, `…and the run is over rather than relabelled: its stop button is gone (${bulkAfter.stop} left)`);
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\nFAIL e2e-extension-orphan: ${failures.length} check(s) failed — an orphaned tab is not behaving as #594 decided`);
    process.exit(1);
  }
  console.log('\nPASS e2e-extension-orphan: an orphaned tab throws nothing, clears what it drew, and only speaks when the user asked for a save');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
