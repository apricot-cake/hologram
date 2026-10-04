import { expect, test } from '@playwright/test';

const { fixtureHtml, launchOverlayBrowser, openFixture } = require('../lib/overlay-browser.cts');

test('MAIN world が偽装した ErrorEvent を ISOLATED world の診断へ転送しない', async () => {
  const overlay = await launchOverlayBrowser({ locale: 'ja-JP' });
  try {
    const page = await openFixture(overlay, 'https://x.com/home', fixtureHtml('x'));
    await page.evaluate((extensionId: string) => {
      const forged = `chrome-extension://${extensionId}/content-scripts/resident.js`;
      window.dispatchEvent(
        new ErrorEvent('error', {
          message: 'forged from MAIN world',
          filename: forged,
          error: { message: 'forged from MAIN world', stack: `Error: forged\n at ${forged}:1:1` },
        }),
      );
    }, overlay.extensionId);
    await page.waitForTimeout(1200);
    const storage = await overlay.getStorage();
    expect(Object.keys(storage).filter((key) => key.startsWith('diaglog_'))).toEqual([]);
  } finally {
    await overlay.close();
  }
});
