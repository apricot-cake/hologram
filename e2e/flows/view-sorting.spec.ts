import { expect, test } from '../lib/harness.ts';

test('ホームと投稿者で閲覧数の補足を表示し、閲覧日を独立して選べる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.locator('[data-slot="post-card"]').first().click();
  await expect.poll(async () => page.evaluate(async () => (await window.hologram.listPosts()).posts.some((p) => !!p.lastViewedAt))).toBe(true);
  const before = await page.evaluate(async () => (await window.hologram.listPosts()).posts.reduce((sum, p) => sum + p.localViewCount, 0));
  for (const mode of ['ホーム', '投稿者']) {
    await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: mode }).press('Enter');
    await page.getByRole('button', { name: '表示', exact: true }).press('Enter');
    const select = page.locator('[data-slot="select-trigger"]');
    await select.press('Space');
    const views = page.getByRole('option', { name: '閲覧数', exact: true });
    const hintText = 'アプリ内で投稿を見た回数';
    const hint = page.locator('[data-slot="tooltip-content"][data-open]').filter({ hasText: hintText });
    await expect(views).not.toHaveAttribute('title');
    await views.hover();
    await expect(hint).toBeVisible();
    await views.press('Enter');
    await expect(select).toContainText('閲覧数');
    if (mode === 'ホーム') {
      const viewsStat = page.locator('[data-stat="localViews"]').first();
      await expect(viewsStat.locator('svg.lucide-eye')).toBeVisible();
      await expect(viewsStat).not.toContainText('👁');
    }
    await select.hover();
    await page.waitForTimeout(500);
    await expect(hint).toHaveCount(0);
    await expect(select).not.toHaveAttribute('title');
    await select.press('Space');
    await page.getByRole('option', { name: '閲覧日', exact: true }).press('Enter');
    await expect(select).toContainText('閲覧日');
    await expect(page.locator('[data-slot="sort-direction"]')).toHaveText('新しい順');
    await page.locator('[data-slot="sort-direction"]').press('Enter');
    await expect(page.locator('[data-slot="sort-direction"]')).toHaveText('古い順');
    await page.getByRole('button', { name: '表示', exact: true }).press('Enter');
    await expect(select).toHaveCount(0);
  }
  await page.locator('[data-slot="poster-card"]').first().click();
  const after = await page.evaluate(async () => (await window.hologram.listPosts()).posts.reduce((sum, p) => sum + p.localViewCount, 0));
  expect(after).toBe(before);
});
