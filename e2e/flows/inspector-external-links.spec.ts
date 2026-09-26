import { expect, test } from '../lib/harness.ts';

test('投稿URLと投稿者のユーザー名に外部リンクアイコンを表示する', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').first().click();
  const postLink = page.getByRole('link', { name: '元投稿を開く', exact: true });
  await expect(postLink.locator('svg.lucide-external-link')).toBeVisible();
  await expect(postLink.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: '投稿者' }).click();
  await page.locator('[data-slot="poster-card"]').first().click();
  const profileLink = page.getByRole('link', { name: '元のプロフィールを開く', exact: true });
  await expect(profileLink.locator('svg.lucide-external-link')).toBeVisible();
});
