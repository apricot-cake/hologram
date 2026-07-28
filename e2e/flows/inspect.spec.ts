// The unified click model (#143) driven by a REAL pointer: single click selects
// and fills the inspector, double click opens the image view. scripts/test-app-
// click-model.cts asserts the same contract with synthetic MouseEvents — it
// cannot see a card covered by an overlay, a dead pointer-events region, or a
// hit target that moved. This can.
import { expect, test } from '../lib/harness.ts';

test('カードをクリックすると選択されインスペクタに内容が出る', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const card = page.locator('#postGrid .post-card').filter({ hasText: '猫が机の上で寝ている' });
  await card.click();

  await expect(card).toHaveClass(/\bselected\b/);
  const inspector = page.locator('[data-slot="inspector-post"]');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('猫沢みけ');
  await expect(inspector).toContainText('BLUESKY');
  // Dates are absolute and rendered in the harness's pinned timezone.
  await expect(inspector).toContainText('2026/3/5');
});

test('別のカードをクリックすると選択が入れ替わる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const first = page.locator('#postGrid .post-card').filter({ hasText: '猫が机の上で寝ている' });
  const second = page.locator('#postGrid .post-card').filter({ hasText: '夕暮れの街並み' });

  await first.click();
  await expect(first).toHaveClass(/\bselected\b/);
  await second.click();

  await expect(page.locator('#postGrid .post-card.selected')).toHaveCount(1);
  await expect(second).toHaveClass(/\bselected\b/);
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('街田あかね');
});

test('カードをダブルクリックすると画像ビューが開く', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.locator('#postGrid .post-card').filter({ hasText: '猫が机の上で寝ている' }).dblclick();

  await expect(page.locator('body')).toHaveClass(/image-tab-active/);
  await expect(page.locator('#imageTabView')).toBeVisible();
});
