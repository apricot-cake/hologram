import { expect, test } from '../lib/harness.ts';

test('画像とタブのピン留め操作を表示しない', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  expect(await page.evaluate(() => 'pinSend' in window.hologram)).toBe(false);
  const card = page.locator('[data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' });
  await card.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /ピン/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await card.dblclick();
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  await expect(page.locator('[data-slot="viewer-pin"]')).toHaveCount(0);
  await page.getByRole('tab').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '複製', exact: false })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /ピン/ })).toHaveCount(0);
});
