// 検索 → 絞られたグリッド。ツールバーの検索欄に打ち込むことは最も使われる
// フィルタであり、単体テストでは別々に見える3つの層をまたぐ: 入力欄、
// オーケストレータ内のデバウンスされた問い合わせ、そして仮想化されたグリッド
// の再構築。
import { expect, test } from '../lib/harness.ts';

test('閉じた検索タブを復元すると検索結果と戻る履歴が残る', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const tabs = page.locator('[data-slot="tab"]');
  const search = page.getByPlaceholder('テキスト・ユーザー名で検索');
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await page.keyboard.press('Control+Shift+t');
  await expect(tabs).toHaveCount(1); // 閉じたタブがなければ新規タブも作らない。
  await page.keyboard.press('Control+t');
  await expect(tabs).toHaveCount(2);
  await search.fill('猫');
  await expect(cards).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+w');
  await expect(tabs).toHaveCount(1);
  await page.keyboard.press('Control+Shift+t');
  await expect(tabs).toHaveCount(2);
  await expect(search).toHaveValue('猫');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('猫が机の上で寝ている');
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(cards).toHaveCount(4);
  await page.getByRole('button', { name: '進む', exact: true }).click();
  await expect(search).toHaveValue('猫');
  await search.fill('夕暮れ');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('夕暮れの街並み');
});

test('最後のタブも、複数回閉じたタブも直前から順に復元する', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const tabs = page.locator('[data-slot="tab"]');
  const search = page.getByPlaceholder('テキスト・ユーザー名で検索');
  for (const word of ['猫', '夕暮れ']) {
    await search.fill(word);
    await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+w');
    await expect(tabs).toHaveCount(1);
    await expect(search).toHaveValue('');
  }
  await page.keyboard.press('Control+Shift+t');
  await expect(search).toHaveValue('夕暮れ');
  await page.keyboard.press('Control+Shift+t');
  await expect(search).toHaveValue('猫');
  await expect(tabs).toHaveCount(3);
  await page.keyboard.press('Control+Shift+t');
  await expect(tabs).toHaveCount(3);
});

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
