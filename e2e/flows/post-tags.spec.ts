import { expect, test } from '../lib/harness';
import { FIXTURE_POSTS } from '../lib/library';

for (const viewer of [false, true]) {
  for (const platform of ['x', 'pixiv']) {
    test(`${viewer ? 'ビューア' : 'ライブラリ'}：${platform}のタグで絞り込み、ユーザータグは変更しない`, async ({ launchHologram }) => {
      const posts = FIXTURE_POSTS.map((p, i) => (i === 0 ? { ...p, platform, text: platform === 'x' ? '本文 #猫' : '本文', hashtags: ['猫', '風景'] } : p));
      const { page } = await launchHologram({ posts });
      const card = page.locator('[data-slot="post-card"]').filter({ hasText: '本文' });
      if (viewer) await card.dblclick();
      else await card.click();
      if (viewer) await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
      const inspector = page.locator('[data-slot="inspector"]');
      if (platform === 'pixiv') {
        await inspector.getByRole('button', { name: 'pixivタグ 2件', exact: true }).click();
        await page.locator('[data-slot="popover-content"]').getByRole('button', { name: '猫', exact: true }).click();
      } else {
        await inspector.getByRole('button', { name: '#猫', exact: true }).click();
      }
      await expect(page.locator('[data-slot="image-tab-view"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="post-card"]')).toHaveCount(1);
      await page.locator('[data-slot="post-card"]').click();
      await inspector.getByRole('tab', { name: 'タグ', exact: true }).click();
      await expect(inspector.getByText('ソースタグから追加', { exact: true })).toHaveCount(0);
      await expect(inspector.locator('[data-slot="tag-chip"]')).toHaveCount(posts[0].tags.length);
    });
  }
}
