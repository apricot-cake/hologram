'use strict';
// Throwaway: a mutation that un-matches the active filter must NOT make the card
// vanish instantly — it survives (sticky) until the next filter change.
//  1) tag filter A active (2 cards) → remove tag A from one post via the edit
//     dialog → still 2 cards + the edited one no longer has the tag on disk
//  2) changing the filter afterwards drops the survivor (1 card)
//  3) ungroup via detail popup while 複数画像のみ is on → card stays + toast
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-st-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// p0/p1: plain tagged posts. p2/p3: same post URL (auto-group of 2 images).
const seeds = [
  { id: '1700000000000-st0', url: 'https://x.com/u/status/10', tags: ['A'] },
  { id: '1700000000001-st1', url: 'https://x.com/u/status/11', tags: ['A'] },
  // p2/p3: drag-saved artworks of the SAME post → one auto-group with 2 files
  { id: '1700000000002-st2', url: 'https://x.com/u/status/12', tags: [], source: 'drag' },
  { id: '1700000000003-st3', url: 'https://x.com/u/status/12', tags: [], source: 'drag' }
];
seeds.forEach((s, i) => {
  fs.writeFileSync(path.join(saveFolder, s.id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, s.id + '.json'), JSON.stringify({
    captureId: s.id, image: s.id + '.jpg', url: s.url, source: s.source || undefined,
    platform: 'x', text: '本文' + i, displayName: '人', screenName: 'u',
    likes: i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: s.tags, hashtags: []
  }, null, 2));
});
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const grid = document.getElementById('postGrid');
  const cards = () => grid.querySelectorAll('.post-card').length;
  await waitFor(() => cards() >= 3);   // 4 records → 3 groups (p2+p3 share a URL)
  localStorage.setItem('corpus.pinnedTags', JSON.stringify(['A']));
  document.getElementById('searchBox').dispatchEvent(new Event('input', { bubbles: true }));
  await wait(80);   // re-render → pinned chip appears
  const tagChip = () => document.querySelector('#sbPinnedTags .sb-chip[data-filter-value="A"]');
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  // 1) filter by tag A → 2 cards; remove the tag from the first card via edit
  console.log('CHK tagChip=' + !!tagChip());
  click(tagChip()); await wait(80);
  const filtered = cards() === 2;
  const card0 = grid.querySelector('.post-card[data-index="0"]');
  console.log('CHK card0=' + !!card0);
  // tag edit moved into the card context menu (hover keeps only ⚡/ℹ)
  card0.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 }));
  await wait(40);
  document.querySelector('.card-menu.show .fm-row[data-act="edit"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(60);
  const rm = document.querySelector('#editTagsList [data-remove-tag]');
  console.log('CHK rm=' + !!rm);
  rm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  document.getElementById('editSave').click();
  await wait(250);
  const staysVisible = cards() === 2;          // sticky: still on screen
  const lp = await window.corpus.listPosts();
  const taggedLeft = lp.posts.filter((p) => (p.tags || []).includes('A')).length === 1;

  // 2) a filter change clears the sticky survivor: トグル解除→再追加で確認
  click(tagChip()); await wait(80);            // A 解除（フィルタ変更→sticky掃除）
  const allBack = cards() === 3;
  click(tagChip()); await wait(80);            // A 再追加 → 生存者は消えている
  const survivorGone = cards() === 1;
  click(tagChip()); await wait(80);            // 後続テストのため解除

  // 3) 複数画像のみ + ungroup via the ℹ popup → the two singles stay (sticky)
  // 複数画像 is now a row inside the メディア flyout (folded from the old checkbox).
  document.querySelector('#filterRows [data-qfrow="media"]').click(); await wait(80);
  [...document.querySelectorAll('.qf-pop .fm-row[data-qfval]')].find((r) => r.dataset.qfval === '__multi').click();
  await wait(120);
  const multiOne = cards() === 1;              // only the p2+p3 group
  grid.querySelector('.post-card .info-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(60);
  const ug = document.getElementById('pdUngroup');
  console.log('CHK ug=' + !!ug);
  ug.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(200);
  const ungroupSticky = cards() === 2;         // both singles remain visible
  const toastEl = document.getElementById('toast');
  const toastShown = !!toastEl && toastEl.textContent === 'グループを解除しました';
  return { filtered, staysVisible, taggedLeft, allBack, survivorGone, multiOne, ungroupSticky, toastShown };
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const keys = ['filtered', 'staysVisible', 'taggedLeft', 'allBack', 'survivorGone', 'multiOne', 'ungroupSticky', 'toastShown'];
  const ok = keys.every((k) => r[k] === true);
  console.log(keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'STICKY_VERIFY_PASS' : 'STICKY_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
