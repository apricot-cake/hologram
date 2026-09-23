// #975: インスペクタはどの幅でも常設のカラムである。#259は1280px未満で
// それをslide-overとして切り離していたが、それを誤りにしたのは述語ではなく
// 幾何学＝浮動パネルが、まさに免れるはずだったカードを覆っていた。だから
// このガードは矩形を測定する「実際の」ウィンドウリサイズであり、モックした
// matchMediaではない（tests/integration/inspector-pref.test.tsが既にその半分を持っている）。
import { expect, test } from '../lib/harness.ts';
import { WIDE_MIN_PX, justBelow } from '../lib/viewport.ts';

test('詳細の開閉でも検索欄と三つの操作は動かず、画像ビューアでも同じ位置に残る', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const toggle = page.locator('[data-slot="inspector-toggle"]');
  const inspector = page.locator('[data-slot="inspector"]');
  await expect(toggle).toHaveText('詳細');
  const search = page.getByRole('combobox', { name: 'ライブラリ内を検索', exact: true });
  const controls = page.locator('[data-slot="page-toolbar"] button').filter({ hasText: /^(フィルタ|表示|詳細)$/ });
  await expect(search).toBeVisible();
  await expect(controls).toHaveCount(3);
  const positions = async () => {
    const searchPosition = await search.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const controlPositions = await controls.evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
    return [searchPosition, ...controlPositions];
  };
  const initial = await positions();
  const buttonBox = await toggle.boundingBox();
  for (let i = 0; i < 4; i++) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', String(i % 2 === 1));
    expect(await positions()).toEqual(initial);
  }
  const pageBox = await page.locator('[data-slot="page-surface"]').boundingBox();
  const toolbarBox = await page.locator('[data-slot="page-toolbar"]').boundingBox();
  const panelBox = await inspector.boundingBox();
  if (!pageBox || !toolbarBox || !panelBox) throw new Error('パネルの位置を取得できません');
  expect(panelBox.y).toBeGreaterThan(toolbarBox.y + toolbarBox.height);
  expect(panelBox.x + panelBox.width).toBeLessThan(pageBox.x + pageBox.width);
  expect(panelBox.y - (toolbarBox.y + toolbarBox.height)).toBeCloseTo(12, 0);
  expect(pageBox.x + pageBox.width - (panelBox.x + panelBox.width)).toBeCloseTo(12, 0);
  expect(pageBox.y + pageBox.height - (panelBox.y + panelBox.height)).toBeCloseTo(12, 0);
  const content = page.locator('[data-slot="content-scroll"]');
  const contentBox = await content.boundingBox();
  if (!contentBox) throw new Error('投稿一覧の位置を取得できません');
  // 投稿一覧は下端まで表示し、スクロールバーとパネルの間だけ間隔を取る。
  expect(contentBox.y + contentBox.height).toBeCloseTo(pageBox.y + pageBox.height, 0);
  expect(panelBox.x - (contentBox.x + contentBox.width)).toBeCloseTo(8, 0);
  await expect(content).toHaveCSS('padding-left', '12px');
  await expect(content).toHaveCSS('padding-right', '12px');
  await page.screenshot({ path: test.info().outputPath('inspector-open.png') });
  await page.locator('[data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).dblclick();
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  expect(await toggle.boundingBox()).toEqual(buttonBox);
  await toggle.click();
  await expect(inspector).toBeHidden();
  expect(await toggle.boundingBox()).toEqual(buttonBox);
  await toggle.click();
  await expect(inspector).toBeVisible();
  expect(await toggle.boundingBox()).toEqual(buttonBox);
});

test('狭幅でもインスペクタは常設カラムのままグリッドを覆わない（#975）', async ({ launchHologram }) => {
  const { app, page } = await launchHologram();
  const narrow = justBelow(WIDE_MIN_PX);
  await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 800), narrow);
  // レイアウトが答えるのはリサイズそのものであって、その要求ではない: アプリが
  // 実際に得たウィンドウを待つ。（バックグラウンドのウィンドウは全く再描画
  // しない＝#259自身の計測メモ＝しかしPlaywrightのElectronウィンドウは画面上に
  // ある。）
  await page.waitForFunction((w) => window.innerWidth <= w, narrow);

  const inspector = page.locator('[data-slot="inspector"]');
  await expect(inspector).toBeVisible();
  // 何も選択されていないが、カラムはそれでも立っている＝プレースホルダの上に
  // （#244）。#259のもとでは、狭幅の形は選択に乗っていて、ここには無かった
  // はず。
  await expect(page.locator('[data-slot="inspector-empty"]')).toBeVisible();
  await expect(inspector).toHaveCSS('position', 'relative');

  // グリッドは自分の領域を保つ: スクロール列はパネルが始まる場所で終わるので、
  // その裏にカードは無い。両者の境界線ぶん1pxの許容誤差。
  const grid = await page.locator('[data-slot="content-scroll"]').boundingBox();
  const panel = await inspector.boundingBox();
  if (!grid || !panel) throw new Error('グリッドまたはインスペクタの矩形が取れなかった');
  expect(grid.x + grid.width).toBeLessThanOrEqual(panel.x + 1);

  // Escは一時的な画面にスコープされる（#143/#242）。#259は狭幅オーバーレイの
  // ために例外を切り出していたが、その形がもう残っていない今、カラムはこれを
  // 素通りさせなければならない。
  await page.keyboard.press('Escape');
  await expect(inspector).toBeVisible();

  // そして、以前はオーバーレイを追い払っていた空白グリッドへのクリックも、
  // カラムを立たせたままにする（パネルを空にするだけ、#242）。
  await page.locator('[data-slot="content-scroll"]').click({ position: { x: 8, y: 8 } });
  await expect(inspector).toBeVisible();
});
