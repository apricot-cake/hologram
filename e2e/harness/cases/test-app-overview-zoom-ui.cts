'use strict';

// 仮想グリッドのCtrl+ホイールは、古いDOMへ合成イベントを送ると再描画の途中で
// イベントが切れる。Playwrightの実入力で、利用者と同じズーム経路を検証する。

const { _electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');

const appDir = path.join(__dirname, '../../../app');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-overview-zoom-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
// 情報表示ありの下限では、狭い CI 画面で縮小できる列数が残らない。
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja', showInfo: false, gridSize: 280 }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const posts = Array.from({ length: 80 }, (_, index) => {
  const captureId = `zoom-${index}`;
  fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), jpeg);
  return {
    captureId,
    image: `${captureId}.jpg`,
    url: `https://x.com/u/status/${captureId}`,
    platform: 'x',
    userId: 'zoom',
    displayName: 'Zoom',
    screenName: 'zoom',
    text: captureId,
    capturedAt: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
  };
});
seedLibrary(configDir, posts);

async function main() {
  let app: import('playwright').ElectronApplication | undefined;
  try {
    const launched = await _electron.launch({
      executablePath: resolveElectron(),
      args: ['.', '--force-device-scale-factor=1', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
      cwd: appDir,
      env: { ...process.env, APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SANDBOX: '1', HOLOGRAM_E2E: '1', HOLOGRAM_E2E_HIDDEN: '1', HOLOGRAM_START_INACTIVE: '1' },
    });
    app = launched;
    const page = await launched.firstWindow();
    const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
    await cards.first().waitFor();
    const width = async () => Math.round((await cards.first().boundingBox())?.width || 0);
    const initial = await width();
    const box = await cards.first().boundingBox();
    if (!box || initial < 48) throw new Error(`投稿カードの初期レイアウトが不正: ${initial}px`);

    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(32, box.height / 2));
    await page.keyboard.down('Control');
    for (let i = 0; i < 18; i++) await page.mouse.wheel(0, 120);
    await page.keyboard.up('Control');
    await page.waitForFunction((before) => {
      const card = document.querySelector('[data-slot="post-grid"] [data-slot="post-card"]');
      return !!card && Math.round(card.getBoundingClientRect().width) < before;
    }, initial);
    const overview = await width();
    if (!(overview < initial && overview >= 48)) throw new Error(`Ctrl+ホイール下で俯瞰表示へ縮小されなかった: ${initial}px -> ${overview}px`);

    const overviewBox = await cards.first().boundingBox();
    if (!overviewBox) throw new Error('縮小後の投稿カードが見つからない');
    await page.mouse.move(overviewBox.x + overviewBox.width / 2, overviewBox.y + Math.min(24, overviewBox.height / 2));
    await page.keyboard.down('Control');
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await page.waitForFunction((before) => {
      const card = document.querySelector('[data-slot="post-grid"] [data-slot="post-card"]');
      return !!card && Math.round(card.getBoundingClientRect().width) > before;
    }, overview);
    const restored = await width();
    if (restored <= overview) throw new Error(`Ctrl+ホイール上で拡大されなかった: ${overview}px -> ${restored}px`);
    console.log('OVERVIEW_ZOOM_UI_TEST_PASS', JSON.stringify({ initial, overview, restored }));
  } finally {
    await app?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
