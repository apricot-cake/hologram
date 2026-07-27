'use strict';

// Verifies the post-view filter flow on the filterbar (P2③ — the Activebar /
// qf-pop flyout era is gone):
//  - adding a platform filter via the "+ フィルタ" value editor shows a chip,
//    filters the grid, checks the row, and keeps the editor open
//  - the chip's ✕ clears the facet (chip gone, grid restored)
// (The search-term text chip is covered by test-app-textleaf.cts; the reset-all
// affordance is the chip row's planned 全解除 — not built yet, #154.)
// Post-view is the default mode, so no mode switch is needed.
//
//   node scripts/test-app-postfilter.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-pf-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// p0/p1 = x, p2 = bluesky — so a platform=X filter actually narrows the grid.
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-pf' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
        captureId: id,
        image: id + '.jpg',
        url: i === 2 ? 'https://bsky.app/profile/u2/post/702' : 'https://x.com/u/status/' + (700 + i),
        platform: i === 2 ? 'bluesky' : 'x',
        text: '投稿' + i,
        displayName: '人' + i,
        screenName: 'u' + i,
        likes: 10 + i,
        capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
        date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
        media: [],
        tags: [],
        hashtags: [],
      },
      null,
      2,
    ),
  );
}

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  // Filterbar idioms (see test-app-facetcounts): "+ フィルタ" popover → category →
  // ValueEditor rows, chips in the [data-slot=filter-chips] row.
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll(POP + ' div.cursor-default')];
  const rowEl = (name) => edRows().find((el) => { const n = el.querySelector('span.truncate'); return n && n.textContent === name; }) || null;
  const chipRow = () => document.querySelector('[data-slot="filter-chips"]');
  const chipCount = () => (chipRow() ? chipRow().querySelectorAll(':scope > span').length : 0);
  await waitFor(() => cards() >= 3);
  const chipsBefore = chipCount();   // 0 — no chip row while nothing is filtered
  // add a platform filter via the value editor
  byText('button', 'フィルタ').click();
  await waitFor(() => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  byText(POP + ' [data-slot="command-item"]', 'プラットフォーム').click();
  await waitFor(() => !!rowEl('X'));
  rowEl('X').click();
  await sleep(220);
  const chipShown = chipCount() === 1 && chipRow().textContent.includes('X');
  const cardsFiltered = cards();                                   // 2 (p0,p1)
  const rowChecked = !!(rowEl('X') && rowEl('X').querySelector('svg')); // ✓ on the picked row
  const stillOpen = !!document.querySelector(POP);                 // editor stays open for more picks
  // close the popover (toggle; don't await the throttled unmount) and clear via the chip ✕
  byText('button', 'フィルタ').click();
  await sleep(120);
  chipRow().querySelector(':scope > span > button[aria-label]').click();
  await sleep(220);
  const chipsAfter = chipCount();   // 0
  const cardsAfter = cards();       // 3
  return { chipsBefore, chipShown, cardsFiltered, rowChecked, stillOpen, chipsAfter, cardsAfter };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});
child.on('close', () => {
  let r: Record<string, any> = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) {
    try {
      r = JSON.parse(m[1]);
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.chipsBefore === 0 && r.chipShown === true && r.cardsFiltered === 2 && r.rowChecked === true && r.stillOpen === true && r.chipsAfter === 0 && r.cardsAfter === 3;
  console.log(`chipsBefore=${r.chipsBefore} chipShown=${r.chipShown} filtered=${r.cardsFiltered} rowChecked=${r.rowChecked} stillOpen=${r.stillOpen} chipsAfter=${r.chipsAfter} cardsAfter=${r.cardsAfter}`);
  console.log(ok ? 'POSTFILTER_TEST_PASS' : 'POSTFILTER_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
