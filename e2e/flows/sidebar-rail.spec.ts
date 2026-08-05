// The left sidebar — a labeled rail, and nothing else (#678 made it the default, #981 made
// it the only form). Confirmed with a real pointer/real keys.
//
// #628's geometry invariants (shell-axes.spec.ts) and #245's bulk toggle
// (scripts/panels-pref.test.ts's Ctrl+Shift+B check) are not duplicated here.
// What this file looks at: the first render, discoverability without hovering, the rail
// carrying no user-generated list of its own, the flyouts that hold those lists instead,
// and the absence of every route the expanded column used to have (Ctrl+B, a trigger
// button, a drag edge, a width-linked reshape).
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

test('初回起動はラベル付きレール（#678 受け入れ条件1・2）', async ({ launchHologram }) => {
  const { page } = await launchHologram();

  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');

  // No hovering at all — the labels being readable from the start IS acceptance criterion 2.
  // In DOM order — the list below is also the ordered assertion at the end of this test.
  const expectedLabels: Record<string, string> = {
    browsePosts: 'ライブラリ',
    browsePosters: '投稿者',
    browseTimeline: 'タイムライン',
    // #965: a FIXED row that opens the folder tree as a flyout — not the folder list
    // itself, which is what #678's acceptance criterion 3 (asserted below) forbids.
    // Always present, like the group it stands for: the tree is where a first folder
    // gets created, so it cannot be gated on already having one.
    qfCatFolder: 'フォルダ',
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

test('ユーザー生成グループはレールに並ばない（#678 受け入れ条件3 / #981）', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed: seedFolderAndSavedSearch });

  // #678 hid these rows behind a CSS switch that the expanded column turned off. With no
  // column left (#981) they are not rendered at all until a flyout opens — so this asserts
  // "not in the document", which the old "attached but invisible" could not distinguish.
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');
  await expect(page.locator('[data-folder-id="f-a"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="sidebar-menu-button"]', { hasText: '保存検索テスト' })).toHaveCount(0);
});

// #965: hiding the groups (above) is only half the design — the rail keeps a fixed row
// per group whose flyout carries the list, so no destination is out of reach. Since #981
// this is the ONLY way to the three lists, which is what makes it load-bearing.
test('レールのフォルダ行はフライアウトでツリーを出し、選ぶと適用して閉じる（#965）', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed: seedFolderAndSavedSearch });
  const sidebar = page.locator('[data-slot="sidebar"]');
  const flyout = page.locator('[data-slot="popover-content"]');
  // Addressed through the label, not the button: Base UI's Trigger stamps its own
  // data-slot onto whatever it renders, so these rows are `popover-trigger`, not
  // `sidebar-menu-button`. Anchored regex — plain "フォルダ" also matches 投稿者フォルダ.
  const railRow = (label: string) => page.locator('[data-slot="menu-label"]', { hasText: new RegExp(`^${label}$`) });

  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  await expect(flyout).toHaveCount(0);

  // The row opens the tree beside the rail, with the folder the column is hiding.
  await railRow('フォルダ').click();
  await expect(flyout).toBeVisible();
  await expect(flyout.locator('[data-folder-id="f-a"]')).toBeVisible();
  // The saved-search group has its own row, and its own flyout (the seed has one).
  await expect(railRow('保存した検索')).toBeVisible();

  // Esc dismisses without applying anything.
  await page.keyboard.press('Escape');
  await expect(flyout).toHaveCount(0);
  await expect(page.locator('[data-slot="filter-chip"]')).toHaveCount(0);

  // Picking a folder applies it as a place filter and gets out of the way.
  await railRow('フォルダ').click();
  await flyout.locator('[data-folder-id="f-a"] [data-slot="sidebar-menu-button"]').click();
  await expect(page.locator('[data-slot="filter-chip"]')).toHaveCount(1);
  await expect(flyout).toHaveCount(0);

  // …and the row for the place you are now in reads as selected.
  await railRow('フォルダ').click();
  await expect(flyout.locator('[data-folder-id="f-a"] [data-slot="sidebar-menu-button"][data-active]')).toBeVisible();
});

// The flyout has to be the manager too, not just a picker (#41's finalized decision D:
// the tree IS the manager, there is no modal behind it) — otherwise collapsing the
// column would quietly take creating, renaming and deleting away with it.
test('フライアウトからフォルダを作れる（#965 / #41 確定D）', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed: seedFolderAndSavedSearch });
  const flyout = page.locator('[data-slot="popover-content"]');

  await page.locator('[data-slot="menu-label"]', { hasText: /^フォルダ$/ }).click();
  await expect(flyout).toBeVisible();
  await flyout.locator('[data-sidebar="group-action"]').click();

  const dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('input').fill('新しい入れ物');
  await dialog.getByRole('button', { name: 'OK' }).click();

  await expect.poll(async () => (await page.evaluate(async () => (await window.hologram.getFolders()).folders.map((f) => f.name))).includes('新しい入れ物')).toBe(true);
});

// #981's acceptance conditions, stated as the absence of the old routes. Written as one
// case because they are one claim — there is no second form to reach, by any means.
test('展開する手段が無い（#981）', async ({ launchHologram }) => {
  const { app, page } = await launchHologram();
  const sidebar = page.locator('[data-slot="sidebar"]');
  const railWidth = () => page.locator('[data-slot="sidebar-container"]').evaluate((el) => el.getBoundingClientRect().width);

  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  const width = await railWidth();

  // The key that used to expand it, twice — a toggle would show on the second press even
  // if the first were swallowed.
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+b');
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  expect(await railWidth()).toBe(width);

  // The trigger button and the drag edge are gone from the DOM, not merely hidden.
  await expect(page.locator('[data-slot="sidebar-trigger"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="sidebar-rail"]')).toHaveCount(0);

  // …and the window's width does not reshape it either way (#259's retreat is gone with
  // the form it retreated from). 720 is the window's own minimum — below shadcn's `md`,
  // where upstream would have swapped the panel for a mobile Sheet with no opener.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(720, 800));
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  expect(await railWidth()).toBe(width);
});

// #812: pressing a destination button resets that side's filters back to the
// whole set — the name ("ライブラリ"/"投稿者") should always match what's shown.
// browseTo() is the one shared entry point (sidebar buttons + the command
// palette's "ライブラリを見る"/"投稿者を見る" both call it), so exercising the
// sidebar buttons here covers the fix regardless of which UI triggers it.
test('行き先を押すとそのビューのフィルタがリセットされる（#812）', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const postCards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  const posterCards = page.locator('[data-slot="poster-grid"] [data-slot="poster-card"]');
  const chips = page.locator('[data-slot="filter-chip"]');
  const search = page.getByPlaceholder('テキスト・ユーザー名で検索');
  const library = page.locator('[data-slot="sidebar-menu-button"]', { hasText: 'ライブラリ' });
  const posters = page.locator('[data-slot="sidebar-menu-button"]', { hasText: '投稿者' });

  await expect(postCards).toHaveCount(4);

  // Cross-mode arrival: filter posts, hop to posters (unfiltered, untouched), then
  // back to the library — landing on "ライブラリ" resets the post side.
  await search.fill('青');
  await expect(postCards).toHaveCount(1);
  await expect(chips).toHaveCount(1);
  await posters.click();
  await expect(posterCards).toHaveCount(4);
  await library.click();
  await expect(postCards).toHaveCount(4);
  await expect(chips).toHaveCount(0);
  await expect(search).toHaveValue('');

  // Same-mode press-again: pressing the destination that's already open used to be
  // a pure no-op via the store's same-value guard; filtered, it now resets instead.
  await posters.click();
  await search.fill('akane');
  await expect(posterCards).toHaveCount(1);
  await posters.click();
  await expect(posterCards).toHaveCount(4);
  await expect(search).toHaveValue('');

  // The reset is a real history entry — Alt+← undoes it like any other filter change.
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(posterCards).toHaveCount(1);
  await expect(search).toHaveValue('akane');
});
