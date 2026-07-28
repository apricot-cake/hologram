// Search → narrowed grid. Typing into the toolbar's search field is the most-used
// filter, and it crosses three layers that a unit test sees separately: the input,
// the debounced query in the orchestrator, and the virtualized grid's rebuild.
import { expect, test } from '../lib/harness.ts';

test('検索語を打つとグリッドが絞り込まれ、消すと元に戻る', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const cards = page.locator('#postGrid .post-card');
  await expect(cards).toHaveCount(4);

  const search = page.getByPlaceholder('テキスト・ユーザー名で検索');
  await search.click();
  await search.fill('猫');

  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('猫が机の上で寝ている');

  // The suggestion popup opens over the grid while typing; Esc closes it without
  // clearing the query (the field keeps what was typed).
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('猫');

  await search.fill('');
  await expect(cards).toHaveCount(4);
});

test('投稿者名でも絞り込める', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const search = page.getByPlaceholder('テキスト・ユーザー名で検索');
  await search.click();
  await search.fill('akane_machi');

  const cards = page.locator('#postGrid .post-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('夕暮れの街並み');
});
