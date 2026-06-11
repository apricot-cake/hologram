'use strict';
// Throwaway: ℹ inspector = persistent right column (was a centered modal).
//  - aside#postDetail.inspector lives inside #appMain (inline column)
//  - ℹ opens it; the inspected card gets a tinted ring (.inspected)
//  - `/` still focuses search while it is open (panel is non-modal)
//  - clicking another card's image SWAPS the content (no lightbox)
//  - double-click opens the gallery on top; Esc closes gallery only,
//    the next Esc closes the panel
//  - タグを編集 opens the existing tag editor overlay
//  - re-render keeps the ring on the inspected card
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-in-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
for (let i = 0; i < 4; i++) {
  const id = '170000000000' + i + '-in' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (300 + i),
    platform: 'x', text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: ['t' + i], hashtags: []
  }, null, 2));
}
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const grid = document.getElementById('postGrid');
  const cards = () => grid.querySelectorAll('.post-card').length;
  await waitFor(() => cards() >= 4);
  const insp = document.getElementById('postDetail');
  const lightbox = document.getElementById('lightbox');
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const title = () => ((insp.querySelector('.iv-insp-title') || {}).textContent || '').trim();
  const cardText = (c) => ((c.querySelector('.text') || {}).textContent || '').trim();

  // structure: inline aside inside #appMain, layout mode follows the breakpoint
  const isAside = insp.tagName === 'ASIDE' && insp.classList.contains('inspector') &&
    insp.parentElement.id === 'appMain';

  // ℹ opens; content matches the card; ring marks it
  const card0 = grid.querySelector('.post-card[data-index="0"]');
  click(card0.querySelector('.info-btn')); await wait(100);
  const opened = !insp.hidden;
  const t0 = title();
  // card .text carries an extra "クリックで全文表示" hint → prefix match
  const contentOk = t0 !== '' && cardText(card0).startsWith(t0);
  const ring0 = card0.classList.contains('inspected');
  // open = click swaps, so images must show a plain pointer (not zoom-in)
  const cursorSwap = grid.classList.contains('insp-open') &&
    getComputedStyle(card0.querySelector('img.card-img')).cursor === 'pointer';
  const hasActions = !!document.getElementById('pdEdit') && !!document.getElementById('pdOpen') && !!document.getElementById('pdClose');
  const posMode = getComputedStyle(insp).position;
  const layoutOk = matchMedia('(max-width: 1279px)').matches ? posMode === 'fixed' : posMode === 'sticky';

  // non-modal: '/' focuses search while the panel is open
  const sb = document.getElementById('searchBox');
  sb.blur();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
  const slashWorks = document.activeElement === sb;
  sb.blur();

  // ℹ on another card swaps the content (stays live in slide-over mode)
  const card2 = grid.querySelector('.post-card[data-index="2"]');
  click(card2.querySelector('.info-btn')); await wait(100);
  const t2 = title();
  const swapped = !insp.hidden && t2 !== '' && cardText(card2).startsWith(t2) && t2 !== t0;
  const ringMoved = card2.classList.contains('inspected') && !card0.classList.contains('inspected');

  // slide-over (the 1100px default window is below the 1280 breakpoint):
  // clicking the grid/cards outside the panel closes it, and the click is
  // consumed — no gallery on the same press. Inline (wide) keeps it open.
  const narrowMode = matchMedia('(max-width: 1279px)').matches;
  click(card2.querySelector('.card-img')); await wait(120);
  const outsideCloses = narrowMode
    ? (insp.hidden && !lightbox.classList.contains('show'))
    : !insp.hidden;
  // reopen for the remaining checks
  click(card2.querySelector('.info-btn')); await wait(80);

  // タグを編集 opens the tag editor; cancel returns to the open panel
  click(document.getElementById('pdEdit')); await wait(80);
  const editOpens = document.getElementById('editOverlay').classList.contains('show');
  click(document.getElementById('editCancel')); await wait(80);
  const editBack = !document.getElementById('editOverlay').classList.contains('show') && !insp.hidden;

  // a fresh re-render keeps the ring on the inspected card
  sb.value = ''; sb.dispatchEvent(new Event('input', { bubbles: true })); await wait(150);
  const ringKept = !!grid.querySelector('.post-card.inspected');

  // Esc (nothing else open) closes the panel and clears the ring
  esc(); await wait(80);
  const escCloses = insp.hidden && !grid.querySelector('.post-card.inspected');
  const cursorBack = !grid.classList.contains('insp-open') &&
    getComputedStyle(grid.querySelector('img.card-img')).cursor === 'zoom-in';

  // with the panel closed, clicking an image opens the gallery as before
  // (re-query: the search re-render replaced the card nodes)
  const card2b = grid.querySelector('.post-card[data-index="2"]');
  click(card2b.querySelector('.card-img')); await wait(100);
  const galleryNormal = lightbox.classList.contains('show');
  esc(); await wait(60);

  return { isAside, opened, contentOk, ring0, cursorSwap, hasActions, layoutOk, slashWorks,
    swapped, ringMoved, outsideCloses, editOpens, editBack, ringKept, escCloses, cursorBack, galleryNormal,
    dbg: JSON.stringify({ t0, c0: cardText(card0), t2, c2: cardText(card2), narrowMode }) };
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
  const keys = ['isAside', 'opened', 'contentOk', 'ring0', 'cursorSwap', 'hasActions', 'layoutOk', 'slashWorks',
    'swapped', 'ringMoved', 'outsideCloses', 'editOpens', 'editBack', 'ringKept', 'escCloses', 'cursorBack', 'galleryNormal'];
  const ok = keys.every((k) => r[k] === true);
  console.log(keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'INSPECTOR_VERIFY_PASS' : 'INSPECTOR_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
