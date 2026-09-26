import { expect, test } from '../lib/harness.ts';

test('非アクティブでもメニューのホバー強調とサブメニューが動く', async ({ launchHologram }) => {
  const { app, page } = await launchHologram();
  await page.locator('[data-slot="toolbar-sort"]').press('Enter');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.blur();
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isFocused()))).toBe(false);
  const item = page.getByRole('menuitemradio', { name: '閲覧数', exact: true });
  await item.hover();
  await expect(item).toHaveAttribute('data-highlighted');
  expect(await item.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isFocused()))).toBe(false);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'フィルタ', exact: true }).press('Enter');
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.blur();
  });
  await page.getByRole('menuitem', { name: '日付', exact: true }).hover();
  await expect(page.getByRole('menu', { name: '日付', exact: true })).toBeVisible();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isFocused()))).toBe(false);
});
