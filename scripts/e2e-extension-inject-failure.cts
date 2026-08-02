'use strict';

// Measures, on a real browser, and pins down the platform facts that #269's design leans on.
//
// A click-to-save works via "the service worker injects capture.js, and the
// injected script draws the banner", so **if the injection itself fails, there
// is no surface on the page to communicate the failure** = clicking does
// absolutely nothing. extension/utils/inject-failure.ts is built on the
// assumption that the only remaining display surface is the worker's own toolbar action.
//
// Warning: **actually driving an icon click isn't possible on this rig**
// (`chrome.action.onClicked` only fires on a real click, and Playwright has no
// way to press the toolbar). So what this checks isn't the wiring but the
// **assumptions** — the wiring side is covered by jsdom's
// `background-wiring.test.ts`. They're kept separate because if the
// assumptions break, the wiring tests would all still pass green = only this
// test would notice that Chrome changed its behavior.
//
// The 5 things measured:
//   1. action's badge / title can be written by the worker with no extra permissions
//   2. badge is per-tabId = it doesn't leak to other tabs or apply globally
//   3. when a tab navigates, Chrome resets both badge and title on its own
//      (= all this side needs to do is discard its "which round" memory)
//   4. once the unpacked extension's directory disappears, executeScript fails
//      every time, and so does `fetch(chrome.runtime.getURL(...))` (= the only
//      way to tell alive from dead), but **the action API stays alive** (= a mark can still be shown even while broken)
//   5. in that state, **chrome-extension://<id>/diag.html cannot be opened**
//      = the diagnostics page can't be the fallback destination for this
//      failure (the basis for replacing step 4 of the 2026-07-25 design
//      decision comment; the fallback destination for the unreadable side is chrome://extensions)
//
// Disposable Chromium and disposable extension staging = touches neither the
// user's profile nor the main tree's .output.

const fs = require('node:fs');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const sw = (worker: any, expression: string) => worker.evaluate(expression);

async function tabIdEndingWith(worker: any, suffix: string): Promise<number> {
  const tabs = await sw(worker, `(async () => (await chrome.tabs.query({})).map(t => ({ id: t.id, url: t.url })))()`);
  const hit = tabs.find((t: any) => String(t.url || '').endsWith(suffix));
  if (!hit) throw new Error(`no tab whose url ends with ${suffix} (saw ${JSON.stringify(tabs)})`);
  return hit.id;
}

(async () => {
  // allUrls: the probe pages below are example.com, which the shipped
  // host_permissions do not cover — without it chrome.tabs.query answers
  // without urls and there is nothing to aim at.
  const extensionDir = stageExtension({ allUrls: true, tempPrefix: 'hologram-inject-failure-e2e-' });
  const browser = await launchExtensionBrowser({ extensionDir, headless: true });
  const { context, serviceWorker, extensionId } = browser;
  let moved = false;
  const movedDir = `${extensionDir}-moved`;

  try {
    const pageA = await context.newPage();
    await pageA.goto('https://example.com/alpha');
    const pageB = await context.newPage();
    await pageB.goto('https://example.com/beta');
    const tabA = await tabIdEndingWith(serviceWorker, '/alpha');
    const tabB = await tabIdEndingWith(serviceWorker, '/beta');

    // --- 1 + 2 -------------------------------------------------------------
    // Warning: the color below is only a value to check that "the API can
    // accept an already-resolved color string" — it isn't the shipped color
    // (the shipped value's provenance and validity are extension-tokens.test.ts's job).
    const wrote = await sw(
      serviceWorker,
      `(async () => {
        try {
          await chrome.action.setBadgeText({ text: '!', tabId: ${tabA} });
          await chrome.action.setBadgeBackgroundColor({ color: '#c00000', tabId: ${tabA} });
          await chrome.action.setBadgeTextColor({ color: '#ffffff', tabId: ${tabA} });
          await chrome.action.setTitle({ title: 'probe', tabId: ${tabA} });
          return { ok: true };
        } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
      })()`,
    );
    check(wrote.ok === true, `the service worker can write the badge and title with no permission beyond \`action\` (${wrote.error || 'no error'})`);

    const scoped = await sw(
      serviceWorker,
      `(async () => ({
        a: await chrome.action.getBadgeText({ tabId: ${tabA} }),
        b: await chrome.action.getBadgeText({ tabId: ${tabB} }),
        global: await chrome.action.getBadgeText({}),
        aTitle: await chrome.action.getTitle({ tabId: ${tabA} }),
      }))()`,
    );
    check(scoped.a === '!', `the marked tab reads the badge back (got "${scoped.a}")`);
    check(scoped.b === '' && scoped.global === '', `no other tab and no global badge picked it up (other "${scoped.b}", global "${scoped.global}")`);
    check(scoped.aTitle === 'probe', `the tooltip is tab-scoped too (got "${scoped.aTitle}")`);

    // --- 3 -----------------------------------------------------------------
    await pageA.goto('https://example.com/alpha2');
    await pageA.waitForTimeout(500);
    const afterNav = await sw(serviceWorker, `(async () => ({ text: await chrome.action.getBadgeText({ tabId: ${tabA} }), title: await chrome.action.getTitle({ tabId: ${tabA} }) }))()`);
    check(afterNav.text === '', `Chrome clears a tab-scoped badge on navigation by itself (got "${afterNav.text}")`);
    check(afterNav.title !== 'probe', `…and the tab-scoped tooltip with it (got "${afterNav.title}")`);

    // --- healthy baseline ---------------------------------------------------
    const before = await sw(
      serviceWorker,
      `Promise.all([
        chrome.scripting.executeScript({ target: { tabId: ${tabB} }, files: ['capture.js'] }).then(() => null, e => String((e && e.message) || e)),
        fetch(chrome.runtime.getURL('diag.html')).then(r => r.ok, () => false),
      ]).then(([inject, readable]) => ({ inject, readable }))`,
    );
    check(before.inject === null, `while healthy, injection succeeds (${before.inject || 'no error'})`);
    check(before.readable === true, 'while healthy, the worker can read its own diag.html');

    // --- 4 + 5: the package becomes unreadable -------------------------------
    fs.renameSync(extensionDir, movedDir);
    moved = true;

    const pageC = await context.newPage();
    await pageC.goto('https://example.com/gamma');
    await pageC.waitForTimeout(300);
    const tabC = await tabIdEndingWith(serviceWorker, '/gamma');

    const after = await sw(
      serviceWorker,
      `Promise.all([
        chrome.scripting.executeScript({ target: { tabId: ${tabC} }, files: ['capture.js'] }).then(() => null, e => String((e && e.message) || e)),
        fetch(chrome.runtime.getURL('diag.html')).then(r => r.ok, () => false),
        (async () => {
          try {
            await chrome.action.setBadgeText({ text: '!', tabId: ${tabC} });
            await chrome.action.setTitle({ title: 'still alive', tabId: ${tabC} });
            return { text: await chrome.action.getBadgeText({ tabId: ${tabC} }), title: await chrome.action.getTitle({ tabId: ${tabC} }) };
          } catch (e) { return { error: String((e && e.message) || e) }; }
        })(),
      ]).then(([inject, readable, badge]) => ({ inject, readable, badge }))`,
    );
    check(typeof after.inject === 'string', `injection now fails on every page (Chrome said: ${after.inject})`);
    check(after.readable === false, 'the liveness probe (fetch of an own resource) now fails — this is what tells the two causes apart');
    check(after.badge.text === '!' && after.badge.title === 'still alive', `the action API still paints while the package is unreadable (${JSON.stringify(after.badge)})`);

    const pageD = await context.newPage();
    let diagError: string | null = null;
    try {
      await pageD.goto(`chrome-extension://${extensionId}/diag.html`, { timeout: 10_000 });
    } catch (error: any) {
      diagError = String(error?.message || error);
    }
    check(diagError !== null && /ERR_FILE_NOT_FOUND|ERR_FAILED|ERR_BLOCKED/.test(diagError), `the diagnostics page cannot be opened in this state — so it cannot be the escalation for it (${diagError ? diagError.split('\n')[0] : 'it LOADED'})`);
  } finally {
    if (moved) fs.renameSync(movedDir, extensionDir);
    await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\nFAIL e2e-extension-inject-failure: ${failures.length} of the premises #269 rests on no longer hold`);
    process.exit(1);
  }
  console.log('\nPASS e2e-extension-inject-failure: the toolbar action is still the one surface that survives an unreadable package, and the diagnostics page is still not');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
