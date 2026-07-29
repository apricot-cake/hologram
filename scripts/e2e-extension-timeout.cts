'use strict';

// 「保存が処理中のまま終わらない」（#507）の、実ブラウザでの再現と回復。
// 使い捨ての Chromium・使い捨てのネイティブホスト登録・使い捨てのライブラリ＝
// ユーザーのプロファイルにも実ライブラリにも触らない（e2e-extension-duplicate と同じ台）。
//
// jsdom 側（capture-timeout.test.ts）はコンテンツスクリプトの見張りを見る。
// ここが見るのは**サービスワーカー側の予算**＝報告された症状に一番近い形で、
// プラットフォームの API が「返らない」ときに保存が終わるか。ルートは fulfill も
// abort もせず握ったままにする＝拡張から見ると、繋がったまま黙っている相手。
//
// 直す前のこの台では、バナーは busy のまま永久に留まり、capture.log には
// activate の行だけが残って成功も失敗も記録されなかった（実測）。

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { createNativeHostSandbox } = require('./lib-native-host-e2e.cts');

declare const chrome: any;

const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const POST_ID = '1999999999999999997';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;

// メタデータの上限は 20 秒。取りこぼしを避けるため、その 2 倍強を待つ。
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
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    });
    if (!activated.ok) throw new Error(`capture activation failed: ${activated.error}`);

    const bannerState = () => page.locator('[data-hologram-capture-banner]').getAttribute('data-hologram-capture-state');

    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await page.waitForFunction(() => document.querySelector('[data-hologram-capture-banner]')?.getAttribute('data-hologram-capture-state') === 'busy', null, { timeout: 15_000 });

    const startedAt = Date.now();
    await page.waitForFunction(() => document.querySelector('[data-hologram-capture-banner]')?.getAttribute('data-hologram-capture-state') === 'fail', null, { timeout: WAIT_FOR_END_MS });
    const endedAfterMs = Date.now() - startedAt;

    const state = await bannerState();
    if (state !== 'fail') throw new Error(`the save ended in state "${state}", wanted "fail"`);

    // 次の一手が読めること＝「保存に失敗しました」で終わらせない（#507 の要求）。
    const shown = (await page.locator('[data-hologram-capture-banner]').textContent()) || '';
    if (!/try again|もう一度/i.test(shown)) throw new Error(`the failure banner offers no next step: ${shown}`);

    // 後から追えること＝止まった脚が capture.log に残る。バナーと同時ではなく
    // 少し遅れて着く＝この行を書くのはホストで、その起動に Windows で1〜2秒かかる。
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
