// The left sidebar's default labeled rail (#678) — confirmed with a real pointer/real keys.
//
// #628's geometry invariants (shell-axes.spec.ts) and #245's bulk toggle
// (scripts/panels-pref.test.ts's Ctrl+Shift+B check) are not duplicated here — that the
// existing suites still pass is confirmed separately (done at step 9, running raw
// `npm run test:e2e`).
// What this file looks at is specific to #678: a fresh profile's first render,
// discoverability without hovering, user-generated groups being hidden on the rail, and
// Ctrl+B round-tripping.
import path from 'node:path';
import { expect, test } from '../lib/harness.ts';

const appDir = path.join(__dirname, '..', '..', 'app');

const FOLDERS = [{ id: 'f-a', name: '資料', kind: 'static', created: 1, parentId: null, items: [] }];
const SAVED_SEARCHES = [{ id: 's-a', name: '保存検索テスト', kind: 'dynamic', created: 2, tree: { children: [] } }];

function seedFolderAndSavedSearch({ saveFolder }: { saveFolder: string }) {
  const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
  const { createDbWriter } = require(path.join(appDir, 'src', 'main', 'lib-db-write.ts'));
  // #176: hologram.db lives inside the save folder now, not configDir (ADR 0025).
  const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));
  createDbWriter(sqlite).setFolders({ folders: [...FOLDERS, ...SAVED_SEARCHES], activeId: null });
  sqlite.close();
}

// harness.ts's launch() never writes sidebarOpen into config.json (only the three keys
// saveFolder / extensionId / theme), so a plain launchHologram() stands in for "a fresh
// profile that has never been toggled".
test('新規プロファイルの初回起動はラベル付きレール（受け入れ条件1・2）', async ({ launchHologram }) => {
  const { page } = await launchHologram();

  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');

  // No hovering at all — the labels being readable from the start IS acceptance criterion 2.
  // In DOM order — the list below is also the ordered assertion at the end of this test.
  const expectedLabels: Record<string, string> = {
    browsePosts: 'ライブラリ',
    browsePosters: '投稿者',
    browseTimeline: 'タイムライン',
    trashTitle: 'ゴミ箱',
    paletteTitle: 'コマンドパレット',
    // #145's global history row is an unconditional footer entry between the
    // palette and Settings (shell/LeftSidebar.tsx) — the rail grows whenever an
    // app-level entry point is added, and this list is what states which ones
    // acceptance criterion 3 considers legitimate.
    historyTitle: '履歴',
    tabSettings: '設定',
  };
  for (const text of Object.values(expectedLabels)) {
    const label = page.locator('[data-slot="menu-label"]', { hasText: text });
    await expect(label).toBeVisible();
    await expect(label).toHaveText(text);
  }
  // Nothing else may be on the rail — a user-generated group leaking in is what
  // acceptance criterion 3 forbids. Asserted as the ordered list rather than as a count:
  // the nightly runner reported "6, wanted 5" and there was no way to tell WHICH row had
  // appeared (#818). A text match prints the list it actually found, so the next failure
  // names the intruder instead of only counting it.
  await expect(page.locator('[data-slot="menu-label"]')).toHaveText(Object.values(expectedLabels));
});

test('ユーザー生成グループはレールで隠れ、展開すると出る（受け入れ条件3）', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed: seedFolderAndSavedSearch });

  const folderRow = page.locator('[data-folder-id="f-a"]');
  const savedRow = page.locator('[data-slot="sidebar-menu-button"]', { hasText: '保存検索テスト' });

  // Rail (default): present in the DOM but not visible.
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');
  await expect(folderRow).toBeAttached();
  await expect(folderRow).not.toBeVisible();
  await expect(savedRow).toBeAttached();
  await expect(savedRow).not.toBeVisible();

  // Expanded: both are visible.
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
