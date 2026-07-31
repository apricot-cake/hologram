'use strict';

// #594 の再現＝**拡張を実際にリロードして、開いたままのタブを孤児にする**。
//
// 拡張がリロード（リリース後は Chrome による自動更新）されると、既に開いていたタブの
// 常駐コンテンツスクリプトは拡張との接続を失う。UI はページに残ったまま、`chrome.*` を
// 呼ぶと同期例外になる。**この状況は使い捨て Chromium で本物を作れる**（`chrome.runtime.reload()`）
// ので、ここは模擬ではなく現物を測る。
//
// 見るのは2層:
//
// **① プラットフォームの前提**（設計がここに寄りかかっている・extension/utils/extension-context.ts）
//   `chrome.runtime.id` が falsy に変わり、**読んでも投げない**こと。
//   `sendMessage` / `storage.local.get` は**同期で投げる**こと。
//   `onMessage.addListener` / `removeListener` は**投げない**こと。
//   ⚠️これが崩れると検知の口が無くなるが、②の配線テストは全部緑のまま通る＝Chrome が
//   振る舞いを変えたことはここでしか分からない。#269 の e2e-extension-inject-failure.cts
//   と同じ役割分担。
//   孤児側の isolated world を覗くために、**同じ拡張へ計測専用の content script を1本**
//   ステージング時に足している（同一拡張の content script は isolated world を共有するので、
//   resident.js が見ているものがそのまま読める）。出荷物には入らない。
//
// **② 壊れ方そのもの**
//   押した時（タブA）: 例外が積まれないこと・**「保存が終わらないため中止しました」ではなく
//     「再読み込みしてください」**が出ること・角のコントロールが消えること・
//     受領期限（SAVE_ACK_MS）を過ぎても遅れて別のバナーが出ないこと。
//   押していない時（タブB）: スクロールしただけで**黙って**UI が消えること
//     （バナーを出さない＝#154 憲章2。自動更新のたびに全タブへ通知が出る形を却下した根拠）。
//
//   node scripts/e2e-extension-orphan.cts

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { fixtureHtml } = require('./lib-overlay-e2e.cts');

// i18n.ts の文言そのもの。出るべき方と、出てはいけない方（#594 以前に出ていた誤誘導）。
const RELOAD_NOTICE = '拡張機能が更新されました。このページを再読み込みしてください';
const TIMEOUT_NOTICE = '保存が終わらないため中止しました。もう一度お試しください（繰り返す場合は Chrome を再起動）';

// 孤児側の isolated world から、resident.js が見ているのと同じ chrome を触って報告する。
// 触った結果は <html data-orphan-probe> に載せる＝ページのメインワールドから読める唯一の道。
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

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const FIXTURE_URL = 'https://x.com/home';

async function openFeed(context: any): Promise<any> {
  const page = await context.newPage();
  await page.route('**/*', async (route: any) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.url() === FIXTURE_URL) await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml('x') });
    else await route.abort();
  });
  await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tweetPhoto"]');
  await wait(900); // document_idle startup, first scan, first badge query
  return page;
}

const overlayState = (page: any) =>
  page.evaluate(() => ({
    controls: document.querySelectorAll('[data-hologram-overlay]').length,
    banner: document.querySelector('hologram-extension-ui')?.shadowRoot?.querySelector('[data-hologram-save-banner]')?.textContent || null,
  }));

(async () => {
  const extensionDir = stageExtension({
    tempPrefix: 'hologram-orphan-e2e-',
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

    // --- orphan both tabs for real ------------------------------------------
    // The call kills the worker that is running it, so the evaluate never returns.
    await browser.serviceWorker.evaluate('chrome.runtime.reload()').catch(() => {});
    await wait(2500);

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
