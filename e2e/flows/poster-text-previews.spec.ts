import path from 'node:path';
import { expect, test } from '../lib/harness.ts';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { preparePostStmts, makeTagResolver, writePost } from '../../app/src/main/lib-db-record-writer.ts';

test('画像なしでも最新6件を表示し、本文から投稿詳細を開ける', async ({ launchHologram }) => {
  const { page } = await launchHologram({
    seed: ({ saveFolder }) => {
      const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));
      try {
        const stmts = preparePostStmts(sqlite),
          tags = makeTagResolver(sqlite);
        for (let i = 1; i <= 8; i++)
          writePost(stmts, tags, {
            captureId: `text-preview-${i}`,
            platform: 'x',
            userId: 'text-preview-user',
            displayName: '本文プレビュー検証',
            screenName: 'text_preview',
            text: i === 8 ? '' : `投稿${i} 本文の冒頭を表示します。長い本文でも枠からはみ出さないことを確認します。`,
            date: `2026-09-0${i}T00:00:00Z`,
            capturedAt: `2026-09-0${i}T00:00:00Z`,
          });
      } finally {
        sqlite.close();
      }
    },
  });
  await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: '投稿者' }).press('Enter');
  const search = page.getByRole('combobox', { name: 'ライブラリ内を検索' });
  await search.fill('本文プレビュー検証');
  await page.keyboard.press('Escape');
  await page.locator('[data-slot="poster-card"]').filter({ hasText: '本文プレビュー検証' }).click();
  const works = page.locator('[data-slot="inspector-work"]');
  await expect(works).toHaveCount(6);
  await expect(works.nth(0)).toHaveText('本文なし');
  await expect(works.nth(1)).toContainText('投稿7');
  await expect(works.nth(5)).toContainText('投稿3');
  await expect(works.locator('[title]')).toHaveCount(0);
  await expect(works.nth(1).locator('[data-slot="inspector-work-text"] > span')).toHaveCSS('-webkit-line-clamp', '3');
  await works.nth(1).press('Enter');
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('投稿7');
});
