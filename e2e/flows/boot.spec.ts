// Boot → grid. The cheapest thing that goes wrong invisibly: the app starts, the
// database has posts, and nothing reaches the screen.
import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

test('起動するとシードした投稿がグリッドに並ぶ', async ({ launchHologram }) => {
  const { page } = await launchHologram();

  const cards = page.locator('#postGrid .post-card');
  await expect(cards).toHaveCount(FIXTURE_POSTS.length);
  // Card bodies carry the post text — the grid is really rendering the seeded
  // records, not empty placeholders. (Order is the sort's business, asserted
  // where sorting is; here only presence matters.)
  for (const post of FIXTURE_POSTS) await expect(cards.filter({ hasText: post.text })).toHaveCount(1);
  // The shell's three panels are all mounted, not just the grid.
  await expect(page.locator('[data-slot="sidebar"]')).toBeVisible();
  await expect(page.locator('#postDetail')).toBeVisible();
});

// KNOWN RED (#470): the placeholder's markup carries a `hidden` attribute and the
// grid builder shows it by setting an inline display — which Tailwind's preflight
// `[hidden] { display: none !important }` overrides, so nothing is ever drawn.
// Annotated rather than deleted: Playwright reports an unexpected PASS once #470
// lands, which is what takes the annotation back off.
test('投稿が無いライブラリでは初回の空状態が出る', async ({ launchHologram }) => {
  test.fail();
  const { page } = await launchHologram({ posts: [] });

  await expect(page.locator('#emptyState')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#postGrid .post-card')).toHaveCount(0);
});
