'use strict';

// #269 の設計が寄りかかっているプラットフォームの事実を、実際のブラウザで
// 計測し固定する。
//
// クリックで保存する機能は「service worker が capture.js を注入し、注入された
// スクリプトがバナーを描く」という仕組みで動くので、**その注入自体が失敗
// すると、ページ上には障害を伝える画面が一切無い**＝クリックしても文字通り
// 何も起きない。extension/utils/inject-failure.ts は、残された唯一の表示面が
// worker 自身のツールバーアクションであるという前提の上に組まれている。
//
// 注意: **このリグでは実際にアイコンのクリックを駆動することはできない**
// （`chrome.action.onClicked` は本物のクリックでしか発火せず、Playwright には
// ツールバーを押す手段が無い）。だからここで検証するのは配線ではなく
// **前提**そのもの — 配線の側は jsdom の `background-wiring.test.ts` が
// カバーしている。両者を分けているのは、前提が崩れても配線のテストは全部
// グリーンで通ってしまうから＝Chrome が挙動を変えたことに気付けるのは
// このテストだけになる。
//
// 計測する5つのこと:
//   1. action のバッジ/タイトルは、追加の権限無しに worker から書き込める
//   2. バッジは tabId ごと＝他のタブへ漏れることも全体に適用されることも無い
//   3. タブが遷移すると、Chrome はバッジもタイトルも自分で両方リセットする
//      （＝この側がやるべきことは「どのラウンドか」の記憶を捨てるだけ）
//   4. パッケージ化されていない拡張機能のディレクトリが消えると、
//      executeScript は毎回失敗し、`fetch(chrome.runtime.getURL(...))` も同様
//      に失敗する（＝生きているか死んでいるかを見分ける唯一の方法）が、
//      **action API は生き続ける**（＝壊れていても印は出せる）
//   5. その状態では、**chrome-extension://<id>/diag.html は開けない**＝
//      診断ページはこの障害の代替先にはなり得ない（2026-07-25 の設計決定
//      コメントのステップ4を置き換える根拠。読めない側の代替先は
//      chrome://extensions）
//
// 使い捨ての Chromium と使い捨ての拡張機能ステージング＝利用者のプロファイル
// にも本流ツリーの .output にも触れない。

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
  if (!hit) throw new Error(`url が ${suffix} で終わるタブが無い (saw ${JSON.stringify(tabs)})`);
  return hit.id;
}

(async () => {
  // allUrls: 下のプローブ用ページは example.com で、出荷版の host_permissions
  // はそれをカバーしていない — これが無いと chrome.tabs.query は url 無しで
  // 答えてしまい、狙う対象が無くなる。
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
    // 注意: 下の色は「API がすでに解決済みの色文字列を受け付けられるか」を
    // 検証するための値でしかなく、出荷版の色ではない（出荷版の値の出どころと
    // 妥当性は extension-tokens.test.ts の仕事）。
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
    check(wrote.ok === true, `service worker は \`action\` 以上の権限無しにバッジとタイトルを書き込める (${wrote.error || 'no error'})`);

    const scoped = await sw(
      serviceWorker,
      `(async () => ({
        a: await chrome.action.getBadgeText({ tabId: ${tabA} }),
        b: await chrome.action.getBadgeText({ tabId: ${tabB} }),
        global: await chrome.action.getBadgeText({}),
        aTitle: await chrome.action.getTitle({ tabId: ${tabA} }),
      }))()`,
    );
    check(scoped.a === '!', `印を付けたタブはバッジを読み返せる (got "${scoped.a}")`);
    check(scoped.b === '' && scoped.global === '', `他のタブにもグローバルバッジにも拾われていない (other "${scoped.b}", global "${scoped.global}")`);
    check(scoped.aTitle === 'probe', `ツールチップもタブごとにスコープされている (got "${scoped.aTitle}")`);

    // --- 3 -----------------------------------------------------------------
    await pageA.goto('https://example.com/alpha2');
    await pageA.waitForTimeout(500);
    const afterNav = await sw(serviceWorker, `(async () => ({ text: await chrome.action.getBadgeText({ tabId: ${tabA} }), title: await chrome.action.getTitle({ tabId: ${tabA} }) }))()`);
    check(afterNav.text === '', `Chrome はタブ単位のバッジを遷移時に自分でクリアする (got "${afterNav.text}")`);
    check(afterNav.title !== 'probe', `…そしてタブ単位のツールチップも一緒に (got "${afterNav.title}")`);

    // --- 健全な状態のベースライン ---------------------------------------------
    const before = await sw(
      serviceWorker,
      `Promise.all([
        chrome.scripting.executeScript({ target: { tabId: ${tabB} }, files: ['capture.js'] }).then(() => null, e => String((e && e.message) || e)),
        fetch(chrome.runtime.getURL('diag.html')).then(r => r.ok, () => false),
      ]).then(([inject, readable]) => ({ inject, readable }))`,
    );
    check(before.inject === null, `健全な間は注入が成功する (${before.inject || 'no error'})`);
    check(before.readable === true, '健全な間は worker が自分の diag.html を読める');

    // --- 4 + 5: パッケージが読めなくなる ---------------------------------------
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
    check(typeof after.inject === 'string', `どのページでも注入が失敗するようになった (Chrome said: ${after.inject})`);
    check(after.readable === false, '生死確認プローブ（自分自身のリソースの fetch）も失敗するようになった — これが2つの原因を見分ける手がかり');
    check(after.badge.text === '!' && after.badge.title === 'still alive', `パッケージが読めない間も action API は描画し続ける (${JSON.stringify(after.badge)})`);

    const pageD = await context.newPage();
    let diagError: string | null = null;
    try {
      await pageD.goto(`chrome-extension://${extensionId}/diag.html`, { timeout: 10_000 });
    } catch (error: any) {
      diagError = String(error?.message || error);
    }
    check(diagError !== null && /ERR_FILE_NOT_FOUND|ERR_FAILED|ERR_BLOCKED/.test(diagError), `この状態では診断ページは開けない — だからそれをこの障害の逃げ場にはできない (${diagError ? diagError.split('\n')[0] : 'it LOADED'})`);
  } finally {
    if (moved) fs.renameSync(movedDir, extensionDir);
    await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\nFAIL e2e-extension-inject-failure: #269 が拠り所にしている前提のうち${failures.length}個がもう成り立たない`);
    process.exit(1);
  }
  console.log('\nPASS e2e-extension-inject-failure: パッケージが読めなくなっても、ツールバーアクションは今も生き残る唯一の画面であり、診断ページは今も生き残らない');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
