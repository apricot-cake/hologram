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
  hologram-extension-ui, hologram-corner-control {
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
    <div class="media" data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/HOSTILE.jpg" alt="fixture"></div>
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
        return page.locator('[data-hologram-overlay][data-hologram-face="save"]').count();
      })
      .toBe(1);

    const measured = await page.evaluate(() => {
      const host = document.querySelector('[data-hologram-overlay]') as HTMLElement | null;
      const button = host?.shadowRoot?.firstElementChild as HTMLElement | null;
      const box = document.querySelector('.media') as HTMLElement;
      const impostor = document.getElementById('host-impostor') as HTMLElement;
      if (!host || !button) return null;
      const hostStyle = getComputedStyle(host);
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      return {
        hostDisplay: hostStyle.display,
        hostPosition: hostStyle.position,
        tag: button.tagName,
        display: style.display,
        width: rect.width,
        height: rect.height,
        radius: style.borderRadius,
        background: style.backgroundColor,
        border: style.borderTopWidth,
        shadow: style.boxShadow,
        glyphs: button.querySelectorAll('svg').length,
        label: button.getAttribute('aria-label'),
        titled: host.hasAttribute('title') || button.hasAttribute('title'),
        offsetLeft: rect.left - boxRect.left,
        offsetTop: rect.top - boxRect.top,
        impostorBackground: getComputedStyle(impostor).backgroundColor,
      };
    });

    const fail = (why: string) => {
      throw new Error(`HOSTILE_CSS_FAIL: ${why} — ${JSON.stringify(measured)}`);
    };
    if (!measured) fail('保存ボタンに ShadowRoot が無い');
    if (measured.impostorBackground !== 'rgb(255, 0, 255)') fail('敵対的シートが適用されていない');
    if (measured.hostDisplay !== 'block' || measured.hostPosition !== 'absolute') fail('ホスト要素の配置が壊れた');
    if (measured.tag !== 'BUTTON' || measured.display !== 'flex') fail('保存面が button として表示されていない');
    if (Math.abs(measured.width - 24) > 0.5 || Math.abs(measured.height - 24) > 0.5) fail('保存ボタンが24pxではない');
    if (measured.radius !== '50%' || measured.border !== '1px') fail('保存ボタンの輪郭が壊れた');
    if (measured.background === 'rgba(0, 0, 0, 0)' || measured.background === 'rgb(255, 0, 255)') fail('保存ボタンの塗りが壊れた');
    if (!/\b2px\b/.test(measured.shadow) || measured.glyphs !== 1) fail('保存ボタンの影またはアイコンが壊れた');
    if (!measured.label || measured.titled) fail('保存ボタンのアクセシブルな名前が壊れた');
    if (Math.abs(measured.offsetLeft - 6) > 1 || Math.abs(measured.offsetTop - 6) > 1) fail('保存ボタンが画像の左上にない');

    console.log(`PASS e2e-extension-hostile-css: 保存ボタン ${Math.round(measured.width)}x${Math.round(measured.height)}、左上 ${Math.round(measured.offsetLeft)},${Math.round(measured.offsetTop)}`);
  } finally {
    await overlay.close();
  }
});
