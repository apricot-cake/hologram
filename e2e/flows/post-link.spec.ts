import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '../lib/harness.ts';
import { makePostLink } from '../../app/src/shared/post-link.ts';

const url = 'https://x.com/sora_umi/status/123';
const individualUrl = 'https://example.test/individual.png';
function seed({ saveFolder }: { saveFolder: string }) {
  const db = new DatabaseSync(path.join(saveFolder, 'hologram.db'));
  try {
    db.prepare('UPDATE posts SET url = ? WHERE captureId IN (?, ?)').run(url, 'e2e-0001', 'e2e-0002');
    db.prepare("UPDATE posts SET saveScope = 'media' WHERE captureId = ?").run('e2e-0002');
    db.prepare('UPDATE media SET url = ? WHERE postId = ?').run(individualUrl, 'e2e-0002');
    db.prepare("UPDATE posts SET url = ?, image = '', video = '' WHERE captureId = ?").run('https://x.com/a/status/124', 'e2e-0003');
    db.prepare('DELETE FROM media WHERE postId = ?').run('e2e-0003');
  } finally {
    db.close();
  }
}

test('投稿リンクで起動すると保存済み投稿を開く', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed, args: [makePostLink({ url })] });
  await expect(page).toHaveTitle(/青い空と海/);
  await expect(page.locator('[data-slot="content-scroll"]')).toBeHidden();
});

test('起動済みアプリで個別保存を開き、削除済みリンクを知らせる', async ({ launchHologram }) => {
  const { app, page } = await launchHologram({ seed });
  const windows = await app.windows();
  await app.evaluate(({ app }, link) => app.emit('second-instance', {}, [link]), makePostLink({ url, mediaUrl: individualUrl }));
  await expect(page).toHaveTitle(/夕暮れの街並み/);
  expect(await app.windows()).toHaveLength(windows.length);
  await app.evaluate(({ app }, link) => app.emit('second-instance', {}, [link]), makePostLink({ url: 'https://x.com/a/status/124' }));
  await expect(page.locator('[data-slot="content-scroll"]')).toBeVisible();
  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"]')).toHaveCount(1);
  await app.evaluate(({ app }, link) => app.emit('second-instance', {}, [link]), makePostLink({ url: 'https://x.com/a/status/999' }));
  await expect(page.getByText('保存済みの投稿が見つかりません。削除されたか、別のライブラリを開いています。')).toBeVisible();
});

test('主窓を閉じても副窓へ起動操作を配送し、tabs の権限は移さない', async ({ launchHologram }) => {
  const hologram = await launchHologram({ seed });
  const { app, page } = hologram;

  const secondaryReady = app.waitForEvent('window');
  await page.evaluate(() => window.hologram.openNewWindow());
  const secondary = await secondaryReady;
  await secondary.waitForFunction(() => !!document.querySelector('[data-slot="post-card"], [data-slot="empty-state"]'));

  const primaryClosed = page.waitForEvent('close');
  await page.evaluate(() => window.hologram.windowControl('close'));
  await primaryClosed;
  await expect.poll(() => app.windows().length).toBe(1);

  const rejected = await secondary.evaluate(() =>
    window.hologram.setTabs({
      tabs: [{ id: 'secondary-must-not-persist', pinned: false, title: null, state: { view: null } }],
      activeTabId: 'secondary-must-not-persist',
    }),
  );
  expect(rejected).toEqual({ ok: false });
  expect(hologram.readDb((sqlite) => sqlite.prepare('SELECT COUNT(*) AS n FROM tabs WHERE id = ?').get('secondary-must-not-persist').n)).toBe(0);

  // テスト起動は非アクティブ指定なので、通常の second-instance は新窓を増やさず、既存窓を
  // 復元する経路を通る。その配送先が、閉じた主窓ではなく残った副窓であることを実物で確かめる。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await app.evaluate(({ app }) => app.emit('second-instance', {}, []));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--hologram-activate-existing']));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);

  await app.evaluate(({ app }, link) => app.emit('second-instance', {}, [link]), makePostLink({ url, mediaUrl: individualUrl }));
  await expect(secondary).toHaveTitle(/夕暮れの街並み/);
});
