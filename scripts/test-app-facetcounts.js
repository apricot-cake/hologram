'use strict';

// Verifies facet counts across the (non-tag) filter flyouts — the generalization of
// fa52635 from p.tags to facetCounts(keyFn). Two behaviours are asserted:
//   fixed lists (platform): every value carries a count badge, counts reflect the
//     CURRENT query, and a 0 keeps its place (no `off` greying — order is stable).
//   facetDim lists (tag): counts reflect the query AND a 0 value is greyed (`off`).
//   seeds: p0 x/猫/reply, p1 x/犬, p2 x/猫, p3 bluesky/猫, p4 misskey/(no tag)
//     all platform → x=3, bluesky=1, misskey=1
//     filter tag=猫 → x=2, bluesky=1, misskey=0 (misskey row stays, not greyed);
//                     tag flyout: 犬 count 0 and greyed (off)
//
//   node scripts/test-app-facetcounts.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-fc-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const seeds = [
  { plat: 'x',       url: 'https://x.com/u0/status/800',          tags: ['猫'], isReply: true },
  { plat: 'x',       url: 'https://x.com/u1/status/801',          tags: ['犬'] },
  { plat: 'x',       url: 'https://x.com/u2/status/802',          tags: ['猫'] },
  { plat: 'bluesky', url: 'https://bsky.app/profile/u3/post/803', tags: ['猫'] },
  { plat: 'misskey', url: 'https://misskey.io/notes/804',         tags: [] },
];
seeds.forEach((s, i) => {
  const id = '170000000000' + i + '-fc' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: s.url, platform: s.plat,
    text: '本文' + i, displayName: '人' + i, screenName: 'u' + i, isReply: !!s.isReply,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: s.tags, hashtags: []
  }, null, 2));
});

const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const openRow = (cat) => document.querySelector('[data-qfrow="' + cat + '"]').click();
  const rowEl = (qfval) => document.querySelector('.qf-vals .fm-row[data-qfval="' + qfval + '"]');
  const cntOf = (qfval) => { const r = rowEl(qfval); return r ? ((r.querySelector('.fm-count') || {}).textContent || null) : null; };
  const offOf = (qfval) => { const r = rowEl(qfval); return r ? r.classList.contains('off') : null; };
  await waitFor(() => cards() >= 5);
  const r = {};
  // all-platform counts (fixed list — order preserved, badges present)
  openRow('platform'); await wait(220);
  r.pfX_all = cntOf('x');           // 3
  r.pfBsky_all = cntOf('bluesky');  // 1
  r.pfMisskey_all = cntOf('misskey'); // 1
  // apply tag=猫 via its flyout
  openRow('tag'); await wait(220);
  rowEl('猫').click(); await wait(220);
  r.afterCatCards = cards();        // 3 (p0,p2,p3)
  // reopen platform — counts now reflect the 猫 query
  openRow('platform'); await wait(220);
  r.pfX_cat = cntOf('x');           // 2
  r.pfMisskey_cat = cntOf('misskey'); // 0
  r.pfMisskey_off = offOf('misskey'); // false (fixed list: badge but no greying)
  // reopen tag — 犬 is now absent (0) and greyed on a facetDim list
  openRow('tag'); await wait(220);
  r.tagCat = cntOf('猫');           // 3
  r.tagDog = cntOf('犬');           // 0
  r.tagDogOff = offOf('犬');        // true (facetDim greys a 0)
  return r;
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
  const fixed = r.pfX_all === '3' && r.pfBsky_all === '1' && r.pfMisskey_all === '1' &&
    r.afterCatCards === 3 && r.pfX_cat === '2' && r.pfMisskey_cat === '0' && r.pfMisskey_off === false;
  const facetDim = r.tagCat === '3' && r.tagDog === '0' && r.tagDogOff === true;
  const ok = fixed && facetDim;
  console.log(`fixed: pfX_all=${r.pfX_all} bsky=${r.pfBsky_all} misskey=${r.pfMisskey_all} afterCat=${r.afterCatCards} pfX_cat=${r.pfX_cat} misskey_cat=${r.pfMisskey_cat} misskey_off=${r.pfMisskey_off}`);
  console.log(`facetDim: tagCat=${r.tagCat} tagDog=${r.tagDog} tagDogOff=${r.tagDogOff}`);
  console.log(ok ? 'FACETCOUNTS_TEST_PASS' : 'FACETCOUNTS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
