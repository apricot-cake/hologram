'use strict';

// Verifies the post-view query builder bar (current flyout-era UI):
//  - the builder bar is always visible; リセット is hidden until a filter exists
//  - adding a platform filter via its flyout adds a pill and filters the grid
//  - リセット clears the pills (and hides itself again)
//  - a search term becomes a real text-leaf pill (qc-text); deleting it clears the search
// Post-view is the default mode, so no mode switch is needed.
//
//   node scripts/test-app-postfilter.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-pf-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-pf' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (700 + i),
    platform: 'x', text: '投稿' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
}

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 3);
  const bar = document.getElementById('postActiveBar');
  const reset = document.getElementById('postResetBtn');
  // builder bar is always visible; reset hidden while nothing is filtered
  const barAlwaysOn = bar.style.display !== 'none';
  const resetHiddenBefore = reset.style.display === 'none';
  // add a platform filter via its flyout (sidebar restructure: rows → flyout)
  document.querySelector('#filterRows [data-qfrow="platform"]').click(); await sleep(60);
  const pop = document.querySelector('.qf-pop');
  pop.querySelector('[data-qfval="x"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(80);
  const pills = document.querySelectorAll('#queryChips .sb-active-chip').length;
  const resetShown = reset.style.display !== 'none';
  const cardsFiltered = document.querySelectorAll('#postGrid .post-card').length;
  // reset clears the pills and hides itself
  reset.click();
  await sleep(80);
  const pillsAfter = document.querySelectorAll('#queryChips .sb-active-chip').length;
  const resetHiddenAfter = reset.style.display === 'none';
  const cardsAfter = document.querySelectorAll('#postGrid .post-card').length;
  // a search term becomes a real text-leaf pill (qc-text), not the legacy 付箋
  const sb = document.getElementById('searchBox');
  sb.value = '投稿1'; sb.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(260);   // 検索入力は 150ms デバウンス後に描画される（それを越えて待つ）
  const searchPill = !!document.querySelector('#queryChips .qb-pill.qc-text');
  const noLegacy = !document.querySelector('#queryChips [data-special="search"]');
  // deleting the text leaf via its ✕ clears the search (box empties, reset hides)
  document.querySelector('#queryChips .qb-pill.qc-text .qb-del-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(80);
  const searchCleared = sb.value === '' && reset.style.display === 'none';
  return { barAlwaysOn, resetHiddenBefore, pills, resetShown, cardsFiltered, pillsAfter, resetHiddenAfter, cardsAfter, searchPill, noLegacy, searchCleared };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.barAlwaysOn === true && r.resetHiddenBefore === true && r.pills === 1 &&
    r.resetShown === true && r.cardsFiltered === 3 && r.pillsAfter === 0 &&
    r.resetHiddenAfter === true && r.cardsAfter === 3 &&
    r.searchPill === true && r.noLegacy === true && r.searchCleared === true;
  console.log(`barAlwaysOn=${r.barAlwaysOn} resetHiddenBefore=${r.resetHiddenBefore} pills=${r.pills} resetShown=${r.resetShown} filtered=${r.cardsFiltered} pillsAfter=${r.pillsAfter} resetHiddenAfter=${r.resetHiddenAfter} cardsAfter=${r.cardsAfter} searchPill=${r.searchPill} noLegacy=${r.noLegacy} searchCleared=${r.searchCleared}`);
  console.log(ok ? 'POSTFILTER_TEST_PASS' : 'POSTFILTER_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
