// Delete → trash → restore. The longest chain a user can walk without typing,
// and the one whose halves live in different surfaces: the floating selection bar
// deletes, the ゴミ箱 destination in the left nav restores (#268 moved that half
// out of the settings dialog). Nothing short of driving both surfaces proves they
// still meet.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../lib/harness.ts';

test('選択バーから削除するとグリッドから消えてごみ箱に入る', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;
  const cards = page.locator('#postGrid .post-card');
  const nav = page.locator('[data-slot="sidebar"]').first();
  const trashEntry = nav.getByRole('button', { name: 'ゴミ箱' });

  // The nav entry is there before anything is deleted (設計確定: 0件でも隠さない),
  // and wears no count badge while the trash is empty.
  await expect(trashEntry).toBeVisible();
  await expect(nav.locator('[data-slot="sidebar-menu-badge"]')).toHaveCount(0);

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

  // The badge counts what just landed there — the deletion is visible in the nav
  // without opening anything.
  await expect(nav.locator('[data-slot="sidebar-menu-badge"]')).toHaveText('1');

  // ゴミ箱 opens as a destination in the content area: the deleted post is a card
  // there, selecting it arms 復元, and pressing it puts the post back.
  await trashEntry.click();
  const trashCards = page.locator('#trashGrid .post-card');
  await expect(trashCards).toHaveCount(1);
  await expect(trashCards.filter({ hasText: 'rough_fudemoto' })).toHaveCount(1);

  const restoreButton = page.getByRole('button', { name: '復元' });
  await expect(restoreButton).toBeDisabled(); // nothing selected yet
  await trashCards.first().click();
  await expect(restoreButton).toBeEnabled();
  await restoreButton.click();
  await expect(trashCards).toHaveCount(0);
  await expect(page.locator('#trashPanel').getByText('ゴミ箱は空です').first()).toBeVisible();

  // Restored means the row and the media are back where the library keeps them.
  await expect.poll(() => hologram.readDb((sqlite) => sqlite.prepare('SELECT captureId FROM posts WHERE captureId = ?').get('e2e-0004'))).toEqual({ captureId: 'e2e-0004' });
  expect(fs.existsSync(path.join(hologram.saveFolder, 'e2e-0004.png'))).toBe(true);

  // Back to the library: the restored post is on the grid again (#471: restore-post
  // broadcasts posts-changed, so no relaunch is required).
  await nav.getByRole('button', { name: 'ライブラリ' }).click();
  await expect(cards).toHaveCount(4);
  await expect(cards.filter({ hasText: '手描きのラフスケッチ' })).toHaveCount(1);
  await expect(nav.locator('[data-slot="sidebar-menu-badge"]')).toHaveCount(0);
});
