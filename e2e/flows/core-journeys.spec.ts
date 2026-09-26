import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

test('既存アルバムは表示でき、取り込み後の作成・解除操作は出ない', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.evaluate(() => window.hologram.setManualGroups([['e2e-0001', 'e2e-0002']]));
  await page.reload();
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await expect(cards).toHaveCount(FIXTURE_POSTS.length - 1);
  await cards.filter({ hasText: '青い空と海の写真です' }).click();
  const inspector = page.locator('[data-slot="inspector"]');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('button', { name: /アルバムを解除|グループを解除|グループ表示に戻す/ })).toHaveCount(0);
  await cards.filter({ hasText: '猫が机の上で寝ている' }).click({ modifiers: ['Control'] });
  const bar = page.locator('[data-slot="selection-bar"]');
  await expect(bar).toHaveAttribute('aria-hidden', 'false');
  await expect(bar.getByRole('button', { name: /アルバムを作成|グループ化/ })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'タグを追加', exact: true })).toBeVisible();
});

test('起動後に検索して投稿を開き、タグを保存できる', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');

  await expect(cards).toHaveCount(FIXTURE_POSTS.length);
  const search = page.getByRole('combobox', { name: 'ライブラリ内を検索', exact: true });
  await search.fill('猫');
  await expect(cards).toHaveCount(1);

  await cards.first().click();
  const inspector = page.locator('[data-slot="inspector"]');
  await expect(inspector).toContainText('猫沢みけ');
  await inspector.getByRole('tab', { name: 'タグ', exact: true }).click();
  const tags = inspector.locator('[data-slot="inspector-tags"]');
  await tags.locator('[data-slot="tag-input"]').fill('ねこ');
  await page.keyboard.press('Enter');
  await expect(tags.locator('[data-slot="tag-chip"]', { hasText: 'ねこ' })).toBeVisible();
  await expect.poll(() => hologram.tagsOf('e2e-0003')).toEqual(['ねこ']);
});

test('選択した投稿をゴミ箱へ送り、復元してライブラリへ戻せる', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  const sidebar = page.locator('[data-slot="sidebar"]').first();

  await cards.filter({ hasText: '手描きのラフスケッチ' }).click();
  await cards.filter({ hasText: '手描きのラフスケッチ' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '削除', exact: true }).click();
  const confirm = page.locator('[data-slot="alert-dialog-content"]');
  await confirm.getByRole('button', { name: '削除する' }).click();
  await expect(cards).toHaveCount(FIXTURE_POSTS.length - 1);
  expect(fs.existsSync(path.join(hologram.saveFolder, '.trash', 'e2e-0004', 'e2e-0004.png'))).toBe(true);

  await sidebar.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
  const trashCards = page.locator('[data-slot="trash-grid"] [data-slot="post-card"]');
  await expect(trashCards).toHaveCount(1);
  await trashCards.first().click();
  await page.getByRole('button', { name: '復元', exact: true }).click();
  await expect(trashCards).toHaveCount(0);

  await sidebar.getByRole('button', { name: 'ホーム', exact: true }).click();
  await expect(cards).toHaveCount(FIXTURE_POSTS.length);
  await expect.poll(() => hologram.readDb((sqlite) => sqlite.prepare('SELECT captureId FROM posts WHERE captureId = ?').get('e2e-0004'))).toEqual({ captureId: 'e2e-0004' });
});
