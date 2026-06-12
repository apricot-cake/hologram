'use strict';

// Smoke test for the browser-style tab system (Phase 3 verification).
// Tests: initial state, filter→title sync, Ctrl+T new tab, state restoration
// on switch, Ctrl+W close, last-tab reset, and tabs.json persistence.
//
//   node scripts/test-app-tabs.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tabs-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==',
  'base64'
);

function writePost(id, text, tags) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  fs.writeFileSync(path.join(saveFolder, `${id}.json`), JSON.stringify({
    captureId: id, image: `${id}.jpg`, url: `https://x.com/u/status/${id}`, platform: 'x',
    text, tags: tags || [],
    capturedAt: '2026-01-01T00:00:00.000Z', date: '2026-01-01T00:00:00.000Z',
  }, null, 2));
}

writePost('p1', '投稿1', ['alpha']);
writePost('p2', '投稿2', ['alpha', 'beta']);
writePost('p3', '投稿3', ['beta']);

const tabsJsonPath = path.join(saveFolder, 'tabs.json');

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); }
    return false;
  };
  const key = (k, opts = {}) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  const tabItems  = () => document.querySelectorAll('#tabBar .tab-item');
  const tabCount  = () => tabItems().length;
  const activeTitle = () => {
    const el = document.querySelector('#tabBar .tab-item.active .tab-title');
    return el ? el.textContent.trim() : '';
  };
  const cardCount = () => document.querySelectorAll('#postGrid .post-card').length;

  // Wait for all 3 posts to render
  await waitFor(() => cardCount() >= 3);
  await sleep(150);

  // ① Initial state
  const initTabCount  = tabCount();
  const initTitle     = activeTitle();

  // ② Add alpha filter via tag flyout
  const tagRow = document.querySelector('[data-qfrow="tag"]');
  if (tagRow) tagRow.click();
  await sleep(100);
  const alphaItem = document.querySelector('.qf-pop [data-qfval="alpha"]');
  if (alphaItem) alphaItem.click();
  await sleep(250);
  document.body.click(); await sleep(60);
  const filteredTitle = activeTitle();
  const filteredCards = cardCount();

  // ③ Ctrl+T → new tab
  key('t', { ctrlKey: true });
  await sleep(250);
  const tab2Count = tabCount();
  const tab2Title = activeTitle();
  const tab2Cards = cardCount();

  // ④ Switch back to tab 1 → filter restored
  const t0 = tabItems()[0];
  if (t0) t0.click();
  await sleep(250);
  const restoredTitle = activeTitle();
  const restoredCards = cardCount();

  // ⑤ Switch to tab 2 → blank state
  const t1 = tabItems()[1];
  if (t1) t1.click();
  await sleep(250);
  const tab2RestoredTitle = activeTitle();
  const tab2RestoredCards = cardCount();

  // ⑥ Ctrl+W → close tab 2, tab 1 becomes active
  key('w', { ctrlKey: true });
  await sleep(250);
  const afterCloseCount = tabCount();
  const afterCloseTitle = activeTitle();
  const afterCloseCards = cardCount();

  // ⑦ Ctrl+W on last tab → resets state, does NOT close window
  key('w', { ctrlKey: true });
  await sleep(250);
  const lastTabCount = tabCount();
  const lastTabTitle = activeTitle();
  const lastTabCards = cardCount();

  // ⑧ Wait for debounce (800ms) then verify IPC round-trip
  await sleep(1000);
  let ipcOk = false;
  try {
    const data = await window.corpus.getTabs();
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
try { fs.unlinkSync(shot); } catch {}

const env = Object.assign({}, process.env, {
  APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs, CORPUS_SMOKE_SHOT: shot,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  const fsTabsOk = fs.existsSync(tabsJsonPath);
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r = {};
  try { r = JSON.parse(m && m[1]); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
    if (!cond) ok = false;
  };

  console.log('\n--- Tab system smoke test ---\n');
  check('① 初期: 1タブ',                          r.initTabCount === 1);
  check('① 初期タイトルが "すべて" を含む',           r.initTitle && r.initTitle.includes('すべて'));
  check('② alpha フィルタ後: タイトルが "すべて" でない', r.filteredTitle && !r.filteredTitle.startsWith('すべて'));
  check('② alpha フィルタ後: 2件に絞り込まれている',   r.filteredCards === 2);
  check('③ Ctrl+T 後: 2タブ',                     r.tab2Count === 2);
  check('③ 新タブタイトルが "すべて" を含む',          r.tab2Title && r.tab2Title.includes('すべて'));
  check('③ 新タブは全件表示 (3件)',                  r.tab2Cards === 3);
  check('④ タブ1に戻る: フィルタタイトル復元',         r.restoredTitle && !r.restoredTitle.startsWith('すべて'));
  check('④ タブ1に戻る: 2件に絞り込まれたまま',        r.restoredCards === 2);
  check('⑤ タブ2に戻る: "すべて" タイトル',           r.tab2RestoredTitle && r.tab2RestoredTitle.includes('すべて'));
  check('⑤ タブ2に戻る: 3件表示',                   r.tab2RestoredCards === 3);
  check('⑥ Ctrl+W: 1タブになる',                   r.afterCloseCount === 1);
  check('⑥ Ctrl+W 後: タブ1 (alpha) がアクティブ',   r.afterCloseTitle && !r.afterCloseTitle.startsWith('すべて'));
  check('⑥ Ctrl+W 後: 2件表示 (alpha フィルタ)',     r.afterCloseCards === 2);
  check('⑦ 最後の1タブ Ctrl+W: タブ数は1のまま',      r.lastTabCount === 1);
  check('⑦ 最後の1タブ Ctrl+W: タイトルが "すべて" にリセット', r.lastTabTitle && r.lastTabTitle.includes('すべて'));
  check('⑦ 最後の1タブ Ctrl+W: 3件 (フィルタ解除)',   r.lastTabCards === 3);
  check('⑧ tabs.json 永続 (IPC 確認)',              r.ipcOk || fsTabsOk);

  console.log('\n' + (ok ? 'TABS_TEST_PASS' : 'TABS_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
