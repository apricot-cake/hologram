import { expect, test } from '../lib/harness.ts';

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test('インスペクタ（投稿の詳細）', async ({ launchHologram }) => {
      const { page } = await launchHologram({ theme });
      await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '青い空と海の写真です' }).click();
      const inspector = page.locator('[data-slot="inspector-post"]');
      await expect(inspector).toBeVisible();
      await expect(inspector).toHaveScreenshot(`inspector-post-${theme}.png`);
    });

    test('設定ダイアログ（外観）', async ({ launchHologram }) => {
      const { page } = await launchHologram({ theme });
      // idではなくroleで: 歯車は今はサイドバーのフッター行（#153が最後の
      // #settingsBtnのリスナーを取り除き、#6がその要素のidも一緒に持って
      // いった）。
      await page.getByRole('button', { name: '設定', exact: true }).click();
      const dialog = page.locator('[data-slot="dialog-content"]');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveScreenshot(`settings-appearance-${theme}.png`);
    });

    test('削除の確認ダイアログ', async ({ launchHologram }) => {
      const { page } = await launchHologram({ theme });
      await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '青い空と海の写真です' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: '削除', exact: true }).click();
      const confirm = page.locator('[data-slot="alert-dialog-content"]');
      await expect(confirm).toBeVisible();
      await expect(confirm).toHaveScreenshot(`confirm-delete-${theme}.png`);
    });
  });
}
