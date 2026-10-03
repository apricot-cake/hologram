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
  #text-post { margin-top: 24px !important; }
  #text-post [data-testid="Tweet-User-Avatar"] { display: block !important; width: 40px !important; height: 40px !important; background: #777 !important; }
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
  <article id="text-post" data-testid="tweet">
    <a href="/hologram/status/${POST_ID}7"><time datetime="2026-07-29T00:01:00.000Z">2026-07-29</time></a>
    <a id="profile-link" href="/hologram"><div data-testid="Tweet-User-Avatar"></div></a>
    <p>Text-only fixture post</p>
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
        hostPointerEvents: hostStyle.pointerEvents,
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
    if (measured.hostPointerEvents !== 'none') fail('ホストの hit testing が状態非依存でない');
    if (measured.shadowRootExposed || measured.faceExposed || measured.hostShadowRootExposed || measured.hostFaceExposed) fail('closed UI の状態がページへ公開された');
    if (measured.tag !== 'BUTTON' || measured.display !== 'flex' || measured.tabIndex !== 0 || !measured.label || measured.titled) fail('保存面の操作またはアクセシブルな名前が壊れた');
    if (Math.abs(measured.rect.width - 24) > 0.5 || Math.abs(measured.rect.height - 24) > 0.5) fail('保存ボタンが24pxではない');
    if (measured.radius !== '50%' || measured.border !== '1px') fail('保存ボタンの輪郭が壊れた');
    if (measured.background === 'rgba(0, 0, 0, 0)' || measured.background === 'rgb(255, 0, 255)') fail('保存ボタンの塗りが壊れた');
    if (!/\b2px\b/.test(measured.shadow) || measured.glyphs !== 1) fail('保存ボタンの影またはアイコンが壊れた');
    if (Math.abs(measured.rect.x - measured.boxRect.x - 6) > 1 || Math.abs(measured.rect.y - measured.boxRect.y - 6) > 1) fail('保存ボタンが画像の左上にない');

    // 投稿画像の内側でも、サイトの button が表示上の最前面ならページが所有する。
    const controlCenter = { x: measured.rect.x + measured.rect.width / 2, y: measured.rect.y + measured.rect.height / 2 };
    await page.evaluate(({ x, y }) => {
      const cover = document.createElement('button');
      cover.id = 'own-cover';
      for (const [name, value] of [
        ['position', 'fixed'],
        ['left', `${x - 15}px`],
        ['top', `${y - 15}px`],
        ['width', '30px'],
        ['height', '30px'],
        ['display', 'block'],
        ['z-index', '9999999'],
      ])
        cover.style.setProperty(name, value, 'important');
      cover.onclick = (event) => {
        event.preventDefault();
        (window as any).__coverClicks = ((window as any).__coverClicks || 0) + 1;
      };
      document.querySelector('[data-testid="tweetPhoto"]')?.appendChild(cover);
    }, controlCenter);
    await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, controlCenter)).toBe('own-cover');
    await page.mouse.click(controlCenter.x, controlCenter.y);
    await expect.poll(() => page.evaluate(() => (window as any).__coverClicks || 0)).toBe(1);
    if (!(await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'save')) fail('前面 button のクリックが保存面を作動させた');
    await page.evaluate(() => document.getElementById('own-cover')?.remove());

    // 可視面を消しても host/hit area は同じまま。その場所への実 mouse click は
    // 透明な拡張 UI に捨てられず、元の画像リンクを一度だけ activation する。
    await overlay.setStorage({ savedBadgeMode: 'always', hoverSaveButton: false });
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.filter((control: any) => control.face !== null).length).toBe(0);
    await page.evaluate(() => {
      (window as any).__mediaLinkEvents = [];
      const record = (event: MouseEvent) => {
        event.preventDefault();
        (window as any).__mediaLinkEvents.push({ type: event.type, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, button: event.button, isTrusted: event.isTrusted });
      };
      for (const type of ['click', 'auxclick', 'contextmenu']) document.getElementById('media-link')?.addEventListener(type, record as EventListener);
    });
    const empty = (await overlay.overlaySnapshot(page)).controls[0];
    const emptyX = empty.hostRect.x + empty.hostRect.width / 2;
    const emptyY = empty.hostRect.y + empty.hostRect.height / 2;
    await page.keyboard.down('Control');
    await page.mouse.click(emptyX, emptyY);
    await page.keyboard.up('Control');
    await page.keyboard.down('Shift');
    await page.mouse.click(emptyX, emptyY);
    await page.keyboard.up('Shift');
    await page.mouse.click(emptyX, emptyY, { button: 'middle' });
    await page.mouse.click(emptyX, emptyY, { button: 'right' });
    await expect.poll(() => page.evaluate(() => (window as any).__mediaLinkEvents.length)).toBeGreaterThanOrEqual(4);
    const nativeEvents = await page.evaluate(() => (window as any).__mediaLinkEvents);
    const ctrlClick = nativeEvents.find((event: any) => event.type === 'click' && event.ctrlKey);
    const shiftClick = nativeEvents.find((event: any) => event.type === 'click' && event.shiftKey);
    const middleClick = nativeEvents.find((event: any) => event.type === 'auxclick' && event.button === 1);
    const contextMenu = nativeEvents.find((event: any) => event.type === 'contextmenu' && event.button === 2);
    if (!ctrlClick || ctrlClick.button !== 0 || !shiftClick || shiftClick.button !== 0 || !middleClick || !contextMenu || nativeEvents.some((event: any) => !event.isTrusted)) fail(`空の面がページ本来の入力を変えた: ${JSON.stringify(nativeEvents)}`);
    const afterEmptyClick = await overlay.overlaySnapshot(page);
    if (afterEmptyClick.controls[0].hostRect.width !== empty.hostRect.width || afterEmptyClick.controls[0].face !== null) fail('空の面のクリックで host 契約が変わった');

    // text-only 面の hitBox は投稿全体だが、配置土台は profile link 内の
    // avatar。avatar 上の保存面は profile 遷移ではなく保存を実行する。
    await overlay.setStorage({ hoverSaveButton: true });
    const avatar = await page.locator('#text-post [data-testid="Tweet-User-Avatar"]').boundingBox();
    await page.evaluate(() => {
      (window as any).__profileClicks = 0;
      document.getElementById('profile-link')?.addEventListener('click', (event) => {
        event.preventDefault();
        (window as any).__profileClicks += 1;
      });
    });
    await page.mouse.move(avatar.x + avatar.width / 2, avatar.y + avatar.height / 2);
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.some((control: any) => control.unitId === 'text-post' && control.face === 'save')).toBe(true);
    const textSave = (await overlay.overlaySnapshot(page)).controls.find((control: any) => control.unitId === 'text-post' && control.face === 'save');
    await page.mouse.click(textSave.rect.x + textSave.rect.width / 2, textSave.rect.y + textSave.rect.height / 2);
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.some((control: any) => control.unitId === 'text-post' && control.face === 'failed')).toBe(true);
    if ((await page.evaluate(() => (window as any).__profileClicks)) !== 0) fail('text-only 保存面が profile link を作動させた');

    // pointer-events:none の host でも closed tree 内の本物の button は Tab で
    // 到達でき、Enter は既存の保存処理を作動させる。
    await page.mouse.move(media.x + media.width / 2, media.y + media.height / 2);
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'save')).toBe(true);
    const saveAgain = (await overlay.overlaySnapshot(page)).controls.find((control: any) => control.face === 'save' && control.unitId === 'post');
    const beforeBoundaryClick = await page.evaluate(() => (window as any).__mediaLinkEvents.length);
    await page.mouse.move(saveAgain.rect.x + saveAgain.rect.width + 20, saveAgain.rect.y + saveAgain.rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(saveAgain.rect.x + saveAgain.rect.width / 2, saveAgain.rect.y + saveAgain.rect.height / 2);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (window as any).__mediaLinkEvents.length)).toBeGreaterThan(beforeBoundaryClick);
    if (!(await overlay.overlaySnapshot(page)).controls.some((control: any) => control.unitId === 'post' && control.face === 'save')) fail('面の外で始まった press が保存を作動させた');
    const hoveredSave = (await overlay.overlaySnapshot(page)).controls.find((control: any) => control.unitId === 'post' && control.face === 'save');
    const rootCursor = await page.evaluate(() => getComputedStyle(document.documentElement).cursor);
    if (hoveredSave.transform === 'none' || hoveredSave.cursor !== 'pointer' || rootCursor !== 'pointer') fail('保存面の hover feedback または cursor が失われた');
    for (let i = 0; i < 8; i++) {
      if ((await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'save' && control.focused)) break;
      await page.keyboard.press('Tab');
    }
    if (!(await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'save' && control.focused)) fail('保存面へキーボードフォーカスできない');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'failed')).toBe(true);

    console.log(`PASS e2e-extension-hostile-css: 保存ボタン ${Math.round(measured.rect.width)}x${Math.round(measured.rect.height)}、closed UI`);
  } finally {
    await overlay.close();
  }
});
