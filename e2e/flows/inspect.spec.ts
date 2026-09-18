// 統一されたクリックモデル（#143）を「本物の」ポインタで駆動する: 単発
// クリックは選択してインスペクタを満たし、ダブルクリックは画像ビューを開く。
// e2e/harness/cases/test-app-click-model.cts は合成 MouseEvent で同じ契約を検証するが
// — それではオーバーレイに覆われたカード、死んだ pointer-events 領域、
// 動いてしまった当たり判定は見えない。これなら見える。
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../lib/harness.ts';

test('インスペクタの投稿選択を閲覧に数え、同じ選択では増やさない', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  const card = cards.filter({ hasText: '猫が机の上で寝ている' });
  const readCount = () =>
    page.evaluate(async () => {
      const { posts } = await window.hologram.listPosts();
      return posts.find((p) => p.text?.includes('猫が机の上で寝ている'))?.localViewCount || 0;
    });
  const before = await readCount();
  await card.click();
  await expect.poll(readCount).toBe(before + 1);
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('アプリ内閲覧');
  await card.click();
  expect(await readCount()).toBe(before + 1);
  await cards.filter({ hasNotText: '猫が机の上で寝ている' }).first().click();
  await card.click();
  await expect.poll(readCount).toBe(before + 2);
  await page.getByRole('button', { name: '詳細パネル', exact: true }).click();
  await cards.filter({ hasNotText: '猫が机の上で寝ている' }).first().click();
  await card.click();
  expect(await readCount()).toBe(before + 2);
});

test('カードをクリックすると選択されインスペクタに内容が出る', async ({ launchHologram }) => {
  const { page } = await launchHologram({
    seed: ({ saveFolder }) => {
      fs.mkdirSync(path.join(saveFolder, 'avatars'), { recursive: true });
      fs.copyFileSync(path.join(saveFolder, 'items', 'e2e-0003', 'e2e-0003.png'), path.join(saveFolder, 'avatars', 'fixture.png'));
      const { openDatabase } = require('../../app/src/main/lib-db.ts');
      const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));
      try {
        sqlite.prepare('UPDATE posts SET avatarFile = ? WHERE screenName = ?').run('avatars/fixture.png', 'mike_nekozawa');
      } finally {
        sqlite.close();
      }
    },
  });
  const card = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' });
  await card.click();

  await expect(card).toHaveAttribute('data-selected', 'true');
  const inspector = page.locator('[data-slot="inspector-post"]');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('猫沢みけ');
  const authorLink = inspector.locator('[data-slot="inspector-author-link"]');
  await expect(authorLink).toBeVisible();
  await expect(inspector.locator('[data-slot="inspector-author-label"]')).toHaveCSS('align-self', 'flex-start');
  await expect(inspector.locator('[data-slot="inspector-author-value"]')).toHaveCSS('align-self', 'flex-start');
  await expect(authorLink).toHaveCSS('border-top-style', 'solid');
  await expect(authorLink).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const authorName = authorLink.locator('[data-slot="inspector-author-name"]');
  await expect(authorName).toHaveCSS('text-decoration-line', 'none');
  await expect(authorName).toHaveCSS('white-space', 'normal');
  await expect(authorName).toHaveCSS('overflow-wrap', 'anywhere');
  const authorAvatar = authorLink.locator('[data-slot="avatar-image"]');
  await expect(authorAvatar).toHaveCSS('width', '24px');
  await expect(authorAvatar).toHaveCSS('height', '24px');
  await expect(inspector).toContainText('Bluesky');
  await expect(inspector).not.toContainText('@mike_nekozawa');
  await expect(inspector.getByText('更新日', { exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: '閉じる', exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('group', { name: 'いいね: 5400', exact: true })).toBeVisible();
  await expect(inspector.getByRole('group', { name: 'リポスト: 900', exact: true })).toBeVisible();
  const external = inspector.getByRole('link', { name: '元投稿を開く', exact: true });
  await expect(external).toBeVisible();
  await expect(external).toHaveText('https://example.test/mike_nekozawa/status/e2e-0003');
  const urlLabel = inspector.locator('dt').filter({ hasText: 'URL' });
  await expect(urlLabel).toBeVisible();
  await expect(urlLabel.locator('xpath=following-sibling::dd[1]').getByRole('link', { name: '元投稿を開く', exact: true })).toBeVisible();
  await external.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'リンクをコピー', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inspector.locator('[data-slot="inspector-open-external-overlay"]')).toHaveCount(0);
  const localViews = inspector.locator('dt').filter({ hasText: 'アプリ内閲覧' });
  await expect(localViews).toBeVisible();
  await expect(localViews.locator('xpath=following-sibling::dd[1]')).toHaveText('1');
  // 日付は絶対値で、ハーネスが固定したタイムゾーンで描画される。
  await expect(inspector).toContainText('2026/3/5');
});

test('1件選択したカードの右クリックで通常メニューが開く', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const card = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' });
  await card.click();
  await expect(card).toHaveAttribute('data-selected', 'true');
  await card.click({ button: 'right' });

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'タグを編集', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator('[data-slot="inspector"]').getByRole('tab', { name: 'タグ', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(card).toHaveAttribute('data-selected', 'true');
});

test('別のカードをクリックすると選択が入れ替わる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const first = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' });
  const second = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '夕暮れの街並み' });

  await first.click();
  await expect(first).toHaveAttribute('data-selected', 'true');
  await second.click();

  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"][data-selected]')).toHaveCount(1);
  await expect(second).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('街田あかね');
});

test('単一選択はインスペクタで閲覧し、2件選択で一括操作を表示する', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const first = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' });
  const second = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '夕暮れの街並み' });
  const bar = page.locator('[data-slot="selection-bar"]');

  await first.click();
  await expect(first).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('猫沢みけ');
  await expect(bar).toHaveAttribute('aria-hidden', 'true');

  await second.click({ modifiers: ['Control'] });
  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"][data-selected]')).toHaveCount(2);
  await expect(bar).toHaveAttribute('aria-hidden', 'false');
  await expect(bar.getByRole('button', { name: 'タグを追加' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'フォルダに追加' })).toBeVisible();
  await expect(bar.getByRole('button', { name: '投稿を削除' })).toBeVisible();
});

test('カードをダブルクリックすると画像ビューが開く', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).dblclick();

  // 配線がどうなっているかではなく、利用者に見えるものを検証する: メディア
  // ステージが立ち上がり、閲覧用の列が消えている。かつてはどちらも
  // `body.image-tab-active` で検証されていて、それこそが #153 ②の「テストが
  // 仕組みを固定してしまう」形そのもの — そのクラスはもう存在しないが、
  // このテストは同じことを言うために意味を変える必要が無かった。
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  await expect(page.locator('[data-slot="content-scroll"]')).toBeHidden();
  const localViews = page.locator('[data-slot="inspector-post"] dt').filter({ hasText: 'アプリ内閲覧' });
  await expect(localViews.locator('xpath=following-sibling::dd[1]')).toHaveText('2');
});

test('画像ビューの投稿者と投稿者インスペクタの作品は中央ビューと左ナビゲーションも切り替える', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).dblclick();
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();

  await page.locator('[data-slot="inspector-author-link"]').click();

  const postersNav = page.getByRole('button', { name: '投稿者', exact: true });
  await expect(postersNav).toHaveAttribute('data-active', '');
  await expect(page.locator('[data-slot="image-tab-view"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="poster-grid"]')).toBeVisible();
  const posterInspector = page.locator('[data-slot="inspector-poster"]');
  await expect(posterInspector).toContainText('猫沢みけ');

  await posterInspector.locator('[data-slot="inspector-work-thumb"]').first().click();

  const libraryNav = page.getByRole('button', { name: 'ホーム', exact: true });
  await expect(libraryNav).toHaveAttribute('data-active', '');
  await expect(postersNav).not.toHaveAttribute('data-active', '');
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  await expect(page.locator('[data-slot="inspector-post"]')).toBeVisible();
});

// #633。パネルは調べていた対象の「スナップショット」を保持しているので、
// その対象が存在しなくなったことはライブラリ側から気付かなければならない —
// そうしないと画像は消えているのにその詳細だけは残り、生きたタグエディタが
// もう存在しないレコードへ書き込み続けることになる。グリッドのケースは
// フローティングバー経由で行う。それが選択が実際に届く削除の経路。
async function deleteSelectionViaBar(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '削除' }).click();
  const confirm = page.locator('[data-slot="alert-dialog-content"]');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '削除する' }).click();
}

test('画像ビューを開いたまま別タブで削除するとステージもインスペクタも投稿を手放す', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  // ダブルクリックはカードを選択すると同時に画像ビューを開く。
  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).dblclick();
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('猫沢みけ');

  // #656 は画像ビューからフローティングバーを外した（ステージは一括操作が
  // どのカードに当たるかを示せないため）ので、このケースが必要とする削除は
  // もうここからは始まらない — 想定ではなく検証する。この変更こそが、
  // 静かにこのテストをレッドにした原因そのものだったから: もう届かなくなった
  // バーをクリックし続けていた。
  await expect(page.locator('[data-slot="selection-bar"]')).toHaveAttribute('aria-hidden', 'true');

  // 2つ目のタブが開いたままになる経路: 同じライブラリ、それ自身のグリッドと
  // それ自身の選択を持ち、画像ビューは開いた時の投稿を保持し続ける。
  await page.locator('[data-slot="tab-new"]').click();
  const grid = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await expect(grid).toHaveCount(4);
  await grid.filter({ hasText: '猫が机の上で寝ている' }).click();
  await grid.filter({ hasText: '夕暮れの街並み' }).click({ modifiers: ['Control'] });
  await deleteSelectionViaBar(page);
  await expect(grid).toHaveCount(2);

  await page.locator('[data-slot="tab"]').first().click();
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  // ステージは投稿が無くなったと言う…
  await expect(page.getByText('この画像はライブラリにありません')).toBeVisible();
  // …そして右の列がそれに答え続けてはならない。投稿の詳細も、入力できる
  // タグ欄も無い — パネルは自身の未選択状態へ戻る。
  await expect(page.locator('[data-slot="inspector-post"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="inspector-empty"]')).toBeVisible();
});

test('グリッドで選択中の投稿を削除するとインスペクタが空になる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const card = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '夕暮れの街並み' });
  await card.click();
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('街田あかね');
  await page
    .locator('[data-slot="post-grid"] [data-slot="post-card"]')
    .filter({ hasText: '猫が机の上で寝ている' })
    .click({ modifiers: ['Control'] });

  await deleteSelectionViaBar(page);

  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"]')).toHaveCount(2);
  await expect(page.locator('[data-slot="inspector-post"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="inspector-empty"]')).toBeVisible();
});

test('カードメニューから削除してもインスペクタが空になる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const card = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '青い空と海の写真' });
  // カードメニューは選択を「立てない」経路（その場合フローティングバーが
  // 一括操作を持つ）なので、このケース全体は選択無しのままでなければ
  // ならない: 「詳細」は選択せずにパネルを満たす。メニュー自身の「削除」が
  // 選択無しで削除するのとまったく同じように。
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '詳細' }).click();
  await expect(page.locator('[data-slot="inspector-post"]')).toContainText('海野そら');

  // 削除へ至る2つ目の経路。かつてはこれ自身がパネルを消していて、それこそが
  // 他の経路がそうしていなかった理由 — 検証は1箇所に移された（#633）ので、
  // このケースは、その移動が置き換えた振る舞いを失っていないことを証明する。
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '削除' }).click();
  const confirm = page.locator('[data-slot="alert-dialog-content"]');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '削除する' }).click();

  await expect(page.locator('[data-slot="post-grid"] [data-slot="post-card"]')).toHaveCount(3);
  await expect(page.locator('[data-slot="inspector-post"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="inspector-empty"]')).toBeVisible();
});

test('投稿者インスペクタは現在値だけを表示し、順位・履歴・名寄せ・閉じる操作を持たない', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.getByRole('button', { name: '投稿者', exact: true }).click();
  const card = page.locator('[data-slot="poster-grid"] [data-slot="poster-card"]').filter({ hasText: '猫沢みけ' });
  await card.click();

  const inspector = page.locator('[data-slot="inspector-poster"]');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('@mike_nekozawa');
  const external = inspector.getByRole('link', { name: '元のプロフィールを開く', exact: true });
  await expect(external).toBeVisible();
  await expect(external).toHaveText('@mike_nekozawa');
  const userLabel = inspector.locator('dt').filter({ hasText: 'ユーザー名' });
  await expect(userLabel.locator('xpath=following-sibling::dd[1]').getByRole('link', { name: '元のプロフィールを開く', exact: true })).toBeVisible();
  await expect(inspector.locator('dt').filter({ hasText: 'リンク先' })).toHaveCount(0);
  await external.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'リンクをコピー', exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: '閉じる', exact: true })).toHaveCount(0);
  for (const removed of ['人気', '上位', 'プロフィール履歴', '同一人物']) await expect(inspector.getByText(removed, { exact: true })).toHaveCount(0);
});
