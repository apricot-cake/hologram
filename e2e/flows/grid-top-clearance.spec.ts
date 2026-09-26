import { expect, test } from '../lib/harness.ts';

test('一覧最上部のカードと選択枠がスクロール領域内に収まる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const card = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').first();
  await card.click();
  await expect(card).toHaveAttribute('data-selected', 'true');
  await page.locator('[data-slot="content-scroll"]').evaluate((el) => {
    el.scrollTop = 0;
  });
  const gap = await card.evaluate((el) => {
    const scroller = el.closest('[data-slot="content-scroll"]');
    if (!scroller) throw new Error('一覧のスクロール領域がありません');
    const css = getComputedStyle(el);
    return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - parseFloat(css.outlineWidth) - parseFloat(css.outlineOffset);
  });
  expect(gap).toBeGreaterThanOrEqual(4);
});
