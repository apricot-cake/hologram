'use strict';

// Verifies the grid's empty-space gesture in a real renderer — both halves of the
// same press: drag it and a band selects the cards it touches (#484), release it
// without dragging and the selection clears (#242).
//
// What this covers that scripts/marquee.test.ts cannot: the gesture is wired to
// the right element, the hit test reads masonic's positioner, and the answer it
// produces matches where the cards actually ARE (the test derives its expectation
// from live DOM rects and compares — model vs. reality, which is the whole risk in
// a virtualized grid). Plus the guards: Ctrl extends instead of replacing, Esc
// restores, a held modifier makes a background click a no-op, and the inspector
// follows the selection down to its placeholder.
//
// What it cannot cover: the feel of the real gesture and auto-scroll — synthetic
// events step through the frames instantly. That needs a real pointer (#484 本文).
//
//   node scripts/test-app-marquee.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { readEvalResult } = require('./lib-eval-result.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-marquee-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// Enough posts for several masonry rows, so a band can cut one row without
// touching the ones around it.
const records: any[] = [];
for (let i = 0; i < 12; i++) {
  const id = `dummy-m${i}`;
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url: `https://x.com/u${i}/status/${900 + i}`,
    platform: 'x',
    text: `本文${i}`,
    displayName: `人${i}`,
    screenName: `u${i}`,
    capturedAt: `2026-05-01T12:00:${String(i).padStart(2, '0')}Z`,
    date: `2026-04-01T10:00:${String(i).padStart(2, '0')}Z`,
    media: [{ file: `${id}-orig.jpg`, url: 'https://x.com/i/1.jpg' }],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  const byId = (id) => document.getElementById(id);
  const cards = () => [...document.querySelectorAll('#postGrid .post-card')];
  const selectedKeys = () => [...document.querySelectorAll('#postGrid .post-card.selected')].map(c => c.dataset.key).sort();
  const band = () => document.querySelector('.grid-marquee');
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out = {};

  await waitFor(() => cards().length >= 12);
  await sleep(200); // let masonic settle its measured heights before reading rects

  const scroller = byId('mode-post');
  const sr = scroller.getBoundingClientRect();

  const down = (x, y, mods) => scroller.dispatchEvent(new MouseEvent('mousedown', Object.assign({ bubbles: true, button: 0, clientX: x, clientY: y }, mods)));
  const move = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
  const up = () => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  // Press and release with no movement at all: the click half of the gesture (#242).
  // No 'click' event is synthesized, so the narrow overlay's outside-click dismiss
  // (a separate listener) cannot be what any of this measures.
  const click = (x, y, mods) => { down(x, y, mods); up(); };
  const inspectedCards = () => document.querySelectorAll('#postGrid .post-card.inspected').length;
  const panelFilled = () => !!document.querySelector('#postDetailBox [data-slot="inspector-tags"]');
  // The panel's "nothing is selected" state (#244). Asserted on its own rather than
  // as "not filled": the placeholder is what has to be THERE, and the panel renders
  // it at both widths (only whether the column is on screen differs).
  const panelPlaceholder = () => !!document.querySelector('#postDetailBox [data-slot="inspector-empty"]');

  // Cards the band would touch, computed from LIVE DOM rects — the independent
  // answer the app's positioner-based hit test has to agree with.
  const expectFor = (x0, y0, x1, y1) => {
    const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
    return cards().filter(c => { const k = c.getBoundingClientRect(); return l < k.right && r > k.left && t < k.bottom && b > k.top; }).map(c => c.dataset.key).sort();
  };
  // One full pass: press in the left margin, cross the threshold, drag, release.
  const drag = async (x0, y0, x1, y1, mods) => {
    down(x0, y0, mods);
    move(x0 + 8, y0 + 8); // past MARQUEE_THRESHOLD → the band arms itself
    await sleep(50);
    move(x1, y1);
    await sleep(120); // a few animation frames of hit testing
    up();
    await sleep(60);
  };

  // Rows, top-first: pick a band that cuts through the middle of one row only.
  const rows = {};
  for (const c of cards()) { const k = c.getBoundingClientRect(); const key = Math.round(k.top); (rows[key] = rows[key] || []).push({ el: c, r: k }); }
  const rowTops = Object.keys(rows).map(Number).sort((a, b) => a - b);
  const row0 = rows[rowTops[0]].sort((a, b) => a.r.left - b.r.left);
  out.rowCount = rowTops.length;
  out.row0Count = row0.length;
  // Thin horizontal band through row 0, from the left margin to the middle of the
  // SECOND column — so it must take exactly the first two cards of that row.
  const cy = Math.round((row0[0].r.top + row0[0].r.bottom) / 2);
  const x0 = Math.round(sr.left + 6);          // the scroller's padding: empty space
  const x1 = Math.round((row0[1].r.left + row0[1].r.right) / 2);
  out.startsOnEmptySpace = document.elementFromPoint(x0, cy) === scroller;

  // A. plain drag selects what it touched, and nothing else
  out.expectA = expectFor(x0, cy - 5, x1, cy + 5);
  await drag(x0, cy - 5, x1, cy + 5);
  out.gotA = selectedKeys();
  out.scrolledA = scroller.scrollTop; // the band stayed clear of the auto-scroll edges
  out.selectingClass = byId('postGrid').classList.contains('selecting');
  out.bandRemovedA = !band();

  // B. a press that never crosses the threshold draws no band, and with Ctrl held
  //    it leaves the selection completely alone (#242 skips the clear on a modifier)
  down(x0, cy, { ctrlKey: true });
  move(x0 + 1, cy + 1);
  await sleep(60);
  out.bandDuringB = !!band();
  up();
  await sleep(60);
  out.gotB = selectedKeys();

  // C. Ctrl held at press time EXTENDS: row 1's first two cards join row 0's
  const row1 = rows[rowTops[1]].sort((a, b) => a.r.left - b.r.left);
  const cy1 = Math.round((row1[0].r.top + row1[0].r.bottom) / 2);
  const x1b = Math.round((row1[1].r.left + row1[1].r.right) / 2);
  out.expectC = [...new Set([...out.gotA, ...expectFor(x0, cy1 - 5, x1b, cy1 + 5)])].sort();
  await drag(x0, cy1 - 5, x1b, cy1 + 5, { ctrlKey: true });
  out.gotC = selectedKeys();

  // D. a plain drag over a single card REPLACES everything selected so far
  const only = row0[0];
  out.expectD = expectFor(x0, cy - 5, Math.round((only.r.left + only.r.right) / 2), cy + 5);
  await drag(x0, cy - 5, Math.round((only.r.left + only.r.right) / 2), cy + 5);
  out.gotD = selectedKeys();

  // E. the band paints while dragging, and Esc puts the selection back
  const before = selectedKeys();
  down(x0, cy1 - 5);
  move(x0 + 8, cy1);
  await sleep(80);
  out.bandVisibleE = !!band();
  move(x1b, cy1 + 5);
  // Live preview needs an animation frame, and a hidden window throttles rAF hard
  // (the passes above only land because the release does one final synchronous
  // pass) — so wait generously instead of assuming a 60Hz clock.
  out.changedDuringE = await waitFor(() => selectedKeys().join(',') !== before.join(','), 4000);
  esc();
  await sleep(60);
  out.bandRemovedE = !band();
  out.gotE = selectedKeys();
  out.expectE = before;
  up(); // the real gesture still ends with a release; it must not re-apply the band
  await sleep(60);
  out.gotEAfterUp = selectedKeys();

  // F. a drag that starts ON a card is not a marquee (cards own the OS drag-out)
  const cardEl = row0[0].el;
  cardEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: Math.round((only.r.left + only.r.right) / 2), clientY: cy }));
  move(x1, cy + 40);
  await sleep(80);
  out.bandFromCard = !!band();
  up();
  await sleep(40);

  // G. a plain click on empty space clears the selection AND sends the inspector
  //    back to its placeholder (#242). The card click first is what fills the panel.
  cardEl.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: Math.round((only.r.left + only.r.right) / 2), clientY: cy }));
  await sleep(120);
  out.selectedBeforeG = selectedKeys();
  out.inspectedBeforeG = inspectedCards();
  out.panelFilledBeforeG = panelFilled();
  click(x0, cy);
  await sleep(120);
  out.gotG = selectedKeys();
  out.inspectedAfterG = inspectedCards();
  out.panelFilledAfterG = panelFilled();
  out.panelPlaceholderAfterG = panelPlaceholder();
  out.bandDuringG = !!band(); // a click must not leave a rectangle behind

  // H. the same click with a modifier held changes nothing (Nautilus / Dolphin
  //    both gate their unselect_all on Ctrl/Shift being up)
  await drag(x0, cy - 5, x1, cy + 5);
  out.beforeH = selectedKeys();
  click(x0, cy, { ctrlKey: true });
  await sleep(80);
  out.gotHCtrl = selectedKeys();
  click(x0, cy, { shiftKey: true });
  await sleep(80);
  out.gotHShift = selectedKeys();

  // I. the empty space BELOW the last row is background too (#242 確定した設計 3):
  //    the grid is only as tall as its cards, so this is the biggest click target
  //    of all and the one a rect-of-the-grid hit test would miss.
  scroller.scrollTop = scroller.scrollHeight;
  await sleep(200);
  const lowest = Math.max(...cards().map(c => c.getBoundingClientRect().bottom));
  const belowY = Math.round(lowest + 24);
  const belowX = Math.round(sr.left + scroller.clientWidth / 2);
  out.belowAvailable = belowY < sr.bottom - 4;
  out.belowIsEmpty = out.belowAvailable && !(document.elementFromPoint(belowX, belowY) || {}).closest?.('.post-card');
  out.beforeI = selectedKeys();
  if (out.belowAvailable) {
    click(belowX, belowY);
    await sleep(120);
  }
  out.gotI = selectedKeys();

  // J. the poster grid rides the same gesture (#242). It has no selection — poster
  //    cards are inspected, never selected — so all its background click does is put
  //    the panel both grids share back to the placeholder.
  [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '投稿者')?.click();
  out.posterCardsShown = await waitFor(() => document.querySelectorAll('#posterGrid .poster-card').length >= 1);
  await sleep(250); // masonic lays the poster grid out from scratch
  const posterCard = document.querySelector('#posterGrid .poster-card');
  posterCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(150);
  out.posterFilledBeforeJ = !!document.querySelector('#postDetailBox [data-slot="inspector-poster"]');
  const pr = posterCard.getBoundingClientRect();
  const py = Math.round((pr.top + pr.bottom) / 2);
  out.posterPressOnEmpty = !(document.elementFromPoint(x0, py) || {}).closest?.('.poster-card');
  click(x0, py);
  await sleep(150);
  out.posterPlaceholderAfterJ = panelPlaceholder();

  out.errors = errors;
  return JSON.stringify(out);
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  const r = readEvalResult(out);
  if (!r) {
    console.log('MARQUEE_TEST_FAIL (no eval result)');
    process.exit(1);
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const checks: Array<[string, boolean]> = [
    ['the grid laid out several rows', r.rowCount >= 2 && r.row0Count >= 2],
    ['the press point is empty space, not a card', r.startsOnEmptySpace === true],
    ['a drag selects exactly the cards it touched', same(r.gotA, r.expectA) && r.gotA.length >= 2],
    ['the band stayed clear of the auto-scroll edges', r.scrolledA === 0],
    ['the grid enters selection mode', r.selectingClass === true],
    ['the band is removed on release', r.bandRemovedA === true],
    ['a press under the threshold draws no band', r.bandDuringB === false],
    ['Ctrl + a background click leaves the selection alone', same(r.gotB, r.gotA)],
    ['Ctrl+drag extends the selection', same(r.gotC, r.expectC) && r.gotC.length > r.gotA.length],
    ['a plain drag replaces the selection', same(r.gotD, r.expectD) && r.gotD.length === 1],
    ['the band paints while dragging', r.bandVisibleE === true],
    ['the selection previews live during the drag', r.changedDuringE === true],
    ['Esc removes the band', r.bandRemovedE === true],
    ['Esc restores the pre-drag selection', same(r.gotE, r.expectE)],
    ['the release after Esc does not re-apply the band', same(r.gotEAfterUp, r.expectE)],
    ['a drag starting on a card is not a marquee', r.bandFromCard === false],
    ['a card click fills the inspector and selects the card', r.selectedBeforeG.length === 1 && r.inspectedBeforeG === 1 && r.panelFilledBeforeG === true],
    ['a background click empties the selection', same(r.gotG, [])],
    ['a background click returns the inspector to its placeholder', r.inspectedAfterG === 0 && r.panelFilledAfterG === false && r.panelPlaceholderAfterG === true],
    ['a background click leaves no band behind', r.bandDuringG === false],
    ['Ctrl + a background click keeps the selection', same(r.gotHCtrl, r.beforeH) && r.beforeH.length >= 2],
    ['Shift + a background click keeps the selection', same(r.gotHShift, r.beforeH)],
    ['the space below the last row is background too', r.belowAvailable === true && r.belowIsEmpty === true && r.beforeI.length > 0 && same(r.gotI, [])],
    ['a poster click fills the inspector', r.posterCardsShown === true && r.posterFilledBeforeJ === true],
    ['the poster grid background returns the inspector too', r.posterPressOnEmpty === true && r.posterPlaceholderAfterJ === true],
    ['no handler threw', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r));
  console.log(failed ? 'MARQUEE_TEST_FAIL' : 'MARQUEE_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
