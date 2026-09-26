import path from 'node:path';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { expect, test } from '../lib/harness.ts';

test('ビューアーではインスペクタのサムネイルを隠し、一覧へ戻ると表示する', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const card = page.locator('[data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' });
  await card.click();
  const toggle = page.locator('[data-slot="inspector-toggle"]');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  const thumb = page.locator('[data-slot="inspector-thumb"]');
  await expect(thumb.first()).toBeVisible();
  await card.dblclick();
  await expect(page.locator('[data-slot="viewer-toolbar"]')).toBeVisible();
  await expect(page.locator('[data-slot="inspector-post"]')).toBeVisible();
  await expect(thumb).toHaveCount(0);
  await expect(page.locator('[data-slot="inspector-previews"]')).toHaveCount(0);
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(card).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('猫が机の上で寝ている');
  await expect(thumb.first()).toBeVisible();
});

test('画像送りは枚数を挟んで下部中央に固定する', async ({ launchHologram }) => {
  const { page } = await launchHologram({
    seed: ({ saveFolder }) => {
      const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));
      sqlite.prepare("INSERT INTO media(postId,seq,file,type,width,height) SELECT 'e2e-0003',1,file,type,width,height FROM media WHERE postId='e2e-0002' AND seq=0").run();
      sqlite.close();
    },
  });
  const card = page.locator('[data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' });
  await card.click();
  const toggle = page.locator('[data-slot="inspector-toggle"]');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  const previews = page.locator('[data-slot="inspector-previews"]');
  const previewCount = previews.locator('[aria-live="polite"]');
  const previewPrev = previews.locator('button').nth(1);
  const previewNext = previews.locator('button').nth(2);
  await expect(previewCount).toHaveText('1 / 2');
  const firstSrc = await previews.locator('img[aria-hidden="false"]').getAttribute('src');
  if (!firstSrc) throw new Error('サムネイルの画像がありません');
  await previewPrev.click();
  await expect(previewCount).toHaveText('2 / 2');
  await expect(previews.locator('img[aria-hidden="false"]')).not.toHaveAttribute('src', firstSrc);
  await previewNext.click();
  await expect(previewCount).toHaveText('1 / 2');
  await expect(previews.locator('img[aria-hidden="false"]')).toHaveAttribute('src', firstSrc);
  await previewNext.click();
  await expect(previewCount).toHaveText('2 / 2');
  await previewNext.click();
  await expect(previewCount).toHaveText('1 / 2');
  await card.dblclick();
  const nav = page.locator('[data-slot="image-tab-navigation"]');
  const counter = nav.locator('[aria-live="polite"]');
  const prev = nav.locator('[data-slot="image-tab-prev"]');
  const next = nav.locator('[data-slot="image-tab-next"]');
  await expect(counter).toHaveText('1 / 2');
  const before = await nav.boundingBox();
  const stage = await page.locator('[data-slot="image-tab-stage"]').boundingBox();
  const left = await prev.boundingBox();
  const right = await next.boundingBox();
  if (!before || !stage || !left || !right) throw new Error('画像送りが表示されていません');
  expect(before.x + before.width / 2).toBeCloseTo(stage.x + stage.width / 2, 0);
  expect(stage.y + stage.height - before.y - before.height).toBeCloseTo(16, 0);
  expect(left.x + left.width).toBeLessThan(right.x);
  await next.click();
  await expect(counter).toHaveText('2 / 2');
  expect(await nav.boundingBox()).toEqual(before);
  await prev.click();
  await expect(counter).toHaveText('1 / 2');
  expect(await nav.boundingBox()).toEqual(before);
});
