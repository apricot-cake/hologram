'use strict';

// Exercises folder-tree drag-and-drop with real pointer input. Unit tests cover
// placement semantics; this suite verifies that the row edge hit zones actually
// deliver "before" and "after" through Electron's HTML drag events.
//
//   node scripts/test-app-folder-dnd.cts

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const { createDbWriter } = require(path.join(appDir, 'src', 'main', 'lib-db-write.ts'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-folder-dnd-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

{
  const { sqlite } = openDatabase(path.join(configDir, 'hologram.db'));
  const writer = createDbWriter(sqlite);
  writer.setFolders({
    folders: [
      { id: 'f-a', name: '資料', kind: 'static', created: 1, parentId: null, items: [] },
      { id: 'f-child', name: '下書き', kind: 'static', created: 2, parentId: 'f-a', items: [] },
      { id: 'f-b', name: '参考', kind: 'static', created: 3, parentId: null, items: [] },
    ],
    activeId: null,
  });
  writer.stateSet('truthSource', 'db');
  sqlite.close();
}

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SANDBOX: '1',
});

const row = (page, id) => page.locator(`[data-folder-id="${id}"]`).first();

async function dragToEdge(page, sourceId, targetId, edge) {
  const sourceBox = await row(page, sourceId).boundingBox();
  const targetBox = await row(page, targetId).boundingBox();
  assert(sourceBox, `source row ${sourceId} is visible`);
  assert(targetBox, `target row ${targetId} is visible`);

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 6, sourceBox.y + sourceBox.height / 2 + 6, { steps: 4 });
  const targetY = targetBox.y + targetBox.height * (edge === 'before' ? 0.08 : 0.92);
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetY, { steps: 18 });
  await page.mouse.up();
}

async function folderOrder(page) {
  return page.evaluate(async () => {
    const data = await window.hologram.getFolders();
    return data.folders.filter((folder) => folder.parentId == null).map((folder) => folder.id);
  });
}

(async () => {
  let electronApp: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  try {
    electronApp = await _electron.launch({
      executablePath: electronPath,
      args: ['.'],
      cwd: appDir,
      env,
    });
    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await row(page, 'f-a').waitFor({ state: 'visible' });
    await row(page, 'f-b').waitFor({ state: 'visible' });

    await dragToEdge(page, 'f-b', 'f-a', 'before');
    await page.waitForFunction(async () => {
      const data = await window.hologram.getFolders();
      return (
        data.folders
          .filter((folder) => folder.parentId == null)
          .map((folder) => folder.id)
          .join(',') === 'f-b,f-a'
      );
    });
    assert.deepEqual(await folderOrder(page), ['f-b', 'f-a']);

    await dragToEdge(page, 'f-b', 'f-a', 'after');
    await page.waitForFunction(async () => {
      const data = await window.hologram.getFolders();
      return (
        data.folders
          .filter((folder) => folder.parentId == null)
          .map((folder) => folder.id)
          .join(',') === 'f-a,f-b'
      );
    });
    assert.deepEqual(await folderOrder(page), ['f-a', 'f-b']);

    await row(page, 'f-a').locator('[data-slot="folder-twisty"]').click();
    await row(page, 'f-child').waitFor({ state: 'visible' });
    const parentBox = await row(page, 'f-a').boundingBox();
    const childBox = await row(page, 'f-child').boundingBox();
    assert(parentBox && childBox, 'expanded parent and child rows are visible');
    assert(childBox.x > parentBox.x, 'child row is indented under its parent');

    const sidebar = page.locator('[data-slot="sidebar-content"]').first();
    const overflow = await sidebar.evaluate((el) => el.scrollWidth - el.clientWidth);
    assert(overflow <= 1, `folder tree has no horizontal overflow (${overflow}px)`);

    const shot = process.env.HOLOGRAM_FOLDER_SHOT;
    if (shot) {
      fs.mkdirSync(path.dirname(shot), { recursive: true });
      await page.screenshot({ path: shot });
      console.log(`FOLDER_DND_SCREENSHOT ${shot}`);
    }
    console.log('FOLDER_DND_TEST_PASS');
  } finally {
    if (electronApp) await electronApp.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
