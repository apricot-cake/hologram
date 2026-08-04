// Folder-tree drag and drop with real pointer input (#41). Unit tests cover the
// placement semantics; this verifies that the row edge hit zones actually deliver
// "before" and "after" through Electron's HTML drag events.
//
// This case predates the suite — it was scripts/test-app-folder-dnd.cts, the first
// place `_electron` + a real pointer were used here, and the harness this file
// imports is that script generalized. It moved rather than being duplicated: it is
// this layer, and leaving it in the scripts/ aggregator would run the same thing
// under two runners.
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
  // #176: hologram.db lives inside the save folder now, not configDir (ADR 0025).
  const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));
  createDbWriter(sqlite).setFolders({ folders: FOLDERS, activeId: null });
  sqlite.close();
}

test('フォルダ行を上端・下端へドロップすると並び順が入れ替わる', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed: seedFolders });
  // The library folder group is hidden in the rail, which is now the default (#678) — this
  // flow needs the rows visible and hit-testable, so expand the column first.
  await page.keyboard.press('Control+b');
  const row = (id: string) => page.locator(`[data-folder-id="${id}"]`).first();

  // Drag `sourceId` onto `targetId`'s top (before) or bottom (after) edge zone.
  const dragToEdge = async (sourceId: string, targetId: string, edge: 'before' | 'after') => {
    const source = await row(sourceId).boundingBox();
    const target = await row(targetId).boundingBox();
    expect(source, `source row ${sourceId} is visible`).toBeTruthy();
    expect(target, `target row ${targetId} is visible`).toBeTruthy();
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
  // Same reason as the drag case above: the folder group is rail-hidden by default (#678).
  await page.keyboard.press('Control+b');
  const row = (id: string) => page.locator(`[data-folder-id="${id}"]`).first();

  await row('f-a').locator('[data-slot="folder-twisty"]').click();
  await expect(row('f-child')).toBeVisible();

  const parent = await row('f-a').boundingBox();
  const child = await row('f-child').boundingBox();
  expect(parent && child, 'expanded parent and child rows are visible').toBeTruthy();
  expect(child?.x).toBeGreaterThan(parent?.x ?? 0);

  const overflow = await page
    .locator('[data-slot="sidebar-content"]')
    .first()
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, 'folder tree has no horizontal overflow').toBeLessThanOrEqual(1);
});
