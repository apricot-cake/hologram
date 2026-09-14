import { expect, test } from '../lib/harness.ts';

test('タグ管理からゴミ箱へ移動し、タグ管理にも戻れる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.getByRole('button', { name: 'フィルタ', exact: true }).click();
  await page.getByText('タグ', { exact: true }).click();
  await page.getByText('タグを管理…', { exact: true }).click();
  await expect(page.getByTestId('tag-management')).toBeVisible();
  await expect(page.locator('[data-slot="inspector"]')).toBeHidden();
  await expect(page.locator('[data-slot="inspector-toggle"]')).toBeDisabled();
  await page.locator('[data-sidebar="menu-button"]').filter({ hasText: 'ゴミ箱' }).click();
  await expect(page.getByTestId('tag-management')).not.toBeVisible();
  await expect(page.locator('[data-slot="trash-view"]')).toBeVisible();
  await expect(page.locator('[data-slot="inspector"]')).toBeVisible();
  await expect(page.locator('[data-slot="inspector-toggle"]')).toBeEnabled();
  await page.getByRole('tab').filter({ hasText: 'タグを管理' }).click();
  await expect(page.getByTestId('tag-management')).toBeVisible();
  await expect(page.locator('[data-slot="trash-view"]')).not.toBeVisible();
});

test('ビューアからタグ管理へ切り替え、ビューアへ戻れる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.getByRole('button', { name: 'フィルタ', exact: true }).click();
  await page.getByText('タグ', { exact: true }).click();
  await page.getByText('タグを管理…', { exact: true }).click();
  const tags = page.getByRole('tab').filter({ hasText: 'タグを管理' });
  await expect(page.getByTestId('tag-management')).toBeVisible();
  await page.getByRole('tab').filter({ hasText: 'すべて' }).first().click();
  await page.locator('[data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).dblclick();
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  await tags.click();
  await expect(page.getByTestId('tag-management')).toBeVisible();
  await expect(page.getByRole('button', { name: 'フィルタ', exact: true })).toBeVisible();
  await page.getByRole('tab').filter({ hasText: '猫が机の上で寝ている' }).click();
  await expect(page.getByTestId('tag-management')).not.toBeVisible();
  await expect(page.locator('[data-slot="content-scroll"]')).toBeHidden();
});
