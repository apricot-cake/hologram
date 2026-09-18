import path from 'node:path';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { expect, test } from '../lib/harness.ts';

test('ホバーで階層を開き、タグを即時選択してチェックを維持する', async ({ launchHologram }) => {
  const { page } = await launchHologram({
    seed({ saveFolder }) {
      const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));
      try {
        sqlite.prepare('INSERT OR REPLACE INTO store_state (key, value) VALUES (?, ?)').run('tagGroupLabels', JSON.stringify({ scene: '景色', style: '形式' }));
        sqlite.prepare('UPDATE tags SET groupId = ? WHERE name = ?').run('scene', '風景');
        sqlite.prepare('UPDATE tags SET groupId = ? WHERE name = ?').run('style', 'ラフ');
      } finally {
        sqlite.close();
      }
    },
  });
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await page.getByRole('button', { name: 'フィルタ', exact: true }).click();
  await page.getByRole('menuitem', { name: 'タグ', exact: true }).hover();
  await page.getByRole('menuitem', { name: '景色', exact: true }).hover();
  const item = page.getByRole('menuitemcheckbox', { name: /風景/ });
  const box = item.locator('[data-slot="filter-check"]');
  await expect(item).toBeVisible();
  await expect(box).toHaveCSS('opacity', '0');
  await item.hover();
  await expect(box).toHaveCSS('opacity', '1');
  await item.click();
  await expect(item).toBeChecked();
  await expect(cards).toHaveCount(2);
  await expect(box).toHaveCSS('width', '14px');
  await page.getByRole('menu', { name: '景色', exact: true }).getByRole('searchbox').click();
  await expect(box).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await page.getByRole('searchbox', { name: 'すべてのグループからタグを検索' }).fill('ラフ');
  await page.getByRole('menuitemcheckbox', { name: /ラフ/ }).click();
  await expect(cards).toHaveCount(0);
  await expect(page.locator('[data-slot=filter-operator]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-slot="filter-values"]').click();
  await page.getByRole('searchbox', { name: 'すべてのグループからタグを検索' }).fill('風景');
  await expect(page.getByRole('menuitemcheckbox', { name: /風景/ })).toBeChecked();
  await expect(page.getByRole('menuitem', { name: '選択を解除', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-slot=filter-chip]').getByRole('button', { name: '削除', exact: true }).click();
  await expect(cards).toHaveCount(4);
});

test('投稿者検索、日付の階層、全解除を操作できる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await page.getByRole('button', { name: 'フィルタ', exact: true }).click();
  await page.getByRole('menuitem', { name: '投稿者', exact: true }).hover();
  await page.getByRole('searchbox', { name: '投稿者を検索' }).fill('@sora_umi');
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(1);
  await page.getByRole('menuitemcheckbox').click();
  await expect(cards).toHaveCount(1);
  await page.getByRole('menuitem', { name: 'すべて解除', exact: true }).click();
  await expect(cards).toHaveCount(4);
  await page.getByRole('menuitem', { name: '日付', exact: true }).hover();
  await page.getByRole('menuitem', { name: '投稿日', exact: true }).hover();
  await page.getByLabel('開始日', { exact: true }).fill('2026-03-03');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await expect(cards).toHaveCount(3);
  await page.getByRole('menuitem', { name: 'すべて解除', exact: true }).click();
  await expect(cards).toHaveCount(4);
});

test('狭い画面とキーボードでもサブメニューを開いて選択できる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.setViewportSize({ width: 460, height: 700 });
  await page.getByRole('button', { name: 'フィルタ', exact: true }).click();
  const trigger = page.getByRole('menuitem', { name: 'メディア', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowRight');
  const item = page.getByRole('menuitemcheckbox', { name: /画像/ }).first();
  await expect(item).toBeVisible();
  await item.focus();
  await expect(item.locator('[data-slot="filter-check"]')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Space');
  await expect(item).toBeChecked();
  const menu = page.getByRole('menu', { name: 'メディア', exact: true });
  const bounds = await menu.boundingBox();
  if (!bounds) throw new Error('メニューが表示されていません');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(460);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('投稿者のメニューに切り替え、サイトを選んでフォロワー条件を開ける', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.getByRole('button', { name: 'フィルタ', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '反応数', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-sidebar="menu-button"]').filter({ hasText: '投稿者' }).click();
  await page.getByRole('button', { name: 'フィルタ', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '反応数', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'プラットフォーム', exact: true }).hover();
  await page.getByRole('menuitemcheckbox', { name: /^X/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('menuitem', { name: 'フォロワー', exact: true }).hover();
  await page.getByRole('spinbutton', { name: '数値', exact: true }).fill('0');
  await expect(page.getByRole('button', { name: '適用', exact: true })).toBeEnabled();
});

test('大量の投稿者を分割表示し、全件から検索・選択できる', async ({ launchHologram }) => {
  const { FIXTURE_POSTS } = await import('../lib/library.ts');
  const posts = Array.from({ length: 125 }, (_, i) => ({ ...FIXTURE_POSTS[0], captureId: `many-${i}`, displayName: `投稿者${String(i).padStart(3, '0')}`, screenName: `author_${i}`, width: 4, height: 4 }));
  const { page } = await launchHologram({ posts });
  await page.getByRole('button', { name: 'フィルタ', exact: true }).click();
  await page.getByRole('menuitem', { name: '投稿者', exact: true }).hover();
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(50);
  await page.getByRole('menuitem', { name: '次へ', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: /^投稿者050/ })).toBeVisible();
  await page.getByRole('menuitem', { name: '次へ', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(25);
  await page.getByRole('searchbox', { name: '投稿者を検索', exact: true }).fill('@author_124');
  const row = page.getByRole('menuitemcheckbox', { name: /^投稿者124/ });
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(1);
  await row.click();
  await expect(row).toBeChecked();
  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"]')).toHaveCount(1);
});

test('X選択中でもBlueskyの件数を表示し、ORで追加できる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.getByRole('button', { name: 'フィルタ', exact: true }).click();
  await page.getByRole('menuitem', { name: 'サイト', exact: true }).hover();
  await page.getByRole('menuitemcheckbox', { name: /^X / }).click();
  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"]')).toHaveCount(2);
  const bluesky = page.getByRole('menuitemcheckbox', { name: /^Bluesky / });
  await expect(bluesky).toHaveText('Bluesky1');
  await bluesky.click();
  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"]')).toHaveCount(3);
});
