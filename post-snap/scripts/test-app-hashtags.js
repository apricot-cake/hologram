'use strict';

// Verifies the Hashtags tab and the chip-filter inputs: seeds posts with #tags
// in text and user tags, checks the extracted/counted hashtag list, then that
// the hashtag-tab search and the sidebar tag search filter their chip lists.
//
//   node scripts/test-app-hashtags.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postsnap-ht-'));
const configDir = path.join(tmp, 'PostSnap');
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
  // Sidebar tag filter (the posts tab is active on load).
  const sb = document.getElementById('sbTagSearch');
  const sbVisible = getComputedStyle(sb).display !== 'none';
  const sbAll = document.querySelectorAll('#sbTagChips .sb-chip').length;
  sb.value = 'the';
  sb.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 50));
  const sbFiltered = [...document.querySelectorAll('#sbTagChips .sb-chip')].map(c => c.dataset.filterValue);

  // Hashtags tab + its filter input.
  document.querySelector('.tab-btn[data-tab="tags"]').click();
  await new Promise(r => setTimeout(r, 150));
  const htChips = [...document.querySelectorAll('.hashtag-chip')].map(c => c.dataset.tag + ':' + c.querySelector('.ht-count').textContent);
  const ht = document.getElementById('hashtagSearch');
  ht.value = 'type';
  ht.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 50));
  const htFiltered = [...document.querySelectorAll('.hashtag-chip')].map(c => c.dataset.tag);

  return { sbVisible, sbAll, sbFiltered, htChips, htFiltered };
})()`;

const shot = path.join(appDir, '.smoke-shot.png');
try { fs.unlinkSync(shot); } catch {}

const env = Object.assign({}, process.env, {
  APPDATA: tmp, POSTSNAP_SMOKE: '1', POSTSNAP_SMOKE_EVAL: evalJs, POSTSNAP_SMOKE_SHOT: shot
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
  const ht = r.htChips || [];
  check('hashtags extracted + counted (#typescript:2, #プログラミング:1)', ht.includes('#typescript:2') && ht.includes('#プログラミング:1') && ht.length === 2);
  check('hashtag search filters the list (type -> #typescript only)', JSON.stringify(r.htFiltered) === JSON.stringify(['#typescript']));
  check('sidebar tag filter shown for >6 tags, all 8 rendered', r.sbVisible === true && r.sbAll === 8);
  check('sidebar tag search filters chips (the -> theta only)', JSON.stringify(r.sbFiltered) === JSON.stringify(['theta']));
  console.log('\n' + (ok ? 'HASHTAG_TEST_PASS' : 'HASHTAG_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
