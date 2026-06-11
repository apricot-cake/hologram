'use strict';
// Throwaway: tile-size slider + search-focus shortcuts + empty-state CTAs.
// Run 1 (empty library): first-run empty state shows the Alt+S hint (kbd) and
//   a "ZIP から復元" CTA button.
// Run 2 (seeded): tile view shows the slider; dragging (input) live-updates
//   the --tile-size var, release (change) keeps it; `/` and Ctrl+K focus the
//   search box (but not while typing or with settings open); a no-hit search
//   shows the "フィルタをリセット" CTA which restores the grid.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

function runApp(seed, evalJs) {
  return new Promise((resolve) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-ux-'));
    const configDir = path.join(tmp, 'Corpus');
    const saveFolder = path.join(tmp, 'saves');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(saveFolder, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
    if (seed) seed(saveFolder);
    const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
    const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
    child.on('close', () => {
      let r = {};
      const m = out.match(/EVAL_RESULT (.+)/);
      if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
      fs.rmSync(tmp, { recursive: true, force: true });
      resolve(r);
    });
  });
}

const evalEmpty = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const empty = document.getElementById('emptyState');
  await waitFor(() => empty.style.display !== 'none' && empty.innerHTML !== '');
  const importBtn = !!document.getElementById('emptyImportBtn');
  const kbdHint = empty.querySelectorAll('kbd').length >= 2;
  const ctaIsSquare = (() => {
    const b = document.getElementById('emptyImportBtn');
    return b ? getComputedStyle(b).borderRadius === '6px' : false;
  })();
  return { importBtn, kbdHint, ctaIsSquare };
})()`;

const evalSeeded = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const grid = document.getElementById('postGrid');
  const cards = () => grid.querySelectorAll('.post-card').length;
  await waitFor(() => cards() >= 4);

  // --- library-image card: no duplicated filename body, no empty badge ---
  const imgCard = [...grid.querySelectorAll('.post-card')]
    .find((c) => (c.querySelector('.user') || {}).textContent && c.querySelector('.user').textContent.includes('IMG_123'));
  const dedupOk = !!imgCard && !imgCard.querySelector('.post-meta .text');
  const noBadge = !!imgCard && !imgCard.querySelector('.platform-badge') &&
    imgCard.querySelector('.user').textContent.trim() === 'IMG_123';
  // hover keeps only the ⚡/ℹ pair (the rest lives in the right-click menu)
  const noUrlPacked = !!imgCard &&
    !imgCard.querySelector('.open-btn, .fold-btn, .edit-btn, .delete-btn') &&
    getComputedStyle(imgCard.querySelector('.info-btn')).right === '8px' &&
    getComputedStyle(imgCard.querySelector('.ws-btn')).right === '40px';
  const urlCard = grid.querySelector('.post-card[data-url^="https"]');
  const urlRow = !!urlCard && !urlCard.querySelector('.open-btn') &&
    getComputedStyle(urlCard.querySelector('.info-btn')).right === '8px';

  // --- reset button: hidden while nothing to reset, hugs the builder ---
  const resetBtn = document.getElementById('postResetBtn');
  const resetHidden = resetBtn.style.display === 'none';
  const resetNear = getComputedStyle(resetBtn).marginLeft === '10px';

  // --- size slider: tile/card = one detent per column, list = direct px ---
  const row = document.getElementById('tileSizeRow');
  const sl = document.getElementById('tileSlider');
  const colCount = () => getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const walk = async () => {
    const lo = parseInt(sl.min, 10), hi = parseInt(sl.max, 10);
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) || sl.disabled) return null;
    const seen = [];
    for (let v = lo; v <= hi; v++) {
      sl.value = String(v); sl.dispatchEvent(new Event('input', { bubbles: true })); await wait(30);
      seen.push(colCount());
    }
    // right = larger → every notch removes exactly one column
    return { seen: seen.join('>'), ok: seen.every((c, i) => i === 0 || c === seen[i - 1] - 1) };
  };
  document.getElementById('viewTile').click(); await wait(120);
  const sliderShown = row.style.display !== 'none' && !!sl;
  // tile action buttons: flex-centered glyphs, whole-pixel square (true circle)
  const dcs = getComputedStyle(grid.querySelector('.post-card .info-btn'));
  const tileBtnRound = dcs.display === 'flex' && dcs.width === dcs.height &&
    Number.isInteger(parseFloat(dcs.width));
  const tileWalk = await walk();
  sl.dispatchEvent(new Event('change', { bubbles: true })); await wait(150);
  const committed = /^\\d+px$/.test(grid.style.getPropertyValue('--tile-size')) && cards() >= 3;
  // card view: slider stays, same column-mapped track (different min/max)
  document.getElementById('viewCard').click(); await wait(120);
  const rowCard = row.style.display !== 'none';
  const cardWalk = await walk();
  sl.dispatchEvent(new Event('change', { bubbles: true })); await wait(150);
  // list view: full-width rows → the track maps straight to the thumbnail px
  document.getElementById('viewList').click(); await wait(120);
  const rowList = row.style.display !== 'none' && sl.step === '8' && sl.min === '56';
  sl.value = '120'; sl.dispatchEvent(new Event('input', { bubbles: true })); await wait(60);
  const listImg = grid.querySelector('.post-card img');
  const listDirect = !!listImg && getComputedStyle(listImg).width === '120px';
  sl.dispatchEvent(new Event('change', { bubbles: true })); await wait(120);
  document.getElementById('viewCard').click(); await wait(100);

  // --- search focus shortcuts ---
  const sb = document.getElementById('searchBox');
  const key = (target, opts) => target.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, opts)));
  sb.blur();
  key(document.body, { key: '/' });
  const slashFocus = document.activeElement === sb;
  sb.blur();
  key(document.body, { key: 'k', ctrlKey: true });
  const ctrlkFocus = document.activeElement === sb;
  // typing in a field: '/' must pass through (no preventDefault)
  sb.focus();
  const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
  sb.dispatchEvent(ev);
  const guardField = !ev.defaultPrevented;
  sb.blur();
  // settings open: shortcut must not fire
  document.getElementById('settingsBtn').click(); await wait(60);
  key(document.body, { key: '/' });
  const guardModal = document.activeElement !== sb;
  document.getElementById('settingsClose').click(); await wait(60);

  // --- query builder: ⓘ help has 6 rows; no hover tooltips on the builder ---
  document.getElementById('qbHelpBtn').click(); await wait(60);
  const helpRows = document.querySelectorAll('.qb-help-pop .qh-row').length === 6;
  document.getElementById('qbHelpBtn').click(); await wait(40);
  const noQbTips = ![...document.querySelectorAll('#queryChips .qc-zone, #queryChips .qc-join-sel')]
    .some((el) => el.hasAttribute('title'));

  // --- filtered-empty CTA ---
  sb.value = 'zzz該当なしzzz'; sb.dispatchEvent(new Event('input', { bubbles: true })); await wait(150);
  const emptyShown = document.getElementById('emptyState').style.display !== 'none';
  const resetVisibleNow = resetBtn.style.display !== 'none';   // search active → button appears
  const emptyReset = document.getElementById('emptyResetBtn');
  const resetShown = !!emptyReset;
  emptyReset.dispatchEvent(new MouseEvent('click', { bubbles: true })); await wait(150);
  const restored = cards() >= 4 && sb.value === '' && resetBtn.style.display === 'none';

  return { dedupOk, noBadge, noUrlPacked, urlRow, resetHidden, resetNear, resetVisibleNow,
    sliderShown, tileBtnRound, tileDetent: !!tileWalk && tileWalk.ok, committed, rowCard, cardDetent: !!cardWalk && cardWalk.ok,
    rowList, listDirect, slashFocus, ctrlkFocus, guardField, guardModal, helpRows, noQbTips, emptyShown, resetShown, restored,
    cols: (tileWalk ? tileWalk.seen : 'x') + ' / ' + (cardWalk ? cardWalk.seen : 'x') };
})()`;

(async () => {
  const r1 = await runApp(null, evalEmpty);
  const r2 = await runApp((saveFolder) => {
    for (let i = 0; i < 3; i++) {
      const id = '170000000000' + i + '-ux' + i;
      fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
      fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
        captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (900 + i),
        platform: 'x', text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
        likes: i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
        date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
      }, null, 2));
    }
    // library image: filename as title AND text, no platform/url/author —
    // the card must not repeat the filename as a body line or render an
    // empty platform badge (which indented the title).
    const iid = '1700000000009-uxim';
    fs.writeFileSync(path.join(saveFolder, iid + '.jpg'), jpeg);
    fs.writeFileSync(path.join(saveFolder, iid + '.json'), JSON.stringify({
      captureId: iid, image: iid + '.jpg', title: 'IMG_123', text: 'IMG_123',
      capturedAt: '2026-03-01T12:00:00Z', date: '2026-03-01T10:00:00Z',
      media: [], tags: [], hashtags: []
    }, null, 2));
  }, evalSeeded);
  const r = Object.assign({}, r1, r2);
  const keys = ['importBtn', 'kbdHint', 'ctaIsSquare', 'dedupOk', 'noBadge', 'noUrlPacked', 'urlRow', 'resetHidden', 'resetNear', 'resetVisibleNow',
    'sliderShown', 'tileBtnRound', 'tileDetent', 'committed', 'rowCard', 'cardDetent',
    'rowList', 'listDirect', 'slashFocus', 'ctrlkFocus', 'guardField', 'guardModal', 'helpRows', 'noQbTips', 'emptyShown', 'resetShown', 'restored'];
  const ok = keys.every((k) => r[k] === true);
  console.log('cols=' + r.cols + ' ' + keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'UIUX_VERIFY_PASS' : 'UIUX_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
})();
