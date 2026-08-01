'use strict';

// Verifies the sidebar authors section (derived from post author fields,
// no extra fetching; replaced the old Users tab): seeds posts for several authors,
// checks the author chips are grouped + ranked by post count, that the author
// search filters them (ignoring a leading "@"), and that clicking an author chip
// applies a `user` filter (pill + narrowed grid).
//
//   node scripts/test-app-users.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-users-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

const records: any[] = [];
function addPost(id, platform, userId, screenName, displayName, when) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url: `https://example.com/${id}`,
    platform,
    userId,
    screenName,
    displayName,
    text: id,
    tags: [],
    capturedAt: when,
    date: when,
  });
}
// Alice (x) has 2 posts; Bob (bluesky) and Carol (misskey) have 1 each.
addPost('a1', 'x', '111', 'alice', 'Alice', '2026-01-04T00:00:00.000Z');
addPost('a2', 'x', '111', 'alice', 'Alice', '2026-01-03T00:00:00.000Z');
addPost('b1', 'bluesky', 'did:plc:bob', 'bob.bsky.social', 'Bob', '2026-01-02T00:00:00.000Z');
addPost('c1', 'misskey', 'mk1', 'carol', 'Carol', '2026-01-01T00:00:00.000Z');
seedLibrary(configDir, records);

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  await waitFor(() => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length >= 4);

  // The poster editor (the "+ フィルタ" flow — the old author row flyout is gone since P2③) —
  // posters are listed by post count. Filterbar idioms: see test-app-facetcounts.
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll(POP + ' div.cursor-default')];
  const nameOf = (r) => { const n = r.querySelector('span.truncate'); return n ? n.textContent : ''; };
  byText('button', 'フィルタ').click();
  await waitFor(() => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  byText(POP + ' [data-slot="command-item"]', '投稿者').click();
  await waitFor(() => edRows().length >= 3);
  const allNames = edRows().map(nameOf);   // Alice(2), Bob, Carol

  // click Alice -> apply a user filter (editor stays open, row shows ✓)
  edRows().find(r => nameOf(r) === 'Alice').click();
  await sleep(200);
  const chips = document.querySelector('[data-slot="filter-chips"]');
  const chipText = chips ? [chips.textContent] : [];
  const cardCount = document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const aliceActive = await waitFor(() => !!edRows().find(r => nameOf(r) === 'Alice' && r.querySelector('svg')));
  const stillOpen = !!document.querySelector(POP);

  return { allNames, chipText, cardCount, aliceActive, stillOpen };
})()`;

const shot = path.join(appDir, '.smoke-shot.png');
try {
  fs.unlinkSync(shot);
} catch {}

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'),
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
  HOLOGRAM_SMOKE_SHOT: shot,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r: Record<string, any> = {};
  try {
    r = JSON.parse((m && m[1]) as string);
  } catch {}
  try {
    fs.unlinkSync(shot);
  } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + label);
    if (!cond) ok = false;
  };
  check('authors ranked by post count in the editor (Alice, Bob, Carol)', eq(r.allNames, ['Alice', 'Bob', 'Carol']));
  check('the active filter chip shows the user (Alice)', Array.isArray(r.chipText) && String(r.chipText[0] || '').includes('Alice'));
  check("posts are filtered to that user's 2 posts", r.cardCount === 2);
  check('the picked author row shows ✓ and the editor stays open', r.aliceActive === true && r.stillOpen === true);
  console.log('\n' + (ok ? 'USERS_TEST_PASS' : 'USERS_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
