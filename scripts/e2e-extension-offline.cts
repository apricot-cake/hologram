'use strict';

// 決定的なブラウザレベルのcaptureテスト。Playwrightのrouteが、X形の投稿と
// そのメタデータ応答を完全にメモリから配信する一方、一意な名前を持つ一時的な
// Native Messagingホストが一時的なHologramのconfig/libraryへ書き込む。試すのは
// プロダクションの経路そのもの:
//
//   capture content script → 拡張機能のservice worker → native messaging
//   ブリッジ → ディスク上のJPEG + inboxエンベロープ（#5 St6 / #299＝sidecar
//   直接書き込みは永続的な.hologram-inbox/newキューに置き換えられた）
//
// ユーザーのブラウザプロファイル、実際のnative-host登録、実ライブラリの
// どれも読み書きしない。

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { createNativeHostSandbox } = require('./lib-native-host-e2e.cts');
const { waitFor } = require('./lib-wait.cts');

declare const chrome: any;

const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const POST_ID = '1999999999999999999';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;

const POST_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>Hologram offline capture fixture</title>
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
    <p>Offline fixture post</p>
    <div class="media" data-testid="tweetPhoto" aria-label="fixture image"></div>
  </article>
</body>
</html>`;

const POST_METADATA = {
  text: 'Offline fixture post',
  user: {
    name: 'Hologram Fixture',
    screen_name: 'hologram',
    id_str: '131',
  },
  favorite_count: 13,
  conversation_count: 1,
  created_at: '2026-07-25T00:00:00.000Z',
  lang: 'ja',
  mediaDetails: [],
};

async function waitForCapture(libraryDir: string, timeoutMs = 20_000): Promise<{ jpg: string; envelope: string }> {
  const inboxNewDir = path.join(libraryDir, '.hologram-inbox', 'new');
  let landed: { jpg: string; envelope: string } | null = null;
  try {
    await waitFor(
      'the native host to land a JPEG and its inbox envelope',
      () => {
        let jpg: string | undefined;
        try {
          for (const item of fs.readdirSync(path.join(libraryDir, 'items'))) {
            const file = fs.readdirSync(path.join(libraryDir, 'items', item)).find((name) => name.endsWith('.jpg'));
            if (file) {
              jpg = path.join('items', item, file);
              break;
            }
          }
        } catch {
          jpg = undefined;
        }
        let envelope: string | undefined;
        try {
          envelope = fs.readdirSync(inboxNewDir).find((file) => file.endsWith('.json'));
        } catch {
          envelope = undefined; // inbox dir not created yet
        }
        landed = jpg && envelope ? { jpg, envelope } : null;
        return landed !== null;
      },
      { timeoutMs, pollMs: 100 },
    );
  } catch {
    throw new Error('native hostが20秒以内にJPEGとinboxエンベロープを着地させませんでした');
  }
  return landed as unknown as { jpg: string; envelope: string };
}

async function waitForLog(configDir: string, file: string, matches: (text: string) => boolean, complaint: string, timeoutMs = 15_000): Promise<void> {
  try {
    await waitFor(
      `${file} to say: ${complaint}`,
      () => {
        let text = '';
        try {
          text = fs.readFileSync(path.join(configDir, file), 'utf8');
        } catch {
          text = ''; // not created yet
        }
        return matches(text);
      },
      { timeoutMs, pollMs: 100 },
    );
  } catch {
    // 汎用のタイムアウトより呼び出し側自身の訴えの方が読みやすい: それはログが
    // 何を記録するはずだったかを言う。
    throw new Error(`${complaint} (waited ${timeoutMs / 1000}s)`);
  }
}

(async () => {
  const nativeHost = createNativeHostSandbox(EXPECTED_EXTENSION_ID);
  const extensionDir = stageExtension({
    allUrls: true,
    nativeHostName: nativeHost.hostName,
    tempPrefix: 'hologram-extension-offline-e2e-ext-',
  });
  let browser: any = null;

  try {
    browser = await launchExtensionBrowser({
      extensionDir,
      headless: true,
      viewport: { width: 1280, height: 900 },
    });
    if (browser.extensionId !== EXPECTED_EXTENSION_ID) {
      throw new Error(`ステージした拡張機能id ${browser.extensionId} がnative-hostの許可リスト ${EXPECTED_EXTENSION_ID} と一致しません`);
    }

    await browser.context.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url === POST_URL) {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: POST_HTML });
      } else if (url.startsWith('https://cdn.syndication.twimg.com/tweet-result?')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(POST_METADATA) });
      } else {
        await route.abort();
      }
    });

    const page = await browser.context.newPage();
    await page.goto(POST_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#capture-target').waitFor();

    const activation = await browser.serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: 'no active tab' };
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    });
    if (!activation.ok) throw new Error(`captureの有効化に失敗しました: ${activation.error}`);

    await page.locator('#capture-target').click({ position: { x: 100, y: 100 } });
    // 保存が走っている間、バナーが落ち着くのを見守る。要点はバージョンの
    // 取り決め（#205）: ここは実際の拡張機能と実際のホストが同じ世代同士で
    // 出会う唯一の場所であり、だから組み合った両者が更新について何も言わない
    // ことを証明できる唯一の場所。保存のたびに出る偽の「Hologramを更新」は、
    // 全ての単体テストを通ってしまう＝両側とも言われたとおりに正確に振る舞う
    // から＝そしてそれは利用者へ永続的な小言として届く。
    const bannerSettled = page
      .waitForFunction(
        () => {
          const el = document.querySelector('hologram-extension-ui')?.shadowRoot?.querySelector('.surface[data-variant="banner"]') as HTMLElement | null;
          // 保存が「終わる」3つの状態＝それ以外（idle、投稿選び中のactive、
          // 保存中のbusy）は、そこへ向かう途中。
          const state = el?.dataset.state;
          if (!el || (state !== 'success' && state !== 'partial' && state !== 'error')) return null;
          return { state, label: el.querySelector('.label')?.textContent || '' };
        },
        { timeout: 30000 },
      )
      .then((handle: any) => handle.jsonValue());
    // このPromiseはここで作られるが、はるか下でしかawaitされない。だから間で
    // 何かがthrowするとfinallyに到達してブラウザを閉じ、これは「Target page,
    // context or browser has been closed」でrejectしてしまう＝それが報告される
    // ことになり、実際に起きた失敗を隠してしまう。今、no-opのハンドラをこれに
    // 仕込んでおく: 下のawaitはそれでも本当の結果を見るし、先に起きたエラーで
    // 潰されたブラウザは、もうそれを代弁しなくなる。（2026-08-01の夜間ランは
    // まさにその覆い隠された形を報告した。）
    bannerSettled.catch(() => {});
    const landed = await waitForCapture(nativeHost.libraryDir);
    const envelope = JSON.parse(fs.readFileSync(path.join(nativeHost.libraryDir, '.hologram-inbox', 'new', landed.envelope), 'utf8'));
    const jpeg = fs.readFileSync(path.join(nativeHost.libraryDir, landed.jpg));
    if (envelope.format !== 'hologram-inbox' || envelope.version !== 1) throw new Error(`想定外のエンベロープの形: ${JSON.stringify(envelope)}`);
    const record = envelope.record;
    if (record.url !== POST_URL) throw new Error(`保存されたURLが不一致: ${record.url}`);
    if (record.platform !== 'x') throw new Error(`保存されたplatformが不一致: ${record.platform}`);
    if (record.text !== POST_METADATA.text) throw new Error(`モックしたメタデータがservice workerを越えて届きませんでした: ${record.text}`);
    const landedRelative = landed.jpg.replace(/\\/g, '/');
    if (record.image !== landedRelative) throw new Error(`エンベロープのimageが不一致: ${record.image} / ${landedRelative}`);
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('着地した画像がJPEGではありません');

    // 両方の行は上のファイルより少し後に着地する: ブリッジは先にJPEGと
    // エンベロープを書き、その作業が返ってから結果の行を追記する
    // （native-host/bridge.mts、logSaveOutcome）。だから1回だけ読むとホストと
    // 競走することになり、負荷のかかったマシンでは負ける＝これが同時に4つ
    // 走らせたときに初めて赤くなった経緯（#968）。同じ形、同じ修正を
    // e2e-extension-timeout.ctsの待機が既に持っている。
    await waitForLog(nativeHost.configDir, 'bridge.log', (text) => text.includes('recv type=save'), 'bridge log has no native save message');
    await waitForLog(nativeHost.configDir, 'capture.log', (text) => text.includes('"stage":"bridge"') && text.includes('"phase":"ok"'), 'capture log has no successful bridge outcome');

    const banner = await bannerSettled;
    // 'partial'はskewが示されるときの状態なので、素の'success'こそが検証対象。
    // 文言の検査は、もしそうでなかったとしたら何が間違っているかを名指しする。
    if (banner.state !== 'success') throw new Error(`バナーは ${banner.state} で落ち着きました。successを期待: ${banner.label}`);
    if (/update/i.test(banner.label)) throw new Error(`組み合った拡張機能/ホストのペアが利用者に更新を求めました: ${banner.label}`);

    console.log(`PASS e2e-extension-offline: ${landed.jpg} + .hologram-inbox/new/${landed.envelope} (banner: ${banner.label})`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
    nativeHost.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
