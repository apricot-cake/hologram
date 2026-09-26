import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

test('縦横比の5段階をOR選択し、再読み込み後も保持する', async ({ launchHologram }) => {
  const sizes = [
    [400, 600],
    [450, 500],
    [500, 500],
    [500, 450],
    [600, 400],
  ];
  const { page } = await launchHologram({ posts: sizes.map(([width, height], i) => ({ ...FIXTURE_POSTS[0], captureId: `ratio-${i}`, width, height })) });
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await expect(cards).toHaveCount(5);
  await page.getByRole('button', { name: 'フィルタ', exact: true }).click();
  await page.getByRole('menuitem', { name: '縦横比', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  const menu = page.getByRole('menu', { name: '縦横比', exact: true });
  await expect(menu.getByRole('menuitemcheckbox')).toHaveCount(5);
  await menu.getByRole('menuitemcheckbox', { name: /^縦長/ }).click();
  await expect(cards).toHaveCount(1);
  await menu.getByRole('menuitemcheckbox', { name: /^やや縦長/ }).click();
  await expect(cards).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(cards).toHaveCount(2);
  await page.locator('[data-slot=filter-values]').click();
  await expect(page.getByRole('menuitemcheckbox', { name: /^縦長/ })).toBeChecked();
  await expect(page.getByRole('menuitemcheckbox', { name: /^やや縦長/ })).toBeChecked();
});
