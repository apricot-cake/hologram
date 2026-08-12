// 年月ジャンプは絞り込みではなく、日付順の一覧をその月までスクロールする入口。
// 実ポインタで開き、選んだあとに一覧が閉じて目的の見出しへ移ることを確認する。
import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS, type FixturePost } from '../lib/library.ts';

function postsAcrossMonths(): FixturePost[] {
  return [3, 2, 1].flatMap((month) =>
    FIXTURE_POSTS.map((post, index) => ({
      ...post,
      captureId: `date-jump-${month}-${index}`,
      date: `2026-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      capturedAt: `2026-${String(month).padStart(2, '0')}-${String(index + 2).padStart(2, '0')}T00:00:00.000Z`,
    })),
  );
}

test('年月ジャンプで選んだ月の先頭へ移動し、一覧を閉じる', async ({ launchHologram }) => {
  const { page } = await launchHologram({ posts: postsAcrossMonths() });
  const button = page.locator('[data-slot="date-jump-button"]');

  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('[data-slot="date-jump-item"]')).toHaveCount(3);

  const scrollBefore = await page.locator('[data-slot="content-scroll"]').evaluate((el) => el.scrollTop);
  await page.getByRole('button', { name: '2026年1月' }).click();
  // ジャンプは中間を滑らかに通らない。ここで動き始めるだけでは、通過した各範囲が
  // 仮想グリッドに描画され、遠い月ほど重くなる。
  await expect.poll(() => page.locator('[data-slot="content-scroll"]').evaluate((el) => el.scrollTop)).toBeGreaterThan(scrollBefore);
  await expect(page.locator('[data-slot="date-jump-item"]')).toHaveCount(0);
  await expect(page.getByText('2026年1月・4件')).toBeInViewport();
});
