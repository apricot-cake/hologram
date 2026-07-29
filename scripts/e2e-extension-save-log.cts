'use strict';

// 「起動しただけ」と「保存が始まって終わらなかった」が capture.log で区別できること
// （#519）を、実ブラウザ・実ネイティブホストで見る。
//
// この2つは同じ記録だった＝どちらも activate の行が1本あって、その後に何も続かない。
// ログを読んだセッションが3回続けて誤診し、うち1回はユーザーへ誤った警告を出して
// 撤回している。だから受け入れ条件は「ログだけを見て区別できる」で、それは**実際に
// 2つを走らせて記録を並べる**以外に確かめようがない＝このスクリプトが1回の実行で
// 両方をやり、両方の記録を印字する。
//
// 台は e2e-extension-timeout と同じ＝使い捨ての Chromium・使い捨てのネイティブホスト
// 登録・使い捨てのライブラリで、ユーザーのプロファイルにも実ライブラリにも触らない。
//
// jsdom 側（scripts/save-log.test.ts）は同じ区別をコンテンツスクリプト単体で見る。
// ここでしか見られないのは、**行が本当にホストのプロセスを通ってディスクへ着くか**。

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { createNativeHostSandbox } = require('./lib-native-host-e2e.cts');

declare const chrome: any;

const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const POST_ID = '1999999999999999996';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;

// メタデータの上限は 20 秒。取りこぼしを避けるため 2 倍強を待つ。
const WAIT_FOR_END_MS = 45_000;
// ホストのプロセスが起きて1行書き終えるまで（Windows で1〜2秒かかる）。
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

// 読める形で1行にする＝この印字が「2つが違って見える」ことの現物。
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

    // メタデータの取得を、②では「繋がったまま黙る」相手・③では普通に答える相手に
    // する。abort は保存を終わらせてしまう（reject するので）＝終わらない保存を作れる
    // のは握り続ける形だけ。
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

    // Alt+S はブラウザ側のコマンドで Playwright からは押せないので、コマンド
    // ハンドラが呼ぶのと同じ scripting.executeScript で注入する。
    const activate = async () => {
      // 前の回が片付き終わるのを待つ。capture.js の再注入は「動いている回を終わらせ
      // る」トグルなので（__snsPostSaveCleanup）、失敗表示が消える前に注入すると
      // 新しい回が始まらずに前の回が閉じるだけになる。
      await page.locator('[data-hologram-capture-banner]').waitFor({ state: 'detached', timeout: 15_000 });
      const done = await browser.serviceWorker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: 'no active tab' };
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      });
      if (!done.ok) throw new Error(`capture activation failed: ${done.error}`);
      await page.locator('[data-hologram-capture-banner][data-state="active"]').waitFor({ timeout: 15_000 });
    };

    // === ① UI を開いて、保存せずに閉じた =====================================
    await activate();
    await page.keyboard.press('Escape');

    const opened = await waitForLog(nativeHost.configDir, 0, (e) => e.some((x: any) => x.phase === 'cancel'), page);
    const cancel = opened.find((e: any) => e.phase === 'cancel');
    if (!cancel) throw new Error(`case 1 wrote no cancel line: ${JSON.stringify(opened)}`);
    if (cancel.stage !== 'select') throw new Error(`case 1 cancelled at stage=${cancel.stage}, wanted select (nothing was chosen)`);
    if (opened.some((e: any) => e.stage === 'save' && e.phase === 'begin')) throw new Error('case 1 announced a save that never happened');
    if (opened.some((e: any) => e.phase === 'fail')) throw new Error(`case 1 recorded a failure: ${JSON.stringify(opened)}`);

    const afterCase1 = captureLogEntries(nativeHost.configDir).length;

    // === ② 保存を始めて、途中で止まった =====================================
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await page.locator('[data-hologram-capture-banner][data-state="busy"]').waitFor({ timeout: 15_000 });

    // 始まったことが**待ちに入る前に**ディスクに在る＝これが無いと①と区別できない。
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

    // どの段まで進んだか＝スクリーンショットと切り抜きは終わり、メタデータで止まった。
    // #507 の調査が答えられなかった問いがこれ。
    if (failure.stage !== 'metadata') throw new Error(`the failure names stage=${failure.stage}, wanted metadata`);
    const reached = Array.isArray(failure.reached) ? failure.reached : [];
    if (reached.join(',') !== 'capture,crop') throw new Error(`the failure says it reached [${reached.join(',')}], wanted [capture,crop]`);

    for (const route of held) await route.abort().catch(() => {});
    const afterCase2 = captureLogEntries(nativeHost.configDir).length;

    // === ③ 保存が普通に終わった ==============================================
    // 対照＝止まった保存が「止まった」と読めるのは、終わった保存が「終わった」と
    // 読めるからで、両方を1つの記録から見て初めて区別が成立する。ホストが書く2行
    // （受け取った / 書き終えた）も、拡張が振った saveId を運んでいること。
    stallMetadata = false;
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await page.locator('[data-hologram-capture-banner][data-state="success"]').waitFor({ timeout: WAIT_FOR_END_MS });

    const done = await waitForLog(nativeHost.configDir, afterCase2, (e) => e.some((x: any) => x.stage === 'bridge' && x.phase === 'ok'), page);
    const ids = new Set(done.filter((e: any) => e.saveId).map((e: any) => e.saveId));
    if (ids.size !== 1) throw new Error(`case 3 spread over ${ids.size} save ids, wanted 1: ${JSON.stringify(done)}`);
    const trail = done.map((e: any) => `${e.stage}/${e.phase}`);
    // ホストが受け取ったことと書き終えたことが別の行になっている＝「ホストへ届かな
    // かった」と「ホストが持っていて終わらなかった」が区別できる（#507 が答えられ
    // なかった問い）。
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
