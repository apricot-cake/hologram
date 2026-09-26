'use strict';

// カードフッターのノイズゲート（カードモデルの showEngagement/showCaptured）を
// 検証する:
//  - 静止時（日付ソート、フィルタ無し）は、エンゲージメントの統計行も 📷
//    キャプチャ日時も「描画されない」— 投稿日だけが描画される
//  - 件数のソートは、その項目だけを全カードに出す（0 も出す）
//  - いいね順は、サイト内補正で並べ替え、実際のいいね数を出す
//  - キャプチャソート（キャプチャ降順）はキャプチャ日時を出し、統計は再び消える
//
// #618 はこれを CSS（グリッドコンテナ上の2つのクラスが、常にそこにあった
// マークアップを隠す方式）からカードモデルの側へ移した。だから主張は
// `display` についてではなく、カードがその部品を「持っているか」についてに
// なる。ソートはツールバーの並び順メニューで駆動する — かつて突いていた隠れた
// <select> はもう無いので、これが人が使うのと同じ画面。
//
//   node e2e/harness/cases/test-app-cardfoot.cts

const { _electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-cf-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// capturedAt は date とは「違う」日に着地させ、📷 のキャプチャ日時が描画
// されるようにする（同日のキャプチャは cardModel で重複除去されて消える）。
const records: any[] = [];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-cf' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (800 + i),
    platform: 'x',
    text: '投稿' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 10 + i,
    reposts: i,
    replies: 2 - i,
    capturedAt: '2026-05-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  });
}
const seeded = seedLibrary(configDir, records, { close: false });
for (let i = 0; i < records.length; i++) {
  seeded.sqlite.prepare('UPDATE posts SET localViewCount = ? WHERE captureId = ?').run(i * 3, records[i].captureId);
}
seeded.sqlite.close();

async function main() {
  let app: import('playwright').ElectronApplication | undefined;
  try {
    const launched: import('playwright').ElectronApplication = await _electron.launch({
      executablePath: electronPath,
      args: ['.', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
      cwd: appDir,
      env: { ...process.env, APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_START_INACTIVE: '1', HOLOGRAM_SANDBOX: '1', HOLOGRAM_E2E: '1', HOLOGRAM_E2E_HIDDEN: '1', HOLOGRAM_LANG: 'ja' },
    });
    app = launched;
    const page = await launched.firstWindow();
    const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
    const stats = cards.locator('[data-slot="post-card-stats"] [data-stat]');
    await expect(cards).toHaveCount(3);
    await expect(cards.locator('[data-slot="post-card-date"]')).toHaveCount(3);
    await expect(cards.locator('[data-slot="post-card-capdate"]')).toHaveCount(0);
    await expect(stats).toHaveCount(0);

    const setSort = async (label: string) => {
      const trigger = page.locator('[data-slot="toolbar-sort"]');
      await trigger.press('Enter');
      await page.getByRole('menuitemradio', { name: label, exact: true }).press('Enter');
      await expect(trigger).toContainText(label);
      if ((await trigger.getAttribute('aria-expanded')) === 'true') await trigger.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    };
    await setSort('閲覧数');
    await expect(stats).toHaveText(['6', '3', '0']);
    await expect(cards.locator('[data-stat="localViews"]')).toHaveCount(3);
    await expect(cards.locator('[data-slot="post-card-date"]')).toHaveCount(0);

    await setSort('いいね数');
    await expect(stats).toHaveText(['12', '11', '10']);
    await expect(cards.locator('[data-stat="likes"]')).toHaveCount(3);

    await setSort('保存日');
    await expect(stats).toHaveCount(0);
    await expect(cards.locator('[data-slot="post-card-capdate"]')).toHaveCount(3);
    await expect(cards.locator('[data-slot="post-card-date"]')).toHaveCount(0);
    console.log('CARDFOOT_TEST_PASS');
  } finally {
    await app?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
