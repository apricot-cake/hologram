// 拡張機能の更新後、開いたままのタブを再注入して復旧する実ブラウザ試験。
//
// Chrome は manifest の content_scripts を新しいページにしか注入しない。拡張
// 機能のリロード後に残る古いコンテンツスクリプトは extension context を失うため、
// background.ts は onInstalled で現在の resident.js を既存タブへ注入し直す。
// これは使い捨て Chromium の chrome.runtime.reload() で実測する。
//
// 孤立したスクリプトが Chrome API をどう失うかも一緒に計測する。再注入がその
// 挙動を隠して、実際には Chrome が拡張機能を無効化していた場合を通してしまわ
// ないようにするため。

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { fixtureHtml } = require('./lib-overlay-e2e.cts');
const { sleep, waitFor } = require('./lib-wait.cts');

// resident.js と同じ分離ワールドで extension context の状態を読む。これは
// ステージしたテスト拡張機能だけに加える計測用スクリプトで、リリースには入らない。
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

async function openFeed(context: any, url: string): Promise<any> {
  const page = await context.newPage();
  await page.route('**/*', async (route: any) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.url() === url) await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml('x') });
    else await route.abort();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tweetPhoto"]');
  // document_idle の常駐スクリプトは、ポインタが写真に入るまで何も描かない。
  // biome-ignore lint/plugin: content-script startup has no observable DOM result
  await sleep(900);
  return page;
}

const overlayCount = (page: any) => page.evaluate(() => document.querySelectorAll('[data-hologram-overlay]').length);

async function hoverControlCount(page: any): Promise<number> {
  const index = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-testid="tweetPhoto"]')];
    return boxes.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return r.top > 8 && r.bottom < innerHeight - 8 && r.width > 0;
    });
  });
  if (index < 0) throw new Error('ホバーできる、画面に完全に収まったフィクスチャの写真が無い');
  const rect = await (await page.$$('[data-testid="tweetPhoto"]'))[index].boundingBox();
  await page.mouse.move(5, 5);
  // biome-ignore lint/plugin: lets the previous control leave before measuring the next one
  await sleep(150);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  // biome-ignore lint/plugin: lets the resident overlay react to the pointer event
  await sleep(700);
  return overlayCount(page);
}

const residentStatus = (worker: any) =>
  worker.evaluate(`(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://x.com/*' });
    return Promise.all(tabs.map(async (tab) => {
      try {
        return { url: tab.url, result: await chrome.tabs.sendMessage(tab.id, { type: 'checkBulkCapturePage' }) };
      } catch (error) {
        return { url: tab.url, error: String((error && error.message) || error) };
      }
    }));
  })()`);

(async () => {
  const extensionDir = stageExtension({
    tempPrefix: 'hologram-orphan-e2e-',
    allUrls: true,
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
    const home = await openFeed(browser.context, 'https://x.com/home');
    const bookmarks = await openFeed(browser.context, 'https://x.com/i/bookmarks');
    home.on('pageerror', (error: any) => pageErrors.push(String(error?.message || error)));
    bookmarks.on('pageerror', (error: any) => pageErrors.push(String(error?.message || error)));

    check((await hoverControlCount(home)) > 0, 'ベースライン: 常駐スクリプトはホバー保存を描画する');

    await browser.serviceWorker.evaluate('chrome.runtime.reload()').catch(() => {});

    const probeSnapshot = async () => JSON.parse((await home.evaluate(() => document.documentElement.getAttribute('data-orphan-probe'))) || '{}');
    await waitFor('古い分離ワールドが extension context を失うこと', async () => {
      const snapshot = await probeSnapshot();
      return snapshot.runtime === 'object' && !snapshot.id;
    }).catch(() => {});

    const isReplacementWorker = (worker: any) => worker.url().startsWith(`chrome-extension://${browser.extensionId}/`) && worker !== browser.serviceWorker;
    const reloaded = browser.context.serviceWorkers().find(isReplacementWorker) || (await browser.context.waitForEvent('serviceworker', { predicate: isReplacementWorker, timeout: 5000 }).catch(() => null));
    check(!!reloaded, 'reload() の後に新しい service worker が起動した');
    if (!reloaded) throw new Error('リロード後の service worker が無い');

    const probe = await probeSnapshot();
    check(probe.runtime === 'object', `孤立したワールドでも chrome.runtime は object のまま (${probe.runtime})`);
    check(!probe.id && probe.idThrew === null, `chrome.runtime.id は例外を投げず falsy になる (${JSON.stringify(probe.id)})`);
    check(/invalidated/i.test(probe.sendThrew || ''), `chrome.runtime.sendMessage は同期的に失敗する (${JSON.stringify(probe.sendThrew)})`);
    check(/invalidated/i.test(probe.storageThrew || ''), `chrome.storage.local.get は同期的に失敗する (${JSON.stringify(probe.storageThrew)})`);
    check(probe.listenerThrew === null, `runtime.onMessage の add/removeListener は例外を投げない (${JSON.stringify(probe.listenerThrew)})`);

    let resident: any[] = [];
    await waitFor('更新後の常駐スクリプトが既存タブへ再注入されること', async () => {
      resident = await residentStatus(reloaded);
      return resident.some((entry) => entry.url === 'https://x.com/home' && entry.result?.supported === false) && resident.some((entry) => entry.url === 'https://x.com/i/bookmarks' && entry.result?.supported === true);
    }).catch(() => {});
    check(
      resident.some((entry) => entry.url === 'https://x.com/home' && entry.result?.supported === false),
      `ホームの常駐スクリプトが新しい worker へ応答する (${JSON.stringify(resident)})`,
    );
    check(
      resident.some((entry) => entry.url === 'https://x.com/i/bookmarks' && entry.result?.supported === true),
      `ブックマークの常駐スクリプトも新しい worker へ応答する (${JSON.stringify(resident)})`,
    );

    check((await hoverControlCount(home)) > 0, 'ページをリロードしなくても、更新後のホームでホバー保存が復帰する');
    await bookmarks.mouse.move(5, 5);
    for (let i = 0; i < 6; i++) {
      await bookmarks.mouse.wheel(0, 400);
      // biome-ignore lint/plugin: simulates a real scrolling sequence
      await sleep(120);
    }
    check((await hoverControlCount(bookmarks)) > 0, 'スクロール後の既存タブでもホバー保存が残る');
    check(pageErrors.length === 0, `再注入でページ例外を出さない (${JSON.stringify(pageErrors)})`);
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\nFAIL e2e-extension-orphan: ${failures.length}件の検証が失敗した`);
    process.exit(1);
  }
  console.log('\nPASS e2e-extension-orphan: 更新後の既存タブは再読み込みなしで常駐スクリプトを復旧する');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
