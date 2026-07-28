// Inline tag editing in the inspector (redesign P2⑦) all the way to the database.
// The point of driving it here rather than in the SMOKE harness is the round trip:
// what the pointer and keyboard put into the field is what a restarted app reads
// back out of SQLite.
import { expect, test } from '../lib/harness.ts';

test('インスペクタでタグを足すとチップになり DB に保存される', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;

  await page.locator('#postGrid .post-card').filter({ hasText: '猫が机の上で寝ている' }).click();
  const tags = page.locator('[data-slot="inspector-tags"]');
  await expect(tags).toBeVisible();

  await tags.locator('[data-slot="tag-input"]').click();
  await page.keyboard.type('ねこ');
  await page.keyboard.press('Enter');

  await expect(tags.locator('[data-slot="tag-chip"]').filter({ hasText: 'ねこ' })).toHaveCount(1);

  // Persistence, read straight from the app's own database rather than from the
  // screen that just claimed it.
  await expect.poll(() => hologram.tagsOf('e2e-0003')).toEqual(['ねこ']);
});

test('タグのチップから削除すると DB からも消える', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;

  await page.locator('#postGrid .post-card').filter({ hasText: '青い空と海の写真です' }).click();
  const tags = page.locator('[data-slot="inspector-tags"]');
  const chip = tags.locator('[data-slot="tag-chip"]').filter({ hasText: '青' });
  await expect(chip).toHaveCount(1);

  await chip.getByRole('button').click();

  await expect(tags.locator('[data-slot="tag-chip"]').filter({ hasText: '青' })).toHaveCount(0);
  await expect.poll(() => hologram.tagsOf('e2e-0001')).toEqual(['風景']);
});
