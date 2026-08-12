// フォルダツリーのドラッグ&ドロップを、本物のポインタ入力で検証する（#41）。
// 配置のセマンティクス自体は単体テストがカバーしている。ここで検証するのは、
// 行の端の当たり判定ゾーンが、Electron の HTML drag イベントを通して実際に
// 「前」と「後」を届けるかどうか。
//
// このケースはこのスイートより前から存在する — かつて scripts/test-app-
// folder-dnd.cts で、`_electron` ＋本物のポインタがここで使われた最初の
// 場所であり、このファイルが import しているハーネスはそのスクリプトを
// 一般化したもの。複製ではなく「移動」した: これはこの層のものであり、
// scripts/ の集約役に残しておくと、同じものを2つのランナーで走らせることに
// なってしまう。
import path from 'node:path';
import { expect, test } from '../lib/harness.ts';

const appDir = path.join(__dirname, '..', '..', 'app');

const FOLDERS = [
  { id: 'f-a', name: '資料', kind: 'static', created: 1, parentId: null, items: [] },
  { id: 'f-child', name: '下書き', kind: 'static', created: 2, parentId: 'f-a', items: [] },
  { id: 'f-b', name: '参考', kind: 'static', created: 3, parentId: null, items: [] },
];

function seedFolders({ saveFolder }: { saveFolder: string }) {
  const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
  const { createDbWriter } = require(path.join(appDir, 'src', 'main', 'lib-db-write.ts'));
  // #176: hologram.db は今や configDir ではなく保存フォルダの中にある。
  const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));
  createDbWriter(sqlite).setFolders({ folders: FOLDERS, activeId: null });
  sqlite.close();
}

// #981: フォルダの木はレールの フォルダ 行の裏にあるフライアウトの中に住んで
// いる — サイドバーにはもうそれを表示する展開列が無い。以下のすべてが行を
// 画面上で当たり判定できる状態を必要とするので、各ケースはまずフライアウト
// を開く。
async function openFolderTree(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('[data-slot="menu-label"]', { hasText: /^フォルダ$/ }).click();
  await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
}

test('フォルダ行を上端・下端へドロップすると並び順が入れ替わる', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed: seedFolders });
  await openFolderTree(page);
  const row = (id: string) => page.locator(`[data-folder-id="${id}"]`).first();

  // `sourceId` を `targetId` の上端（before）または下端（after）の端ゾーンへ
  // ドラッグする。
  const dragToEdge = async (sourceId: string, targetId: string, edge: 'before' | 'after') => {
    const source = await row(sourceId).boundingBox();
    const target = await row(targetId).boundingBox();
    expect(source, `元の行 ${sourceId} が見える`).toBeTruthy();
    expect(target, `対象の行 ${targetId} が見える`).toBeTruthy();
    if (!source || !target) return;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 6, source.y + source.height / 2 + 6, { steps: 4 });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height * (edge === 'before' ? 0.08 : 0.92), { steps: 18 });
    await page.mouse.up();
  };

  const rootOrder = () => page.evaluate(async () => (await window.hologram.getFolders()).folders.filter((folder) => folder.parentId == null).map((folder) => folder.id));

  await expect(row('f-a')).toBeVisible();
  await expect(row('f-b')).toBeVisible();

  await dragToEdge('f-b', 'f-a', 'before');
  await expect.poll(rootOrder).toEqual(['f-b', 'f-a']);

  await dragToEdge('f-b', 'f-a', 'after');
  await expect.poll(rootOrder).toEqual(['f-a', 'f-b']);
});

test('親フォルダを開くと子はインデントされ、横スクロールを出さない', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed: seedFolders });
  await openFolderTree(page);
  const row = (id: string) => page.locator(`[data-folder-id="${id}"]`).first();

  await row('f-a').locator('[data-slot="folder-twisty"]').click();
  await expect(row('f-child')).toBeVisible();

  const parent = await row('f-a').boundingBox();
  const child = await row('f-child').boundingBox();
  expect(parent && child, '展開された親と子の行が見える').toBeTruthy();
  expect(child?.x).toBeGreaterThan(parent?.x ?? 0);

  const overflow = await page
    .locator('[data-slot="popover-content"]')
    .first()
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, 'フォルダの木に横方向のはみ出しが無い').toBeLessThanOrEqual(1);
});
