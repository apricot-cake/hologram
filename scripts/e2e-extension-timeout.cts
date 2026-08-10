'use strict';

// 「保存が終わらず処理中のまま固まる」（#507）の再現と復旧を、実際のブラウザで
// 検証する。
// 使い捨てのChromium、使い捨てのnative host登録、使い捨てのライブラリ
// ＝ユーザーのプロファイルにも実際のライブラリにも触れない
// （e2e-extension-duplicateと同じ設定）。
//
// jsdom側（capture-timeout.test.ts）はcontent scriptのwatchdogをカバーする。
// これがカバーするのは「service worker側の予算」＝報告された症状に最も近い形で、
// プラットフォームAPIが「決して返らない」ときに保存は終わるか？ routeは
// 満たされも中断されもせず保持したままにする＝拡張機能の視点からは、接続した
// まま黙っている相手。
//
// 修正前のこのリグでは、バナーは永遠にbusyのまま固まり、capture.logには
// activate行しか無く、成功も失敗も一度も記録されなかった（直接実測）。

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { createNativeHostSandbox } = require('./lib-native-host-e2e.cts');

declare const chrome: any;

const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const POST_ID = '1999999999999999997';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;

// メタデータの上限は20秒。取りこぼさないよう、その2倍強を待つ。
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
      throw new Error(`ステージした拡張機能id ${browser.extensionId} がnative-hostの許可リスト ${EXPECTED_EXTENSION_ID} と一致しません`);
    }

    // 止まった状態。中断ではなく保持する。中断されたfetchはrejectするから＝
    // 保存はそれではいつも終わっていた。終わりが無かったのは開いたままの
    // リクエストであり、それこそが詰まった接続の実際の見た目。
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

    // Alt+Sはブラウザレベルのコマンドで、Playwrightは押せない。だから有効化は
    // コマンドハンドラが呼ぶのと同じscripting.executeScriptを経由する。
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
    if (!activated.ok) throw new Error(`captureの有効化に失敗しました: ${activated.error}`);

    // #44: バナーは共有ShadowRootに住む。PlaywrightのCSSエンジンはopenな
    // shadow rootを貫通するので、locatorはそれでも見つける＝しかし
    // page.evaluate内のdocument.querySelectorは貫通しない。だから下の待機も
    // locator経由にしている。
    const bannerState = () => page.locator('[data-hologram-capture-banner]').getAttribute('data-state');

    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await page.locator('[data-hologram-capture-banner][data-state="busy"]').waitFor({ timeout: 15_000 });

    const startedAt = Date.now();
    await page.locator('[data-hologram-capture-banner][data-state="error"]').waitFor({ timeout: WAIT_FOR_END_MS });
    const endedAfterMs = Date.now() - startedAt;

    const state = await bannerState();
    if (state !== 'error') throw new Error(`保存は状態"${state}"で終わりました。"error"を期待`);

    // 次の一手が読み取れなければならない＝「保存に失敗した」で放置しない
    // （#507の要件）。
    const shown = (await page.locator('[data-hologram-capture-banner]').textContent()) || '';
    if (!/try again|もう一度/i.test(shown)) throw new Error(`失敗バナーが次の一手を提示していません: ${shown}`);

    // 後から追跡できなければならない＝固まった経路がcapture.logに残る。
    // バナーと同時には着地せず少し遅れる＝この行を書くのはホストで、
    // 起動には Windows で1〜2秒かかる。
    let entries: any[] = [];
    let failure: any = null;
    for (const started = Date.now(); Date.now() - started < 15_000; ) {
      entries = captureLogEntries(nativeHost.configDir);
      failure = entries.find((e: any) => e.phase === 'fail' && /timed out/i.test(String(e.error || '')));
      if (failure) break;
      await page.waitForTimeout(250);
    }
    if (!failure) throw new Error(`capture.logにタイムアウトが記録されていません: ${JSON.stringify(entries)}`);
    if (entries.some((e: any) => e.stage === 'bridge' && e.phase === 'ok')) throw new Error('メタデータの取得が一度も応答していないのに保存が書き込まれました');

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
