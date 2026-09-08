import { test } from '@playwright/test';

// タイムラインのホバーコントロールに対する時間軸の回帰テスト（#347）。
// フリッカーとは「時間の経過に伴って」繰り返されるマウント/アンマウントで
// あり、overlay-visual.spec.ts の前後比較には見えない。そこでこれは
// プラットフォームを模したフィード（x / bluesky / pixiv のフィクスチャ）で
// スクロールセッションを駆動し、オーバーレイの DOM タイムラインが静かな
// ままであることを検証する:
//
//   hover        — ホバーで保存ボタンが現れる。Bluesky/pixiv では写真を覆う
//                  隣接オーバーレイ越しでも現れること（#338 の回帰形）。
//                  ホバーされた写真自身の rect は、コントロールがマウントされて
//                  いる間、崩れてはならない（#347 の「画像が点滅する」半分 —
//                  bsky.app で実際に確認済み: overlay.ts が <img> の素の・
//                  サイズ無し親の position:relative を借用したところ、それが
//                  静かにその containing block になってしまい、高さ0に
//                  潰れた）。
//   jiggle-scroll — 1枚の写真の上でホイールを小刻みに前後させても（長い投稿を
//                  読んでいる状態）ボタンは決して外れない: 写真はその間ずっと
//                  ポインタの下に留まり、ホバーはスクロールが起きたという
//                  事実ではなく、その幾何形状で決まる。
//   re-render    — フィードがホバー中の写真の要素を新しいものに差し替えても
//                  （スクロール中の仮想化タイムラインの再描画）、ボタンは
//                  取り落とされずに新しい要素へ渡される。
//   still-scroll — ポインタを「静止」させたままホイールでスクロールした後、
//                  ポインタの下の写真へコントロールが一度だけ戻る。スクロール
//                  中や遅れて届く Intersection Observer の通知ごとに付け替わる
//                  ことはない。
//   drift-scroll — 実際の手が生む数px程度のポインタのずれを伴うホイール
//                  スクロールは、新しい写真への切り替えは仕様通り起こり得る
//                  （それぞれ1回マウント）が、同じ写真が2回マウントされる
//                  ことは無く（＝ばたつき）、オーバーレイがページ要素への
//                  スタイル書き込みを乱発することも無い — これが「画像が
//                  点滅する」症状。
//   leave        — ポインタが空白のページ領域へ移動: すべてのコントロールが
//                  消える。
//
//   npx playwright test --project=extension overlay-flicker
//
// 先に拡張機能をビルドすること（`npm run test:overlay-flicker` は両方やる）。
// 失敗した時はその段階のイベントタイムラインが出力される。修正ループにとっての
// デバッグ材料は成否の1ビットではなく、そのタイムラインの方。

const { launchOverlayBrowser, openFixture, fixtureHtml, takeLog, wheelScroll, continuousScroll, summarize, formatTimeline } = require('../lib/overlay-browser.cts');
const { sleep } = require('../../scripts/lib-wait.cts');

// scrollend 未対応時に使う overlay.ts の SCROLL_HOVER_SETTLE_MS と、
// 旧実装で競合が起きた観測窓を反映したもの。待ちはこれより長くなければならない。
//
// ⚠️このファイルの待ちはほぼすべて固定時間で、それを変えない（#986）。
// フリッカーは「時間の経過に伴うパターン」— 同じホストが2回マウントされる、
// スタイル書き込みが乱発する — なので、各段階にはそのパターンが現れる余地の
// ある観測窓が必要になる。以下の検証はどれも「そして他には何も起きなかった」
// という形をしており、条件が成立した瞬間に終わる待ちでは、こうした検証に
// 観測窓が一切与えられない: 常に一瞬で、しかも永遠に通ってしまう。観測窓の
// 長さは SETTLE_MS を基準にしている。その中で発火していたのが、まさに落ち着き
// タイマーだったから（#347）。
const SETTLE_MS = 100;

// 保存の「面」。要素の種類ではなく名前で問い合わせる。#310 以降、ページの
// 部分木にある要素は shadow host（<hologram-corner-control>）であり、
// <button> はその shadow root の内側にあるので、以前これが待っていた
// `button[data-hologram-overlay]` はもう何にもマッチしない。まさにこの理由で
// `data-hologram-face` はホストの上にある: 面自身の文言はブラウザのロケール
// に従うので、テストが待てるものではない。
const SAVE_FACE = '[data-hologram-overlay][data-hologram-face="save"]';

const PLATFORMS: Record<string, { url: string; image: string }> = {
  x: { url: 'https://x.com/home', image: '[data-testid="tweetPhoto"]' },
  bluesky: { url: 'https://bsky.app/', image: '.thumbwrap img' },
  pixiv: { url: 'https://www.pixiv.net/', image: '.card img' },
};

interface CheckResult {
  platform: string;
  check: string;
  ok: boolean;
  detail: string;
  timeline: string;
}

const results: CheckResult[] = [];
const verbose = false;
const platforms = Object.keys(PLATFORMS);
for (const name of platforms) if (!PLATFORMS[name]) throw new Error(`未知のプラットフォーム ${name}（期待値: ${Object.keys(PLATFORMS).join(', ')}）`);

function report(platform: string, check: string, ok: boolean, detail: string, timeline = '') {
  results.push({ platform, check, ok, detail, timeline });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${platform}:${check} — ${detail}`);
  if (timeline && (verbose || !ok)) console.log(timeline.replace(/^/gm, '    '));
}

async function overlayCount(page: any): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-hologram-overlay]').length);
}

// N番目のフィクスチャ画像の中心＝ホバーの標的。レイアウトが変わるたびに
// 読み直すこと。ページがスクロールすると box は動く。
async function imageCenter(page: any, selector: string, index: number): Promise<{ x: number; y: number }> {
  const box = await imageRect(page, selector, index);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function imageRect(page: any, selector: string, index: number): Promise<{ x: number; y: number; width: number; height: number }> {
  const handles = await page.$$(selector);
  if (handles.length <= index) throw new Error(`フィクスチャに ${selector} #${index} が無い`);
  const box = await handles[index].boundingBox();
  if (!box) throw new Error(`${selector} #${index} にレイアウト box が無い`);
  return box;
}

async function runPlatform(overlay: any, name: string): Promise<void> {
  const spec = PLATFORMS[name];
  const page = await openFixture(overlay, spec.url, fixtureHtml(name));
  try {
    // --- hover: 保存ボタンが現れる（bluesky/pixiv では隣接オーバーレイ越しに
    // — そこではポインタは物理的にその隣接要素の上に着地する）。
    const restRect = await imageRect(page, spec.image, 1);
    const target = await imageCenter(page, spec.image, 1);
    await page.mouse.move(target.x, target.y);
    let hoverOk = true;
    let hoverDetail = 'ホバーで保存ボタンが現れた';
    try {
      await page.waitForSelector(SAVE_FACE, { timeout: 3000 });
    } catch {
      hoverOk = false;
      hoverDetail = '写真をホバーしても3秒以内に保存ボタンが現れなかった';
    }
    report(name, 'hover', hoverOk, hoverDetail, formatTimeline(await takeLog(page)));
    if (!hoverOk) return; // スクロールの段階は同じ失敗を繰り返すだけになる

    // --- no-collapse: コントロールがマウントされている間、写真自身の box は
    // 変わってはならない。overlay.ts はコントロールを配置するために box の
    // ホストの position:relative を借用する。そのホストがすでに box の
    // containing block の出どころだった場合（絶対配置の <img> で、本当の
    // containing block が素の・サイズ無し親を越えてさらに上にある場合）、
    // その借用は静かにそれを再定義してしまい、写真が潰れる。
    const hoveredRect = await imageRect(page, spec.image, 1);
    const collapsed = hoveredRect.width < restRect.width * 0.9 || hoveredRect.height < restRect.height * 0.9;
    report(name, 'no-collapse', !collapsed, `静止時の写真 rect は ${restRect.width}x${restRect.height}、ホバー時は ${hoveredRect.width}x${hoveredRect.height}（変化なしを期待）`);

    // --- jiggle-scroll: ポインタは静止させたまま、ホイールを小さなノッチで
    // 上下に揺らし、写真が始点と同じ位置に戻り、ポインタから一度も外れない
    // ようにする。何もアンマウントされてはならない — ここでかつて起きていた
    // 削除は、単にスクロールが起きたという事実だけで落ち着きタイマーが
    // ホバーを消していたもの（#347）。
    await takeLog(page);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, i % 2 ? -40 : 40);
      // biome-ignore lint/plugin: the pacing between notches is the input being simulated
      await sleep(60);
    }
    await sleep(SETTLE_MS + 250); // 観測窓: 落ち着きタイマーによる削除はここに収まるはず
    const jiggleEvents = await takeLog(page);
    const jiggle = summarize(jiggleEvents);
    const jiggleRect = await imageRect(page, spec.image, 1);
    const onPicture = target.x >= jiggleRect.x && target.x <= jiggleRect.x + jiggleRect.width && target.y >= jiggleRect.y && target.y <= jiggleRect.y + jiggleRect.height;
    const kept = await overlayCount(page);
    // onPicture は結果ではなく前提条件: 写真がポインタの下から外れて動いて
    // しまうフィクスチャでは、この先の検証が空虚になってしまう。
    report(name, 'jiggle-scroll', onPicture && jiggle.removes === 0 && kept === 1, `pointerOnPicture=${onPicture} adds=${jiggle.adds} removes=${jiggle.removes} controls=${kept}（pointerOnPicture=true removes=0 controls=1 を期待）`, formatTimeline(jiggleEvents));

    // --- re-render: ポインタを動かさないまま、フィードがホバー中の写真の
    // 要素を同一内容の新しい要素に差し替える（仮想化タイムラインがスクロール
    // 中にやること）。写真は一度もポインタから外れていないので、ボタンは
    // マウスの揺らぎを待つのではなく、新しい要素の上に着地しなければならない。
    await takeLog(page);
    await page.evaluate((selector: string) => {
      const box = document.querySelectorAll(selector)[1];
      if (!box) return;
      const fresh = box.cloneNode(true) as Element;
      // ページ自身の再描画は自分自身のマークアップを作る。オーバーレイの
      // コントロールを引き継ぐことは無く、もし引き継ぐクローンなら2つ目の
      // コントロールを残してしまい、この検証はコードではなくフィクスチャを
      // 測ることになる。
      for (const stale of fresh.querySelectorAll('[data-hologram-overlay]')) stale.remove();
      box.replaceWith(fresh);
    }, spec.image);
    // コントロールを待つのではなく観測窓: 検証は「コントロールは1つで、
    // 途中でばたつかなかった」であり、ばたつきは時間の幅の上でしか見えない。
    await sleep(SETTLE_MS + 400);
    const rerenderEvents = await takeLog(page);
    const rerender = summarize(rerenderEvents);
    const rehomed = await overlayCount(page);
    report(name, 're-render', rehomed === 1 && rerender.flapping.length === 0, `controls=${rehomed} adds=${rerender.adds} flapping=[${rerender.flapping.join(', ')}]（controls=1、ばたつき無しを期待）`, formatTimeline(rerenderEvents));

    // --- idle-re-render: 別タブへ移った後のようにホバーが空の間に、投稿
    // ユニットを残して media の箱だけを差し替える。ホバー中の rehomeHover
    // だけに頼ると、追跡表は切断済みの古い箱を指し続け、新しい写真へ戻っ
    // ても保存ボタンが出ない。
    await page.mouse.move(10, 10);
    await page.waitForSelector(SAVE_FACE, { state: 'detached', timeout: 3000 });
    await takeLog(page);
    await page.evaluate((selector: string) => {
      const box = document.querySelectorAll(selector)[1];
      if (!box) return;
      const fresh = box.cloneNode(true) as Element;
      for (const stale of fresh.querySelectorAll('[data-hologram-overlay]')) stale.remove();
      box.replaceWith(fresh);
    }, spec.image);
    await sleep(SETTLE_MS + 400);
    await page.mouse.move(target.x + 2, target.y);
    await page.mouse.move(target.x, target.y);
    let idleRerenderOk = true;
    try {
      await page.waitForSelector(SAVE_FACE, { timeout: 3000 });
    } catch {
      idleRerenderOk = false;
    }
    const idleRerenderEvents = await takeLog(page);
    const idleRerender = summarize(idleRerenderEvents);
    const idleRehomed = await overlayCount(page);
    report(name, 'idle-re-render', idleRerenderOk && idleRehomed === 1 && idleRerender.flapping.length === 0, `controls=${idleRehomed} adds=${idleRerender.adds} flapping=[${idleRerender.flapping.join(', ')}]（controls=1、ばたつき無しを期待）`, formatTimeline(idleRerenderEvents));
    if (!idleRerenderOk) return;

    // --- still-scroll: ポインタを静止させたまま、一つの連続スクロールを
    // 12ノッチ分の距離だけ送る。停止後には最後に
    // ポインタの下へ来た写真へ一度だけ付く。ホバー中だったコントロールを
    // 外した後、スクロール中の各写真へ連続して付け替わってはならない。
    await takeLog(page);
    await continuousScroll(page, { from: target, steps: 12, deltaY: 120, stepMs: 50 });
    await sleep(SETTLE_MS + 250); // 観測窓: ポインタの下を通り過ぎる写真によるマウントはここに収まるはず
    const stillEvents = await takeLog(page);
    const still = summarize(stillEvents);
    const leftovers = await overlayCount(page);
    const stillOk = still.adds === 1 && still.removes <= 1 && leftovers === 1 && still.flapping.length === 0;
    report(name, 'still-scroll', stillOk, `adds=${still.adds} removes=${still.removes} styleWrites=${still.styles} leftovers=${leftovers} flapping=[${still.flapping.join(', ')}]（adds=1 removes<=1 leftovers=1、ばたつき無しを期待）`, formatTimeline(stillEvents));

    // --- drift-scroll: 同じスクロールだが、ノッチ間に2pxのポインタのずれを
    // 加える。新しい写真への切り替えは仕様どおり起こり得る（それぞれ1回
    // マウント）。「同じ」写真が2回マウントされるのはフリッカーであり、
    // ページ要素へのスタイル書き込みの乱発（借用したホストの position）が
    // 画像点滅の症状。
    await page.evaluate(() => window.scrollTo(0, 0));
    // 前の段階の落ち着きタイマーは、この段階のログを取る「前」に期限切れに
    // なっていなければならない。そうでないと、その削除がこの段階の分として
    // 数えられてしまう。
    await sleep(SETTLE_MS + 400);
    const retarget = await imageCenter(page, spec.image, 1);
    await page.mouse.move(retarget.x, retarget.y);
    await page.waitForSelector(SAVE_FACE, { timeout: 3000 });
    await takeLog(page);
    await wheelScroll(page, { from: retarget, steps: 12, deltaY: 120, stepMs: 50, jitterPx: 2 });
    await sleep(SETTLE_MS + 250); // 観測窓: 同じホストの再マウントやスタイルの乱発はここに収まるはず
    const driftEvents = await takeLog(page);
    const drift = summarize(driftEvents);
    const churny = [...drift.byHost].filter(([, s]) => s.styles > 2).map(([host]) => host);
    const driftOk = drift.flapping.length === 0 && churny.length === 0;
    report(name, 'drift-scroll', driftOk, `adds=${drift.adds} flapping=[${drift.flapping.join(', ')}] styleChurn=[${churny.join(', ')}]（ばたつき無し、ホストごとのスタイル書き込み2回以下を期待）`, formatTimeline(driftEvents));

    // --- leave: ポインタをページの余白へ移すとすべてが消える。
    await page.mouse.move(30, 400);
    await sleep(SETTLE_MS + 250); // 観測窓: 最後のコントロールを取り去るのは落ち着きタイマー
    const left = await overlayCount(page);
    report(name, 'leave', left === 0, `フィードから離れた後のコントロール数: ${left}（0 を期待）`);
  } finally {
    await page.close();
  }
}

test('overlay-flicker', async () => {
  const overlay = await launchOverlayBrowser();
  try {
    for (const name of platforms) await runPlatform(overlay, name);
  } finally {
    await overlay.close();
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`FAIL e2e-overlay-flicker: ${results.length}件中${failed.length}件の検証が失敗（${failed.map((r) => `${r.platform}:${r.check}`).join(', ')}）`);
    throw new Error('検証が失敗しました。上の失敗項目を確認してください。');
  }
  console.log(`PASS e2e-overlay-flicker: ${platforms.join(', ')} にわたって${results.length}件の検証`);
});
