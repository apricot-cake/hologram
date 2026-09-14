import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';
import path from 'node:path';
import fs from 'node:fs';
import { quotedCaptureId } from '../../native-host/quoted-id.mts';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer.ts';

test('引用元は一覧に出ず、インスペクタの画像からローカルビューアを開ける', async ({ launchHologram }) => {
  const { page } = await launchHologram({
    posts: [FIXTURE_POSTS[0]],
    seed({ saveFolder }) {
      const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));
      try {
        const file = `quoted-media/${quotedCaptureId('https://x.com/quoted/status/123')}/image.png`;
        fs.mkdirSync(path.dirname(path.join(saveFolder, file)), { recursive: true });
        fs.copyFileSync(path.join(saveFolder, 'items/e2e-0001/e2e-0001.png'), path.join(saveFolder, file));
        writePost(preparePostStmts(sqlite), makeTagResolver(sqlite), {
          captureId: 'quote-parent',
          text: '引用を保存した投稿',
          platform: 'x',
          quotedPost: { url: 'https://x.com/quoted/status/123', text: '引用元の本文', displayName: '引用元の作者', media: [{ file, type: 'image', width: 400, height: 300 }] },
        });
      } finally {
        sqlite.close();
      }
    },
  });
  await expect(page.locator('[data-slot="post-card"]')).toHaveCount(2);
  await page.locator('[data-slot="post-card"]').filter({ hasText: '引用を保存した投稿' }).click();
  const quote = page.locator('[data-slot="quoted-post-card"][data-kind="quote"]');
  await expect(quote).toContainText('引用元の本文');
  await expect(quote.locator('img')).toBeVisible();
  await quote.locator('img').click();
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  await expect.poll(() => page.locator('[data-slot="image-tab-view"] img').evaluateAll((images) => images.some((img) => (img as HTMLImageElement).naturalWidth === 400))).toBe(true);
});
