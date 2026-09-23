// 削除→ゴミ箱→復元。ユーザーが文字入力なしで歩ける最長の連鎖であり、その半分
// 半分が別々の画面に住んでいる: フローティングの選択バーが削除し、左ナビの
// ゴミ箱という行き先が復元する（#268がその半分を設定ダイアログの外へ移した）。
// 両方の画面を実際に操作すること以外に、それらが今も噛み合っていることを
// 証明する方法は無い。
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../lib/harness.ts';

test('選択バーから削除するとグリッドから消えてごみ箱に入る', async ({ launchHologram }) => {
  const hologram = await launchHologram();
  const { page } = hologram;
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  const nav = page.locator('[data-slot="sidebar"]').first();
  const trashEntry = nav.getByRole('button', { name: 'ゴミ箱' });

  // ナビの行は何も削除される前からそこにある（設計判断: 0件でも隠さない）。
  // ゴミ箱が空の間は件数バッジを付けない。
  await expect(trashEntry).toBeVisible();
  await expect(nav.locator('[data-slot="sidebar-menu-badge"]')).toHaveCount(0);

  await cards.filter({ hasText: '手描きのラフスケッチ' }).click();
  await cards.filter({ hasText: '夕暮れの街並み' }).click({ modifiers: ['Control'] });
  const deleteButton = page.getByRole('button', { name: '削除' });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();

  // shadcn AlertDialog: 誤ったクリックで選択を捨てられないように、確認を
  // 押さなければならない。
  const confirm = page.locator('[data-slot="alert-dialog-content"]');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '削除する' }).click();

  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: '手描きのラフスケッチ' })).toHaveCount(0);
  // ソフト削除: 行は消えるが、メディアは消去されず.trashへ移動する。
  expect(hologram.readDb((sqlite) => sqlite.prepare('SELECT captureId FROM posts WHERE captureId = ?').get('e2e-0004'))).toBeUndefined();
  expect(fs.existsSync(path.join(hologram.saveFolder, '.trash', 'e2e-0004', 'e2e-0004.png'))).toBe(true);

  // ゴミ箱はコンテンツ領域内の行き先として開く: 削除された投稿はそこでカード
  // であり、それを選ぶと復元が構えられ、押すと投稿が戻る。
  await trashEntry.click();
  const trashCards = page.locator('[data-slot="trash-grid"] [data-slot="post-card"]');
  await expect(trashCards).toHaveCount(2);
  await expect(trashCards.filter({ hasText: '筆本らふ' })).toHaveCount(1);

  const restoreButton = page.getByRole('button', { name: '復元' });
  await expect(restoreButton).toBeDisabled(); // まだ何も選ばれていない
  await trashCards.first().click();
  await expect(restoreButton).toBeEnabled();
  await restoreButton.click();
  await expect(trashCards).toHaveCount(1);
  await trashCards.first().click();
  await expect(restoreButton).toBeEnabled();
  await restoreButton.click();
  await expect(trashCards).toHaveCount(0);
  await expect(page.locator('[data-slot="trash-view"]').getByText('ゴミ箱は空です').first()).toBeVisible();

  // 復元とは、行とメディアがライブラリの保管場所に戻ることを意味する。
  await expect.poll(() => hologram.readDb((sqlite) => sqlite.prepare('SELECT captureId FROM posts WHERE captureId = ?').get('e2e-0004'))).toEqual({ captureId: 'e2e-0004' });
  const restoredMedia = hologram.readDb((sqlite) => sqlite.prepare('SELECT file FROM media WHERE postId = ?').get('e2e-0004')) as { file: string };
  expect(fs.existsSync(path.join(hologram.saveFolder, restoredMedia.file))).toBe(true);

  // ライブラリへ戻る: 復元された投稿は再びグリッド上にある（#471:
  // restore-postはposts-changedを発信するので、再起動は不要）。
  await nav.getByRole('button', { name: 'ホーム' }).click();
  await expect(cards).toHaveCount(4);
  await expect(cards.filter({ hasText: '手描きのラフスケッチ' })).toHaveCount(1);
});
