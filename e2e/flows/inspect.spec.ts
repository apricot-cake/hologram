// The unified click model (#143) driven by a REAL pointer: single click selects
// and fills the inspector, double click opens the image view. scripts/test-app-
// click-model.cts asserts the same contract with synthetic MouseEvents — it
// cannot see a card covered by an overlay, a dead pointer-events region, or a
// hit target that moved. This can.
import { expect, test } from '../lib/harness.ts';

test('カードをクリックすると選択されインスペクタに内容が出る', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const card = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' });
  await card.click();

  await expect(card).toHaveAttribute('data-selected', 'true');
  const inspector = page.locator('[data-slot="inspector-post"]');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('猫沢みけ');
  await expect(inspector).toContainText('BLUESKY');
  // Dates are absolute and rendered in the harness's pinned timezone.
  await expect(inspector).toContainText('2026/3/5');
});

test('別のカードをクリックすると選択が入れ替わる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const first = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' });
  const second = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '夕暮れの街並み' });

  await first.click();
  await expect(first).toHaveAttribute('data-selected', 'true');
  await second.click();

  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"][data-selected]')).toHaveCount(1);
  await expect(second).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('街田あかね');
});

test('カードをダブルクリックすると画像ビューが開く', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).dblclick();

  // What the user sees, not how it is wired: the media stage is up and the browse
  // column is gone. Both used to be asserted through `body.image-tab-active`, which
  // is exactly the "test pins the mechanism" shape #153 ② is about — the class does
  // not exist any more, and this test did not have to change its meaning to say so.
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  await expect(page.locator('[data-slot="content-scroll"]')).toBeHidden();
});

// #633. The panel holds a SNAPSHOT of what was inspected, so a subject that stops
// existing has to be noticed from the library side — otherwise the picture is gone
// and the detail of it is still there, with a live tag editor writing to a record
// that no longer exists. The grid cases go through the floating bar, which is the
// delete a selection can actually reach.
async function deleteSelectionViaBar(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '削除' }).click();
  const confirm = page.locator('[data-slot="alert-dialog-content"]');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '削除する' }).click();
}

test('画像ビューを開いたまま別タブで削除するとステージもインスペクタも投稿を手放す', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  // A double click both selects the card and opens the image view.
  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).dblclick();
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('猫沢みけ');

  // #656 took the floating bar off the image view (the stage cannot show WHICH cards a
  // bulk action would hit), so the delete this case needs no longer starts here — asserted
  // rather than assumed, because that change is exactly what silently turned this test red:
  // it kept clicking a bar that had stopped being reachable.
  await expect(page.locator('[data-slot="selection-bar"]')).toHaveAttribute('aria-hidden', 'true');

  // A second tab is the route that stays open: same library, its own grid and its own
  // selection, and the image view keeps holding the post it was opened on.
  await page.locator('[data-slot="tab-new"]').click();
  const grid = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await expect(grid).toHaveCount(4);
  await grid.filter({ hasText: '猫が机の上で寝ている' }).click();
  await deleteSelectionViaBar(page);
  await expect(grid).toHaveCount(3);

  await page.locator('[data-slot="tab"]').first().click();
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  // The stage says the post is gone…
  await expect(page.getByText('この画像はライブラリにありません')).toBeVisible();
  // …and the right column must not keep answering for it. No post detail, no tag
  // field to type into — the panel falls back to its own no-selection state.
  await expect(page.locator('[data-slot="inspector-post"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="inspector-empty"]')).toBeVisible();
});

test('グリッドで選択中の投稿を削除するとインスペクタが空になる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const card = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '夕暮れの街並み' });
  await card.click();
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('街田あかね');

  await deleteSelectionViaBar(page);

  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"]')).toHaveCount(3);
  await expect(page.locator('[data-slot="inspector-post"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="inspector-empty"]')).toBeVisible();
});

test('カードメニューから削除してもインスペクタが空になる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const card = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '青い空と海の写真' });
  // The card menu is the route that stands DOWN for a selection (the floating bar owns
  // bulk actions then), so this whole case has to stay selection-free: "Details" fills the
  // panel without selecting, exactly as the menu's own "Delete" will delete without one.
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '詳細' }).click();
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('海野そら');

  // The second route into deletion. It used to dismiss the panel by itself, which is
  // exactly why the other routes did not — the check moved to one place (#633), so this
  // case is what proves the move did not lose the behaviour it replaced.
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '削除' }).click();
  const confirm = page.locator('[data-slot="alert-dialog-content"]');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '削除する' }).click();

  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"]')).toHaveCount(3);
  await expect(page.locator('[data-slot="inspector-post"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="inspector-empty"]')).toBeVisible();
});
