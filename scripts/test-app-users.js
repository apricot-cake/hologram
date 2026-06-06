'use strict';

// Verifies the Users tab (Phase 1, derived from post author fields, no extra
// fetching): seeds posts for several authors across platforms, opens the tab,
// and checks the grouped user list, the search and platform filters, and that
// clicking a user jumps to the Posts tab filtered to that user.
//
//   node scripts/test-app-users.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postsnap-users-'));
const configDir = path.join(tmp, 'PostSnap');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

function writePost(id, platform, userId, screenName, displayName, when) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  fs.writeFileSync(path.join(saveFolder, `${id}.json`), JSON.stringify({
    captureId: id, image: `${id}.jpg`, url: `https://example.com/${id}`, platform,
    userId, screenName, displayName, text: id, tags: [],
    capturedAt: when, date: when
  }, null, 2));
}
// Alice (x) has 2 posts; Bob (bluesky) and Carol (misskey) have 1 each.
writePost('a1', 'x', '111', 'alice', 'Alice', '2026-01-04T00:00:00.000Z');
writePost('a2', 'x', '111', 'alice', 'Alice', '2026-01-03T00:00:00.000Z');
writePost('b1', 'bluesky', 'did:plc:bob', 'bob.bsky.social', 'Bob', '2026-01-02T00:00:00.000Z');
writePost('c1', 'misskey', 'mk1', 'carol', 'Carol', '2026-01-01T00:00:00.000Z');

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const names = () => [...document.querySelectorAll('#userList .user-row .user-name')].map(e => e.textContent);
  document.querySelector('.tab-btn[data-tab="users"]').click();
  await sleep(120);
  const allNames = names();
  const platformChips = [...document.querySelectorAll('#userPlatformChips .sb-chip')].map(c => c.dataset.pl).sort();

  // search
  const us = document.getElementById('userSearch');
  us.value = 'bob'; us.dispatchEvent(new Event('input')); await sleep(40);
  const searchNames = names();
  us.value = ''; us.dispatchEvent(new Event('input')); await sleep(40);

  // platform filter (click the 'x' chip, read, then toggle off)
  const xChip = () => [...document.querySelectorAll('#userPlatformChips .sb-chip')].find(c => c.dataset.pl === 'x');
  xChip().click(); await sleep(40);
  const xNames = names();
  xChip().click(); await sleep(40);

  // click Alice -> jump to Posts tab filtered to that user
  [...document.querySelectorAll('#userList .user-row')].find(r => r.querySelector('.user-name').textContent === 'Alice').click();
  await sleep(140);
  const postsActive = document.getElementById('panelPosts').classList.contains('active');
  const chipText = [...document.querySelectorAll('#queryChips .sb-active-chip.qc-user')].map(c => c.textContent);
  const cardCount = document.querySelectorAll('#postGrid .post-card').length;

  return { allNames, platformChips, searchNames, xNames, postsActive, chipText, cardCount };
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
  check('users grouped + sorted by post count (Alice, Bob, Carol)', eq(r.allNames, ['Alice', 'Bob', 'Carol']));
  check('platform chips for present platforms (bluesky, misskey, x)', eq(r.platformChips, ['bluesky', 'misskey', 'x']));
  check('user search filters the list (bob -> Bob)', eq(r.searchNames, ['Bob']));
  check('platform filter narrows the list (x -> Alice)', eq(r.xNames, ['Alice']));
  check('clicking a user jumps to the Posts tab', r.postsActive === true);
  check('the active filter chip shows the user (Alice)', eq(r.chipText, ['Alice']));
  check("posts are filtered to that user's 2 posts", r.cardCount === 2);
  console.log('\n' + (ok ? 'USERS_TEST_PASS' : 'USERS_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
