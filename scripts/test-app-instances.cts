'use strict';

// Verifies the instance filter (Misskey/Mastodon hosts), now served by the
// sidebar row → flyout: the flyout lists every host across both platforms,
// picking one filters the grid (and lights the row badge), picking it again
// clears it. (The old platform-chip-expands-servers UI was retired.)
//
//   node scripts/test-app-instances.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-inst-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

const records: any[] = [];
function addPost(id, platform, url, when) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url,
    platform,
    text: id,
    screenName: 'u',
    displayName: 'U',
    tags: [],
    capturedAt: when,
    date: when,
  });
}
// Mastodon on two servers (2 + 1), Misskey on two instances (1 + 1).
addPost('m1', 'mastodon', 'https://mastodon.social/@u/111', '2026-01-05T00:00:00Z');
addPost('m2', 'mastodon', 'https://mastodon.social/@u/112', '2026-01-04T00:00:00Z');
addPost('m3', 'mastodon', 'https://mstdn.jp/@u/113', '2026-01-03T00:00:00Z');
addPost('k1', 'misskey', 'https://misskey.io/notes/aaa', '2026-01-02T00:00:00Z');
addPost('k2', 'misskey', 'https://nijimiss.moe/notes/bbb', '2026-01-01T00:00:00Z');
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  await waitFor('the grid to show all 5 seeded posts', () => cards() >= 5);

  // The platform editor ("+ フィルタ" flow) -> instances are listed as indented sub-rows
  // (pl-6) directly under Misskey/Mastodon. Filterbar idioms: see test-app-facetcounts.
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll<HTMLElement>(POP + ' div.cursor-default')];
  const rowName = (r) => {
    const n = r.querySelector('span.truncate');
    return n ? n.textContent : '';
  };
  const rowByName = (name) => edRows().find((r) => rowName(r) === name) || null;
  // Re-queried per click: applying a filter re-renders the editor, so a held
  // reference would click a detached node. A missing row is named rather than
  // skipped — a skipped click would leave the waits below to report something else.
  const clickRow = (name) => {
    const row = rowByName(name);
    if (!row) throw new Error('the ' + name + ' row is missing from the site editor');
    row.click();
  };
  const subRows = () => edRows().filter((r) => r.className.includes('pl-6'));
  const chipsText = () => {
    const c = document.querySelector('[data-slot="filter-chips"]');
    return c ? c.textContent || '' : '';
  };
  byText('button', 'フィルタ').click();
  await waitFor('the filter menu to open', () => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  byText(POP + ' [data-slot="command-item"]', 'サイト').click(); // #253: renamed from プラットフォーム
  await waitFor('the site editor to list every instance host', () => subRows().length >= 4);
  const hosts = subRows().map(rowName).sort();
  const subIndented = subRows().some((r) => rowName(r) === 'misskey.io');

  // Pick mastodon.social -> 2 items, chip appears, editor stays open.
  // The wait is "the grid moved off 5", not "the grid shows 2", so the count,
  // the chip and the open editor are all still checked below.
  clickRow('mastodon.social');
  await waitFor('the grid to narrow once an instance is picked', () => cards() < 5);
  const socialCount = cards();
  const chipOn = chipsText().includes('mastodon.social');
  const stillOpen = !!document.querySelector(POP);

  // Click again to clear -> all 5 items, chip disappears
  clickRow('mastodon.social');
  await waitFor('the grid to widen again once the instance is cleared', () => cards() > socialCount);
  const cleared = cards();
  const chipOff = !chipsText().includes('mastodon.social');

  return { hosts, subIndented, socialCount, chipOn, stillOpen, cleared, chipOff };
});

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r: Record<string, any> = {};
  try {
    r = JSON.parse((m && m[1]) as string);
  } catch {
    /* ignore */
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + label);
    if (!cond) ok = false;
  };
  check('platform editor nests every host as indented sub-rows', eq(r.hosts, ['mastodon.social', 'misskey.io', 'mstdn.jp', 'nijimiss.moe']) && r.subIndented === true);
  check('picking mastodon.social filters to 2 (chip on, editor stays)', r.socialCount === 2 && r.chipOn === true && r.stillOpen === true);
  check('picking it again clears the filter (5 posts, chip off)', r.cleared === 5 && r.chipOff === true);
  console.log('\n' + (ok ? 'INSTANCES_TEST_PASS' : 'INSTANCES_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
