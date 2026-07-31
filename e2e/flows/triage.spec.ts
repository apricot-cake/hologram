// Fast triage mode (#46), end to end. The fixture library (e2e/lib/library.ts) has
// exactly one untagged, unfoldered post — e2e-0003 (猫が机の上で寝ている, tags: [])
// — so a fresh triage session always opens on a queue of exactly 1. The point of
// driving it here rather than only in scripts/triage-builder.test.ts is the same
// as tags.spec.ts's: what the pointer/keyboard put in is what a restarted app (or
// here, a straight DB read) reads back out.
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
  // The queue was exactly 1 item — tagging the only item exhausts it, so the stage
  // gives way to the "done" empty state rather than showing an empty queue.
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
