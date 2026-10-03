import { test, expect } from '@playwright/test';

// ホストページが拡張機能の要素を !important で狙い、インラインスタイルを CSP で
// 禁じても、投稿上の保存ボタンが表示されることを実ブラウザで確かめる。使い捨ての
// Chromium と使い捨ての拡張機能ステージングだけを使い、実ライブラリには触れない。

const { launchOverlayBrowser } = require('../lib/overlay-browser.cts');

const POST_ID = '1999999999999999996';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;
const CSS_URL = 'https://x.com/hostile.css';
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const PAGE_CSS = `
  *, *::before, *::after { all: unset !important; }
  div, button, svg, span { all: unset !important; display: inline !important; }
  .surface, .badge, .label, .spinner {
    all: unset !important;
    display: none !important;
    position: static !important;
    background: #ff00ff !important;
  }
  hologram-extension-ui, [data-hologram-overlay] {
    display: none !important;
    position: static !important;
    opacity: 0 !important;
  }
  article, .media { display: block !important; }
  article { width: 640px !important; min-height: 360px !important; margin: 80px auto !important; padding: 32px !important; }
  #post .media img { display: block !important; width: 480px !important; height: 220px !important; }
  #post .media { width: 480px !important; height: 220px !important; margin-top: 24px !important; background: #888 !important; }
`;

const POST_HTML = `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>Hologram hostile-CSS fixture</title><link rel="stylesheet" href="${CSS_URL}"></head>
<body>
  <article id="post" data-testid="tweet">
    <a href="/hologram/status/${POST_ID}"><time datetime="2026-07-29T00:00:00.000Z">2026-07-29</time></a>
    <p>Hostile CSS fixture post</p>
    <a id="media-link" href="/hologram/status/${POST_ID}/photo/1"><div class="media" data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/HOSTILE.jpg" alt="fixture"></div></a>
    <div id="host-impostor" class="surface"><span class="badge">x</span></div>
  </article>
</body>
</html>`;

test('extension-hostile-css', async () => {
  const overlay = await launchOverlayBrowser({ locale: 'ja-JP' });
  try {
    const page = await overlay.browser.newPage();
    await page.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url === POST_URL) {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': "style-src 'self'" }, body: POST_HTML });
      } else if (url === CSS_URL) {
        await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: PAGE_CSS });
      } else if (route.request().resourceType() === 'image') {
        await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
      } else {
        await route.abort();
      }
    });
    await page.goto(POST_URL, { waitUntil: 'domcontentloaded' });
    const media = await page.locator('.media').boundingBox();
    await expect
      .poll(async () => {
        await page.mouse.move(0, 0);
        await page.mouse.move(media.x + media.width / 2, media.y + media.height / 2);
        const snapshot = await overlay.overlaySnapshot(page);
        return snapshot.controls.filter((control: any) => control.face === 'save').length;
      })
      .toBe(1);

    const pageMeasured = await page.evaluate(() => {
      const host = document.querySelector('[data-hologram-overlay]') as HTMLElement | null;
      const box = document.querySelector('.media') as HTMLElement;
      const impostor = document.getElementById('host-impostor') as HTMLElement;
      if (!host) return null;
      const hostStyle = getComputedStyle(host);
      const boxRect = box.getBoundingClientRect();
      return {
        hostDisplay: hostStyle.display,
        hostPosition: hostStyle.position,
        shadowRootExposed: host.shadowRoot !== null,
        faceExposed: host.hasAttribute('data-hologram-face'),
        boxRect: { x: boxRect.x, y: boxRect.y },
        impostorBackground: getComputedStyle(impostor).backgroundColor,
      };
    });
    const snapshot = await overlay.overlaySnapshot(page);
    const button = snapshot.controls.find((control: any) => control.face === 'save');
    const measured = pageMeasured && button ? { ...pageMeasured, ...button } : null;

    const fail = (why: string) => {
      throw new Error(`HOSTILE_CSS_FAIL: ${why} — ${JSON.stringify(measured)}`);
    };
    if (!measured) fail('保存ボタンを拡張機能のテスト境界から取得できない');
    if (measured.impostorBackground !== 'rgb(255, 0, 255)') fail('敵対的シートが適用されていない');
    if (measured.hostDisplay !== 'block' || measured.hostPosition !== 'absolute') fail('ホスト要素の配置が壊れた');
    if (measured.shadowRootExposed || measured.faceExposed || measured.hostShadowRootExposed || measured.hostFaceExposed) fail('closed UI の状態がページへ公開された');
    if (measured.tag !== 'BUTTON' || measured.display !== 'flex' || measured.tabIndex !== 0 || !measured.label || measured.titled) fail('保存面の操作またはアクセシブルな名前が壊れた');
    if (Math.abs(measured.rect.width - 24) > 0.5 || Math.abs(measured.rect.height - 24) > 0.5) fail('保存ボタンが24pxではない');
    if (measured.radius !== '50%' || measured.border !== '1px') fail('保存ボタンの輪郭が壊れた');
    if (measured.background === 'rgba(0, 0, 0, 0)' || measured.background === 'rgb(255, 0, 255)') fail('保存ボタンの塗りが壊れた');
    if (!/\b2px\b/.test(measured.shadow) || measured.glyphs !== 1) fail('保存ボタンの影またはアイコンが壊れた');
    if (Math.abs(measured.rect.x - measured.boxRect.x - 6) > 1 || Math.abs(measured.rect.y - measured.boxRect.y - 6) > 1) fail('保存ボタンが画像の左上にない');

    // 可視面を消しても host/hit area は同じまま。その場所への実 mouse click は
    // 透明な拡張 UI に捨てられず、元の画像リンクを一度だけ activation する。
    await overlay.setStorage({ savedBadgeMode: 'always', hoverSaveButton: false });
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.filter((control: any) => control.face !== null).length).toBe(0);
    await page.evaluate(() => {
      (window as any).__mediaLinkClicks = 0;
      document.getElementById('media-link')?.addEventListener('click', (event) => {
        event.preventDefault();
        (window as any).__mediaLinkClicks += 1;
      });
    });
    const empty = (await overlay.overlaySnapshot(page)).controls[0];
    await page.mouse.click(empty.hostRect.x + empty.hostRect.width / 2, empty.hostRect.y + empty.hostRect.height / 2);
    await expect.poll(() => page.evaluate(() => (window as any).__mediaLinkClicks)).toBe(1);
    const afterEmptyClick = await overlay.overlaySnapshot(page);
    if (afterEmptyClick.controls[0].hostRect.width !== empty.hostRect.width || afterEmptyClick.controls[0].face !== null) fail('空の面のクリックで host 契約が変わった');

    console.log(`PASS e2e-extension-hostile-css: 保存ボタン ${Math.round(measured.rect.width)}x${Math.round(measured.rect.height)}、closed UI`);
  } finally {
    await overlay.close();
  }
});
