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
const { evalSource } = require('./lib-wait.cts');

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

const evalJs = evalSource(async ({ waitFor, waitStable }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const has = (slot) => !!document.querySelector('[data-slot="post-grid"] [data-slot="' + slot + '"]');
  const byText = (sel, text) => Array.from(document.querySelectorAll<HTMLElement>(sel)).find((el) => (el.textContent || '').trim() === text) || null;
  // The footer's own markup is what every assertion below reads, so none of these waits
  // may mention it: each one stops on a step BEFORE the footer (the menu, the trigger's
  // own label, the popover closing) and the last one just waits for the re-render to go
  // quiet (#986).
  const gridChurn = () => cards() + ':' + document.querySelector('[data-slot="post-grid"]')?.textContent;
  const sortTrigger = () => document.querySelector<HTMLElement>('[data-slot="select-trigger"]');
  // Pick a sort the way a person does: 表示 popover → the sort Select → the option.
  const setSort = async (label) => {
    // Each control is named and thrown on rather than optional-chained: it IS the step,
    // so a missing one has to stop the run and say which control was gone. `?.` would
    // skip the click and leave a later assertion to report something unrelated.
    const openDisplay = byText('button', '表示');
    if (!openDisplay) throw new Error('the 表示 button is missing from the toolbar');
    openDisplay.click();
    await waitFor('the 表示 popover to show its sort control', () => !!sortTrigger());
    const trigger = sortTrigger();
    if (!trigger) throw new Error('the sort control is missing from the 表示 popover');
    trigger.click();
    await waitFor('the sort menu to list ' + label, () => !!byText('[data-slot="select-item"]', label));
    const option = byText('[data-slot="select-item"]', label);
    if (!option) throw new Error('the sort option ' + label + ' is missing from the sort menu');
    option.click();
    // SelectValue renders the picked option, so the trigger reading it back is the
    // observable post-condition of the pick — and it is not what the test asserts.
    await waitFor('the sort control to read back ' + label, () => (sortTrigger()?.textContent || '').includes(label));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor('the 表示 popover to close', () => !document.querySelector('[data-slot="popover-content"]:not([data-closed])'));
    await waitFor('the grid to still hold all 3 posts after re-sorting', () => cards() >= 3);
    await waitStable('the re-sorted grid to stop re-rendering', gridChurn);
  };
  await waitFor('the grid to show all 3 seeded posts', () => cards() >= 3);
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
});

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
