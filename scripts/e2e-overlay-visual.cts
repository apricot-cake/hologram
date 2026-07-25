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
  const overlay = await launchOverlayBrowser();
  try {
    const page = await openFixture(overlay, 'https://x.com/home', HTML);
    await page.waitForSelector('[data-testid="tweetPhoto"]');

    const photo = await page.$('[data-testid="tweetPhoto"]');
    const photoBox = await photo.boundingBox();
    if (!photoBox) throw new Error('test photo has no browser layout box');
    await page.mouse.move(photoBox.x + photoBox.width / 2, photoBox.y + photoBox.height / 2);
    await page.waitForSelector('[data-hologram-overlay]', { timeout: 3000 });

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
    await page.evaluate(() => window.scrollTo(0, 190));
    await wait(25);
    const headerClear = await page.evaluate(() => !document.querySelector('[data-hologram-overlay]'));
    if (!headerClear) throw new Error('OVERLAY_HEADER_OCCLUSION_FAIL: control remained beneath the fixed header');

    console.log('PASS e2e-overlay-visual: scroll tracking, modal occlusion, fixed-header occlusion');
  } finally {
    await overlay.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
