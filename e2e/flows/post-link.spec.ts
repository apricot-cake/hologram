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
