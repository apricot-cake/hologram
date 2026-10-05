import { expect, test } from '@playwright/test';

const { fixtureHtml, launchOverlayBrowser, openFixture } = require('../lib/overlay-browser.cts');

test('対応する投稿で保存を開始し、保存先に届かないと再試行できる状態になる', async () => {
  const overlay = await launchOverlayBrowser({ locale: 'ja-JP' });
  try {
    const page = await openFixture(overlay, 'https://x.com/home', fixtureHtml('x'));
    const photo = await page.locator('[data-testid="tweetPhoto"]').first().boundingBox();
    if (!photo) throw new Error('テスト投稿の画像を配置できませんでした');

    await page.mouse.move(photo.x + photo.width / 2, photo.y + photo.height / 2);
    let control: any;
    await expect
      .poll(async () => {
        control = (await overlay.overlaySnapshot(page)).controls.find((candidate: any) => candidate.face === 'save');
        return Boolean(control);
      })
      .toBe(true);
    await page.mouse.click(control.rect.x + control.rect.width / 2, control.rect.y + control.rect.height / 2);

    await expect.poll(async () => (await overlay.overlaySnapshot(page)).controls.some((candidate: any) => candidate.face === 'failed' && candidate.tag === 'BUTTON' && candidate.tabIndex === 0)).toBe(true);
    const banner = page.locator('[data-hologram-save-banner]');
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner).toContainText('アプリに接続できません');
  } finally {
    await overlay.close();
  }
});
