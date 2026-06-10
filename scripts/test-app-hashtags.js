'use strict';

// Verifies the sidebar tag filter and that hashtag browsing now lives in the
// search box (the dedicated Hashtags tab was removed): seeds posts with #tags in
// text and user tags, checks the sidebar タグ chips + their search input, then
// that typing "#typescript" in the search box narrows the post grid.
//
//   node scripts/test-app-hashtags.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-ht-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

function writePost(id, text, tags) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  fs.writeFileSync(path.join(saveFolder, `${id}.json`), JSON.stringify({
    captureId: id, image: `${id}.jpg`, url: `https://x.com/u/status/${id}`, platform: 'x',
    text, tags: tags || [], capturedAt: '2026-01-01T00:00:00.000Z', date: '2026-01-01T00:00:00.000Z'
  }, null, 2));
}
// 8 unique user tags (> 6) so the sidebar tag filter input is shown.
writePost('p1', 'TypeScript最高 #typescript #プログラミング', ['alpha', 'beta', 'gamma']);
writePost('p2', '別記事 #typescript の続き', ['delta', 'epsilon']);
writePost('p3', 'タグなし投稿', ['zeta', 'eta', 'theta']);

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 3);
  document.querySelector('#sbTagGroupRows [data-tag-group="__other"]').click();
  await sleep(60);
  const pop = document.querySelector('.qf-pop');
  const flyTags = pop.querySelectorAll('[data-qfval]').length;
  document.body.click(); await sleep(40);

  // Hashtag browsing now lives in the search box: "#typescript" appears in two
  // posts' text, so the grid should narrow to those two cards.
  const search = document.getElementById('searchBox');
  search.value = '#typescript';
  search.dispatchEvent(new Event('input'));
  await sleep(120);
  const htCards = document.querySelectorAll('#postGrid .post-card').length;

  return { flyTags, htCards };
})()`;

const shot = path.join(appDir, '.smoke-shot.png');
try { fs.unlinkSync(shot); } catch {}

const env = Object.assign({}, process.env, {
  APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs, CORPUS_SMOKE_SHOT: shot
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r = {};
  try { r = JSON.parse(m[1]); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) ok = false; };
  check('その他 group flyout lists the 8 tags', r.flyTags === 8);
  check('searching "#typescript" narrows the grid to its 2 posts', r.htCards === 2);
  console.log('\n' + (ok ? 'HASHTAG_TEST_PASS' : 'HASHTAG_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
