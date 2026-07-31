'use strict';

// #269 の設計が寄りかかっているプラットフォームの事実を、実ブラウザで測って固定する。
//
// クリック保存は「サービスワーカーが capture.js を注入し、注入されたスクリプトが
// バナーを描く」構造なので、**注入そのものが失敗すると、失敗を伝える面がページ上に
// 存在しない**＝押しても完全に無反応になる。残る表示面はワーカーが持つツールバーの
// action だけ、という前提の上に extension/utils/inject-failure.ts が建っている。
//
// ⚠️**この台ではアイコンのクリックそのものは駆動できない**（`chrome.action.onClicked`
// は実クリックでしか発火せず、Playwright にツールバーを押す手段は無い）。だからここが
// 見るのは配線ではなく**前提**＝配線の側は jsdom の `background-wiring.test.ts` が持つ。
// 分けているのは、前提が崩れた時に配線のテストは全部緑のまま通るため＝Chrome が
// 振る舞いを変えたことは、ここでしか分からない。
//
// 測る5つ:
//   1. action の badge / title はワーカーから追加権限なしで書ける
//   2. badge は tabId 単位＝他のタブにも全体にも漏れない
//   3. タブが遷移すると Chrome が自分で badge も title も戻す
//      （＝こちら側は「何回目か」の記憶だけ捨てればよい）
//   4. 展開先が消えると executeScript は毎回失敗し、
//      `fetch(chrome.runtime.getURL(...))` も失敗する（＝生死の唯一の判定手段）
//      が、**action の API は生きたまま**（＝壊れていても印は出せる）
//   5. その状態では **chrome-extension://<id>/diag.html が開けない**
//      ＝診断ページはこの失敗の逃がし先になれない（2026-07-25 の設計確定コメントの
//      手順4を置き換えた根拠。読めない側の逃がし先は chrome://extensions）
//
// 使い捨ての Chromium と使い捨ての拡張ステージング＝ユーザーのプロファイルにも
// 本体ツリーの .output にも触らない。

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
    // ⚠️下の色は「API が解決済みの色文字列を受け取れる」ことを見るためだけの値で、
    // 出荷する色ではない（出荷値の出どころと妥当性は extension-tokens.test.ts）。
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
