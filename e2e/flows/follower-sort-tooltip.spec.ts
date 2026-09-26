import { expect, test } from '../lib/harness.ts';

test('フォロワー数の補足は候補内だけで表示する', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: '投稿者' }).press('Enter');
  await page.getByRole('button', { name: '表示', exact: true }).press('Enter');
  const select = page.locator('[data-slot="select-trigger"]');
  await select.press('Space');
  const followers = page.getByRole('option', { name: 'フォロワー数', exact: true });
  await expect(followers).not.toHaveAttribute('title');
  await followers.hover();
  const hint = page.locator('[data-slot="tooltip-content"][data-open]').filter({ hasText: 'サイト内での比較に基づく並び順' });
  await expect(hint).toBeVisible();
  await followers.press('Enter');
  await expect(select).toContainText('フォロワー数');
  await expect(select).not.toHaveAttribute('title');
  await select.hover();
  await page.waitForTimeout(500);
  await expect(hint).toHaveCount(0);
  await select.press('Space');
  await page.getByRole('option', { name: '投稿数', exact: true }).press('Enter');
  await select.hover();
  await expect(hint).toHaveCount(0);
});
