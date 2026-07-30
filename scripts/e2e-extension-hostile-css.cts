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
// 3つ目に、ホストが inline のスタイルを禁じる CSP を返す場合も見る。#270 の実測どおり、
// 構築済みシート（adoptedStyleSheets）は CSP の検査対象ではないので、トークンは
// 解決されなければならない。x.com が実際に出しているのがこの種のポリシー。
//
// ⚠️敵対 CSS は**外部シートで配る**（`<style>` ではなく `<link>`）。`style-src 'none'` は
// ページ自身の `<style>` と `style=` 属性も等しく殺すので、`<style>` に敵対規則を書くと
// **その規則ごと効かなくなり、1と2が空振りのまま緑になる**（2026-07-30 実測。同じ理由で
// フィクスチャ側の寸法もインライン属性では書けない）。`style-src 'self'` なら同一オリジンの
// 外部シートだけが通る＝敵対 CSS は実際に当たり、inline を当てにできない状況は保たれる。
//
// 使い捨ての Chromium と使い捨ての拡張ステージング＝ユーザーのプロファイルにも
// 実ライブラリにも触らない（e2e-overlay-visual と同じ台）。

const { launchOverlayBrowser, wait } = require('./lib-overlay-e2e.cts');

const POST_ID = '1999999999999999996';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;
const CSS_URL = 'https://x.com/hostile.css';

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
  /* 写真の角のコントロール（#310）。固定レイヤーではなく投稿の部分木に居るので、
     ページの CSS からは名指しできる位置にある＝ここを潰しにいく。 */
  hologram-corner-control { display: none !important; position: static !important; width: auto !important; height: auto !important; }
  article, .media { display: block !important; }
`;

const PAGE_CSS = `
  article { width: 640px; min-height: 360px; margin: 80px auto; padding: 32px; }
  .media { margin-top: 24px; background: #888; }
  ${HOSTILE}
  /* 全消しの後にページが自分の写真枠を寸法づけ直す（特異度で上の * に勝つ）。
     実サイトでも普通の形であり、これが無いと枠が 0 高さになって「小さすぎる枠」として
     角のコントロールが最初から出ない＝下の検査が空振りする。 */
  #capture-target .media { display: block !important; width: 480px !important; height: 220px !important; }
`;

const POST_HTML = `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>Hologram hostile-CSS fixture</title>
<link rel="stylesheet" href="${CSS_URL}">
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
          // style-src 'self' — no 'unsafe-inline', so an injected <style> is
          // dead even inside a shadow root (#270's measurement), while the
          // page's OWN hostile sheet still loads because it is same-origin and
          // external. adoptedStyleSheets and CSSOM are not CSP sinks, and those
          // are what the extension uses.
          headers: { 'content-security-policy': "style-src 'self'" },
          body: POST_HTML,
        });
      } else if (route.request().url() === CSS_URL) {
        await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: PAGE_CSS });
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

    // === 写真の角のコントロール（#310）=====================================
    // ドロップゾーンと違って固定レイヤーには居ない＝投稿の部分木に残したまま、各自の
    // 小さな ShadowRoot で隔離している。だから見るものが2つある: ①ホスト要素の箱が
    // ページの `!important` に勝って残っているか（ここだけはページから名指しできる）
    // ②円そのものがページの `button { all: unset !important }` に触られていないか。
    const media = await page.locator('.media').boundingBox();
    await page.mouse.move(media.x + media.width / 2, media.y + media.height / 2);
    await page.waitForSelector('[data-hologram-overlay][data-hologram-face="save"]', { timeout: 5000 });
    const corner = await page.evaluate(() => {
      const el = document.querySelector('[data-hologram-overlay]') as HTMLElement;
      const disc = el?.shadowRoot?.firstElementChild as HTMLElement | undefined;
      const box = document.querySelector('.media') as HTMLElement;
      if (!el || !disc) return null;
      const hostStyle = getComputedStyle(el);
      const discStyle = getComputedStyle(disc);
      const r = disc.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      return {
        hostDisplay: hostStyle.display,
        hostPosition: hostStyle.position,
        tag: disc.tagName,
        display: discStyle.display,
        width: r.width,
        height: r.height,
        radius: discStyle.borderRadius,
        background: discStyle.backgroundColor,
        borderTopWidth: discStyle.borderTopWidth,
        boxShadow: discStyle.boxShadow,
        glyphs: disc.querySelectorAll('svg').length,
        label: disc.getAttribute('aria-label'),
        titled: el.hasAttribute('title') || disc.hasAttribute('title'),
        // 角に居ること＝借りた containing block（ページ要素の position: relative）が
        // ページの `position: static !important` に負けていないことの、唯一の観測点。
        offsetLeft: r.left - boxRect.left,
        offsetTop: r.top - boxRect.top,
      };
    });
    const cornerFail = (why: string) => {
      throw new Error(`HOSTILE_CSS_CORNER_FAIL: ${why} — ${JSON.stringify(corner)}`);
    };
    if (!corner) cornerFail('the corner control has no shadow root of its own');
    if (corner.hostDisplay !== 'block') cornerFail(`the host element is display:${corner.hostDisplay}, wanted block`);
    if (corner.hostPosition !== 'absolute') cornerFail(`the host element is position:${corner.hostPosition}, wanted absolute`);
    if (corner.tag !== 'BUTTON') cornerFail(`the save face is a <${corner.tag}>, wanted BUTTON`);
    if (corner.display !== 'flex') cornerFail(`the disc is display:${corner.display}, wanted flex`);
    if (Math.abs(corner.width - 24) > 0.5 || Math.abs(corner.height - 24) > 0.5) cornerFail(`the disc is ${corner.width}x${corner.height}, wanted 24x24`);
    if (corner.radius !== '50%') cornerFail(`the disc radius is ${corner.radius}, wanted 50%`);
    if (corner.background === 'rgba(0, 0, 0, 0)' || corner.background === 'rgb(255, 0, 255)') cornerFail(`the disc fill is ${corner.background}`);
    if (corner.borderTopWidth !== '1px') cornerFail(`the disc outline is ${corner.borderTopWidth}, wanted 1px`);
    // 影は 24px 専用トークン（#310）＝カード用の 36px ぼかしを共有していない。
    if (!/\b2px\b/.test(corner.boxShadow) || /3[0-9]px/.test(corner.boxShadow)) cornerFail(`the disc shadow is "${corner.boxShadow}", wanted the compact control shadow`);
    if (corner.glyphs !== 1) cornerFail(`the disc holds ${corner.glyphs} glyphs, wanted 1`);
    if (!corner.label) cornerFail('the pressable face has no accessible name');
    if (corner.titled) cornerFail('the corner still carries a browser tooltip');
    if (Math.abs(corner.offsetLeft - 6) > 1 || Math.abs(corner.offsetTop - 6) > 1) cornerFail(`the disc sits ${corner.offsetLeft},${corner.offsetTop} from the picture's corner, wanted 6,6`);

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

    // 前提の自己検査＝敵対 CSS が実際に当たっていること。`.surface { background: #ff00ff }`
    // はページ自身の規則なので、これがマゼンタでなければシートが読まれていない＝以降の
    // 判定は全部空振りで緑になる。#44 の初版はまさにその状態だった（`<style>` を
    // `style-src 'none'` が殺していた・2026-07-30 に #310 で発見）。
    if (m.impostorBackground !== 'rgb(255, 0, 255)') fail(`the hostile sheet did not apply (the page's own .surface is ${m.impostorBackground}, wanted magenta) — every check below would pass vacuously`);
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

    console.log(`PASS e2e-extension-hostile-css: zone ${Math.round(m.width)}x${Math.round(m.height)} anchored at ${Math.round(m.right)},${Math.round(m.bottom)}, fill ${m.background}, outline ${m.borderTopWidth}, --hologram-surface ${m.surfaceToken} resolved under style-src 'self'`);
    console.log(`  corner control: ${Math.round(corner.width)}x${Math.round(corner.height)} <${corner.tag}> in its own shadow root, fill ${corner.background}, shadow ${corner.boxShadow}, no tooltip, name "${corner.label}"`);
  } finally {
    await overlay.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
