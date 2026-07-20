'use strict';

// Verifies the タグ and ハッシュタグ value editors ("+ フィルタ" flow — the sidebar
// row flyouts are gone since P2③):
// - the タグ editor lists all user tags
// - the ハッシュタグ editor lists hashtags from post text; picking one filters the grid
//
//   node scripts/test-app-hashtags.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ht-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

function writePost(id, text, tags, hashtags) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, `${id}.json`),
    JSON.stringify(
      {
        captureId: id,
        image: `${id}.jpg`,
        url: `https://x.com/u/status/${id}`,
        platform: 'x',
        text,
        tags: tags || [],
        hashtags: hashtags || [],
        capturedAt: '2026-01-01T00:00:00.000Z',
        date: '2026-01-01T00:00:00.000Z',
      },
      null,
      2,
    ),
  );
}
// 8 unique user tags so the tag flyout search input is shown (> 8 items).
writePost('p1', 'TypeScript最高', ['alpha', 'beta', 'gamma'], ['typescript', 'プログラミング']);
writePost('p2', '別記事の続き', ['delta', 'epsilon'], ['typescript']);
writePost('p3', 'タグなし投稿', ['zeta', 'eta', 'theta'], ['rust']);

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 3);

  // Filterbar idioms (see test-app-facetcounts): one "+ フィルタ" popover session,
  // categories navigated via 戻る, queries scoped to the open popup.
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll(POP + ' div.cursor-default')];
  const rowEl = (name) => edRows().find((el) => { const n = el.querySelector('span.truncate'); return n && n.textContent === name; }) || null;
  const openMenu = async () => {
    byText('button', 'フィルタ').click();
    await waitFor(() => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  };
  const pickCat = async (label) => {
    byText(POP + ' [data-slot="command-item"]', label).click();
    await waitFor(() => edRows().length > 0);
  };
  const goBack = async () => {
    document.querySelector(POP + ' button[aria-label="戻る"]').click();
    await waitFor(() => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  };

  // --- タグ editor: lists all 8 user tags ---
  await openMenu();
  await pickCat('タグ');
  const tagFlyCount = edRows().length;

  // --- ハッシュタグ editor: lists the 3 distinct hashtags; pick '#typescript' ---
  await goBack();
  await pickCat('ハッシュタグ');
  const htFlyCount = edRows().length;
  const tsRow = rowEl('#typescript');
  if (tsRow) tsRow.click();
  await sleep(220);
  const htCards = document.querySelectorAll('#postGrid .post-card').length;

  return { tagFlyCount, htFlyCount, htCards };
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
    console.log((cond ? 'PASS ' : 'FAIL ') + label);
    if (!cond) ok = false;
  };
  check('tag row flyout lists the 8 user tags', r.tagFlyCount === 8);
  check('hashtag row flyout lists 3 distinct hashtags', r.htFlyCount === 3);
  check('selecting #typescript narrows grid to 2 posts', r.htCards === 2);
  console.log('\n' + (ok ? 'HASHTAG_TEST_PASS' : 'HASHTAG_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
