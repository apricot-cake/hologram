'use strict';

// Verifies the post-view active-filter bar:
//  - adding a platform filter shows #postActiveBar with a pill in #queryChips
//  - clicking リセット clears it and hides the bar again
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
  await new Promise(r => setTimeout(r, 700));
  const bar = document.getElementById('postActiveBar');
  const barBefore = bar.style.display !== 'none';
  // add a platform filter
  document.querySelector('.sb-chip[data-filter-type="platform"][data-filter-value="x"]').click();
  await new Promise(r => setTimeout(r, 50));
  const barShown = bar.style.display !== 'none';
  const pills = document.querySelectorAll('#queryChips .sb-active-chip').length;
  const cardsFiltered = document.querySelectorAll('#postGrid .post-card').length;
  // reset
  document.getElementById('postResetBtn').click();
  await new Promise(r => setTimeout(r, 50));
  const barAfter = bar.style.display === 'none';
  const cardsAfter = document.querySelectorAll('#postGrid .post-card').length;
  // 検索もアクティブバーにピル化される（検索単独でもバーが出る）
  const sb = document.getElementById('searchBox');
  sb.value = '投稿1'; sb.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
  const searchBarShown = bar.style.display !== 'none';
  const searchPill = !!document.querySelector('#queryChips .sb-active-chip[data-special="search"]');
  // 検索ピルをクリックで個別解除 → 検索クリア＆バー非表示
  document.querySelector('#queryChips .sb-active-chip[data-special="search"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
  const searchCleared = sb.value === '' && bar.style.display === 'none';
  return { barBefore, barShown, pills, cardsFiltered, barAfter, cardsAfter, searchBarShown, searchPill, searchCleared };
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
  const ok = r.barBefore === false && r.barShown === true && r.pills === 1 &&
    r.cardsFiltered === 3 && r.barAfter === true && r.cardsAfter === 3 &&
    r.searchBarShown === true && r.searchPill === true && r.searchCleared === true;
  console.log(`barBefore=${r.barBefore} barShown=${r.barShown} pills=${r.pills} filtered=${r.cardsFiltered} barAfter=${r.barAfter} cardsAfter=${r.cardsAfter} searchBarShown=${r.searchBarShown} searchPill=${r.searchPill} searchCleared=${r.searchCleared}`);
  console.log(ok ? 'POSTFILTER_TEST_PASS' : 'POSTFILTER_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
