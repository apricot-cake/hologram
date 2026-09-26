import { expect, test } from '../lib/harness.ts';

test('標準チップを共通チップに置き換え、操作を保つ', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const hint = (text: string) => page.locator('[data-slot="tooltip-content"][data-open]').filter({ hasText: text });
  await page.getByRole('button', { name: '表示', exact: true }).press('Enter');
  await page.locator('[data-slot="select-trigger"]').press('Space');
  await page.getByRole('option', { name: 'ランダム', exact: true }).press('Enter');
  const shuffle = page.getByRole('button', { name: 'シャッフルし直す', exact: true });
  await expect(shuffle).not.toHaveAttribute('title');
  await shuffle.hover();
  await expect(hint('シャッフルし直す')).toBeVisible();
  await shuffle.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(hint('シャッフルし直す')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hint('シャッフルし直す')).toHaveCount(0);
  if (await page.locator('[data-slot="select-trigger"]').count()) await page.getByRole('button', { name: '表示', exact: true }).press('Enter');

  const rail = page.locator('[data-slot="inspector-rail"]:visible');
  await rail.hover();
  await expect(hint('インスペクタの幅を変更')).toBeVisible();
  const width = Number(await rail.getAttribute('aria-valuenow'));
  await rail.press('ArrowLeft');
  await expect(rail).not.toHaveAttribute('aria-valuenow', String(width));

  await page.getByRole('button', { name: '履歴', exact: true }).press('Enter');
  const clear = page.getByRole('button', { name: 'すべて消去', exact: true });
  await clear.hover();
  await expect(hint('すべて消去')).toBeVisible();
  await expect(page.locator('[title]:visible')).toHaveCount(0);
  await page.getByRole('button', { name: '履歴', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'フォルダ', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'フォルダを作成', exact: true }).hover();
  await expect(hint('フォルダを作成')).toBeVisible();
});
