'use strict';
// Throwaway: self-reply chains group with their parent when both records are in
// the library:
//   p0  status/10 (author U)                ┐
//   p1  status/11 replyToId=10 (author U)   ├─ one card (chain via p1)
//   p2  status/12 replyToId=11 (author U)   ┘   (grandchild joins transitively)
//   p3  status/13 replyToId=10 (author V)   — OTHER author → separate card
// Expect 2 cards; the merged group holds 3 records (ℹ gallery/edit operate on all).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-rg-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const seeds = [
  { id: '1700000000000-rg0', url: 'https://x.com/u/status/10', userId: 'U' },
  { id: '1700000000001-rg1', url: 'https://x.com/u/status/11', userId: 'U', replyToId: '10', isThread: true },
  { id: '1700000000002-rg2', url: 'https://x.com/u/status/12', userId: 'U', replyToId: '11', isThread: true },
  { id: '1700000000003-rg3', url: 'https://x.com/u/status/13', userId: 'V', replyToId: '10', isReply: true }
];
seeds.forEach((s, i) => {
  fs.writeFileSync(path.join(saveFolder, s.id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, s.id + '.json'), JSON.stringify({
    captureId: s.id, image: s.id + '.jpg', url: s.url,
    platform: 'x', text: '本文' + i, displayName: '人', screenName: s.userId.toLowerCase(),
    userId: s.userId, replyToId: s.replyToId || null, isThread: s.isThread || null, isReply: s.isReply || null,
    likes: i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
});
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const grid = document.getElementById('postGrid');
  await waitFor(() => grid.querySelectorAll('.post-card').length >= 2);
  await wait(200);
  const cardsN = grid.querySelectorAll('.post-card').length;       // 2 (chain + other-author)
  // date-desc puts the other-author reply (newest) first → the merged chain card
  // is index 1; its ℹ popup must offer the group-ungroup link (3 records).
  grid.querySelector('.post-card[data-index="1"] .info-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(80);
  const detail = document.getElementById('postDetailBox').textContent;
  const hasUngroup = !!document.getElementById('pdUngroup');
  document.getElementById('postDetail').hidden = true;
  return { cardsN, detailHasGroup: hasUngroup, detailText: detail.slice(0, 40) };
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.cardsN === 2 && r.detailHasGroup === true;
  console.log(`cards=${r.cardsN} groupDetail=${r.detailHasGroup}`);
  console.log(ok ? 'REPLYGROUP_VERIFY_PASS' : 'REPLYGROUP_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
