'use strict';

// Verifies the saved-search tree-unification (Stage 3): the search term is saved as
// a 'text' leaf INSIDE the tree, not in a separate coll.q field.
//   - type「投稿1」→ one matching card
//   - click 保存 (prompt overridden) → the dynamic collection has the term as a
//     text leaf in its tree, NO coll.q, and the box auto-confirmed empty
// Restore/open and legacy coll.q fallback are exercised on the real app (_verify-dyncoll).
//
//   node scripts/test-app-savesearch.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-ss-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-ss' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (700 + i),
    platform: 'x', text: '投稿' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
}

const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  await waitFor(() => cards() >= 3);
  const sb = document.getElementById('searchBox');
  sb.value = '投稿1'; sb.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(240);
  const r = {};
  r.leafCards = cards();   // 1 (投稿1 だけ一致)
  // Save the search (prompt overridden so it doesn't block the smoke run).
  const op = window.prompt; window.prompt = () => 'テスト保存';
  document.getElementById('saveSearchBtn').click();
  window.prompt = op;
  await wait(300);
  const dyn = (window.corpusFolders.allWithActive() || []).filter((c) => c.kind === 'dynamic');
  const c = dyn.find((x) => x.name === 'テスト保存');
  r.saved = !!c;
  r.hasQ = c ? ('q' in c) : null;                                              // false: q は保存しない
  r.leaves = c ? (c.tree.children || []).map((n) => n.type + ':' + n.value).join(',') : '';  // text:投稿1
  r.boxAfterSave = sb.value;                                                   // '' (auto-confirm)
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
  const ok = r.leafCards === 1 && r.saved === true && r.hasQ === false &&
    r.leaves === 'text:投稿1' && r.boxAfterSave === '';
  console.log(`leafCards=${r.leafCards} saved=${r.saved} hasQ=${r.hasQ} leaves="${r.leaves}" boxAfterSave="${r.boxAfterSave}"`);
  console.log(ok ? 'SAVESEARCH_TEST_PASS' : 'SAVESEARCH_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
