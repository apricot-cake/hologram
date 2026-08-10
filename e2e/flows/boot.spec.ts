// 起動 → グリッド。目に見えないまま壊れる最も安上がりな壊れ方: アプリは
// 起動し、データベースには投稿があるのに、何も画面に届かない。
import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

test('起動するとシードした投稿がグリッドに並ぶ', async ({ launchHologram }) => {
  const { page } = await launchHologram();

  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await expect(cards).toHaveCount(FIXTURE_POSTS.length);
  // カードの本体は投稿のテキストを運んでいる — グリッドは空のプレース
  // ホルダーではなく、シードしたレコードを本当に描画している。（順序は
  // ソートの領分で、ソートを検証する箇所で検証する。ここでは存在するかどうか
  // だけが問題。）
  for (const post of FIXTURE_POSTS) await expect(cards.filter({ hasText: post.text })).toHaveCount(1);
  // グリッドだけでなく、シェルの3つのパネルすべてがマウントされている。
  await expect(page.locator('[data-slot="sidebar"]')).toBeVisible();
  await expect(page.locator('[data-slot="inspector"]')).toBeVisible();
});

// #1057: ウィンドウは自分がどの言語で立ち上がったかを言わなければならない。
// ここで検証するのは、この連鎖全体を実際に走らせる必要があるから — main が
// config.json を読み、レンダラーがそれを解決し、src/app/root.tsx がこの
// テストが待つマウントより前にそれを document へ書く。両方向を検証するのは、
// index.html の静的な値が ja だから: ja だけを確認するケースは、何も書かれ
// なくても通ってしまう。
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
