// ビジュアルregressionの基準＝最初の、意図的に狭い集合（#14）。
//
// なぜこの3つか。リデザイン（#154）はまだ開いていて、その残っている子issue群が
// シェルをかき回している: フィルタチップの帯はインライン入力を得る（#148）、
// コマンドパレットはまだ存在しない（#28）、View Transitionsは自分の面を選ぶ
// （#252）、そしてTailwind移行（#6）はまだCSSを動かしている。シェルに対して
// 取った基準は、何かを捉えられるより早く置き換えられてしまう。確定している
// のはパネルとダイアログの層＝インスペクタのインラインタグ編集（P2⑦）、設定
// ダイアログ、確認ダイアログはどれもshadcn/Base UIの部品で、それらに対する
// 未解決の子issueは無い。
//
// 同じ理由で撮影は要素スコープにしている: これらのどれであれページ全体の
// 撮影には背後のツールバーとチップの行が含まれてしまい、最初の#148のコミットで
// 赤くなる。#154が入ったら集合は広がる（Issue #14、2026-07-25）。
//
// 基準はローカル限定（#14、2026-07-29）: 開発機で取り、コミットし、CIでは
// 決して走らせない。理由と更新コマンドはe2e/README.mdにある。
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
      await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '青い空と海の写真です' }).click();
      await page.getByRole('button', { name: '削除' }).click();
      const confirm = page.locator('[data-slot="alert-dialog-content"]');
      await expect(confirm).toBeVisible();
      await expect(confirm).toHaveScreenshot(`confirm-delete-${theme}.png`);
    });
  });
}
