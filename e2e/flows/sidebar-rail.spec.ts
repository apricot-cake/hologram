// 左サイドバーの既定ラベル付きレール（#678）— 実クリック/実キーで確かめる。
//
// #628 のジオメトリ不変条件（shell-axes.spec.ts）と #245 の一括トグル
// （scripts/panels-pref.test.ts の Ctrl+Shift+B 判定）はここでは重複させない——既存の
// スイートがそのまま通ることを別途確認する（実施は step 9・生の `npm run test:e2e` 実行）。
// ここが見るのは #678 に固有のもの: 新規プロファイルの初回描画・ホバー無しの発見性・
// ユーザー生成グループのレール非表示・Ctrl+B の往復。
import path from 'node:path';
import { expect, test } from '../lib/harness.ts';

const appDir = path.join(__dirname, '..', '..', 'app');

const FOLDERS = [{ id: 'f-a', name: '資料', kind: 'static', created: 1, parentId: null, items: [] }];
const SAVED_SEARCHES = [{ id: 's-a', name: '保存検索テスト', kind: 'dynamic', created: 2, tree: { children: [] } }];

function seedFolderAndSavedSearch({ configDir }: { configDir: string }) {
  const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
  const { createDbWriter } = require(path.join(appDir, 'src', 'main', 'lib-db-write.ts'));
  const { sqlite } = openDatabase(path.join(configDir, 'hologram.db'));
  createDbWriter(sqlite).setFolders({ folders: [...FOLDERS, ...SAVED_SEARCHES], activeId: null });
  sqlite.close();
}

// harness.ts の launch() は毎回 config.json に sidebarOpen を書かない（saveFolder /
// extensionId / theme の3キーだけ）ので、素の launchHologram() は「一度もトグルしていな
// い新規プロファイル」の代役として成立する。
test('新規プロファイルの初回起動はラベル付きレール（受け入れ条件1・2）', async ({ launchHologram }) => {
  const { page } = await launchHologram();

  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');

  // ホバーは一切行わない — ラベルが最初から読めることが受け入れ条件2の本体。
  const expectedLabels: Record<string, string> = {
    browsePosts: 'ライブラリ',
    browsePosters: '投稿者',
    trashTitle: 'ゴミ箱',
    paletteTitle: 'コマンドパレット',
    tabSettings: '設定',
  };
  for (const text of Object.values(expectedLabels)) {
    const label = page.locator('[data-slot="menu-label"]', { hasText: text });
    await expect(label).toBeVisible();
    await expect(label).toHaveText(text);
  }
  await expect(page.locator('[data-slot="menu-label"]')).toHaveCount(Object.keys(expectedLabels).length);
});

test('ユーザー生成グループはレールで隠れ、展開すると出る（受け入れ条件3）', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed: seedFolderAndSavedSearch });

  const folderRow = page.locator('[data-folder-id="f-a"]');
  const savedRow = page.locator('[data-slot="sidebar-menu-button"]', { hasText: '保存検索テスト' });

  // レール（既定）: DOM には居るが見えない。
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');
  await expect(folderRow).toBeAttached();
  await expect(folderRow).not.toBeVisible();
  await expect(savedRow).toBeAttached();
  await expect(savedRow).not.toBeVisible();

  // 展開: 両方見える。
  await page.keyboard.press('Control+b');
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded');
  await expect(folderRow).toBeVisible();
  await expect(savedRow).toBeVisible();
});

test('Ctrl+B は同一セッション内で往復する（受け入れ条件4の往復半分）', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const sidebar = page.locator('[data-slot="sidebar"]');

  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  await page.keyboard.press('Control+b');
  await expect(sidebar).toHaveAttribute('data-state', 'expanded');
  await page.keyboard.press('Control+b');
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  await page.keyboard.press('Control+b');
  await expect(sidebar).toHaveAttribute('data-state', 'expanded');
});
