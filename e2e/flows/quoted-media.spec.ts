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

for (const viewer of [false, true]) {
  for (const kind of ['quotedPost', 'replyToPost']) {
    test(`${viewer ? 'ビューア' : 'ライブラリ'}から保存済みの${kind}へ移動する`, async ({ launchHologram }) => {
      const { page } = await launchHologram({
        seed({ saveFolder }) {
          const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));
          try {
            sqlite.prepare('UPDATE posts SET url = ? WHERE captureId = ?').run('https://x.com/target/status/123', FIXTURE_POSTS[0].captureId);
            writePost(preparePostStmts(sqlite), makeTagResolver(sqlite), {
              captureId: 'navigation-parent',
              url: 'https://x.com/parent/status/999',
              platform: 'x',
              text: '遷移元の投稿',
              media: [{ file: 'items/e2e-0001/e2e-0001.png', type: 'image', width: 400, height: 300 }],
              [kind]: { url: 'https://x.com/target/status/123', text: '遷移先の本文', displayName: '遷移先の作者' },
            });
          } finally {
            sqlite.close();
          }
        },
      });
      const parent = page.locator('[data-slot="post-card"]').filter({ hasText: '遷移元の投稿' });
      if (viewer) await parent.dblclick();
      else await parent.click();
      if (viewer) await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
      await page.locator('[data-slot="quoted-post-card"]').getByRole('button', { name: '遷移先の作者' }).click();
      await expect(page.locator('[data-slot="image-tab-view"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="post-card"]')).toHaveCount(1);
      await expect(page.locator('[data-slot="post-card"]')).toContainText(FIXTURE_POSTS[0].text);
    });
  }
}
