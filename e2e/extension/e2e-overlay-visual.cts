'use strict';

// タイムラインのホバーコントロールに対する、ブラウザレベルの回帰テスト。
// jsdom は DOM の判定はテストできるが、Chrome のスクロールコンポジタ、
// 重なり順、コンテンツスクリプトの分離までは動かせない。このテストは
// ビルド済みの拡張機能を使い捨ての Chrome プロファイルへ読み込み、x.com 自身の
// 形をしたページを配信する。
//
//   node e2e/extension/e2e-overlay-visual.cts

const { launchOverlayBrowser, openFixture } = require('../../scripts/lib-overlay-e2e.cts');
const { sleep, waitFor } = require('../../scripts/lib-wait.cts');

// プログラムによるスクロールには観測可能な終わりがある: ページがそのオフセット
// に「ある」状態で、ブラウザがそこにフレームを描き終えている — それこそが、
// オーバーレイが借用した transform が画面に乗り、getBoundingClientRect が
// 何かを意味するようになる時。rAF を2回使うのは、1回目はスクロールを適用する
// フレームだから。
async function scrollPage(page: any, y: number): Promise<void> {
  await page.evaluate((want: number) => window.scrollTo(0, want), y);
  await page.waitForFunction((want: number) => window.scrollY === want, y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const noOverlay = (page: any) => page.evaluate(() => !document.querySelector('[data-hologram-overlay]'));

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 2200px; background: #fff; font-family: Arial, sans-serif; }
  header { position: fixed; inset: 0 0 auto; height: 72px; z-index: 100; background: #fff; border-bottom: 1px solid #cfd9de; padding: 22px 32px; }
  #compose { position: fixed; top: 16px; right: 28px; z-index: 101; }
  main { width: 620px; margin: 0 auto; padding-top: 160px; }
  article { border: 1px solid #cfd9de; border-radius: 14px; padding: 18px; }
  [data-testid="tweetPhoto"] { position: relative; width: 560px; height: 560px; margin-top: 14px; overflow: hidden; border-radius: 14px; background: linear-gradient(135deg, #cde9ff, #ebd2ff); }
  [data-testid="tweetPhoto"] img { display: block; width: 100%; height: 100%; object-fit: cover; }
  #composeDialog[hidden] { display: none; }
  #composeDialog { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; background: rgba(0, 0, 0, .45); }
  #composeDialog > div { width: 460px; min-height: 220px; padding: 28px; border-radius: 18px; background: white; }
</style></head><body>
  <header>Home</header><button id="compose">Post</button>
  <main><article data-testid="tweet" id="tweet">
    <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">now</time></a>
    <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/AAA.jpg" alt="test image"></div>
  </article></main>
  <div id="composeDialog" role="dialog" aria-modal="true" hidden><div>Compose post</div></div>
  <script>document.querySelector('#compose').addEventListener('click', () => document.querySelector('#composeDialog').hidden = false);</script>
</body></html>`;

(async () => {
  const overlay = await launchOverlayBrowser({ locale: 'ja-JP' });
  try {
    const page = await openFixture(overlay, 'https://x.com/home', HTML);
    await page.waitForSelector('[data-testid="tweetPhoto"]');

    const photo = await page.$('[data-testid="tweetPhoto"]');
    const photoBox = await photo.boundingBox();
    if (!photoBox) throw new Error('テスト用の写真にブラウザのレイアウト box が無い');
    await page.mouse.move(photoBox.x + photoBox.width / 2, photoBox.y + photoBox.height / 2);
    await page.waitForSelector('[data-hologram-overlay]', { timeout: 3000 });

    // ステージングされた拡張機能は誰も登録していないホスト名を指しているので
    // （lib-overlay-e2e.cts）、ホバーのコントロールを押すと実際のバックグラウンド
    // 失敗経路が動く: 再試行チップは画像の上に残り、読める警告が
    // 上部中央のバナーに現れる（#357）。
    await page.click('[data-hologram-overlay]');
    // #44: 失敗バナーは共有の ShadowRoot の中にある。Playwright の CSS
    // セレクタは開いた shadow root を貫通するが、page.evaluate の
    // querySelector はしない。
    await page.waitForSelector('[data-hologram-save-banner]', { timeout: 5000 });
    // バナーは Web Animation を伴って現れる（status-surface.ts の frames():
    // translateY(-14px) scale(0.96) → none）ので、以下で読むすべての数値は
    // getBoundingClientRect。その途中で計測すると、レイアウトの数値ではなく
    // トゥイーンの数値になる — これはまさに夜間ランナーが報告した内容
    // （一度も動いていない `top: 12px` に対して top=11.02、#818）。固定の
    // sleep では確率が動くだけなので、アニメーション自体を待つ。
    await page.evaluate(async () => {
      const banner = document.querySelector('hologram-extension-ui')?.shadowRoot?.querySelector('[data-hologram-save-banner]');
      if (banner) await Promise.all(banner.getAnimations().map((animation) => animation.finished.catch(() => {})));
    });
    // chrome.storage.local へのログはベストエフォートかつ非同期なので、
    // そのエントリ自体が事後条件。タイムアウトはあえて握りつぶす: この先の
    // 明示的な検証がログが「実際に」持っていた内容を報告する方が、
    // 「10秒待った」よりも役に立つ失敗になる。
    const readDiagnostics = () =>
      overlay.browser.serviceWorkers()[0].evaluate(async () => {
        const all = await (globalThis as any).chrome.storage.local.get(null);
        return Object.entries(all)
          .filter(([key]) => key.startsWith('diaglog_'))
          .map(([, value]) => value);
      });
    let diagnosticEntries: any[] = [];
    await waitFor('失敗した保存が拡張機能の診断ログに届くこと', async () => {
      diagnosticEntries = await readDiagnostics();
      return diagnosticEntries.some((entry: any) => entry?.phase === 'fail' && typeof entry?.error === 'string');
    }).catch(() => {});
    // 隅の「面」はバナーとは別の要素で、別の経路で更新されるので、バナーが
    // 現れたこともそのアニメーションが終わったことも、それについては何も
    // 語らない（#982）。ここでは何もそれを待っていなかった: 上の診断ログの
    // 待ちが速いマシンではたまたまその隙間をカバーしていたが、混んだランナー
    // ではそうならなかった — `main` は 286c87c で `failed` を期待した場所に
    // `save` を読んでレッドになり、同じ主張の中の他のすべての数値が正しかった
    // せいで、それを壊れた「レイアウト」として報告した。面自体を待つことで、
    // タイムアウトが実際に起きなかったことを正しく語るようになる。
    await page.waitForSelector('[data-hologram-overlay][data-hologram-face="failed"]', { timeout: 5000 }).catch(() => {
      throw new Error('OVERLAY_FAILURE_FACE_FAIL: 保存が失敗した後も隅が failed の面に切り替わらなかった');
    });
    const failureUi = await page.evaluate(() => {
      const banner = document.querySelector('hologram-extension-ui')?.shadowRoot?.querySelector('[data-hologram-save-banner]');
      // #310以降、隅自身の要素は shadow host。面を持つディスクはその root の
      // 内側にあり、page.evaluate の querySelector は shadow root を貫通
      // しないので、明示的に辿る。
      const retry = document.querySelector('[data-hologram-overlay]');
      const disc = retry?.shadowRoot?.firstElementChild;
      if (!banner || !retry || !disc) return null;
      const r = banner.getBoundingClientRect();
      return {
        role: banner.getAttribute('role'),
        text: banner.textContent,
        top: r.top,
        centerX: r.left + r.width / 2,
        width: r.width,
        retryFace: retry.getAttribute('data-hologram-face'),
        retryLabel: disc.getAttribute('aria-label'),
        // #310: このコントロールにはブラウザのツールチップがどこにも無い —
        // ホストにも、ディスクにも。失敗が「何を意味するか」は今やバナーの
        // 役目。
        retryTitled: retry.hasAttribute('title') || disc.hasAttribute('title'),
      };
    });
    if (!failureUi || failureUi.role !== 'alert' || !failureUi.text || failureUi.width < 200 || Math.abs(failureUi.top - 12) > 0.5 || Math.abs(failureUi.centerX - 640) > 0.5 || failureUi.retryFace !== 'failed') {
      throw new Error(`OVERLAY_FAILURE_BANNER_LAYOUT_FAIL: ${JSON.stringify(failureUi)}`);
    }
    if (failureUi.retryTitled) throw new Error(`OVERLAY_RETRY_TOOLTIP_FAIL: 隅がまだブラウザのツールチップを持っている — ${JSON.stringify(failureUi)}`);
    // bannerHostMissing（extension/utils/i18n.ts）— ホスト不在のメッセージで、
    // このフィクスチャがどのマシンでも引き起こす失敗そのもの。隅の方は代わりに
    // cornerRetry を言う: 長い復旧の文はそのための余地がある画面の役目
    // （#310）。
    // #203 はそこに bannerQueued を継ぎ足す: ホストが一度も答えなかった保存は
    // 今や再試行のために保持されており、バナーはそれを言わなければ利用者は
    // 「失敗した」と読んで手で保存し直してしまう。理由だけ、約束だけではそれ
    // ぞれ違う（そして間違った）ことを伝えてしまうので、両方の半分を検証する。
    if (failureUi.text !== 'Hologram の保存先に接続できません。Chrome を再起動してください 接続が回復したら自動で保存します。' || failureUi.retryLabel !== '保存に失敗しました。押すと再試行します。') {
      throw new Error(`OVERLAY_FAILURE_BANNER_LOCALE_FAIL: ${JSON.stringify({ failureUi, diagnosticEntries })}`);
    }
    const rawFailure = diagnosticEntries.find((entry) => entry?.phase === 'fail' && typeof entry?.error === 'string');
    if (!rawFailure) {
      throw new Error(`OVERLAY_FAILURE_DIAGNOSTIC_FAIL: ${JSON.stringify(diagnosticEntries)}`);
    }
    if (process.env.HOLOGRAM_OVERLAY_SCREENSHOT) {
      await page.screenshot({ path: process.env.HOLOGRAM_OVERLAY_SCREENSHOT });
    }
    // 表示時間そのものは仕様だが、その「終わり」は観測できる: それを超える
    // はずの数値を待つのではなく、バナーが実際に去るのを待つ。下の検証は
    // それでも失敗を報告する（waitFor のタイムアウトは握りつぶす）。
    const bannerGone = () => page.evaluate(() => !document.querySelector('hologram-extension-ui')?.shadowRoot?.querySelector('[data-hologram-save-banner]'));
    await waitFor('失敗バナーが表示時間を終えて去ること', bannerGone, { timeoutMs: 15_000 }).catch(() => {});
    const failureCleared = await bannerGone();
    if (!failureCleared) throw new Error('OVERLAY_FAILURE_BANNER_DISMISS_FAIL: 失敗バナーが去らなかった');

    const before = await page.evaluate(() => {
      const button = document.querySelector('[data-hologram-overlay]');
      const media = document.querySelector('[data-testid="tweetPhoto"]');
      if (!button || !media) return null;
      const buttonRect = button.getBoundingClientRect();
      const mediaRect = media.getBoundingClientRect();
      return { deltaTop: buttonRect.top - mediaRect.top };
    });
    if (!before) throw new Error('スクロール検証の前にテスト用コントロールが消えた');
    // スクロールが描画された後、しかしホバーの後片付けが走る前に計測する
    // （SCROLL_HOVER_SETTLE_MS は100ms、2フレームは約32ms）: コントロールは、
    // 自分が乗っている写真と同じスクロールの transform を使っていなければ
    // ならない。
    await scrollPage(page, 80);
    const scroll = await page.evaluate((previous) => {
      const button = document.querySelector('[data-hologram-overlay]')?.getBoundingClientRect();
      const media = document.querySelector('[data-testid="tweetPhoto"]')?.getBoundingClientRect();
      return button && media ? Math.abs(button.top - media.top - previous.deltaTop) < 0.5 : false;
    }, before);
    if (!scroll) throw new Error('OVERLAY_SCROLL_TRACKING_FAIL: コントロールがメディアのスクロール位置を共有していない');

    await scrollPage(page, 0);
    const photoBeforeModal = await photo.boundingBox();
    if (!photoBeforeModal) throw new Error('モーダル検証の前にテスト用の写真が消えた');
    await page.mouse.move(photoBeforeModal.x + photoBeforeModal.width / 2, photoBeforeModal.y + photoBeforeModal.height / 2);
    await page.waitForSelector('[data-hologram-overlay]', { timeout: 3000 });

    // ポインタを動かさずにモーダルを開くと、実際の障害が再現する: 古い
    // バックグラウンドのコントロールがダイアログの上に残ってはならない。
    await page.evaluate(() => ((document.querySelector('#composeDialog') as HTMLElement).hidden = false));
    await waitFor('モーダルが開いたらバックグラウンドのコントロールが去ること', () => noOverlay(page)).catch(() => {});
    const modalClear = await noOverlay(page);
    if (!modalClear) throw new Error('OVERLAY_MODAL_OCCLUSION_FAIL: モーダルが開いている間もバックグラウンドのコントロールが残っていた');

    await page.evaluate(() => {
      (document.querySelector('#composeDialog') as HTMLElement).hidden = true;
    });
    const photoBeforeHeader = await photo.boundingBox();
    if (!photoBeforeHeader) throw new Error('ヘッダー検証の前にテスト用の写真が消えた');
    await page.mouse.move(photoBeforeHeader.x + photoBeforeHeader.width / 2, photoBeforeHeader.y + photoBeforeHeader.height / 2);
    await page.waitForSelector('[data-hologram-overlay]', { timeout: 3000 });
    // 写真の上端（コントロールが乗っている隅）は固定ヘッダーの下へスクロール
    // していくが、ポインタはその真ん中に留まる。ポインタは依然として写真の
    // 上にあるので、ホバーは依然として有効: 遮蔽は「ポインタ」について
    // 問われるべきものであり、代わりにコントロールの隅について問うたことが、
    // x.com でスクロール中にボタンを取り去ってしまった原因（#347）。
    await scrollPage(page, 190);
    // あえて固定時間: これはコントロールが「取り去られない」ことを検証する
    // ので、待ちは overlay.ts の SCROLL_HOVER_SETTLE_MS（100ms）より長く
    // なければならない — かつては単にスクロールが起きたという事実だけで
    // ホバーを消していたタイマー。ここで事後条件を待つということは、何も
    // 起きないことを待つことになり、一瞬で通って何も検証しない。
    // biome-ignore lint/plugin: window in which the settle timer must NOT fire
    await sleep(250);
    const headerHold = await page.evaluate(() => !!document.querySelector('[data-hologram-overlay]'));
    if (!headerHold) throw new Error('OVERLAY_HEADER_HOVER_LOST_FAIL: ポインタがまだ写真の上にあるのにコントロールが消えた');

    // 同じ写真、同じスクロール位置: ポインタ自身が、写真の上端を覆っている
    // ヘッダーの上へ移動する。今度こそポインタと写真の間に何かが「ある」ので、
    // ホバーは終わる。
    const photoUnderHeader = await photo.boundingBox();
    if (!photoUnderHeader) throw new Error('ヘッダー検証の途中でテスト用の写真が消えた');
    await page.mouse.move(photoUnderHeader.x + photoUnderHeader.width / 2, 40);
    await waitFor('ポインタが固定ヘッダーの上に来たらコントロールが去ること', () => noOverlay(page)).catch(() => {});
    const headerClear = await noOverlay(page);
    if (!headerClear) throw new Error('OVERLAY_HEADER_OCCLUSION_FAIL: ポインタが固定ヘッダーの上にある間もコントロールが残っていた');

    // #659: ビューア自身が `[role="dialog"][aria-modal="true"]` そのものである。
    // このファイルの compose-dialog のケース（上）が固定しようとしている
    // 「開いたモーダルはすべてホバーを遮る」という一律の規則は、直っていなければ
    // ビューア自身の写真を永久に触れなくしてしまう — modalCovers() は、
    // アンカーを「含む」モーダルを例外扱いしなければならない。
    // #704: swipe-to-dismiss のラッパーは X のスワイプダウンの当たり判定
    // 対象で、写真ではなく「ビューアのスライド」に合わせたサイズになっている。
    // このレイアウトは、写真がビューポートの上端に達し、そうでなければ X の
    // 閉じるボタンと衝突してしまうワイドウィンドウのケースを再現している。
    const VIEWER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { background: #000; }
  [role="dialog"] { position: fixed; inset: 0; }
  [data-testid="swipe-to-dismiss"] { position: relative; width: 100%; height: 100%; }
  [data-testid="swipe-to-dismiss"] img { display: block; position: absolute; left: 18px; top: 0; width: 1100px; height: 620px; object-fit: contain; }
  button[aria-label="Close"] { position: fixed; left: 12px; top: 12px; width: 36px; height: 36px; }
</style></head><body>
  <div role="dialog" aria-modal="true">
    <div data-testid="swipe-to-dismiss">
      <img src="https://pbs.twimg.com/media/AAA.jpg?format=jpg&amp;name=large" alt="viewer image">
    </div>
    <button aria-label="Close"></button>
  </div>
</body></html>`;
    const viewerPage = await openFixture(overlay, 'https://x.com/alice/status/111/photo/1', VIEWER_HTML);
    const viewerImg = await viewerPage.$('[data-testid="swipe-to-dismiss"] img');
    const viewerImgBox = await viewerImg.boundingBox();
    if (!viewerImgBox) throw new Error('ビューアのフィクスチャにブラウザのレイアウト box が無い');
    await viewerPage.mouse.move(viewerImgBox.x + viewerImgBox.width / 2, viewerImgBox.y + viewerImgBox.height / 2);
    const viewerControlVisible = await viewerPage.waitForSelector('[data-hologram-overlay]', { timeout: 3000 }).then(
      () => true,
      () => false,
    );
    if (!viewerControlVisible) throw new Error('OVERLAY_VIEWER_MODAL_BLOCKED_FAIL: 写真ビューア自身がダイアログであり、ホバーがそれに遮られた — modalCovers() はアンカーを含むモーダルを例外にすべき');
    // #704: コントロールはラッパーではなく「写真」の左端に乗る。所有権は
    // 幾何形状で判定される（コントロールはラッパーの上にマウントされる —
    // controlHost() の IMG 分岐 — ので、包含関係は何も語らない）: その左上は
    // 写真の左端から CONTROL_INSET（6px）内側でなければならない。下にずれる
    // のは、閉じるボタンが画像の左上の隅を占めている時だけ。
    const viewerCorner = await viewerPage.evaluate(() => {
      const control = document.querySelector('[data-hologram-overlay]');
      const img = document.querySelector('[data-testid="swipe-to-dismiss"] img');
      const wrapper = document.querySelector('[data-testid="swipe-to-dismiss"]');
      if (!(control instanceof HTMLElement) || !(img instanceof HTMLImageElement) || !(wrapper instanceof HTMLElement)) {
        throw new Error('ビューアのフィクスチャがコントロール・写真・スワイプラッパーのいずれかを失った');
      }
      const controlRect = control.getBoundingClientRect();
      const imgRect = img.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      return { controlLeft: controlRect.left, controlTop: controlRect.top, imgLeft: imgRect.left, imgTop: imgRect.top, imgWidth: imgRect.width, imgHeight: imgRect.height, wrapperLeft: wrapperRect.left, wrapperTop: wrapperRect.top, wrapperWidth: wrapperRect.width, wrapperHeight: wrapperRect.height };
    });
    if (viewerCorner.wrapperWidth - viewerCorner.imgWidth < 50 && viewerCorner.wrapperHeight - viewerCorner.imgHeight < 50) throw new Error('ビューアのフィクスチャが退行した: このケースが何かを検証するには、ラッパーは写真より有意に大きくなければならない（#704）');
    const viewerOffsetX = viewerCorner.controlLeft - viewerCorner.imgLeft;
    const viewerOffsetY = viewerCorner.controlTop - viewerCorner.imgTop;
    if (Math.abs(viewerOffsetX - 6) > 1.5 || Math.abs(viewerOffsetY - 54) > 1.5) throw new Error(`OVERLAY_VIEWER_CLOSE_CLEARANCE_FAIL: コントロールが写真の隅から ${viewerOffsetX}×${viewerOffsetY}px の位置にある（右へ6px・下へ54pxを期待）— ラッパーに追従しているか、X の閉じるボタンと交差しているかのどちらか（#704）`);
    await viewerPage.close();

    console.log('PASS e2e-overlay-visual: 失敗バナーのレイアウト、隅にツールチップが無いこと、スクロール追従、モーダル遮蔽、固定ヘッダー遮蔽、写真ビューアのホバー（#659）、写真の隅の配置（#704）');
  } finally {
    await overlay.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
