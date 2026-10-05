import fs from 'node:fs';
import path from 'node:path';
import { itemDirectoryAbsolute, itemDirectoryRelative } from '../../native-host/item-storage.mts';
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
  // 最初の問い合わせは Meilisearch の起動と SQLite からの索引構築も担う。カードの
  // 初期描画はその完了条件ではないので、検索 API 自身の応答で準備完了を確認する。
  const indexed = await page.evaluate(() => window.hologram.searchFullText('猫'));
  expect(indexed.map((hit) => hit.postId)).toContain('e2e-0003');
  await search.click();
  await search.pressSequentially('猫');
  await search.press('Enter');
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
  const captureId = 'e2e-0004';
  const mediaBefore = hologram.readDb((sqlite) => sqlite.prepare('SELECT file FROM media WHERE postId = ? ORDER BY seq').all(captureId)) as Array<{ file: string }>;
  expect(mediaBefore).toHaveLength(1);
  const mediaFile = mediaBefore[0].file;
  const liveItemDir = itemDirectoryAbsolute(hologram.saveFolder, captureId);
  const liveMedia = path.join(hologram.saveFolder, ...mediaFile.split('/'));
  const trashItemDir = path.join(hologram.saveFolder, '.trash', path.basename(itemDirectoryRelative(captureId)));
  const trashedMedia = path.join(trashItemDir, path.basename(mediaFile));
  expect(fs.existsSync(liveItemDir)).toBe(true);
  expect(fs.existsSync(liveMedia)).toBe(true);

  await cards.filter({ hasText: '手描きのラフスケッチ' }).click();
  await cards.filter({ hasText: '手描きのラフスケッチ' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '削除', exact: true }).click();
  const confirm = page.locator('[data-slot="alert-dialog-content"]');
  await confirm.getByRole('button', { name: '削除する' }).click();
  await expect(cards).toHaveCount(FIXTURE_POSTS.length - 1);
  expect(hologram.readDb((sqlite) => sqlite.prepare('SELECT captureId FROM posts WHERE captureId = ?').get(captureId))).toBeUndefined();
  expect(hologram.readDb((sqlite) => sqlite.prepare('SELECT file FROM media WHERE postId = ?').all(captureId))).toEqual([]);
  expect(fs.existsSync(liveMedia)).toBe(false);
  expect(fs.existsSync(trashedMedia)).toBe(true);

  await sidebar.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
  const trashCards = page.locator('[data-slot="trash-grid"] [data-slot="post-card"]');
  await expect(trashCards).toHaveCount(1);
  await trashCards.first().click();
  await page.getByRole('button', { name: '復元', exact: true }).click();
  await expect(trashCards).toHaveCount(0);

  await sidebar.getByRole('button', { name: 'ホーム', exact: true }).click();
  await expect(cards).toHaveCount(FIXTURE_POSTS.length);
  await expect.poll(() => hologram.readDb((sqlite) => sqlite.prepare('SELECT captureId FROM posts WHERE captureId = ?').get(captureId))).toEqual({ captureId });
  expect(hologram.readDb((sqlite) => sqlite.prepare('SELECT file FROM media WHERE postId = ? ORDER BY seq').all(captureId))).toEqual(mediaBefore);
  expect(fs.existsSync(liveMedia)).toBe(true);
  expect(fs.existsSync(trashedMedia)).toBe(false);
});
