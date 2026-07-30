'use strict';

// Browser-level regression test for the timeline hover control. jsdom can test
// DOM decisions, but it cannot exercise Chrome's scroll compositor, stacking
// order, or content-script isolation. This test loads the built extension into
// a disposable Chrome profile and serves an X-shaped page at x.com itself.
//
//   node scripts/e2e-overlay-visual.cts

const { launchOverlayBrowser, openFixture, wait } = require('./lib-overlay-e2e.cts');

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
    if (!photoBox) throw new Error('test photo has no browser layout box');
    await page.mouse.move(photoBox.x + photoBox.width / 2, photoBox.y + photoBox.height / 2);
    await page.waitForSelector('[data-hologram-overlay]', { timeout: 3000 });

    // The staged extension points at a host name nobody registered
    // (lib-overlay-e2e.cts), so pressing the hover control exercises the real
    // background failure path: the retry chip stays on the image, and the readable
    // alert appears at the same top-center position as the Alt+S banner (#357).
    await page.click('[data-hologram-overlay]');
    // #44: the failure banner is in the shared ShadowRoot; Playwright's CSS
    // selectors pierce open shadow roots, page.evaluate's querySelector does not.
    await page.waitForSelector('[data-hologram-save-banner]', { timeout: 5000 });
    await wait(100); // chrome.storage.local logging is best-effort and asynchronous
    const diagnosticEntries = await overlay.browser.serviceWorkers()[0].evaluate(async () => {
      const all = await (globalThis as any).chrome.storage.local.get(null);
      return Object.entries(all)
        .filter(([key]) => key.startsWith('diaglog_'))
        .map(([, value]) => value);
    });
    const failureUi = await page.evaluate(() => {
      const banner = document.querySelector('hologram-extension-ui')?.shadowRoot?.querySelector('[data-hologram-save-banner]');
      // The corner's own element is the shadow HOST since #310; the disc that
      // carries the face is inside its root, and page.evaluate's querySelector
      // does not pierce shadow roots, so it is reached explicitly.
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
        // #310: no browser tooltip anywhere on this control — not on the host,
        // not on the disc. What the failure MEANS is the banner's job now.
        retryTitled: retry.hasAttribute('title') || disc.hasAttribute('title'),
      };
    });
    if (!failureUi || failureUi.role !== 'alert' || !failureUi.text || failureUi.width < 200 || Math.abs(failureUi.top - 12) > 0.5 || Math.abs(failureUi.centerX - 640) > 0.5 || failureUi.retryFace !== 'failed') {
      throw new Error(`OVERLAY_FAILURE_BANNER_LAYOUT_FAIL: ${JSON.stringify(failureUi)}`);
    }
    if (failureUi.retryTitled) throw new Error(`OVERLAY_RETRY_TOOLTIP_FAIL: the corner still carries a browser tooltip — ${JSON.stringify(failureUi)}`);
    // bannerHostMissing (extension/utils/i18n.ts) — the message for an absent host,
    // which is the failure this fixture provokes on any machine. The corner says
    // cornerRetry instead: the long recovery sentence belongs to the surface that
    // has room for it (#310).
    if (failureUi.text !== 'Hologram の保存先に接続できません。Chrome を再起動してください' || failureUi.retryLabel !== '保存に失敗しました。押すと再試行します') {
      throw new Error(`OVERLAY_FAILURE_BANNER_LOCALE_FAIL: ${JSON.stringify({ failureUi, diagnosticEntries })}`);
    }
    const rawFailure = diagnosticEntries.find((entry) => entry?.phase === 'fail' && typeof entry?.error === 'string');
    if (!rawFailure) {
      throw new Error(`OVERLAY_FAILURE_DIAGNOSTIC_FAIL: ${JSON.stringify(diagnosticEntries)}`);
    }
    if (process.env.HOLOGRAM_OVERLAY_SCREENSHOT) {
      await page.screenshot({ path: process.env.HOLOGRAM_OVERLAY_SCREENSHOT });
    }
    await wait(3000); // banner + retry dwell end before the scroll checks
    const failureCleared = await page.evaluate(() => !document.querySelector('hologram-extension-ui')?.shadowRoot?.querySelector('[data-hologram-save-banner]'));
    if (!failureCleared) throw new Error('OVERLAY_FAILURE_BANNER_DISMISS_FAIL: failure banner did not leave');

    const before = await page.evaluate(() => {
      const button = document.querySelector('[data-hologram-overlay]');
      const media = document.querySelector('[data-testid="tweetPhoto"]');
      if (!button || !media) return null;
      const buttonRect = button.getBoundingClientRect();
      const mediaRect = media.getBoundingClientRect();
      return { deltaTop: buttonRect.top - mediaRect.top };
    });
    if (!before) throw new Error('test control disappeared before the scroll check');
    await page.evaluate(() => window.scrollTo(0, 80));
    await wait(25); // before hover cleanup; the control must use the same scroll transform
    const scroll = await page.evaluate((previous) => {
      const button = document.querySelector('[data-hologram-overlay]')?.getBoundingClientRect();
      const media = document.querySelector('[data-testid="tweetPhoto"]')?.getBoundingClientRect();
      return button && media ? Math.abs(button.top - media.top - previous.deltaTop) < 0.5 : false;
    }, before);
    if (!scroll) throw new Error('OVERLAY_SCROLL_TRACKING_FAIL: control does not share the media scroll position');

    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(150);
    const photoBeforeModal = await photo.boundingBox();
    if (!photoBeforeModal) throw new Error('test photo disappeared before modal check');
    await page.mouse.move(photoBeforeModal.x + photoBeforeModal.width / 2, photoBeforeModal.y + photoBeforeModal.height / 2);
    await page.waitForSelector('[data-hologram-overlay]', { timeout: 3000 });

    // Opening a modal without moving the pointer recreates the real failure:
    // the old background control must not remain above the dialog.
    await page.evaluate(() => ((document.querySelector('#composeDialog') as HTMLElement).hidden = false));
    await wait(250);
    const modalClear = await page.evaluate(() => !document.querySelector('[data-hologram-overlay]'));
    if (!modalClear) throw new Error('OVERLAY_MODAL_OCCLUSION_FAIL: background control remained while a modal was open');

    await page.evaluate(() => {
      (document.querySelector('#composeDialog') as HTMLElement).hidden = true;
    });
    const photoBeforeHeader = await photo.boundingBox();
    if (!photoBeforeHeader) throw new Error('test photo disappeared before header check');
    await page.mouse.move(photoBeforeHeader.x + photoBeforeHeader.width / 2, photoBeforeHeader.y + photoBeforeHeader.height / 2);
    await page.waitForSelector('[data-hologram-overlay]', { timeout: 3000 });
    // The picture's top — the corner the control sits in — scrolls under the
    // fixed header while the pointer stays on the middle of it. The pointer is
    // still on the picture, so the hover is still on: occlusion is asked about
    // the POINTER, and asking it about the control's corner instead is what
    // took the button away mid-scroll on x.com (#347).
    await page.evaluate(() => window.scrollTo(0, 190));
    await wait(250);
    const headerHold = await page.evaluate(() => !!document.querySelector('[data-hologram-overlay]'));
    if (!headerHold) throw new Error('OVERLAY_HEADER_HOVER_LOST_FAIL: control vanished while the pointer was still on the picture');

    // Same picture, same scroll position: the pointer itself moves onto the
    // header covering the picture's top. Now something IS between the pointer
    // and the picture, and the hover ends.
    const photoUnderHeader = await photo.boundingBox();
    if (!photoUnderHeader) throw new Error('test photo disappeared during the header check');
    await page.mouse.move(photoUnderHeader.x + photoUnderHeader.width / 2, 40);
    await wait(250);
    const headerClear = await page.evaluate(() => !document.querySelector('[data-hologram-overlay]'));
    if (!headerClear) throw new Error('OVERLAY_HEADER_OCCLUSION_FAIL: control remained while the pointer was on the fixed header');

    console.log('PASS e2e-overlay-visual: failure banner layout, corner has no tooltip, scroll tracking, modal occlusion, fixed-header occlusion');
  } finally {
    await overlay.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
