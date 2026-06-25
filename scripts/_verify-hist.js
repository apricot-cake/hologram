'use strict';
// Throwaway: verify (1) back/forward history over filter & view state,
// (2) the tile info-overlay toggle (.no-overlay), and (3) the ❤-on-tiles
// gating (.show-eng only under an engagement sort/filter).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-hist-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const plats = ['x', 'x', 'bluesky'];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-h' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (100 + i),
    platform: plats[i], text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
}
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const grid = document.getElementById('postGrid');
  const cards = () => grid.querySelectorAll('.post-card').length;
  await waitFor(() => cards() >= 3);
  await wait(950);   // separate the baseline from the next push (typing-coalesce window)

  const back = document.getElementById('histBack');
  const fwd = document.getElementById('histFwd');
  const backDisabledAtStart = back.disabled;

  // platform filter via the sidebar row flyout → 2 cards, back becomes enabled
  const platRow = document.querySelector('#filterRows [data-qfrow="platform"]');
  platRow.click(); await wait(50);
  document.querySelector('.qf-pop [data-qfval="x"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(120);
  document.body.click(); await wait(40);   // close the flyout
  const afterFilter = cards() === 2 && !back.disabled;

  // ← undoes the filter, → redoes it
  back.click(); await wait(120);
  const afterBack = cards() === 3 && !fwd.disabled && document.querySelectorAll('#queryChips .sb-active-chip').length === 0;
  fwd.click(); await wait(120);
  const afterFwd = cards() === 2;

  // search gets its own entry; ← restores the pre-search state
  await wait(950);
  const sb = document.getElementById('searchBox');
  sb.value = '本文0'; sb.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(120);
  const afterSearch = cards() === 1;
  back.click(); await wait(120);
  const backClearsSearch = sb.value === '' && cards() === 2;

  // view density is NOT part of the history: switching to tile and pressing ←
  // changes the filter state but the view stays tile
  await wait(950);
  document.getElementById('viewTile').click(); await wait(120);
  const tiledNow = grid.classList.contains('tile-view');
  back.click(); await wait(120);
  const backToCard = grid.classList.contains('tile-view') && cards() === 3;   // view kept, filters reverted

  // tile overlay toggle (now lives in settings) + ❤ gating
  const ovRowShown = !!document.getElementById('tileOverlayToggle').closest('#panelSettings');
  const engHiddenDefault = !grid.classList.contains('show-eng');
  document.getElementById('tileOverlayToggle').checked = false;
  document.getElementById('tileOverlayToggle').dispatchEvent(new Event('change', { bubbles: true }));
  await wait(80);
  const noOverlay = grid.classList.contains('no-overlay');
  const sort = document.getElementById('sortSelect');
  sort.value = 'likes-desc'; sort.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(80);
  const engShownOnSort = grid.classList.contains('show-eng');
  const hasImgWinApi = typeof window.corpus.openImageWindow === 'function';

  // 行フライアウト: 8行 → プラットフォーム行 → 値5 → 選択で適用＆開いたまま
  document.getElementById('postResetBtn').click(); await wait(150);
  const popCats = document.querySelectorAll('#filterRows .sb-row').length === 7;
  document.querySelector('#filterRows [data-qfrow="platform"]').click(); await wait(50);
  const pop = document.querySelector('.qf-pop');
  const popVals = pop.classList.contains('show') && pop.querySelectorAll('[data-qfval]').length === 5;
  pop.querySelector('[data-qfval="x"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); await wait(150);
  const popApplied = cards() === 2 && pop.classList.contains('show') &&
    document.querySelector('#filterRows [data-badge="platform"]').classList.contains('on');
  document.body.click(); await wait(40);
  const popClosed = !pop.classList.contains('show');
  // 件数はサイドバーフッターへ、最上部へ戻るボタンは未スクロール時非表示
  const countInFooter = !!document.getElementById('postCount').closest('.sidebar-footer');
  const sbTopHidden = document.getElementById('sbTop').style.display === 'none';

  return { backDisabledAtStart, afterFilter, afterBack, afterFwd, afterSearch, backClearsSearch,
    tiledNow, backToCard, ovRowShown, engHiddenDefault, noOverlay, engShownOnSort, hasImgWinApi,
    popCats, popVals, popApplied, popClosed, countInFooter, sbTopHidden };
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
  const keys = ['backDisabledAtStart', 'afterFilter', 'afterBack', 'afterFwd', 'afterSearch', 'backClearsSearch',
    'tiledNow', 'backToCard', 'ovRowShown', 'engHiddenDefault', 'noOverlay', 'engShownOnSort', 'hasImgWinApi',
    'popCats', 'popVals', 'popApplied', 'popClosed', 'countInFooter', 'sbTopHidden'];
  const ok = keys.every((k) => r[k] === true);
  console.log(keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'HIST_VERIFY_PASS' : 'HIST_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
