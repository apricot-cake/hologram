import { expect, test } from '../lib/harness.ts';

test('カード右下の値がソートに連動し、補足は候補だけに表示される', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  for (const mode of ['ホーム', '投稿者']) {
    await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: mode }).press('Enter');
    await page.getByRole('button', { name: '表示', exact: true }).press('Enter');
    const select = page.locator('[data-slot="select-trigger"]');
    const slot = mode === 'ホーム' ? 'post-card-sort-value' : 'poster-card-sort-value';
    const options = mode === 'ホーム' ? ['投稿日', '保存日', '閲覧数', '閲覧日', 'いいね数', 'ランダム'] : ['閲覧数', '閲覧日', '投稿数', 'フォロワー数', '日付', '名前', 'ランダム'];
    for (const label of options) {
      await select.press('Space');
      const option = page.getByRole('option', { name: label, exact: true });
      if (label === 'いいね数' || label === 'フォロワー数') {
        await option.hover();
        await expect(page.locator('[data-slot="tooltip-content"][data-open]')).toContainText('サイト内での比較に基づく並び順');
      }
      await option.press('Enter');
      const values = page.locator(`[data-slot="${slot}"]`);
      if (label === 'ランダム' || label === '名前') {
        await expect(values).toHaveCount(0);
      } else {
        await expect(values.first()).toBeVisible();
        await expect(values.first()).not.toContainText('%');
        await expect(values.first()).not.toHaveAttribute('title');
        expect(await values.first().locator('[title]').count()).toBe(0);
        const aligned = await values.first().evaluate((el) => {
          const box = el.getBoundingClientRect();
          const parent = el.parentElement!.getBoundingClientRect();
          return Math.abs(parent.right - box.right) < 20;
        });
        expect(aligned).toBe(true);
      }
    }
    await page.getByRole('button', { name: '表示', exact: true }).press('Enter');
  }
});
