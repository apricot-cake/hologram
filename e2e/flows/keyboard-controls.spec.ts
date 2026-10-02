import { expect, test } from '../lib/harness.ts';

test('タブは矢印でフォーカスを移し、Enter と Space で切り替えられる', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.keyboard.press('Control+t');
  const tabs = page.locator('[data-slot="tab-strip"]').getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await tabs.last().focus();
  await page.keyboard.press('Home');
  await expect(tabs.first()).toBeFocused();
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tabs.last()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel');
  await expect(panel).toHaveAttribute('id', (await tabs.last().getAttribute('aria-controls')) as string);
});

test('IME の Enter はタグ追加と名前入力の確定に使わない', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await page.locator('[data-slot="post-card"]').first().click();
  const inspector = page.locator('[data-slot="inspector"]');
  await inspector.getByRole('tab', { name: 'タグ', exact: true }).click();
  const input = inspector.locator('[data-slot="tag-input"]');
  await input.fill('変換中のタグ');
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    await input.dispatchEvent('keydown', { key: 'Enter', bubbles: true, ...init });
    await expect(input).toHaveValue('変換中のタグ');
    await expect(inspector.locator('[data-slot="tag-chip"][data-tag="変換中のタグ"]')).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  await inspector.getByRole('button', { name: 'グループを作成', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByRole('textbox');
  await name.fill('変換中の名前');
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    await name.dispatchEvent('keydown', { key: 'Enter', bubbles: true, ...init });
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('変換中の名前');
  }
  await name.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(inspector.locator('summary').filter({ hasText: '変換中の名前' })).toBeVisible();
});

test('詳細パネルのサイズ変更キーは投稿選択を変えない', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const cards = page.locator('[data-slot="post-card"]');
  await cards.first().click();
  const selectionBefore = await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-selected')));
  const rail = page.getByRole('separator', { name: 'インスペクタの幅を変更', exact: true });
  await rail.focus();
  const width = await rail.getAttribute('aria-valuenow');
  await page.keyboard.press('ArrowLeft');
  await expect(rail).not.toHaveAttribute('aria-valuenow', width as string);
  expect(await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-selected')))).toEqual(selectionBefore);
  await page.getByRole('grid').first().focus();
  await page.keyboard.press('End');
  await expect(cards.last()).toHaveAttribute('data-selected', 'true');
});
