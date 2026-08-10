'use strict';

// #594 の再現 = **実際に拡張機能をリロードし、開いたままのタブを孤立させる**。
//
// 拡張機能がリロードされると（リリース後は Chrome の自動更新でこれが起きる）、
// すでに開いているタブの常駐コンテンツスクリプトは拡張機能との接続を失う。
// UI はページに残ったままだが、`chrome.*` の呼び出しは同期的な例外を投げる。
// **この状況は使い捨ての Chromium で実際に再現できる**ので
// （`chrome.runtime.reload()`）、このテストはシミュレーションではなく本物を計測する。
//
// ここでは2つの層を検証する:
//
// **①プラットフォームの前提**（設計はこれらに寄りかかっている＝
// extension/utils/extension-context.ts）
//   `chrome.runtime.id` は falsy になり、**読み取り自体は例外を投げない**。
//   `sendMessage` / `storage.local.get` は**同期的に例外を投げる**。
//   `onMessage.addListener` / `removeListener` は**例外を投げない**。
//   注意: これらが崩れたら検知する口そのものが無くなるが、②の配線テストは
//   すべてそのままグリーンで通ってしまう＝ここだけが Chrome の挙動変化に
//   気付ける場所である。#269 の e2e-extension-inject-failure.cts と同じ
//   役割分担。
//   孤立した側の分離ワールドを覗くために、**計測専用のコンテンツスクリプトを
//   ステージング時に同じ拡張機能へ1本だけ追加する**（同じ拡張機能のコンテンツ
//   スクリプトは分離ワールドを共有するので、resident.js が見ているものを
//   そのまま読める）。これはリリースビルドには含まれない。
//
// **②障害モードそのもの**
//   クリックした場合（タブ A）: 例外は投げられず、**「このページを再読み込み
//     してください」が表示され**（「保存が最後まで終わらず中止した」ではない）、
//     隅のコントロールは消え、応答期限（SAVE_ACK_MS）を過ぎても別のバナーが
//     遅れて出ることはない。
//   クリックしなかった場合（タブ B）: UI はスクロールするだけで**無言のまま**
//     消える（バナーが出ない＝#154 の憲章項目2。すべてのタブへ自動更新の
//     たびに通知する設計を却下する根拠）。
//   一括取り込みが実行中の場合（タブ C、#646）: 進捗バナーが「このページを
//     再読み込みしてください」に切り替わり、実行は終了する。**一括取り込みは
//     1回に数分続く**＝自動更新に遭遇する可能性が最も高い経路であり、
//     #594 の修正はこの経路をカバーしていなかった。
//
//   node scripts/e2e-extension-orphan.cts

const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { fixtureHtml } = require('./lib-overlay-e2e.cts');
const { sleep, waitFor } = require('./lib-wait.cts');

// i18n.ts そのままの文言。表示されるべきものと、されるべきでないもの
// （#594 以前に表示されていた紛らわしい文言）。
const RELOAD_NOTICE = '拡張機能が更新されました。このページを再読み込みしてください';
const TIMEOUT_NOTICE = '保存が終わらないため中止しました。もう一度お試しください（繰り返す場合は Chrome を再起動）';

// resident.js が見ているのと同じ chrome を、孤立した側の分離ワールドから
// 触って報告する。触った結果は <html data-orphan-probe> に置く＝ページの
// メインワールドから読める唯一の経路。
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

// 一括取り込み（#362）はブックマーク一覧でしか始まらず、専用のジェスチャー
// Alt+Shift+S（ページレベルの入力からは届かないブラウザのアクセラレータ）で
// 起動される。そこで background.ts が起動するのと同じやり方で、ワーカーから
// 起動する: まずフラグを立て、次にキャプチャの入口を呼ぶ。
const START_BULK_JS = `
(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://x.com/i/bookmarks*' });
  if (!tab || !tab.id) throw new Error('the bookmarks tab is not visible to the worker');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.__hologramAutoCapture = true; } });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
  return tab.id;
})()
`;

// 一覧にもう1行到着する＝取り込みが前提としているイベント（行がマウントされた
// 瞬間にパーマリンクを読む）。あえて PAGE のワールドから書く: 実行を突つくの
// ではなく、実行中に一覧が伸びる形でなければならない。
const MOUNT_ROW_JS = `(() => {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  article.innerHTML = '<a href="/zoe/status/9901"><time datetime="2026-07-01T00:00:00Z">now</time></a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/ZZZ.jpg"></div>';
  document.getElementById('feed').appendChild(article);
  return document.querySelectorAll('[data-testid="tweet"]').length;
})()`;

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const FIXTURE_URL = 'https://x.com/home';
// 一括取り込みはここ以外では起動を拒む（isXBookmarksPage）。同じフィクスチャが
// 両方に使える: ブックマーク一覧も同じ行のフィードでしかない。
const BOOKMARKS_URL = 'https://x.com/i/bookmarks';

async function openFeed(context: any, url: string = FIXTURE_URL): Promise<any> {
  const page = await context.newPage();
  await page.route('**/*', async (route: any) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.url() === url) await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml('x') });
    else await route.abort();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tweetPhoto"]');
  // あえて固定時間: 常駐コンテンツスクリプトの document_idle 起動・最初の
  // スキャン・最初のバッジ問い合わせは、ページに何も置かない＝オーバーレイは
  // ポインタの下にしか描かれないので、ここで待つべき事後条件が存在しない。
  // biome-ignore lint/plugin: the content script's startup draws nothing to wait on
  await sleep(900);
  return page;
}

const overlayState = (page: any) =>
  page.evaluate(() => ({
    controls: document.querySelectorAll('[data-hologram-overlay]').length,
    banner: document.querySelector('hologram-extension-ui')?.shadowRoot?.querySelector('[data-hologram-save-banner]')?.textContent || null,
  }));

// 取り込み自身の画面。`stop` は実行中に提示されるボタンを数える: setState は
// 前の状態が持っていたものを丸ごと入れ替えるので、終了した実行がそれを
// まだ提示し続けることはあり得ない。
const bulkState = (page: any) =>
  page.evaluate(() => {
    const root = document.querySelector('hologram-extension-ui')?.shadowRoot;
    return {
      banner: root?.querySelector('[data-hologram-bulk-label]')?.textContent || null,
      stop: root?.querySelectorAll('[data-hologram-bulk-banner] button').length ?? 0,
    };
  });

(async () => {
  const extensionDir = stageExtension({
    tempPrefix: 'hologram-orphan-e2e-',
    // 下でワーカーがブックマークタブへ capture.js を注入できるようにするためだけ。
    // 実運用ではその注入は Alt+Shift+S が運ぶ activeTab の許可に乗るが、
    // テストはブラウザのアクセラレータを押せない。取り込み自身の振る舞いは
    // この広い権限があっても変わらない＝それを読みもしないし、別の経路を
    // 取ることもない。
    allUrls: true,
    // 本番の名前は絶対に使わない: この開発機は Chromium 向けにも
    // com.hologram.host を登録済みで、ホストまで届いた押下は本物のライブラリに
    // 書き込んでしまう。
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
    // タブ A は押す。タブ B はスクロールするだけ。タブを2つに分けるのは、
    // 設計の2つの半分が1つのタブの上では互いに排他的だから: どちらか先に
    // 起きた方が UI を持ち去ってしまい、もう一方には作用する対象が残らない。
    const pressTab = await openFeed(browser.context);
    pressTab.on('pageerror', (error: any) => pageErrors.push(String(error?.message || error)));
    const scrollTab = await openFeed(browser.context);
    scrollTab.on('pageerror', (error: any) => pageErrors.push(String(error?.message || error)));

    const photo = await pressTab.$('[data-testid="tweetPhoto"]');
    const box = await photo.boundingBox();
    if (!box) throw new Error('fixture photo has no layout box');
    await pressTab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await pressTab.waitForSelector('[data-hologram-overlay]', { timeout: 4000 });
    check(true, 'ベースライン: 拡張機能が生きている間はホバーの保存ボタンが描画される');

    // 一括取り込みが実行中の3本目のタブ（#646）。リロードより前に開始する。
    // それが実際の状況だからで、実行は数分続き、更新はその途中に降ってくる。
    const bulkTab = await openFeed(browser.context, BOOKMARKS_URL);
    bulkTab.on('pageerror', (error: any) => pageErrors.push(String(error?.message || error)));
    await browser.serviceWorker.evaluate(START_BULK_JS);
    await bulkTab.waitForSelector('[data-hologram-bulk-banner]', { timeout: 6000 });
    const bulkBefore = await bulkState(bulkTab);
    check(bulkBefore.banner !== RELOAD_NOTICE && bulkBefore.stop === 1, `ベースライン: 取り込みは実行中で、停止ボタンを提示している (${JSON.stringify(bulkBefore)})`);

    // --- 実際にすべてのタブを孤立させる ---------------------------------------
    // この呼び出しは実行中のワーカー自身を殺すので、evaluate は決して返らない。
    await browser.serviceWorker.evaluate('chrome.runtime.reload()').catch(() => {});
    // 孤立には事後条件があり、プローブはすでに400msごとに報告している:
    // 孤立した分離ワールドで chrome.runtime.id が falsy になること。タイムアウト
    // は握りつぶす＝下のプローブ検証が実際に見えたものをそのまま語る。
    const probeSnapshot = async () => JSON.parse((await pressTab.evaluate(() => document.documentElement.getAttribute('data-orphan-probe'))) || '{}');
    await waitFor('タブが chrome.runtime.id を失うこと＝孤立そのもの', async () => {
      const snapshot = await probeSnapshot();
      return snapshot.runtime === 'object' && !snapshot.id;
    }).catch(() => {});

    // --- #657: プラットフォームが実際に「リロード」した、無効化しただけではない ---
    // 無効化された拡張機能は、以下でこのファイルが検証するのとまったく同じ
    // 孤立の症状を出す（古いタブから話しかけられる生きた拡張機能が残っていない）
    // ので、この検証が無いと、Chrome が拡張機能をリロードしたのか、代わりに
    // 静かに無効化しただけなのかに関わらずファイル全体がグリーンになって
    // しまう＝これは #657 以前にまさに起きていたこと（Chrome 137 以降は
    // `--load-extension` を廃止し、このテストが動かす使い捨ての Chromium は
    // `reload()` で拡張機能をリロードするのではなく無効化していた）。同じ
    // 拡張機能 ID を持つ新しい・有効な service worker こそが、両者を見分ける
    // 唯一の信号である。
    const isReplacementWorker = (worker: any) => worker.url().startsWith(`chrome-extension://${browser.extensionId}/`) && worker !== browser.serviceWorker;
    const reloaded = browser.context.serviceWorkers().find(isReplacementWorker) || (await browser.context.waitForEvent('serviceworker', { predicate: isReplacementWorker, timeout: 5000 }).catch(() => null));
    check(!!reloaded, 'reload() の後に新しい service worker が起動した — chrome.runtime.reload() は無効化ではなく拡張機能をリロードした（#657）');
    if (reloaded) {
      const self = await reloaded.evaluate('chrome.management.getSelf()').catch((error: any) => ({ error: String(error) }));
      check(self?.enabled === true, `リロードされた拡張機能が enabled:true を報告している — 無効化されたままではない (${JSON.stringify(self)})`);
    }

    // --- ①プラットフォームの前提 ----------------------------------------------
    const probe = await probeSnapshot();
    check(probe.runtime === 'object', `孤立したワールドでも chrome.runtime は依然オブジェクトである (got ${probe.runtime})`);
    check(!probe.id && probe.idThrew === null, `chrome.runtime.id は例外を投げずに falsy になった — これが検出器の役目 (id ${JSON.stringify(probe.id)}, threw ${JSON.stringify(probe.idThrew)})`);
    check(/invalidated/i.test(probe.sendThrew || ''), `chrome.runtime.sendMessage は同期的に例外を投げる (${JSON.stringify(probe.sendThrew)})`);
    check(/invalidated/i.test(probe.storageThrew || ''), `chrome.storage.local.get は同期的に例外を投げる (${JSON.stringify(probe.storageThrew)})`);
    check(probe.listenerThrew === null, `runtime.onMessage の add/removeListener は例外を投げない — Chrome はすでにこれらを切り捨てている (${JSON.stringify(probe.listenerThrew)})`);

    // --- ②押した方 -----------------------------------------------------------
    const before = await overlayState(pressTab);
    check(before.controls > 0, `リロード後も注入された UI がページに残っている — これがバグの前提そのもの (${before.controls} controls)`);

    const control = await pressTab.$('[data-hologram-overlay]');
    if (!control) throw new Error('押すべき隅のコントロールが無い');
    await control.click();
    // 押した結果そのものが事後条件。タイムアウトは握りつぶす: どちらの半分が
    // 崩れたか（バナーが間違っている、あるいはコントロールが残っている）は
    // 下の検証が名指しする。
    await waitFor('押した結果としてリロード通知が返ってくること', async () => (await overlayState(pressTab)).banner === RELOAD_NOTICE).catch(() => {});
    const pressed = await overlayState(pressTab);
    check(pageErrors.length === 0, `孤立した保存ボタンを押してもページには何も投げられない (${JSON.stringify(pageErrors)})`);
    check(pressed.banner === RELOAD_NOTICE, `バナーは効く対処法を名指ししている — このページを再読み込み (got ${JSON.stringify(pressed.banner)})`);
    check(pressed.controls === 0, `古びたコントロールは消えていて、もう一度押せるものが残っていない (${pressed.controls} remain)`);

    // SAVE_ACK_MS（deadline.ts）を過ぎたところ: 以前は startSaveDeadline が
    // 仕掛けたタイマーだけが例外を生き延び、それが9秒後に健全な拡張機能に
    // 対してタイムアウトを報告していた。
    // あえて固定時間、しかも SAVE_ACK_MS を基準にした長さ: これはバナーが
    // 「決して」届かないことを検証する。この検証全体が観測窓であり、早く
    // 終えてしまうと、その中で発火していたはずのタイマーがまだ機会を
    // 得ていないことになる。
    // biome-ignore lint/plugin: sized off SAVE_ACK_MS — the window IS the check
    await sleep(12_000);
    const late = await overlayState(pressTab);
    check(late.banner !== TIMEOUT_NOTICE, `単に更新されただけの拡張機能を、遅れて出るタイムアウトバナーがホストのせいにすることはない (got ${JSON.stringify(late.banner)})`);
    check(pageErrors.length === 0, `保存の期限を過ぎても依然として何も投げられない (${JSON.stringify(pageErrors)})`);

    // --- ②何も押さなかったタブ -------------------------------------------------
    //
    // 画面にすでにあるものを数えるのではなく、HOVER させて計測する: コント
    // ロールはポインタの下にある写真の上に描かれるので、スクロールするだけで
    // それ自体が勝手に消え（写真がポインタから離れる）、この問題が直っていたか
    // どうかに関わらず前後の個数はどちらもゼロになってしまう。スクロールの
    // 後で改めて描画を求めるのが、答えが1つしかない問い方＝生きている
    // オーバーレイは描くが、破棄されたものは描けない。
    //
    // ⚠️写真は「今まさに画面上にある」ものでなければならない。ドキュメント内の
    // 最初の写真を狙うと、下のスクロール後にはビューポートの上へ外れてしまい、
    // ポインタは何もない場所に着地し、コントロールは何も描かれず、何かが
    // 直っていたかどうかに関わらずこの検証は通ってしまう（このファイルの
    // 最初の版では実際にそうなった）。
    // ⚠️内部の2つの待ちは固定時間のままにする: このヘルパーは、肯定側の検証
    // （生きたオーバーレイは依然として描く）と否定側の検証（破棄された
    // オーバーレイは何も描かない）の両方を支えている。コントロールの出現を
    // 待ってしまうと否定側の検証は反証不能になる＝何かが直っていたかどうかに
    // 関わらずタイムアウトしてゼロを報告してしまう。
    const hoverControlCount = async (page: any) => {
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
      // biome-ignore lint/plugin: fixed window — this helper also backs a "draws nothing" check
      await sleep(150);
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      // biome-ignore lint/plugin: fixed window — this helper also backs a "draws nothing" check
      await sleep(700);
      return (await overlayState(page)).controls;
    };

    check((await hoverControlCount(scrollTab)) > 0, '触っていないタブは、リロード後も（今はもう無駄な）保存ボタンを描き続けている — 報告どおりのバグ');

    await scrollTab.mouse.move(5, 5);
    for (let i = 0; i < 6; i++) {
      await scrollTab.mouse.wheel(0, 400);
      // biome-ignore lint/plugin: the pacing between notches is the input being simulated
      await sleep(120);
    }
    // 固定時間: この先で検証するのは、オーバーレイが「自分から」ページを
    // 去り、かつ何も言わなかったことである＝どちらも「無いこと」の検証なので、
    // これはそれが起こり得る観測窓である。
    // biome-ignore lint/plugin: window for two absences (nothing drawn, nothing said)
    await sleep(1200);
    const stillDraws = await hoverControlCount(scrollTab);
    const scrolled = await overlayState(scrollTab);
    check(stillDraws === 0, `スクロール後、孤立したオーバーレイは何も描かない — 自分でページから退いた (${stillDraws} drawn)`);
    check(scrolled.banner === null, `…しかもそれを無言でやった — 自動更新のたびに開いているすべてのタイムラインへ通知を出してはならない (got ${JSON.stringify(scrolled.banner)})`);
    check(pageErrors.length === 0, `受け身の経路でも何も投げられない (${JSON.stringify(pageErrors)})`);

    // --- ②更新が降ってきた時に実行中だった一括取り込み（#646） -------------------
    //
    // あえて最後に置く: 未修正のコードが捕捉されない例外を出すのがこの節で
    // あり、上の検証も同じ `pageErrors` 配列を読んでいる。
    //
    // トリガーはスクロールやクリックではなく「行のマウント」である。それが
    // 取り込みの唯一の入力だからで、行が現れた瞬間にパーマリンクを読み、
    // その投稿がすでに保存済みかどうかをライブラリに尋ねる。その問い合わせが
    // この issue の対象である sendMessage そのもの。この時点でリロードから
    // SAVED_QUERY_TIMEOUT_MS 以上が経過しているので、リロード前に飛んでいた
    // バッチはとっくに諦めて「問い合わせ中」のラッチを解除している。そうで
    // なければ実行は再度の問い合わせを拒み、何も計測できない。
    const rows = await bulkTab.evaluate(MOUNT_ROW_JS);
    check(rows > 8, `ブックマーク一覧に新しい行がマウントされた。これが取り込みの唯一の入力 (${rows} rows)`);
    // バナーがリロード通知に変わることが、実行がその行に対して返す答え。
    // 未修正のコードでは決して来ず、握りつぶすタイムアウトは、それが置き換えた
    // 固定待ちよりも「長い」観測窓を残すので、下の「何も投げられない」検証は
    // 修正済みの経路で早く終わることによって弱められることはない。
    await waitFor('実行中の取り込みがリロード通知で終わること', async () => (await bulkState(bulkTab)).banner === RELOAD_NOTICE).catch(() => {});
    const bulkAfter = await bulkState(bulkTab);
    check(pageErrors.length === 0, `実行中の取り込みは、新しい行について問い合わせてもページには何も投げない (${JSON.stringify(pageErrors)})`);
    check(bulkAfter.banner === RELOAD_NOTICE, `進捗バナーがリロード通知になった — 実行を打ち切ったのは更新であって、利用者やライブラリが何かをしたからではない (got ${JSON.stringify(bulkAfter.banner)})`);
    check(bulkAfter.stop === 0, `…しかも実行はラベルの張り替えではなく本当に終わっている: 停止ボタンが消えている (${bulkAfter.stop} left)`);
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(extensionDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\nFAIL e2e-extension-orphan: ${failures.length}件の検証が失敗した — 孤立したタブが #594 で決めたとおりに振る舞っていない`);
    process.exit(1);
  }
  console.log('\nPASS e2e-extension-orphan: 孤立したタブは何も投げず、自分が描いたものを片付け、保存を求められた時にだけ話す');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
