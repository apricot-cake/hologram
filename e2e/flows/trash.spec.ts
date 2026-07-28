// Delete → trash → restore. The longest chain a user can walk without typing,
// and the one whose halves live in different surfaces: the floating selection bar
// deletes, the settings dialog restores. Nothing short of driving both surfaces
// proves they still meet.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../lib/harness.ts';

test('選択バーから削除するとグリッドから消えてごみ箱に入る', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;
  const cards = page.locator('#postGrid .post-card');

  await cards.filter({ hasText: '手描きのラフスケッチ' }).click();
  const deleteButton = page.getByRole('button', { name: '削除' });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();

  // shadcn AlertDialog: a stray click cannot discard the choice, so the confirm
  // has to be pressed.
  const confirm = page.locator('[data-slot="alert-dialog-content"]');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '削除する' }).click();

  await expect(cards).toHaveCount(3);
  await expect(cards.filter({ hasText: '手描きのラフスケッチ' })).toHaveCount(0);
  // Soft delete: the row is gone and the media moved to .trash, not erased.
  expect(hologram.readDb((sqlite) => sqlite.prepare('SELECT captureId FROM posts WHERE captureId = ?').get('e2e-0004'))).toBeUndefined();
  expect(fs.existsSync(path.join(hologram.saveFolder, '.trash', 'e2e-0004.png'))).toBe(true);

  // Settings → ゴミ箱 lists it and restores it.
  await page.locator('#settingsBtn').click();
  const dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'ゴミ箱' }).click();
  // The trashed post is listed by its author (a capture has no title of its own),
  // and it is the only row, so its 復元 button is the only one.
  await expect(dialog.getByText('rough_fudemoto')).toBeVisible();
  const restoreButton = dialog.getByRole('button', { name: '復元' });
  await expect(restoreButton).toHaveCount(1);
  await restoreButton.click();
  await expect(restoreButton).toHaveCount(0);

  // Restored means the row and the media are back where the library keeps them.
  // NOTE: the grid behind the dialog does NOT come back on its own — restore-post
  // writes the row but broadcasts no posts-changed, so the card only reappears on
  // the next launch. Asserted at the storage layer until that gap is closed (#471).
  await expect.poll(() => hologram.readDb((sqlite) => sqlite.prepare('SELECT captureId FROM posts WHERE captureId = ?').get('e2e-0004'))).toEqual({ captureId: 'e2e-0004' });
  expect(fs.existsSync(path.join(hologram.saveFolder, 'e2e-0004.png'))).toBe(true);
});
