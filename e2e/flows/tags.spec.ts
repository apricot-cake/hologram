// インスペクタでのタグのインライン編集（刷新 P2⑦）をDBまで通しで検証する。
// SMOKEハーネスではなくここで駆動する理由は往復にある＝ポインタとキーボードで
// 欄に入れた値が、アプリを再起動した後にSQLiteから読み出した値と一致することを確かめる。
import { expect, test } from '../lib/harness.ts';

test('インスペクタでタグを足すとチップになり DB に保存される', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;

  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).click();
  const tags = page.locator('[data-slot="inspector-tags"]');
  await expect(tags).toBeVisible();

  await tags.locator('[data-slot="tag-input"]').click();
  await page.keyboard.type('ねこ');
  await page.keyboard.press('Enter');

  await expect(tags.locator('[data-slot="tag-chip"]').filter({ hasText: 'ねこ' })).toHaveCount(1);

  // 永続化を検証する。いま操作した画面ではなく、アプリ自身のデータベースから直接読み出す。
  await expect.poll(() => hologram.tagsOf('e2e-0003')).toEqual(['ねこ']);
});

test('タグのチップから削除すると DB からも消える', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;

  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '青い空と海の写真です' }).click();
  const tags = page.locator('[data-slot="inspector-tags"]');
  const chip = tags.locator('[data-slot="tag-chip"]').filter({ hasText: '青' });
  await expect(chip).toHaveCount(1);

  await chip.getByRole('button').click();

  await expect(tags.locator('[data-slot="tag-chip"]').filter({ hasText: '青' })).toHaveCount(0);
  await expect.poll(() => hologram.tagsOf('e2e-0001')).toEqual(['風景']);
});
