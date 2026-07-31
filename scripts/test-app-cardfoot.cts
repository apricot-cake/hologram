'use strict';

// Verifies the card-footer noise gate (the card model's showEngagement/showCaptured):
//  - at rest (date sort, no filters) neither the engagement stats row nor the 📷
//    capture date is DRAWN — only the post date is
//  - an engagement sort (likes-desc) puts the stats row on the card
//  - the capture sort (captured-desc) puts the capture date on it, and takes the
//    stats back off
//
// #618 moved this from CSS (two classes on the grid container hiding markup that was
// always there) into the card model, so the assertions are about a card HAVING the
// part, not about its `display`. The sort is driven through the display popover —
// the same surface a person uses, since the hidden <select> it used to poke is gone.
//
//   node scripts/test-app-cardfoot.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-cf-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// capturedAt lands on a DIFFERENT day than date so the 📷 cdate is rendered
// (same-day captures are deduped away in cardModel).
const records: any[] = [];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-cf' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (800 + i),
    platform: 'x',
    text: '投稿' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 10 + i,
    capturedAt: '2026-05-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const has = (slot) => !!document.querySelector('[data-slot="post-grid"] [data-slot="' + slot + '"]');
  const byText = (sel, text) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent || '').trim() === text) || null;
  // Pick a sort the way a person does: 表示 popover → the sort Select → the option.
  const setSort = async (label) => {
    byText('button', '表示').click();
    await waitFor(() => !!document.querySelector('[data-slot="select-trigger"]'));
    document.querySelector('[data-slot="select-trigger"]').click();
    await waitFor(() => !!byText('[data-slot="select-item"]', label));
    byText('[data-slot="select-item"]', label).click();
    await sleep(200);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => cards() >= 3);
    await sleep(160);
  };
  await waitFor(() => cards() >= 3);
  // at rest: the post date is the only thing in the footer
  const defStats = has('post-card-stats');
  const defCdate = has('post-card-capdate');
  const defPdate = has('post-card-date');
  // engagement sort → the counts become the point, so they are drawn
  await setSort('いいね順');
  const engStats = has('post-card-stats');
  // capture sort → the capture date is drawn, the counts go away again
  await setSort('キャプチャ日時順');
  const capCdate = has('post-card-capdate');
  const capStats = has('post-card-stats');
  return { defStats, defCdate, defPdate, engStats, capCdate, capStats };
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
  const ok = r.defStats === false && r.defCdate === false && r.defPdate === true && r.engStats === true && r.capCdate === true && r.capStats === false;
  console.log(`defStats=${r.defStats} defCdate=${r.defCdate} defPdate=${r.defPdate} engStats=${r.engStats} capCdate=${r.capCdate} capStats=${r.capStats}`);
  console.log(ok ? 'CARDFOOT_TEST_PASS' : 'CARDFOOT_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
