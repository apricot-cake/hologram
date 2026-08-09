// 高速トリアージモード（#46）を、エンドツーエンドで検証する。フィクスチャ
// ライブラリ（e2e/lib/library.ts）はタグ無し・フォルダ無しの投稿をちょうど
// 1件持つ — e2e-0003（猫が机の上で寝ている、tags: []）— なので、新しい
// トリアージセッションは常にちょうど1件のキューで開く。scripts/triage-
// builder.test.ts だけでなくここでも駆動する理由は tags.spec.ts と同じ:
// ポインタ/キーボードで入れたものが、再起動したアプリ（あるいはここでは
// 素の DB 読み取り）から同じものとして読み出せるか。
import { expect, test } from '../lib/harness.ts';

test('タグを入力してEnterで片付けると DB に保存され、キューが空になる', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;

  await page.locator('[data-slot="triage-toolbar-button"]').click();
  const stage = page.locator('[data-slot="triage-stage"]');
  await expect(stage).toBeVisible();
  await expect(page.locator('[data-slot="triage-progress"]')).toHaveText('1 / 1');

  await stage.getByPlaceholder('タグを入力してEnter').fill('ねこ');
  await page.keyboard.press('Enter');

  await expect.poll(() => hologram.tagsOf('e2e-0003')).toEqual(['ねこ']);
  // キューはちょうど1件だった — 唯一のアイテムにタグを付けると使い果たされる
  // ので、ステージは空のキューを見せるのではなく「完了」の空状態へ道を譲る。
  await expect(stage).toHaveCount(0);
  await expect(page.getByText('お疲れさまでした')).toBeVisible();
});

test('Backspace は直前のタグ付けをデータごと取り消し、キューを1件戻す', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;

  await page.locator('[data-slot="triage-toolbar-button"]').click();
  const stage = page.locator('[data-slot="triage-stage"]');
  await stage.getByPlaceholder('タグを入力してEnter').fill('ねこ');
  await page.keyboard.press('Enter');
  await expect.poll(() => hologram.tagsOf('e2e-0003')).toEqual(['ねこ']);

  await page.keyboard.press('Backspace');

  await expect(page.locator('[data-slot="triage-stage"]')).toBeVisible();
  await expect(page.locator('[data-slot="triage-progress"]')).toHaveText('1 / 1');
  await expect.poll(() => hologram.tagsOf('e2e-0003')).toEqual([]);
});

test('スキップはデータを変えずに閉じられる（受信箱ゼロの投稿を巻き込まない）', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;

  await page.locator('[data-slot="triage-toolbar-button"]').click();
  await page.getByRole('button', { name: /スキップ/ }).click();

  await expect(page.getByText('お疲れさまでした')).toBeVisible();
  await expect.poll(() => hologram.tagsOf('e2e-0003')).toEqual([]);
});
