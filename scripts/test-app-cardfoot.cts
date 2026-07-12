'use strict';

// Verifies the card-footer noise gate (#show-eng / #show-cap on #postGrid):
//  - at rest (date sort, no filters) the engagement stats row and the 📷
//    capture date are hidden — only the post date shows
//  - an engagement sort (likes-desc) flips .show-eng → stats row visible
//  - the capture sort (captured-desc) flips .show-cap → capture date visible,
//    stats hidden again
//
//   node scripts/test-app-cardfoot.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-cf-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// capturedAt lands on a DIFFERENT day than date so the 📷 cdate is rendered
// (same-day captures are deduped away in cardModel).
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-cf' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
}

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  const grid = document.getElementById('postGrid');
  const vis = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display !== 'none' : null; };
  const setSort = async (v) => {
    const s = document.getElementById('sortSelect');
    s.value = v;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 3);
    await sleep(120);
  };
  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 3);
  // at rest: neither gate class, stats + cdate hidden, pdate visible
  const defEng = grid.classList.contains('show-eng');
  const defCap = grid.classList.contains('show-cap');
  const defStats = vis('#postGrid .post-card .stats');
  const defCdate = vis('#postGrid .post-card .cdate');
  const defPdate = vis('#postGrid .post-card .pdate');
  // engagement sort: .show-eng flips on, stats row shows
  await setSort('likes-desc');
  const engClass = grid.classList.contains('show-eng');
  const engStats = vis('#postGrid .post-card .stats');
  // capture sort: .show-cap on, .show-eng off — cdate shows, stats hide again
  await setSort('captured-desc');
  const capClass = grid.classList.contains('show-cap');
  const capEng = grid.classList.contains('show-eng');
  const capCdate = vis('#postGrid .post-card .cdate');
  const capStats = vis('#postGrid .post-card .stats');
  return { defEng, defCap, defStats, defCdate, defPdate, engClass, engStats, capClass, capEng, capCdate, capStats };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
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
  const ok = r.defEng === false && r.defCap === false && r.defStats === false && r.defCdate === false && r.defPdate === true && r.engClass === true && r.engStats === true && r.capClass === true && r.capEng === false && r.capCdate === true && r.capStats === false;
  console.log(`defEng=${r.defEng} defCap=${r.defCap} defStats=${r.defStats} defCdate=${r.defCdate} defPdate=${r.defPdate} engClass=${r.engClass} engStats=${r.engStats} capClass=${r.capClass} capEng=${r.capEng} capCdate=${r.capCdate} capStats=${r.capStats}`);
  console.log(ok ? 'CARDFOOT_TEST_PASS' : 'CARDFOOT_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
