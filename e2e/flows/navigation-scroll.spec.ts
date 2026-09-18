import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

test('スクロールしてビューアを開き戻ると元の位置を復元する', async ({ launchHologram }) => {
  const posts = Array.from({ length: 40 }, (_, i) => ({ ...FIXTURE_POSTS[0], captureId: `viewer-scroll-${i}` }));
  const { page } = await launchHologram({ posts });
  const scroller = page.locator('[data-slot="content-scroll"]');
  await scroller.evaluate((el) => {
    el.scrollTop = 600;
  });
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(600);
  const bounds = await scroller.boundingBox();
  if (!bounds) throw new Error('投稿一覧が表示されていません');
  const previousTop = await scroller.evaluate((el) => el.scrollTop);
  expect(previousTop).toBeGreaterThan(0);
  await page.mouse.dblclick(bounds.x + 100, bounds.y + 120);
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(scroller).toBeVisible();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(previousTop);
  await page.getByRole('button', { name: '進む', exact: true }).click();
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(previousTop);
});

test('投稿者へ移動して戻ると投稿一覧のスクロール位置を復元する', async ({ launchHologram }) => {
  const posts = Array.from({ length: 40 }, (_, i) => ({ ...FIXTURE_POSTS[0], captureId: `scroll-${i}`, screenName: `author_${i}`, displayName: `投稿者${i}` }));
  const { page } = await launchHologram({ posts });
  const scroller = page.locator('[data-slot="content-scroll"]');
  const scrollTop = () => scroller.evaluate((el) => el.scrollTop);
  await page.locator('[data-slot="post-card"]').first().click();
  await expect(page.locator('[data-slot="inspector-author-link"]')).toBeVisible();
  await scroller.evaluate((el) => {
    el.scrollTop = 600;
  });
  await expect.poll(scrollTop).toBe(600);
  await page.locator('[data-slot="inspector-author-link"]').click();
  await expect(page.locator('[data-slot="poster-grid"]')).toBeVisible();
  await scroller.evaluate((el) => {
    el.scrollTop = 1800;
  });
  await expect.poll(scrollTop).toBe(1800);
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(page.locator('[data-slot="post-grid"]')).toBeVisible();
  await expect.poll(scrollTop).toBe(600);
  await page.getByRole('button', { name: '進む', exact: true }).click();
  await expect(page.locator('[data-slot="poster-grid"]')).toBeVisible();
  await expect.poll(scrollTop).toBe(1800);
});
