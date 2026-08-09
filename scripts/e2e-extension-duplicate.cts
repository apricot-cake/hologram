'use strict';

// 重複保存の警告（#34）に対するブラウザレベルのテスト。e2e-extension-
// offline.cts と同じ決定的なリグ上で動く: Playwright のルートが X の形をした
// 投稿とそのメタデータをメモリから配信し、一意な名前を持つ一時的な
// Native Messaging ホストが一時的な Hologram の設定/ライブラリへ書き込む。
// 利用者のブラウザプロファイルにも、本物の native-host 登録にも、個人の
// ライブラリにも一切読み書きしない。
//
// 実際のブラウザでしか示せないこと、そして jsdom のスイートの隣にこれが
// 存在する理由: この問いに答えるのは「本物の」ネイティブホスト。最初の
// キャプチャは bridge-journal.jsonl を書く。2回目のキャプチャの
// checkDuplicate は、ブリッジ自身の保存済み投稿索引経由でそれを見つけ、
// 「すでに保存済み」と言わなければならない — これはコンテンツスクリプト、
// service worker、Native Messaging のポート、ホストプロセスにまたがる往復で
// あり、単体テストではどれ1つ立ち上げられない。
//
// 3つの答えを、最も後始末が少なく済む順序で運動させる:
//   1回目のキャプチャ — ライブラリは空なので、問いは発生しない
//   2回目のキャプチャ — 問いが現れる。「skip」は何も書かない
//   3回目のキャプチャ — 「replace」は `replaces` を持つレコードを書く＝
//                       最初のキャプチャの id（その印。古いキャプチャの
//                       引退はデスクトップアプリの仕事で、
//                       test-app-replaces.cts がカバーしている）

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { createNativeHostSandbox } = require('./lib-native-host-e2e.cts');
const { waitFor } = require('./lib-wait.cts');

declare const chrome: any;

const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const POST_ID = '1999999999999999998';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;

const POST_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>Hologram duplicate-warning fixture</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: start center; padding: 80px; background: #f4f7fa; font-family: system-ui, sans-serif; }
    article { width: 640px; min-height: 360px; padding: 32px; border: 1px solid #ccd6dd; border-radius: 20px; background: white; color: #17202a; }
    .media { height: 220px; margin-top: 24px; border-radius: 16px; background: linear-gradient(135deg, #73c7ff, #9c7cff); }
  </style>
</head>
<body>
  <article id="capture-target" data-testid="tweet">
    <a href="/hologram/status/${POST_ID}"><time datetime="2026-07-25T00:00:00.000Z">2026-07-25</time></a>
    <p>Duplicate warning fixture post</p>
    <div class="media" data-testid="tweetPhoto" aria-label="fixture image"></div>
  </article>
</body>
</html>`;

const POST_METADATA = {
  text: 'Duplicate warning fixture post',
  user: { name: 'Hologram Fixture', screen_name: 'hologram', id_str: '131' },
  favorite_count: 3,
  conversation_count: 0,
  created_at: '2026-07-25T00:00:00.000Z',
  lang: 'ja',
  mediaDetails: [],
};

function envelopes(libraryDir: string): any[] {
  const dir = path.join(libraryDir, '.hologram-inbox', 'new');
  let names: string[];
  try {
    names = fs
      .readdirSync(dir)
      .filter((f: string) => f.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  return names.map((f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

async function waitForEnvelopes(libraryDir: string, want: number, timeoutMs = 20_000): Promise<any[]> {
  let found: any[] = [];
  try {
    await waitFor(
      `${want} inbox envelope(s) under ${libraryDir}`,
      () => {
        found = envelopes(libraryDir);
        return found.length >= want;
      },
      { timeoutMs, pollMs: 100 },
    );
  } catch {
    // このファイル独自の言い回し: 実際に「何件届いたか」こそが調べたい事実で
    // あり、共有のタイムアウトメッセージにはそれが分からない。
    throw new Error(`${timeoutMs}ms 後も${envelopes(libraryDir).length}件しか届いていない（${want}件を期待）`);
  }
  return found;
}

(async () => {
  const nativeHost = createNativeHostSandbox(EXPECTED_EXTENSION_ID);
  const extensionDir = stageExtension({
    allUrls: true,
    nativeHostName: nativeHost.hostName,
    tempPrefix: 'hologram-extension-duplicate-e2e-ext-',
  });
  let browser: any = null;

  try {
    browser = await launchExtensionBrowser({ extensionDir, headless: true, viewport: { width: 1280, height: 900 } });
    if (browser.extensionId !== EXPECTED_EXTENSION_ID) {
      throw new Error(`ステージングした拡張機能の id ${browser.extensionId} が native-host の許可リスト ${EXPECTED_EXTENSION_ID} と一致しない`);
    }

    await browser.context.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url === POST_URL) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: POST_HTML });
      else if (url.startsWith('https://cdn.syndication.twimg.com/tweet-result?')) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(POST_METADATA) });
      else await route.abort();
    });

    const page = await browser.context.newPage();
    await page.goto(POST_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#capture-target').waitFor();

    // Alt+S はブラウザレベルのコマンドで Playwright は押せないので、起動は
    // コマンドハンドラが呼ぶのと同じ scripting.executeScript を経由する。
    const activate = async () => {
      const res = await browser.serviceWorker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: 'no active tab' };
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      });
      if (!res.ok) throw new Error(`キャプチャの起動に失敗した: ${res.error}`);
    };
    const choice = (which: string) => page.locator(`[data-hologram-choice="${which}"]`);
    // capture.js は単発でトグル式: そのバナーがまだ出ている間に再注入すると、
    // 新しい実行を始めるのではなく実行がキャンセルされる。バナーは結果の後も
    // 約1.5秒残り、その後片付けフラグはコンテンツスクリプトの分離ワールドに
    // あって page.evaluate からは見えない — だからこの間隔は条件ではなく
    // 待ち時間。
    const settleCapture = () => page.waitForTimeout(2500);

    // --- 1回目: まだ何も保存されていないので問いは無い ------------------------
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    const first = await waitForEnvelopes(nativeHost.libraryDir, 1);
    if (await choice('copy').count()) throw new Error('空のライブラリへの最初のキャプチャなのに重複について尋ねてきた');
    await settleCapture();
    const firstId = first[0].record.captureId;
    if (first[0].record.replaces !== null) throw new Error(`普通の保存が replaces の印を持っていた: ${first[0].record.replaces}`);

    // --- 2回目: 問いが現れ、「skip」と答える ------------------------------
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await choice('skip').waitFor({ timeout: 15_000 });
    for (const which of ['copy', 'replace', 'skip']) {
      if (!(await choice(which).count())) throw new Error(`重複警告に "${which}" の答えが無い`);
    }
    await choice('skip').click();
    // それでも保存が始まっていたら届いているはずの十分な長さ（1回目はこれより
    // かなり短く済んだ）— 「保存しなかった」ことを示す前向きなイベントは無い。
    await page.waitForTimeout(3000);
    if (envelopes(nativeHost.libraryDir).length !== 1) throw new Error('"skip" なのに保存してしまった');
    await settleCapture();

    // --- 3回目: 問いが現れ、「replace」と答える ----------------------------
    await activate();
    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    await choice('replace').waitFor({ timeout: 15_000 });
    await choice('replace').click();
    const both = await waitForEnvelopes(nativeHost.libraryDir, 2);
    const replacement = both.find((e: any) => e.record.captureId !== firstId);
    if (!replacement) throw new Error('置き換えが新しいレコードを一切生まなかった');
    if (replacement.record.replaces !== firstId) {
      throw new Error(`置き換えが間違ったキャプチャを名指ししている: ${replacement.record.replaces}（${firstId} を期待）`);
    }

    console.log(`PASS e2e-extension-duplicate: 2回問われ、1回スキップし、${replacement.record.captureId} が ${firstId} を置き換えた`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
    nativeHost.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
