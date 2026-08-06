'use strict';

// Smoke test for the browser-style tab system (Phase 3 verification).
// Tests: initial state, filter→title sync, Ctrl+T new tab, state restoration
// on switch, Ctrl+W close, last-tab reset, and tabs.json persistence.
//
//   node scripts/test-app-tabs.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { rendererWaits } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tabs-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

const records: any[] = [];
function addPost(id, text, tags) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url: `https://x.com/u/status/${id}`,
    platform: 'x',
    text,
    tags: tags || [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  });
}

addPost('p1', '投稿1', ['alpha']);
addPost('p2', '投稿2', ['alpha', 'beta']);
addPost('p3', '投稿3', ['beta']);
seedLibrary(configDir, records);

const evalJs = `(async () => {
  ${rendererWaits()}
  const key = (k, opts = {}) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  const tabItems  = () => document.querySelectorAll('[data-slot="tab"]');
  const tabCount  = () => tabItems().length;
  const tabActiveAt = (i) => { const t = tabItems(); return t.length > i && t[i].hasAttribute('data-active'); };
  const activeTitle = () => {
    const el = document.querySelector('[data-slot="tab"][data-active] [data-slot="tab-title"]');
    return el ? el.textContent.trim() : '';
  };
  const cardCount = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const chipRow = () => document.querySelector('[data-slot="filter-chips"]');
  const chipText = () => { const c = chipRow(); return c ? (c.textContent || '') : ''; };
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  // A tab switch changes renderer state at once but the grid refills over IPC, so
  // every step below waits for the count to LEAVE the previous tab's value and then
  // to stop moving — waiting for the expected number instead would assert nothing.

  await waitFor('the grid to show all 3 seeded posts', () => cardCount() >= 3);
  await waitFor('the tab bar to render a title for the active tab', () => activeTitle().length > 0);

  // ① Initial state
  const initTabCount  = tabCount();
  const initTitle     = activeTitle();

  // ② Add alpha filter via the "+ フィルタ" flow (filterbar component — the qf-pop
  //    flyout is gone since P2③): open the popover, pick "タグ" (tags), click the alpha row.
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  byText('button', 'フィルタ').click();
  await waitFor('the filter menu to list its categories', () => !!byText('[data-slot="command-item"]', 'タグ'));
  byText('[data-slot="command-item"]', 'タグ').click();
  await waitFor('the tag editor to list the alpha tag', () => !!byText('[data-slot="popover-content"] span', 'alpha'));
  byText('[data-slot="popover-content"] span', 'alpha').click();
  await waitFor('the chip row to show the applied alpha tag', () => chipText().includes('alpha'));
  await waitFor('the grid to narrow once the alpha tag is applied', () => cardCount() < 3);
  // close the picker (it stays open by design so several values can be toggled):
  // Escape is the dismissal, the outside click the fallback when it keeps focus
  key('Escape');
  document.body.click();
  await waitFor('the value picker to close', () => !document.querySelector(POP));
  const filteredTitle = activeTitle();
  const filteredCards = cardCount();

  // ③ Ctrl+T → new tab
  key('t', { ctrlKey: true });
  await waitFor('the new tab to open and take focus', () => tabCount() >= 2 && tabActiveAt(1));
  await waitFor('the new tab to leave the filtered post count behind', () => cardCount() !== filteredCards);
  await waitStable('the new tab grid to stop moving', () => cardCount());
  const tab2Count = tabCount();
  const tab2Title = activeTitle();
  const tab2Cards = cardCount();

  // ④ Switch back to tab 1 → filter restored
  const t0 = tabItems()[0];
  if (t0) t0.click();
  await waitFor('tab 1 to become the active tab again', () => tabActiveAt(0));
  await waitFor('the grid to leave the unfiltered post count behind', () => cardCount() !== tab2Cards);
  await waitStable('the restored grid to stop moving', () => cardCount());
  const restoredTitle = activeTitle();
  const restoredCards = cardCount();

  // ⑤ Switch to tab 2 → blank state
  const t1 = tabItems()[1];
  if (t1) t1.click();
  await waitFor('tab 2 to become the active tab', () => tabActiveAt(1));
  await waitFor('the grid to leave the filtered post count behind', () => cardCount() !== restoredCards);
  await waitStable('the grid to stop moving back on tab 2', () => cardCount());
  const tab2RestoredTitle = activeTitle();
  const tab2RestoredCards = cardCount();

  // ⑥ Ctrl+W → close tab 2, tab 1 becomes active
  key('w', { ctrlKey: true });
  await waitFor('the closed tab to leave a single tab behind', () => tabCount() <= 1);
  await waitFor('the surviving tab to bring its narrowed grid back', () => cardCount() !== tab2RestoredCards);
  await waitStable('the grid to stop moving after the tab closes', () => cardCount());
  const afterCloseCount = tabCount();
  const afterCloseTitle = activeTitle();
  const afterCloseCards = cardCount();

  // ⑦ Ctrl+W on last tab → resets state, does NOT close window
  key('w', { ctrlKey: true });
  await waitFor('the last tab to drop its filter chips on reset', () => chipRow() === null);
  await waitFor('the reset grid to leave the narrowed post count behind', () => cardCount() !== afterCloseCards);
  await waitStable('the grid to stop moving after the reset', () => cardCount());
  const lastTabCount = tabCount();
  const lastTabTitle = activeTitle();
  const lastTabCards = cardCount();

  // ⑧ The persist is debounced by 800ms in the renderer, so the delay IS the
  // specification here: there is nothing observable to poll until it elapses.
  await sleep(1000);
  let ipcOk = false;
  try {
    const data = await window.hologram.getTabs();
    ipcOk = !!(data && Array.isArray(data.tabs) && data.tabs.length >= 1);
  } catch {}

  return {
    initTabCount, initTitle,
    filteredTitle, filteredCards,
    tab2Count, tab2Title, tab2Cards,
    restoredTitle, restoredCards,
    tab2RestoredTitle, tab2RestoredCards,
    afterCloseCount, afterCloseTitle, afterCloseCards,
    lastTabCount, lastTabTitle, lastTabCards,
    ipcOk,
  };
})()`;

const shot = path.join(appDir, '.smoke-shot.png');
try {
  fs.unlinkSync(shot);
} catch {}

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'),
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
  HOLOGRAM_SMOKE_SHOT: shot,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r: Record<string, any> = {};
  try {
    r = JSON.parse((m && m[1]) as string);
  } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
    if (!cond) ok = false;
  };

  console.log('\n--- Tab system smoke test ---\n');
  check('① 初期: 1タブ', r.initTabCount === 1);
  check('① 初期タイトルが "すべて" を含む', r.initTitle && r.initTitle.includes('すべて'));
  check('② alpha フィルタ後: タイトルが "すべて" でない', r.filteredTitle && !r.filteredTitle.startsWith('すべて'));
  check('② alpha フィルタ後: 2件に絞り込まれている', r.filteredCards === 2);
  check('③ Ctrl+T 後: 2タブ', r.tab2Count === 2);
  check('③ 新タブタイトルが "すべて" を含む', r.tab2Title && r.tab2Title.includes('すべて'));
  check('③ 新タブは全件表示 (3件)', r.tab2Cards === 3);
  check('④ タブ1に戻る: フィルタタイトル復元', r.restoredTitle && !r.restoredTitle.startsWith('すべて'));
  check('④ タブ1に戻る: 2件に絞り込まれたまま', r.restoredCards === 2);
  check('⑤ タブ2に戻る: "すべて" タイトル', r.tab2RestoredTitle && r.tab2RestoredTitle.includes('すべて'));
  check('⑤ タブ2に戻る: 3件表示', r.tab2RestoredCards === 3);
  check('⑥ Ctrl+W: 1タブになる', r.afterCloseCount === 1);
  check('⑥ Ctrl+W 後: タブ1 (alpha) がアクティブ', r.afterCloseTitle && !r.afterCloseTitle.startsWith('すべて'));
  check('⑥ Ctrl+W 後: 2件表示 (alpha フィルタ)', r.afterCloseCards === 2);
  check('⑦ 最後の1タブ Ctrl+W: タブ数は1のまま', r.lastTabCount === 1);
  check('⑦ 最後の1タブ Ctrl+W: タイトルが "すべて" にリセット', r.lastTabTitle && r.lastTabTitle.includes('すべて'));
  check('⑦ 最後の1タブ Ctrl+W: 3件 (フィルタ解除)', r.lastTabCards === 3);
  check('⑧ タブがDBへ永続 (IPC 確認)', r.ipcOk);

  console.log('\n' + (ok ? 'TABS_TEST_PASS' : 'TABS_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
