import path from 'node:path';
import { expect, test } from '../lib/harness.ts';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { preparePostStmts, makeTagResolver, writePost } from '../../app/src/main/lib-db-record-writer.ts';

test('旧名で投稿者を検索し、カードとインスペクタに履歴を表示する', async ({ launchHologram }) => {
  const { page } = await launchHologram({
    seed: ({ saveFolder }) => {
      const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));
      try {
        const stmts = preparePostStmts(sqlite),
          tags = makeTagResolver(sqlite);
        writePost(stmts, tags, { captureId: 'name-old', platform: 'x', userId: 'stable-name-test', displayName: '春野なぎ', screenName: 'haruno_sketch', text: '旧名の投稿', capturedAt: '2026-01-01T00:00:00Z' });
        writePost(stmts, tags, { captureId: 'name-new', platform: 'x', userId: 'stable-name-test', displayName: '凪', screenName: 'nagi_draw', text: '現在の投稿', capturedAt: '2026-09-01T00:00:00Z' });
      } finally {
        sqlite.close();
      }
    },
  });
  await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: '投稿者' }).click();
  const search = page.getByRole('combobox', { name: 'ライブラリ内を検索' });
  await search.fill('春野');
  const card = page.locator('[data-slot="poster-card"]').filter({ hasText: '凪' });
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-slot="poster-previous-name"]')).toHaveText('以前の名前：春野なぎ');
  await page.keyboard.press('Escape');
  await card.click();
  const inspector = page.locator('[data-slot="inspector-poster"]');
  await expect(inspector.locator('svg.lucide-history')).toHaveCount(0);
  await expect(page.locator('[data-slot="poster-name-popover"]')).toHaveCount(0);
  await expect(inspector.locator('dt')).toHaveText(['以前の名前', '以前のユーザー名', 'サイト', '投稿数']);
  const columns = await inspector.locator('dd').evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().left));
  expect(new Set(columns).size).toBe(1);
  const history = page.locator('[data-slot="poster-name-history"]');
  await expect(history.locator('summary')).toHaveCount(0);
  await expect(history.getByText('春野なぎ', { exact: true })).toBeVisible();
  await expect(history.getByText('@haruno_sketch', { exact: true })).toBeVisible();
  await expect(history).toHaveCount(2);
  await expect(page.getByText('以前の名前', { exact: true })).toBeVisible();
  await expect(page.getByText('以前のユーザー名', { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  await history.getByText('春野なぎ', { exact: true }).hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('最終確認 2026/01/01');
  await page.keyboard.press('Escape');
  await search.fill('haruno');
  await expect(card.locator('[data-slot="poster-previous-name"]')).toHaveText('以前の名前：@haruno_sketch');
  await search.fill('');
  await expect(page.locator('[data-slot="poster-previous-name"]')).toHaveCount(0);
  await page.reload();
  await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: '投稿者' }).click();
  await search.fill('春野');
  await expect(card).toHaveCount(1);
});
