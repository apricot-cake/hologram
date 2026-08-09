'use strict';

// 実際のブラウザと実際のnative hostの上で、「ちょうど有効化しただけ」と「保存が
// 始まって一度も終わらなかった」がcapture.log上で区別できることを確かめる（#519）。
//
// この2つは以前は同じレコードを生んでいた＝どちらも後に何も続かない単一の
// activate行だった。ログを読んだセッションはこれを3回連続で誤診断し、一度は
// 利用者へ誤った警告を出してしまい撤回する羽目になった。だから受け入れ基準は
// 「ログだけから区別できる」ことで、それを検証する方法は「実際に両方を走らせて
// レコードを並べる」以外に無い＝このスクリプトは1回の実行でその両方を行い、
// 両方のレコードを印字する。
//
// e2e-extension-timeoutと同じ仕組み＝使い捨てのChromium、使い捨てのnative host
// 登録、使い捨てのライブラリ＝ユーザーのプロファイルにも実際のライブラリにも
// 触れない。
//
// jsdom側（scripts/save-log.test.ts）は同じ区別をcontent scriptだけで検証する。
// ここでしか見えないのは「その行が実際にホストのプロセスを通してディスクへ
// 届くか」だけ。

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { createNativeHostSandbox } = require('./lib-native-host-e2e.cts');

declare const chrome: any;

const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const POST_ID = '1999999999999999996';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;

// メタデータの上限は20秒。取りこぼさないよう、その2倍強を待つ。
const WAIT_FOR_END_MS = 45_000;
// ホストのプロセスが目を覚まし、1行書き終えるまでの時間（Windowsでは1〜2秒かかる）。
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

// 1エントリを読みやすい1行に描画する＝この印字こそが「2つが違って見える」ことの実際の証拠。
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
      throw new Error(`ステージした拡張機能id ${browser.extensionId} がnative-hostの許可リスト ${EXPECTED_EXTENSION_ID} と一致しません`);
    }

    // メタデータの取得を、ケース(2)では「接続したまま黙っている」相手に、
    // ケース(3)では普通に応答する相手にする。abortすると（それがrejectするため）
    // 保存が終わってしまう＝一度も終わらない保存を作る唯一の方法はrouteを開いた
    // まま保持し続けること。
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

    // Alt+SはPlaywrightが押せないブラウザ側のコマンドなので、コマンドハンドラが
    // 呼ぶのと同じscripting.executeScript経由で注入する。
    const activate = async () => {
      // 前の回の後片付けが終わるのを待つ。capture.jsを再注入することは「今動いて
      // いるどの回であれ終わらせる」トグル（__snsPostSaveCleanup）なので、失敗
      // 表示が消える前に注入すると、新しい回は始まらず前の回を閉じるだけになる。
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
      if (!done.ok) throw new Error(`capture の有効化に失敗しました: ${done.error}`);
      await page.locator('[data-hologram-capture-banner][data-state="active"]').waitFor({ timeout: 15_000 });
    };

    // === (1) UIを開いて保存せずに閉じた =====================================
    await activate();
    await page.keyboard.press('Escape');

    const opened = await waitForLog(nativeHost.configDir, 0, (e) => e.some((x: any) => x.phase === 'cancel'), page);
    const cancel = opened.find((e: any) => e.phase === 'cancel');
    if (!cancel) throw new Error(`ケース1がcancel行を書きませんでした: ${JSON.stringify(opened)}`);
    if (cancel.stage !== 'select') throw new Error(`ケース1はstage=${cancel.stage}でキャンセルしました。selectを期待（何も選ばれていない）`);
    if (opened.some((e: any) => e.stage === 'save' && e.phase === 'begin')) throw new Error('ケース1が起きなかった保存を告知しました');
    if (opened.some((e: any) => e.phase === 'fail')) throw new Error(`ケース1が失敗を記録しました: ${JSON.stringify(opened)}`);

    const afterCase1 = captureLogEntries(nativeHost.configDir).length;

    // === (2) 保存を始めて途中で止まった =====================================
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await page.locator('[data-hologram-capture-banner][data-state="busy"]').waitFor({ timeout: 15_000 });

    // 保存が始まったという事実は「待機に入る前に」ディスク上にある＝これが無いと
    // ケース(1)と区別できない。
    const begun = await waitForLog(nativeHost.configDir, afterCase1, (e) => e.some((x: any) => x.stage === 'save' && x.phase === 'begin'), page);
    const begin = begun.find((e: any) => e.stage === 'save' && e.phase === 'begin');
    if (!begin) throw new Error(`ケース2が保存を一度も告知しませんでした: ${JSON.stringify(begun)}`);
    if (!begin.saveId) throw new Error('begin行がsaveIdを運んでいないので、何にも紐付けられません');

    await page.locator('[data-hologram-capture-banner][data-state="error"]').waitFor({ timeout: WAIT_FOR_END_MS });

    const stalled = await waitForLog(nativeHost.configDir, afterCase1, (e) => e.some((x: any) => x.phase === 'fail'), page);
    const failure = stalled.find((e: any) => e.phase === 'fail');
    if (!failure) throw new Error(`ケース2が失敗を記録しませんでした: ${JSON.stringify(stalled)}`);
    if (failure.saveId !== begin.saveId) throw new Error(`失敗（saveId=${failure.saveId}）がbegin（saveId=${begin.saveId}）に紐付けられません`);
    if (stalled.some((e: any) => e.phase === 'cancel')) throw new Error('ケース2はユーザーが諦めたと主張していますが、誰も諦めていません');
    if (stalled.some((e: any) => e.stage === 'bridge' && e.phase === 'ok')) throw new Error('メタデータの取得が一度も応答していないのに保存が書き込まれました');

    // どこまで進んだか＝スクリーンショットとクロップは終わり、metadataで止まった。
    // これはまさに#507の調査が答えられなかった問いそのもの。
    if (failure.stage !== 'metadata') throw new Error(`失敗はstage=${failure.stage}を名指ししています。metadataを期待`);
    const reached = Array.isArray(failure.reached) ? failure.reached : [];
    if (reached.join(',') !== 'capture,crop') throw new Error(`失敗は[${reached.join(',')}]まで到達したと言っています。[capture,crop]を期待`);

    for (const route of held) await route.abort().catch(() => {});
    const afterCase2 = captureLogEntries(nativeHost.configDir).length;

    // === (3) 普通に終わった保存 ==============================================
    // 対照群＝止まった保存が「止まった」と読めるのは、終わった保存が「終わった」
    // と読める場合だけ＝その区別は両方を単一のレコードから見て初めて成り立つ。
    // 併せて、ホストが書く2行（受け取った／書き終えた）が拡張機能の割り当てた
    // saveIdを運んでいることも確認する。
    stallMetadata = false;
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await page.locator('[data-hologram-capture-banner][data-state="success"]').waitFor({ timeout: WAIT_FOR_END_MS });

    const done = await waitForLog(nativeHost.configDir, afterCase2, (e) => e.some((x: any) => x.stage === 'bridge' && x.phase === 'ok'), page);
    const ids = new Set(done.filter((e: any) => e.saveId).map((e: any) => e.saveId));
    if (ids.size !== 1) throw new Error(`ケース3が ${ids.size} 個のsave idに分散しています。1個を期待: ${JSON.stringify(done)}`);
    const trail = done.map((e: any) => `${e.stage}/${e.phase}`);
    // ホストが受け取ったことと、ホストが書き終えたことは別々の行＝これにより
    // 「ホストへ一度も届かなかった」と「ホストは持っていたが一度も終わらな
    // かった」が区別できる（#507が答えられなかった問い）。
    for (const wanted of ['save/begin', 'bridge/begin', 'bridge/ok']) {
      if (!trail.includes(wanted)) throw new Error(`ケース3に ${wanted} 行がありません: ${trail.join(' → ')}`);
    }
    if (done.some((e: any) => e.phase === 'fail' || e.phase === 'cancel')) throw new Error(`ケース3が問題を記録しました: ${JSON.stringify(done)}`);

    const all = captureLogEntries(nativeHost.configDir);
    console.log('  ① UI を開いて保存せずに閉じた:');
    for (const e of all.slice(0, afterCase1)) console.log(render(e));
    console.log('  ② 保存を始めて途中で止まった:');
    for (const e of all.slice(afterCase1, afterCase2)) console.log(render(e));
    console.log('  ③ 保存が普通に終わった（対照）:');
    for (const e of all.slice(afterCase2)) console.log(render(e));
    console.log(`PASS e2e-extension-save-log: 3つが異なって読める — ①${cancel.stage}/${cancel.phase}で保存の告知なし、②save/beginの後${failure.stage}/${failure.phase}で[${reached.join(',')}]まで到達、③${trail.join(' → ')}が1つのsaveIdの下で`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
    nativeHost.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
