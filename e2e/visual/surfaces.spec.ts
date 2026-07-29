// Visual regression baselines — the first, deliberately narrow set (#14).
//
// WHY THESE THREE. The redesign (#154) is still open, and its remaining children
// churn the shell: the filter-chip band gets inline input (#148), the command
// palette does not exist yet (#28), View Transitions pick their surfaces (#252),
// and the Tailwind migration (#6) is still moving CSS around. Baselines taken over
// the shell would be replaced faster than they could catch anything. What is
// settled is the panel-and-dialog layer — the inspector's inline tag editing
// (P2⑦), the settings dialog, and the confirm dialog are all shadcn/Base UI parts
// with no open child issue against them.
//
// The shots are ELEMENT-scoped for the same reason: a page shot of any of these
// includes the toolbar and the chip row behind it, and would go red on the first
// #148 commit. The set widens once #154 lands (Issue #14, 2026-07-25).
//
// The baselines are LOCAL (#14, 2026-07-29): taken on the development machine,
// committed, and never run in CI. e2e/README.md holds the reasoning and the
// update command.
import { expect, test } from '../lib/harness.ts';

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test('インスペクタ（投稿の詳細）', async ({ launchHologram }) => {
      const { page } = await launchHologram({ theme });
      await page.locator('#postGrid .post-card').filter({ hasText: '青い空と海の写真です' }).click();
      const inspector = page.locator('[data-slot="inspector-post"]');
      await expect(inspector).toBeVisible();
      await expect(inspector).toHaveScreenshot(`inspector-post-${theme}.png`);
    });

    test('設定ダイアログ（外観）', async ({ launchHologram }) => {
      const { page } = await launchHologram({ theme });
      await page.locator('#settingsBtn').click();
      const dialog = page.locator('[data-slot="dialog-content"]');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveScreenshot(`settings-appearance-${theme}.png`);
    });

    test('削除の確認ダイアログ', async ({ launchHologram }) => {
      const { page } = await launchHologram({ theme });
      await page.locator('#postGrid .post-card').filter({ hasText: '青い空と海の写真です' }).click();
      await page.getByRole('button', { name: '削除' }).click();
      const confirm = page.locator('[data-slot="alert-dialog-content"]');
      await expect(confirm).toBeVisible();
      await expect(confirm).toHaveScreenshot(`confirm-delete-${theme}.png`);
    });
  });
}
