import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

test('カードのサムネイルは元の縦横比を保持する', async ({ launchHologram }) => {
  const { page } = await launchHologram({
    posts: [
      { ...FIXTURE_POSTS[0], captureId: 'portrait-card', width: 400, height: 600 },
      { ...FIXTURE_POSTS[0], captureId: 'landscape-card', width: 600, height: 400 },
    ],
  });
  const images = page.locator('[data-slot="post-grid"] [data-slot="post-card-media"]');
  await expect(images).toHaveCount(2);
  await expect
    .poll(() =>
      images.evaluateAll((nodes) =>
        nodes
          .map((el) => {
            const box = el.getBoundingClientRect();
            return Math.round((box.width / box.height) * 1000);
          })
          .sort((a, b) => a - b),
      ),
    )
    .toEqual([667, 1500]);
});
