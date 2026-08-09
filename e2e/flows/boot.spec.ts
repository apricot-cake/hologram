// Boot → grid. The cheapest thing that goes wrong invisibly: the app starts, the
// database has posts, and nothing reaches the screen.
import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

test('起動するとシードした投稿がグリッドに並ぶ', async ({ launchHologram }) => {
  const { page } = await launchHologram();

  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await expect(cards).toHaveCount(FIXTURE_POSTS.length);
  // Card bodies carry the post text — the grid is really rendering the seeded
  // records, not empty placeholders. (Order is the sort's business, asserted
  // where sorting is; here only presence matters.)
  for (const post of FIXTURE_POSTS) await expect(cards.filter({ hasText: post.text })).toHaveCount(1);
  // The shell's three panels are all mounted, not just the grid.
  await expect(page.locator('[data-slot="sidebar"]')).toBeVisible();
  await expect(page.locator('[data-slot="inspector"]')).toBeVisible();
});

// #1057: the window has to say which language it came up in. Asserted here because
// the whole chain has to run for real — main reads config.json, the renderer resolves
// it, and src/app/root.tsx writes it onto the document before the mount this awaits.
// Both directions, because index.html's static value is ja: a case that only checked
// ja would pass with nothing written at all.
test('表示言語の設定が文書の lang 属性に出る', async ({ launchHologram }) => {
  const ja = await launchHologram({ language: 'ja' });
  await expect(ja.page.locator('html')).toHaveAttribute('lang', 'ja');

  const en = await launchHologram({ language: 'en' });
  await expect(en.page.locator('html')).toHaveAttribute('lang', 'en');
});

test('投稿が無いライブラリでは初回の空状態が出る', async ({ launchHologram }) => {
  const { page } = await launchHologram({ posts: [] });

  await expect(page.locator('[data-slot="empty-state"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"]')).toHaveCount(0);
});
