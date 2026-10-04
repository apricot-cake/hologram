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

    // pointer-events:none の closed tree には pointerenter/leave が届かない。
    // 座標委譲で glow/scale が戻り、ページ側へ状態を写さないことを見る。実際の
    // hit target はページのリンクなので、内部 button の cursor 値は表示カーソル
    // 復元の証拠として扱わない。
    const controlCenter = { x: measured.rect.x + measured.rect.width / 2, y: measured.rect.y + measured.rect.height / 2 };
    const publicStyleBeforeHover = await page.evaluate(() => document.querySelector('[data-hologram-overlay]')?.getAttribute('style'));
    await page.mouse.move(controlCenter.x, controlCenter.y);
    await expect
      .poll(async () => {
        const hovered = (await overlay.overlaySnapshot(page)).controls.find((control: any) => control.face === 'save');
        return hovered ? { transform: hovered.transform, glowed: hovered.shadow !== measured.shadow } : null;
      })
      .toEqual({ transform: 'matrix(1.04, 0, 0, 1.04, 0, 0)', glowed: true });
    if ((await page.evaluate(() => document.querySelector('[data-hologram-overlay]')?.getAttribute('style'))) !== publicStyleBeforeHover) fail('hover が公開 host の style を変更した');
    if ((await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.id, controlCenter)) !== 'media-link') fail('pointer-events:none の操作面が実 hit target を奪った');

    // Mutation による paint は同じ save 面の基礎 style/handler を初期化する。
    // Anchor が同じでも、静止ポインタの hover feedback を再適用する。
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'second-media';
      box.className = 'media';
      box.setAttribute('data-testid', 'tweetPhoto');
      const image = document.createElement('img');
      image.src = 'https://pbs.twimg.com/media/SECOND.jpg';
      box.appendChild(image);
      document.getElementById('post')?.appendChild(box);
    });
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.length).toBe(2);
    await expect
      .poll(async () => {
        const repainted = (await overlay.overlaySnapshot(page)).controls.find((control: any) => control.face === 'save' && control.hostRect.x === measured.hostRect.x);
        return repainted ? { transform: repainted.transform, glowed: repainted.shadow !== measured.shadow } : null;
      })
      .toEqual({ transform: 'matrix(1.04, 0, 0, 1.04, 0, 0)', glowed: true });

    await page.evaluate(() => {
      (window as any).__auxiliaryEvents = [];
      for (const type of ['auxclick', 'contextmenu']) {
        document.getElementById('media-link')?.addEventListener(type, (event) => {
          event.preventDefault();
          (window as any).__auxiliaryEvents.push(type);
        });
      }
    });
    for (const button of ['middle', 'right'] as const) await page.mouse.click(controlCenter.x, controlCenter.y, { button });
    if ((await overlay.overlaySnapshot(page)).saveStarts !== 0) fail('中クリックまたは右クリックが保存を開始した');
    if ((await page.evaluate(() => (window as any).__auxiliaryEvents.length)) !== 0) fail('可視面の中クリックまたは右クリックが下のリンクへ漏れた');

    // 面外で始めた press は、面内で離して click が発生しても保存にしない。
    await page.mouse.move(controlCenter.x - 30, controlCenter.y);
    await page.mouse.down();
    await page.mouse.move(controlCenter.x, controlCenter.y);
    await page.mouse.up();
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'save')).toBe(true);
    if ((await overlay.overlaySnapshot(page)).saveStarts !== 0) fail('面外で始めた press が保存要求を開始した');

    // 面内でclaimしたpressを面外で離すと保存しない。同じページlink上で生成される
    // 末尾clickもclaim済みgestureの一部として消費し、common ancestorへ漏らさない。
    await page.evaluate(() => {
      (window as any).__terminalClicks = 0;
      document.getElementById('media-link')?.addEventListener('click', () => {
        (window as any).__terminalClicks += 1;
      });
    });
    await page.mouse.move(controlCenter.x, controlCenter.y);
    await page.mouse.down();
    await page.mouse.move(controlCenter.x + 30, controlCenter.y);
    await page.mouse.up();
    if ((await overlay.overlaySnapshot(page)).saveStarts !== 0) fail('面内開始から面外releaseした press が保存要求を開始した');
    if ((await page.evaluate(() => (window as any).__terminalClicks)) !== 0) fail('claim済みgestureの末尾clickがページlinkへ漏れた');

    await page.mouse.move(controlCenter.x, controlCenter.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.down({ button: 'middle' });
    await page.mouse.up({ button: 'left' });
    await page.mouse.up({ button: 'middle' });
    if ((await overlay.overlaySnapshot(page)).saveStarts !== 0) fail('複数ボタンの同時押しで保存した');
    if ((await page.evaluate(() => (window as any).__terminalClicks)) !== 0 || (await page.evaluate(() => (window as any).__auxiliaryEvents.length)) !== 0) fail('複数ボタンの同時押しが下のリンクへ漏れた');

    await page.mouse.down({ button: 'left' });
    await page.mouse.down({ button: 'middle' });
    await page.mouse.up({ button: 'middle' });
    await page.mouse.up({ button: 'left' });
    if ((await overlay.overlaySnapshot(page)).saveStarts !== 0) fail('解放順を変えた複数ボタンの同時押しで保存した');
    if ((await page.evaluate(() => (window as any).__terminalClicks)) !== 0 || (await page.evaluate(() => (window as any).__auxiliaryEvents.length)) !== 0) fail('解放順を変えた同時押しが下のリンクへ漏れた');

    await page.mouse.down();
    await page.mouse.move(-10, -10);
    await page.mouse.move(controlCenter.x, controlCenter.y);
    await page.mouse.up();
    if ((await overlay.overlaySnapshot(page)).saveStarts !== 0) fail('document 外に出た操作で保存した');
    if ((await page.evaluate(() => (window as any).__terminalClicks)) !== 0) fail('document 外に出た操作の末尾 click がページへ漏れた');

    // 仮想リストが同じ投稿ノードを別の投稿に再利用しても、押下時と異なる
    // 投稿を保存しない。再描画を待たずに release し、入力境界での照合を確かめる。
    await page.mouse.move(controlCenter.x, controlCenter.y);
    await page.mouse.down();
    await page.locator('#post a:has(time)').evaluate((link: HTMLAnchorElement) => {
      link.href = '/hologram/status/1999999999999999988';
    });
    await page.mouse.up();
    if ((await overlay.overlaySnapshot(page)).saveStarts !== 0) fail('押下中に入れ替わった投稿を保存した');
    await page.locator('#post a:has(time)').evaluate((link: HTMLAnchorElement, url) => {
      link.href = url;
    }, POST_URL);
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'save')).toBe(true);

    // 投稿 URL が同じでも、画像を入れ替えた press は元の操作ではない。
    await page.mouse.move(controlCenter.x, controlCenter.y);
    await page.mouse.down();
    await page.locator('#media-link img').evaluate((image: HTMLImageElement) => {
      image.src = 'https://pbs.twimg.com/media/REPLACEMENT.jpg';
    });
    await page.mouse.up();
    if ((await overlay.overlaySnapshot(page)).saveStarts !== 0) fail('押下中に入れ替わった画像を保存した');
    await page.locator('#media-link img').evaluate((image: HTMLImageElement) => {
      image.src = 'https://pbs.twimg.com/media/HOSTILE.jpg';
    });

    await page.mouse.move(controlCenter.x, controlCenter.y);
    await page.mouse.down();
    await page.locator('#media-link img').evaluate((image: HTMLImageElement) => {
      image.srcset = 'https://pbs.twimg.com/media/SRCSET-REPLACEMENT.jpg 1x';
    });
    await page.mouse.up();
    if ((await overlay.overlaySnapshot(page)).saveStarts !== 0) fail('押下中に srcset で入れ替わった画像を保存した');
    await page.locator('#media-link img').evaluate((image: HTMLImageElement) => {
      image.removeAttribute('srcset');
    });

    // 投稿画像の内側でも、サイトの button が表示上の最前面ならページが所有する。
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
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.find((control: any) => control.face === 'save' && control.hostRect.x === measured.hostRect.x)?.transform).toBe('none');
    await page.mouse.click(controlCenter.x, controlCenter.y);
    await expect.poll(() => page.evaluate(() => (window as any).__coverClicks || 0)).toBe(1);
    if (!(await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'save')) fail('前面 button のクリックが保存面を作動させた');
    await page.evaluate(() => document.getElementById('own-cover')?.remove());
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.find((control: any) => control.face === 'save' && control.hostRect.x === measured.hostRect.x)?.transform).toBe('matrix(1.04, 0, 0, 1.04, 0, 0)');

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

    // text-post の avatar を包む profile link だけは保存面の土台。button と
    // role=button は包含していてもページ所有で、trusted click を奪わない。
    await page.evaluate((postId) => {
      const place = (el: HTMLElement, left: number, top: number, width: number, height: number) => {
        for (const [name, value] of [
          ['position', 'fixed'],
          ['left', `${left}px`],
          ['top', `${top}px`],
          ['width', `${width}px`],
          ['height', `${height}px`],
          ['min-height', '0'],
          ['display', 'block'],
          ['margin', '0'],
          ['padding', '0'],
        ])
          el.style.setProperty(name, value, 'important');
      };
      for (const [index, kind] of ['profile', 'button', 'role-button'].entries()) {
        const article = document.createElement('article');
        article.id = `text-${kind}`;
        article.setAttribute('data-testid', 'tweet');
        place(article, 720, 80 + index * 180, 320, 140);
        const permalink = document.createElement('a');
        permalink.href = `/hologram/status/${postId.slice(0, -1)}${index}`;
        const time = document.createElement('time');
        time.dateTime = '2026-07-29T00:00:00.000Z';
        permalink.append(time);
        article.append(permalink);
        const avatarContainer = document.createElement('div');
        avatarContainer.setAttribute('data-testid', 'Tweet-User-Avatar');
        place(avatarContainer, 16, 16, 40, 40);
        avatarContainer.style.setProperty('position', 'absolute', 'important');
        const wrapper = kind === 'profile' ? document.createElement('a') : kind === 'button' ? document.createElement('button') : document.createElement('div');
        wrapper.id = `page-${kind}`;
        if (wrapper instanceof HTMLAnchorElement) {
          wrapper.href = `/hologram-${kind}`;
          wrapper.setAttribute('role', 'link');
        }
        if (kind === 'role-button') wrapper.setAttribute('role', 'button');
        place(wrapper, 0, 0, 40, 40);
        wrapper.style.setProperty('position', 'absolute', 'important');
        const avatar = document.createElement('img');
        place(avatar, 0, 0, 40, 40);
        avatar.style.setProperty('position', 'absolute', 'important');
        wrapper.append(avatar);
        wrapper.addEventListener('click', (event) => {
          event.preventDefault();
          const counts = ((window as any).__textPageClicks ||= {});
          counts[kind] = (counts[kind] || 0) + 1;
        });
        avatarContainer.append(wrapper);
        article.append(avatarContainer);
        document.body.append(article);
      }
    }, POST_ID);
    await overlay.setStorage({ hoverSaveButton: true });
    const textControl = async (unitId: string) => {
      const article = page.locator(`#${unitId}`);
      const rect = await article.boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      let found: any;
      await expect
        .poll(async () => {
          await page.mouse.move(0, 0);
          await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
          const controls = (await overlay.overlaySnapshot(page)).controls;
          found = controls.find((control: any) => control.unitId === unitId && control.face === 'save');
          return controls.map((control: any) => `${control.unitId}:${control.face}`);
        })
        .toContain(`${unitId}:save`);
      return found;
    };
    const beforeTextSaves = (await overlay.overlaySnapshot(page)).saveStarts;
    const profileControl = await textControl('text-profile');
    await page.mouse.click(profileControl.rect.x + profileControl.rect.width / 2, profileControl.rect.y + profileControl.rect.height / 2);
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).saveStarts).toBe(beforeTextSaves + 1);
    if ((await page.evaluate(() => (window as any).__textPageClicks?.profile || 0)) !== 0) fail('profile link の avatar 保存がページ click へ漏れた');
    for (const kind of ['button', 'role-button']) {
      const control = await textControl(`text-${kind}`);
      await page.mouse.click(control.rect.x + control.rect.width / 2, control.rect.y + control.rect.height / 2);
      await expect.poll(() => page.evaluate((key) => (window as any).__textPageClicks?.[key] || 0, kind)).toBe(1);
      if ((await overlay.overlaySnapshot(page)).saveStarts !== beforeTextSaves + 1) fail(`${kind} 内 avatar のページ click が保存要求になった`);
    }

    // pointer-events:none の host でも closed tree 内の本物の button は Tab で
    // 到達でき、Enter は既存の保存処理を作動させる。
    await overlay.setStorage({ hoverSaveButton: true });
    await page.mouse.move(media.x + media.width / 2, media.y + media.height / 2);
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'save')).toBe(true);
    for (let i = 0; i < 20; i++) {
      if ((await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'save' && control.focused)) break;
      await page.keyboard.press('Tab');
    }
    if (!(await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'save' && control.focused)) fail('保存面へキーボードフォーカスできない');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'failed')).toBe(true);
    for (let i = 0; i < 20; i++) {
      if ((await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'failed' && control.focused)) break;
      await page.keyboard.press('Tab');
    }
    if (!(await overlay.overlaySnapshot(page)).controls.some((control: any) => control.face === 'failed' && control.focused)) fail('再試行面へキーボードフォーカスできない');
    const beforeSpaceRetry = (await overlay.overlaySnapshot(page)).saveStarts;
    await page.keyboard.press('Space');
    await expect.poll(async () => (await overlay.overlaySnapshot(page)).saveStarts).toBe(beforeSpaceRetry + 1);

    console.log(`PASS e2e-extension-hostile-css: 保存ボタン ${Math.round(measured.rect.width)}x${Math.round(measured.rect.height)}、closed UI`);
  } finally {
    await overlay.close();
  }
});
