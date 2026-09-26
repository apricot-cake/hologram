import { expect, test } from '../lib/harness.ts';

test('投稿者メニューは区切り線なしで上下の余白を揃える', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: '投稿者' }).click();
  await page.locator('[data-slot="poster-card"]').first().click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  await expect(menu.getByRole('separator')).toHaveCount(0);
  const spacing = await menu.evaluate((element) => {
    const items = element.querySelectorAll('[role="menuitem"]');
    const bounds = element.getBoundingClientRect();
    return {
      top: items[0].getBoundingClientRect().top - bounds.top,
      bottom: bounds.bottom - items[items.length - 1].getBoundingClientRect().bottom,
    };
  });
  expect(spacing.top).toBeGreaterThan(0);
  expect(Math.abs(spacing.top - spacing.bottom)).toBeLessThanOrEqual(1);
});
