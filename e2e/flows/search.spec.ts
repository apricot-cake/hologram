// 検索 → 絞られたグリッド。ツールバーの検索欄に打ち込むことは最も使われる
// フィルタであり、単体テストでは別々に見える3つの層をまたぐ: 入力欄、
// オーケストレータ内のデバウンスされた問い合わせ、そして仮想化されたグリッド
// の再構築。
import { expect, test } from '../lib/harness.ts';

test('検索語を打つとグリッドが絞り込まれ、消すと元に戻る', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await expect(cards).toHaveCount(4);

  const search = page.getByPlaceholder('テキスト・ユーザー名で検索');
  await search.click();
  await search.fill('猫');

  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('猫が机の上で寝ている');

  // 入力中は候補のポップアップがグリッドの上に開く。Esc は問い合わせを消さずに
  // それを閉じる（欄は打ち込んだものを保つ）。
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('猫');

  await search.fill('');
  await expect(cards).toHaveCount(4);
});

test('投稿者名でも絞り込める', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const search = page.getByPlaceholder('テキスト・ユーザー名で検索');
  await search.click();
  await search.fill('akane_machi');

  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('夕暮れの街並み');
});
