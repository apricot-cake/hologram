'use strict';

// #44 の完了条件2つを、実ブラウザで数値にする。
//
//   1. ホスト CSS の影響を受けない — ページ側が `* { all: unset !important }` 相当の
//      敵対的な規則を置いても、拡張の UI は設計どおりの見た目のまま
//   2. 拡張 CSS がホストへ漏れない — ページ自身の要素が拡張のクラス名を持っていても、
//      拡張のスタイルは当たらない
//
// これは ShadowRoot（extension/utils/ui-root.ts）が在る理由そのもので、境界が
// 外れても普通のテストは全部緑のまま通る＝ここで押さえないと静かに壊れる。
//
// 3つ目に、ホストが `style-src 'none'` を返す場合も見る。#270 の実測どおり、
// 構築済みシート（adoptedStyleSheets）は CSP の検査対象ではないので、トークンは
// 解決されなければならない。x.com が実際に出しているのがこの種のポリシー。
//
// 使い捨ての Chromium と使い捨ての拡張ステージング＝ユーザーのプロファイルにも
// 実ライブラリにも触らない（e2e-overlay-visual と同じ台）。

const { launchOverlayBrowser, wait } = require('./lib-overlay-e2e.cts');

const POST_ID = '1999999999999999996';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;

// ページ側の敵対的な CSS。拡張が使う要素・クラス名を名指しで潰しにいく。
const HOSTILE = `
  *, *::before, *::after { all: unset !important; }
  div, button, svg, span, input, label { all: unset !important; display: inline !important; }
  .surface, .badge, .label, .ring, .choice, .highlight, .spinner {
    all: unset !important;
    display: none !important;
    position: static !important;
    background: #ff00ff !important;
    border: 0 !important;
  }
  hologram-extension-ui { display: none !important; position: static !important; opacity: 0 !important; }
  article, .media { display: block !important; }
`;

const POST_HTML = `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>Hologram hostile-CSS fixture</title>
<style>
  article { width: 640px; min-height: 360px; margin: 80px auto; padding: 32px; }
  .media { height: 220px; margin-top: 24px; background: #888; }
  ${HOSTILE}
</style>
</head>
<body>
  <article id="capture-target" data-testid="tweet">
    <a href="/hologram/status/${POST_ID}"><time datetime="2026-07-29T00:00:00.000Z">2026-07-29</time></a>
    <p>Hostile CSS fixture post</p>
    <div class="media" data-testid="tweetPhoto" aria-label="fixture image"><img id="pic" src="https://pbs.twimg.com/media/HOSTILE.jpg" alt="fixture"></div>
    <!-- The page claiming the extension's own class names. Nothing the extension
         ships may reach these: its stylesheet lives inside the shadow root. -->
    <div id="host-impostor" class="surface"><span class="badge">x</span><span class="label">y</span></div>
  </article>
</body>
</html>`;

declare const chrome: any;

// 1x1 の透明 PNG。中身は問われない＝「壊れていない画像」であることだけが要る。
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// 数値で押さえるもの。敵対的な CSS が効いてしまうと、どれか必ず外れる。
interface Measured {
  found: boolean;
  display: string;
  position: string;
  right: number;
  bottom: number;
  width: number;
  height: number;
  background: string;
  borderTopWidth: string;
  fontWeight: string;
  badgeRadius: string;
  badgeWidth: number;
  // The host's own element wearing our class names, measured for OUR
  // properties: what the page's cascade settles on is the page's business.
  impostorPosition: string;
  impostorWidth: number;
  impostorBackground: string;
  // A token resolved inside the root — the CSP half of the test.
  surfaceToken: string;
}

(async () => {
  const overlay = await launchOverlayBrowser({ locale: 'ja-JP' });
  try {
    const page = await overlay.browser.newPage();
    await page.route('**/*', async (route: any) => {
      if (route.request().url() === POST_URL) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          // style-src 'none' — the policy that kills an injected <style> even
          // inside a shadow root (#270's measurement). adoptedStyleSheets and
          // CSSOM are not CSP sinks, and those are what the extension uses.
          headers: { 'content-security-policy': "style-src 'none'" },
          body: POST_HTML,
        });
      } else if (route.request().resourceType() === 'image') {
        // A REAL picture, because the drag below has to be a real one: Chromium
        // starts no drag from a broken image, so an aborted request would leave
        // the zone with nothing to appear for. The URL keeps its x.com shape —
        // that is what the extension reads the post's identity from.
        await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
      } else await route.abort();
    });
    await page.goto(POST_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#capture-target').waitFor();

    // The DROP ZONE, not the Alt+S banner: activating capture needs activeTab,
    // which only an extension-level gesture (toolbar or command) can grant, and
    // Playwright can press neither. The resident content script is already on
    // this origin by manifest, and dragging a post's picture is a page-level
    // gesture — same shared surface, same shared root, no permission needed.
    //
    // A REAL drag, not `page.dispatchEvent('dragstart')`: since #323 the zone
    // only appears for a trusted event, and a dispatched one is by definition
    // the page's. Pressing and moving the mouse goes through the DevTools
    // protocol's input domain, which is the user's side of that line. The
    // release below is far from the zone, so nothing is saved — this test is
    // about how the zone LOOKS.
    const picture = await page.locator('#pic').boundingBox();
    await page.mouse.move(picture.x + picture.width / 2, picture.y + picture.height / 2);
    await page.mouse.down();
    await page.mouse.move(picture.x + picture.width / 2 + 80, picture.y + picture.height / 2 + 40, { steps: 8 });
    await wait(600); // the zone's entrance

    const m: Measured = await page.evaluate(() => {
      const root = document.querySelector('hologram-extension-ui')?.shadowRoot;
      const banner = root?.querySelector('#__hologramDropZone') as HTMLElement | null;
      const badge = banner?.querySelector('.badge') as HTMLElement | null;
      const impostor = document.getElementById('host-impostor') as HTMLElement;
      const impostorStyle = getComputedStyle(impostor);
      if (!banner || !badge) {
        return {
          found: false,
          display: '',
          position: '',
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          background: '',
          borderTopWidth: '',
          fontWeight: '',
          badgeRadius: '',
          badgeWidth: 0,
          impostorPosition: impostorStyle.position,
          impostorWidth: impostor.getBoundingClientRect().width,
          impostorBackground: impostorStyle.backgroundColor,
          surfaceToken: '',
        };
      }
      const s = getComputedStyle(banner);
      const r = banner.getBoundingClientRect();
      const bs = getComputedStyle(badge);
      return {
        found: true,
        display: s.display,
        position: s.position,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        background: s.backgroundColor,
        borderTopWidth: s.borderTopWidth,
        fontWeight: s.fontWeight,
        badgeRadius: bs.borderRadius,
        badgeWidth: badge.getBoundingClientRect().width,
        impostorPosition: impostorStyle.position,
        impostorWidth: impostor.getBoundingClientRect().width,
        impostorBackground: impostorStyle.backgroundColor,
        surfaceToken: s.getPropertyValue('--hologram-surface').trim(),
      };
    });

    await page.mouse.up(); // let the drag go, away from the zone — nothing is saved

    const fail = (why: string) => {
      throw new Error(`HOSTILE_CSS_FAIL: ${why} — ${JSON.stringify(m)}`);
    };

    if (!m.found) fail('the drop zone is not in the shared root at all');
    // 1. The host's `display:none !important` on our tag and our classes must not
    //    reach anything: the host element's own box is inline !important from us,
    //    and the surface inside is out of the page's reach entirely.
    if (m.display !== 'flex') fail(`the zone is display:${m.display}, wanted flex`);
    if (m.position !== 'fixed') fail(`the banner is position:${m.position}, wanted fixed`);
    // Bottom-right, at the width components.css gives it. A host rule that got
    // through would collapse this to an inline box in the document flow.
    if (Math.abs(m.width - 248) > 1) fail(`the zone is ${m.width}px wide, wanted 248`);
    if (m.height < 90) fail(`the zone collapsed to ${m.height}px tall`);
    if (Math.abs(m.right - (1280 - 24)) > 1) fail(`the zone's right edge is at ${m.right}, wanted ${1280 - 24}`);
    if (Math.abs(m.bottom - (960 - 24)) > 1) fail(`the zone's bottom edge is at ${m.bottom}, wanted ${960 - 24}`);
    // 2. The look survives: fill, outline, weight and the badge's circle.
    if (m.background === 'rgba(0, 0, 0, 0)' || m.background === 'rgb(255, 0, 255)') fail(`the zone fill is ${m.background}`);
    if (m.borderTopWidth !== '1px') fail(`the outline is ${m.borderTopWidth}, wanted 1px`);
    if (m.fontWeight !== '600') fail(`the label weight is ${m.fontWeight}, wanted 600`);
    if (m.badgeRadius !== '50%') fail(`the badge radius is ${m.badgeRadius}, wanted 50%`);
    if (m.badgeWidth < 20) fail(`the badge collapsed to ${m.badgeWidth}px`);
    // 3. Tokens resolve even though the page forbids stylesheets outright.
    if (!/^#|^rgb/.test(m.surfaceToken)) fail(`--hologram-surface did not resolve: "${m.surfaceToken}"`);
    // 4. Nothing leaks the other way. Asserted as the ABSENCE of our own
    //    properties rather than the presence of the page's: what the page's own
    //    cascade settles on is the page's business, but `position: fixed`, our
    //    248px measure and our surface fill could only have come from us.
    if (m.impostorPosition === 'fixed') fail("the host's own .surface was given our position");
    if (Math.abs(m.impostorWidth - m.width) < 1) fail(`the host's own .surface was given our width (${m.impostorWidth}px)`);
    if (m.impostorBackground === m.background) fail(`the host's own .surface was given our fill (${m.impostorBackground})`);

    console.log(`PASS e2e-extension-hostile-css: zone ${Math.round(m.width)}x${Math.round(m.height)} anchored at ${Math.round(m.right)},${Math.round(m.bottom)}, fill ${m.background}, outline ${m.borderTopWidth}, --hologram-surface ${m.surfaceToken} resolved under style-src 'none'`);
  } finally {
    await overlay.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
