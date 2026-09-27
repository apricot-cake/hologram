import { expect, test } from '../lib/harness';
import type { ElectronApplication, Page } from '@playwright/test';

// OS の最終合成画面を検証するテストではない。
// 背景色の再計算を行わず、同じ DOM の暗幕がタイトルバー全幅を覆う構造を確認する。
async function expectFullWidthBackdrop(page: Page, slot = 'dialog-overlay') {
  const coverage = await page.locator(`[data-slot="${slot}"]`).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const titlebarElement = document.querySelector('[data-slot="tabs-band"]');
    if (!titlebarElement) throw new Error('タイトルバーがありません');
    const titlebar = titlebarElement.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: innerWidth,
      height: innerHeight,
      titlebarRight: titlebar.right,
      coversControls: document.elementsFromPoint(innerWidth - 24, titlebar.height / 2).includes(el),
      background: getComputedStyle(el).backgroundColor,
    };
  });
  expect(coverage.left).toBe(0);
  expect(coverage.top).toBe(0);
  expect(coverage.right).toBe(coverage.width);
  expect(coverage.bottom).toBe(coverage.height);
  expect(coverage.titlebarRight).toBe(coverage.width);
  expect(coverage.coversControls).toBe(true);
  expect(coverage.background).toBe('oklab(0 0 0 / 0.5)');
}

async function recordTitlebarColors(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const original = win.setTitleBarOverlay.bind(win);
    const scope = globalThis as typeof globalThis & { titlebarCalls: unknown[] };
    scope.titlebarCalls = [];
    win.setTitleBarOverlay = (options) => {
      scope.titlebarCalls.push(options);
      original(options);
    };
  });
  return () => app.evaluate(() => (globalThis as typeof globalThis & { titlebarCalls: { color?: string; symbolColor?: string }[] }).titlebarCalls);
}

async function waitForPopupAnimation(page: Page, slot = 'dialog-content') {
  await page.waitForFunction((dataSlot) => {
    const popup = document.querySelector(`[data-slot="${dataSlot}"]`);
    return popup && popup.getAnimations().every((animation) => animation.playState === 'finished');
  }, slot);
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: 設定の開閉でネイティブ背景色を変更しない`, async ({ launchHologram }) => {
    const { page, app } = await launchHologram({ theme });
    const calls = await recordTitlebarColors(app);
    const dimmed = { symbolColor: theme === 'light' ? '#101112' : '#737477' };
    const normal = { symbolColor: theme === 'light' ? '#202124' : '#e6e8ed' };
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: '設定', exact: true }).click();
      await expect.poll(async () => (await calls()).at(-1)).toEqual(dimmed);
      await waitForPopupAnimation(page);
      await expectFullWidthBackdrop(page);
      await page.keyboard.press('Escape');
      await page.locator('[data-slot="dialog-overlay"]').waitFor({ state: 'detached' });
      await expect.poll(async () => (await calls()).at(-1)).toEqual(normal);
    }
    expect(await calls()).toEqual([dimmed, normal, dimmed, normal, dimmed, normal]);
  });
}

test('確認ダイアログを重ねてもネイティブ背景色を変更しない', async ({ launchHologram }) => {
  const { page, app } = await launchHologram();
  const calls = await recordTitlebarColors(app);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await waitForPopupAnimation(page);
  await page.getByRole('button', { name: '危険な操作', exact: true }).click();
  // 確認を開いてキャンセルするだけ。削除の確定は行わない。
  await page.getByRole('button', { name: '全データを削除', exact: true }).click();
  await waitForPopupAnimation(page, 'alert-dialog-content');
  await expectFullWidthBackdrop(page, 'alert-dialog-overlay');
  await expect.poll(async () => (await calls()).at(-1)).toEqual({ symbolColor: '#080809' });
  await page.getByRole('alertdialog').getByRole('button', { name: 'キャンセル', exact: true }).click();
  await page.locator('[data-slot="alert-dialog-overlay"]').waitFor({ state: 'detached' });
  await expect.poll(async () => (await calls()).at(-1)).toEqual({ symbolColor: '#101112' });
  await page.keyboard.press('Escape');
  await page.locator('[data-slot="dialog-overlay"]').waitFor({ state: 'detached' });
  await expect.poll(async () => (await calls()).at(-1)).toEqual({ symbolColor: '#202124' });
  expect(await calls()).toEqual([{ symbolColor: '#101112' }, { symbolColor: '#080809' }, { symbolColor: '#101112' }, { symbolColor: '#202124' }]);
});

test('記号色の IPC を処理しなくても暗幕はタイトルバー全幅を覆う', async ({ launchHologram }) => {
  const { page, app } = await launchHologram();
  const calls = await recordTitlebarColors(app);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('set-titlebar-symbol-dim');
    ipcMain.handle('set-titlebar-symbol-dim', () => undefined);
  });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await waitForPopupAnimation(page);
  await expectFullWidthBackdrop(page);
  await page.keyboard.press('Escape');
  await page.locator('[data-slot="dialog-overlay"]').waitFor({ state: 'detached' });
  expect(await calls()).toEqual([]);
});
