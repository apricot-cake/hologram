import { expect, test } from '../lib/harness.ts';

test('日付プリセットと期間指定の確定を分ける', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: '投稿者' }).press('Enter');
  await page.getByRole('button', { name: 'フィルタ', exact: true }).press('Enter');
  await page.getByRole('menuitem', { name: '日付', exact: true }).hover();
  await page.getByRole('menuitem', { name: '最後に投稿した日', exact: true }).hover();
  const period = page.getByRole('combobox', { name: '期間', exact: true });
  await expect(period).toBeVisible();
  await expect(page.locator('[data-slot="custom-date-range"]')).toHaveCount(0);
  await period.press('Space');
  await expect(page.getByRole('option').first()).toHaveText('指定なし');
  await expect
    .poll(async () => {
      const triggerBounds = await period.boundingBox();
      const popupBounds = await page.getByRole('listbox').boundingBox();
      return popupBounds!.y - (triggerBounds!.y + triggerBounds!.height);
    })
    .toBeGreaterThanOrEqual(0);
  await page.getByRole('option', { name: '期間を指定', exact: true }).click();
  const custom = page.locator('[data-slot="custom-date-range"]');
  await expect(custom).toBeVisible();
  const apply = custom.getByRole('button', { name: 'この期間で絞り込む' });
  await expect(apply).toBeDisabled();
  const inputs = custom.locator('input');
  await inputs.nth(0).fill('2026-09-20');
  await inputs.nth(1).fill('2026-09-10');
  await expect(apply).toBeDisabled();
  await inputs.nth(1).fill('2026-09-25');
  await expect(apply).toBeEnabled();
  await period.press('Space');
  await page.getByRole('option', { name: '過去7日間', exact: true }).click();
  await expect(custom).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="filter-values"]')).toHaveCount(1);
  const openPeriod = async (name: string) => {
    await page.getByRole('button', { name: 'フィルタ', exact: true }).press('Enter');
    await page.getByRole('menuitem', { name: '日付', exact: true }).hover();
    await page.getByRole('menuitem', { name, exact: true }).hover();
    await period.press('Space');
  };
  const closeMenus = async () => {
    for (let i = 0; i < 4; i++) await page.keyboard.press('Escape');
  };
  await openPeriod('アカウント作成日');
  await page.getByRole('option', { name: '指定なし', exact: true }).press('Enter');
  await closeMenus();
  await expect(page.locator('[data-slot="filter-values"]')).toHaveCount(1);
  await openPeriod('最後に投稿した日');
  await page.getByRole('option', { name: '指定なし', exact: true }).press('Enter');
  await closeMenus();
  await expect(page.locator('[data-slot="filter-values"]')).toHaveCount(0);
});
