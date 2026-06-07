'use strict';

// Verifies the sidebar instance/server filter for the host-based platforms
// (Misskey + Mastodon): selecting the platform expands its server list, picking
// a server filters the posts, and deselecting the platform clears the orphaned
// instance filter.
//
//   node scripts/test-app-instances.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postsnap-inst-'));
const configDir = path.join(tmp, 'PostSnap');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

function writePost(id, platform, url, when) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  fs.writeFileSync(path.join(saveFolder, `${id}.json`), JSON.stringify({
    captureId: id, image: `${id}.jpg`, url, platform,
    text: id, screenName: 'u', displayName: 'U', tags: [], capturedAt: when, date: when
  }, null, 2));
}
// Mastodon on two servers (2 + 1), Misskey on two instances (1 + 1).
writePost('m1', 'mastodon', 'https://mastodon.social/@u/111', '2026-01-05T00:00:00Z');
writePost('m2', 'mastodon', 'https://mastodon.social/@u/112', '2026-01-04T00:00:00Z');
writePost('m3', 'mastodon', 'https://mstdn.jp/@u/113', '2026-01-03T00:00:00Z');
writePost('k1', 'misskey', 'https://misskey.io/notes/aaa', '2026-01-02T00:00:00Z');
writePost('k2', 'misskey', 'https://nijimiss.moe/notes/bbb', '2026-01-01T00:00:00Z');

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const pchip = (v) => document.querySelector('.sb-chip[data-filter-type="platform"][data-filter-value="' + v + '"]');
  const instChips = () => [...document.querySelectorAll('#sbInstanceChips .sb-chip')].map(c => c.dataset.filterValue).sort();
  const instVisible = () => getComputedStyle(document.getElementById('sbInstanceWrap')).display !== 'none';
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;

  // Mastodon -> its two servers expand
  pchip('mastodon').click(); await sleep(90);
  const mastoVisible = instVisible();
  const mastoInstances = instChips();
  // Pick mastodon.social -> 2 posts
  document.querySelector('#sbInstanceChips .sb-chip[data-filter-value="mastodon.social"]').click(); await sleep(90);
  const mastoSocialCount = cards();
  // Deselect Mastodon -> section hides, orphaned instance filter cleared -> all 5
  pchip('mastodon').click(); await sleep(90);
  const afterDeselectVisible = instVisible();
  const afterDeselectCount = cards();

  // Misskey -> its two instances
  pchip('misskey').click(); await sleep(90);
  const misskeyInstances = instChips();
  pchip('misskey').click(); await sleep(90);

  return { mastoVisible, mastoInstances, mastoSocialCount, afterDeselectVisible, afterDeselectCount, misskeyInstances };
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
  try { fs.unlinkSync(shot); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let ok = true;
  const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) ok = false; };
  check('Mastodon expands its server list', r.mastoVisible === true && eq(r.mastoInstances, ['mastodon.social', 'mstdn.jp']));
  check('picking a Mastodon server filters posts (mastodon.social -> 2)', r.mastoSocialCount === 2);
  check('deselecting Mastodon hides the section and clears the instance filter', r.afterDeselectVisible === false && r.afterDeselectCount === 5);
  check('Misskey expands its instance list', eq(r.misskeyInstances, ['misskey.io', 'nijimiss.moe']));
  console.log('\n' + (ok ? 'INSTANCES_TEST_PASS' : 'INSTANCES_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
