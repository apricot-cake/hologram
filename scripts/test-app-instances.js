'use strict';

// Verifies the インスタンス filter (Misskey/Mastodon hosts), now served by the
// sidebar row → flyout: the flyout lists every host across both platforms,
// picking one filters the grid (and lights the row badge), picking it again
// clears it. (The old platform-chip-expands-servers UI was retired.)
//
//   node scripts/test-app-instances.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-inst-'));
const configDir = path.join(tmp, 'Corpus');
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
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  await waitFor(() => cards() >= 5);

  // プラットフォーム行 → Misskey/Mastodon の直下にインスタンスがサブ行で並ぶ
  document.querySelector('#filterRows [data-qfrow="platform"]').click(); await sleep(60);
  const pop = document.querySelector('.qf-pop');
  const hosts = [...pop.querySelectorAll('[data-qftype="instance"]')].map(r => r.dataset.qfval).sort();
  const subIndented = !!pop.querySelector('.fm-sub[data-qfval="misskey.io"]');

  // mastodon.social を選ぶ → 2件・プラットフォーム行のバッジ点灯・開いたまま
  pop.querySelector('[data-qfval="mastodon.social"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(120);
  const socialCount = cards();
  const badgeOn = document.querySelector('#filterRows [data-badge="platform"]').classList.contains('on');
  const stillOpen = pop.classList.contains('show');

  // もう一度クリックで解除 → 全5件・バッジ消灯
  pop.querySelector('[data-qfval="mastodon.social"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(120);
  const cleared = cards();
  const badgeOff = !document.querySelector('#filterRows [data-badge="platform"]').classList.contains('on');

  return { hosts, subIndented, socialCount, badgeOn, stillOpen, cleared, badgeOff };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r = {};
  try { r = JSON.parse(m[1]); } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let ok = true;
  const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) ok = false; };
  check('platform flyout nests every host as indented sub-rows', eq(r.hosts, ['mastodon.social', 'misskey.io', 'mstdn.jp', 'nijimiss.moe']) && r.subIndented === true);
  check('picking mastodon.social filters to 2 (platform badge on, flyout stays)', r.socialCount === 2 && r.badgeOn === true && r.stillOpen === true);
  check('picking it again clears the filter (5 posts, badge off)', r.cleared === 5 && r.badgeOff === true);
  console.log('\n' + (ok ? 'INSTANCES_TEST_PASS' : 'INSTANCES_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
