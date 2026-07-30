'use strict';

// Verifies facet counts across the "+ フィルタ" value editors (filterbar component —
// the qf-pop flyouts are gone since P2③). Two behaviours are asserted:
//   fixed lists (platform): every value carries a count, counts reflect the
//     CURRENT query, and a 0 keeps its place (no greying — order is stable).
//   facetDim lists (tag): counts reflect the query AND a 0 value is greyed.
//   seeds: p0 x/猫/reply, p1 x/犬, p2 x/猫, p3 bluesky/猫, p4 misskey/(no tag)
//     all platform → x=3, bluesky=1, misskey=1
//     filter tag=猫 → x=2, bluesky=1, misskey=0 (misskey row stays, not greyed);
//                     tag editor: 犬 count 0 and greyed
//
//   node scripts/test-app-facetcounts.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-fc-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const seeds = [
  { plat: 'x', url: 'https://x.com/u0/status/800', tags: ['猫'], isReply: true },
  { plat: 'x', url: 'https://x.com/u1/status/801', tags: ['犬'] },
  { plat: 'x', url: 'https://x.com/u2/status/802', tags: ['猫'] },
  { plat: 'bluesky', url: 'https://bsky.app/profile/u3/post/803', tags: ['猫'] },
  { plat: 'misskey', url: 'https://misskey.io/notes/804', tags: [] },
];
const records: any[] = [];
seeds.forEach((s, i) => {
  const id = '170000000000' + i + '-fc' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: s.url,
    platform: s.plat,
    text: '本文' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    isReply: !!s.isReply,
    likes: 10 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: s.tags,
    hashtags: [],
  });
});
seedLibrary(configDir, records);

const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  const posterCards = () => document.querySelectorAll('#posterGrid .poster-card').length;
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  // Filterbar idioms (see test-app-tabs): the "+ フィルタ" popover → Command category
  // list → ValueEditor rows (div.cursor-default with a label span + tabular-nums count).
  // The smoke window is unfocused, so exit animations are throttled — awaiting a full
  // popup unmount costs seconds against the 9s harness cap. Instead navigate BETWEEN
  // categories with the editor's 戻る button inside ONE popover session, scoping every
  // query to the open (:not([data-closed])) popup.
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll(POP + ' div.cursor-default')];
  const rowEl = (name) => edRows().find((el) => { const n = el.querySelector('span.truncate'); return n && n.textContent === name; }) || null;
  const cntSpan = (name) => { const r = rowEl(name); return r ? r.querySelector('span.tabular-nums') : null; };
  const cntOf = (name) => { const c = cntSpan(name); return c ? c.textContent : null; };
  const offOf = (name) => { const c = cntSpan(name); return c ? c.className.includes('/60') : null; }; // muted 0-count (ValueRow off state)
  const openMenu = async () => {
    byText('button', 'フィルタ').click();
    await waitFor(() => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  };
  const pickCat = async (label) => {
    byText(POP + ' [data-slot="command-item"]', label).click();
    await waitFor(() => edRows().length > 0);
  };
  const goBack = async () => {
    document.querySelector(POP + ' button[aria-label="戻る"]').click();
    await waitFor(() => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  };
  await waitFor(() => cards() >= 5);
  const r = {};
  // all-platform counts (fixed list — order preserved, counts present)
  await openMenu();
  await pickCat('プラットフォーム');
  r.pfX_all = cntOf('X');           // 3
  r.pfBsky_all = cntOf('Bluesky');  // 1
  r.pfMisskey_all = cntOf('Misskey'); // 1
  // apply tag=猫 via its editor
  await goBack();
  await pickCat('タグ');
  rowEl('猫').click(); await wait(220);
  r.afterCatCards = cards();        // 3 (p0,p2,p3)
  // back to platform — counts now reflect the 猫 query (values() reads the live tree)
  await goBack();
  await pickCat('プラットフォーム');
  r.pfX_cat = cntOf('X');           // 2
  r.pfMisskey_cat = cntOf('Misskey'); // 0
  r.pfMisskey_off = offOf('Misskey'); // false (fixed list: count but no greying)
  // back to tag — 犬 is now absent (0) and greyed on a facetDim list
  await goBack();
  await pickCat('タグ');
  r.tagCat = cntOf('猫');           // 3
  r.tagDog = cntOf('犬');           // 0
  r.tagDogOff = offOf('犬');        // true (facetDim greys a 0)
  // --- poster view: counts come from filteredPosters() (population = posters) ---
  byText('button', 'フィルタ').click(); // toggle shut (don't await the throttled unmount)
  await wait(120);
  byText('button', '投稿者').click();
  await waitFor(() => posterCards() >= 5);
  await openMenu();
  await pickCat('プラットフォーム');   // poster-platform (same label in poster mode)
  r.posterPfX = cntOf('X');           // 3 posters (u0,u1,u2)
  r.posterPfBsky = cntOf('Bluesky');  // 1 (u3)
  r.posterPfMisskey = cntOf('Misskey'); // 1 (u4)
  return r;
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
  const fixed = r.pfX_all === '3' && r.pfBsky_all === '1' && r.pfMisskey_all === '1' && r.afterCatCards === 3 && r.pfX_cat === '2' && r.pfMisskey_cat === '0' && r.pfMisskey_off === false;
  const facetDim = r.tagCat === '3' && r.tagDog === '0' && r.tagDogOff === true;
  const poster = r.posterPfX === '3' && r.posterPfBsky === '1' && r.posterPfMisskey === '1';
  const ok = fixed && facetDim && poster;
  console.log(`fixed: pfX_all=${r.pfX_all} bsky=${r.pfBsky_all} misskey=${r.pfMisskey_all} afterCat=${r.afterCatCards} pfX_cat=${r.pfX_cat} misskey_cat=${r.pfMisskey_cat} misskey_off=${r.pfMisskey_off}`);
  console.log(`facetDim: tagCat=${r.tagCat} tagDog=${r.tagDog} tagDogOff=${r.tagDogOff}`);
  console.log(`poster: pfX=${r.posterPfX} bsky=${r.posterPfBsky} misskey=${r.posterPfMisskey}`);
  console.log(ok ? 'FACETCOUNTS_TEST_PASS' : 'FACETCOUNTS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
