import { expect, test } from '../lib/harness.ts';

test('ソート項目だけを常時表示し、サイズ操作を独立させる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  for (const mode of ['ホーム', '投稿者', 'ゴミ箱']) {
    await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: mode }).press('Enter');
    await expect(page.getByRole('button', { name: '表示', exact: true })).toHaveCount(0);
    const sort = page.locator('[data-slot="toolbar-sort"]');
    await expect(sort).toBeVisible();
    await expect(sort.locator('.lucide-arrow-down-wide-narrow')).toHaveCount(1);
    await expect(sort).not.toContainText(/多い順|少ない順|新しい順|古い順/);
    await expect(page.locator('[data-slot="toolbar-card-size"]')).toBeVisible();
    await sort.press('Enter');
    await page.getByRole('menuitemradio', { name: '閲覧数', exact: true }).press('Enter');
    await expect(sort).toHaveText('閲覧数');
    await expect(sort.locator('.lucide-arrow-down-wide-narrow')).toHaveCount(1);
    await sort.press('Enter');
    await page.getByRole('menuitemradio', { name: '少ない順', exact: true }).press('Enter');
    await expect(sort).toHaveText('閲覧数');
    await sort.press('Enter');
    await expect(page.getByRole('menuitemradio', { name: '少ない順', exact: true })).toBeChecked();
    await page.keyboard.press('Escape');
  }
});
