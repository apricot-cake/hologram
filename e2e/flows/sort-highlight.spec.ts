import { expect, test } from '../lib/harness.ts';

test('ソート候補をマウスとキーボードで強調する', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  for (const mode of ['ホーム', '投稿者']) {
    await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: mode }).press('Enter');
    await page.getByRole('button', { name: '表示', exact: true }).press('Enter');
    const trigger = page.locator('[data-slot="select-trigger"]');
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    const normal = await trigger.evaluate((e) => getComputedStyle(e).backgroundColor);
    await trigger.hover();
    await page.waitForTimeout(200);
    expect(await trigger.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(normal);
    await trigger.press('Space');
    const views = page.getByRole('option', { name: '閲覧数', exact: true });
    const date = page.getByRole('option', { name: '閲覧日', exact: true });
    await views.hover();
    await expect(views).toHaveAttribute('data-highlighted');
    const inset = await views.evaluate((e) => {
      const item = e.getBoundingClientRect();
      const popup = e.closest('[data-slot="select-content"]')!.getBoundingClientRect();
      return { left: item.left - popup.left, right: popup.right - item.right };
    });
    expect(inset.left).toBeGreaterThanOrEqual(4);
    expect(inset.right).toBeGreaterThanOrEqual(4);
    const background = await views.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
    await views.press('ArrowDown');
    await expect(date).toHaveAttribute('data-highlighted');
    await expect(views).not.toHaveAttribute('data-highlighted');
    expect(await date.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(background);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '表示', exact: true }).press('Enter');
  }
});
