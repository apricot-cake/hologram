'use strict';

// Base UI のサブメニューは実ポインタ操作で開く。レンダラーへ式を注入する
// smoke harness ではその入力を再現できないため、ここだけは Playwright が
// Electron を直接操作し、投稿者・タグ・ハッシュタグの実際の選択経路を検証する。

const { _electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');

const appDir = path.join(__dirname, '../../../app');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-filter-menus-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const posts = [
  ['alice-1', 'Alice', 'alice', ['alpha', 'beta', 'gamma'], ['typescript', 'プログラミング']],
  ['alice-2', 'Alice', 'alice', ['delta', 'epsilon'], ['typescript']],
  ['bob', 'Bob', 'bob', ['zeta', 'eta', 'theta'], ['rust']],
  ['carol', 'Carol', 'carol', [], []],
].map(([captureId, displayName, screenName, tags, hashtags], index) => {
  fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), jpeg);
  return { captureId, image: `${captureId}.jpg`, url: `https://x.com/u/status/${captureId}`, platform: 'x', userId: screenName, displayName, screenName, text: captureId, tags, hashtags, capturedAt: `2026-01-0${index + 1}T00:00:00.000Z`, date: `2026-01-0${index + 1}T00:00:00.000Z` };
});
seedLibrary(configDir, posts);

async function main() {
  let app: import('playwright').ElectronApplication | undefined;
  try {
    const launched = await _electron.launch({ executablePath: resolveElectron(), args: ['.'], cwd: appDir, env: { ...process.env, APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir } });
    app = launched;
    const page = await launched.firstWindow();
    const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
    await cards.nth(3).waitFor();
    const open = async () => {
      await page.getByRole('button', { name: 'フィルタ' }).click();
      await page.locator('[data-slot="filter-panel"]').waitFor();
    };
    const category = async (label) => {
      await page.locator('[data-slot="filter-panel"]').getByText(label, { exact: true }).hover();
      const menu = page.locator(`[data-slot="dropdown-menu-sub-content"][aria-label="${label}"]`);
      await menu.waitFor();
      return menu;
    };

    await open();
    let menu = await category('投稿者');
    const authors = await menu.getByRole('menuitemcheckbox').allTextContents();
    if (!authors[0]?.includes('Alice') || !authors[1]?.includes('Bob') || !authors[2]?.includes('Carol')) throw new Error(`投稿者の順序が不正: ${authors.join(',')}`);
    await menu.getByRole('menuitemcheckbox', { name: /Alice/ }).click();
    await page.locator('[data-slot="filter-chips"]').getByText(/Alice/).waitFor();
    if ((await cards.count()) !== 2) throw new Error('Alice の投稿が2件に絞り込まれなかった');

    await page.getByRole('button', { name: 'フィルタ' }).click();
    await open();
    await page.locator('[data-slot="filter-panel"]').getByText('すべて解除', { exact: true }).click();
    await page.getByRole('button', { name: 'フィルタ' }).click();
    await cards.nth(3).waitFor();
    await open();
    menu = await category('タグ');
    const tagSearch = menu.getByRole('searchbox');
    await tagSearch.fill('alpha');
    if ((await menu.getByRole('menuitemcheckbox', { name: /alpha/ }).count()) !== 1) throw new Error('タグ検索が alpha を1件に絞り込まなかった');

    await page.getByRole('button', { name: 'フィルタ' }).click();
    await open();
    menu = await category('ハッシュタグ');
    if ((await menu.getByRole('menuitemcheckbox').count()) !== 3) throw new Error('ハッシュタグが3件一覧されなかった');
    await menu.getByRole('menuitemcheckbox', { name: /#typescript/ }).click();
    if ((await cards.count()) !== 2) throw new Error('#typescript が2件に絞り込まなかった');
    console.log('FILTER_MENUS_TEST_PASS');
  } finally {
    await app?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
