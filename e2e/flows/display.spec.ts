import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../lib/harness.ts';

test('以前のリスト設定が残っていてもグリッドで表示し、表示設定を変更できる', async ({ launchHologram }) => {
  const { page } = await launchHologram({
    seed: ({ configDir }) => {
      const file = path.join(configDir, 'config.json');
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.writeFileSync(file, JSON.stringify({ ...config, layoutMode: 'list', posterLayoutMode: 'list', listThumb: 160 }));
    },
  });
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await expect(cards).toHaveCount(4);
  await expect.poll(() => cards.evaluateAll((items) => new Set(items.map((item) => Math.round(item.getBoundingClientRect().left))).size)).toBeGreaterThan(1);
  await page.getByRole('button', { name: '表示', exact: true }).click();
  const menu = page.locator('[data-slot="popover-content"]');
  await expect(menu.getByText('リスト', { exact: true })).toHaveCount(0);
  const square = menu.getByRole('switch').first();
  await expect(square).toBeEnabled();
  await square.click();
  await expect(square).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(cards).toHaveCount(4);
});
