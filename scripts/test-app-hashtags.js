'use strict';

// Verifies the sidebar tag row and hashtag row flyouts:
// - Tag row opens a flyout listing all user tags (grouped by group / uncategorized)
// - Hashtag row opens a flyout listing hashtags from post text
//
//   node scripts/test-app-hashtags.js

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-ht-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

function writePost(id, text, tags, hashtags) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, `${id}.json`),
    JSON.stringify(
      {
        captureId: id,
        image: `${id}.jpg`,
        url: `https://x.com/u/status/${id}`,
        platform: 'x',
        text,
        tags: tags || [],
        hashtags: hashtags || [],
        capturedAt: '2026-01-01T00:00:00.000Z',
        date: '2026-01-01T00:00:00.000Z',
      },
      null,
      2,
    ),
  );
}
// 8 unique user tags so the tag flyout search input is shown (> 8 items).
writePost('p1', 'TypeScript最高', ['alpha', 'beta', 'gamma'], ['typescript', 'プログラミング']);
writePost('p2', '別記事の続き', ['delta', 'epsilon'], ['typescript']);
writePost('p3', 'タグなし投稿', ['zeta', 'eta', 'theta'], ['rust']);

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 3);

  // --- Tag row: opens flyout with all user tags ---
  document.querySelector('[data-qfrow="tag"]').click();
  await sleep(60);
  const pop = document.querySelector('.qf-pop');
  const tagFlyCount = pop ? pop.querySelectorAll('[data-qfval]').length : 0;
  document.body.click(); await sleep(40);

  // --- Hashtag row: opens flyout with hashtags from post text ---
  document.querySelector('[data-qfrow="hashtag"]').click();
  await sleep(60);
  const pop2 = document.querySelector('.qf-pop');
  const htFlyCount = pop2 ? pop2.querySelectorAll('[data-qfval]').length : 0;
  // select 'typescript' hashtag from flyout
  const tsRow = pop2 && pop2.querySelector('[data-qfval="typescript"]');
  if (tsRow) tsRow.click();
  await sleep(120);
  document.body.click(); await sleep(40);
  const htCards = document.querySelectorAll('#postGrid .post-card').length;

  return { tagFlyCount, htFlyCount, htCards };
})()`;

const shot = path.join(appDir, '.smoke-shot.png');
try {
  fs.unlinkSync(shot);
} catch {}

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'),
  CORPUS_SMOKE: '1',
  CORPUS_SMOKE_EVAL: evalJs,
  CORPUS_SMOKE_SHOT: shot,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r = {};
  try {
    r = JSON.parse(m[1]);
  } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + label);
    if (!cond) ok = false;
  };
  check('tag row flyout lists the 8 user tags', r.tagFlyCount === 8);
  check('hashtag row flyout lists 3 distinct hashtags', r.htFlyCount === 3);
  check('selecting #typescript narrows grid to 2 posts', r.htCards === 2);
  console.log('\n' + (ok ? 'HASHTAG_TEST_PASS' : 'HASHTAG_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
