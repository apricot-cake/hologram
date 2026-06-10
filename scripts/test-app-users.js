'use strict';

// Verifies the sidebar 作者 (authors) section (derived from post author fields,
// no extra fetching; replaced the old Users tab): seeds posts for several authors,
// checks the author chips are grouped + ranked by post count, that the author
// search filters them (ignoring a leading "@"), and that clicking an author chip
// applies a `user` filter (pill + narrowed grid).
//
//   node scripts/test-app-users.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-users-'));
const configDir = path.join(tmp, 'Corpus');
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
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 4);

  // 作者行 → フライアウトに投稿数順で列挙される
  document.querySelector('#filterRows [data-qfrow="user"]').click(); await sleep(60);
  const pop = document.querySelector('.qf-pop');
  const rows = () => [...pop.querySelectorAll('[data-qfval]')];
  const allNames = rows().map(r => r.querySelector('.fm-name').textContent);   // Alice(2), Bob, Carol

  // click Alice -> apply a user filter (flyout stays open, row shows ✓)
  rows().find(r => r.querySelector('.fm-name').textContent === 'Alice')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(140);
  const chipText = [...document.querySelectorAll('#queryChips .sb-active-chip.qc-user')].map(c => c.textContent);
  const cardCount = document.querySelectorAll('#postGrid .post-card').length;
  const aliceActive = !!rows().find(r => r.querySelector('.fm-name').textContent === 'Alice' && r.querySelector('.fm-check'));
  const badgeOn = document.querySelector('#filterRows [data-badge="user"]').classList.contains('on');

  return { allNames, chipText, cardCount, aliceActive, badgeOn };
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
  try { fs.unlinkSync(shot); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let ok = true;
  const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) ok = false; };
  check('authors ranked by post count in the flyout (Alice, Bob, Carol)', eq(r.allNames, ['Alice', 'Bob', 'Carol']));
  check('the active filter chip shows the user (Alice)', eq(r.chipText, ['Alice']));
  check("posts are filtered to that user's 2 posts", r.cardCount === 2);
  check('the picked author row shows ✓ and the row badge lights', r.aliceActive === true && r.badgeOn === true);
  console.log('\n' + (ok ? 'USERS_TEST_PASS' : 'USERS_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
