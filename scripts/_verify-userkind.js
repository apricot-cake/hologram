'use strict';
// Throwaway: userKind (メディア/ポスト) filter + kind label rename.
// Seeds 3 posts: userKind media / plain / none. The new フィルタ row should
// filter to exactly the matching ones; the 種別 row's first value is now
// 「キャプチャ」 (was SNS投稿).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-uk-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const kinds = ['media', 'plain', null];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-uk' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (500 + i),
    platform: 'x', text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: [],
    userKind: kinds[i]
  }, null, 2));
}
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  await waitFor(() => cards() >= 3);
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  // the new メディア/ポスト row exists with a badge
  const row = document.querySelector('#filterRows [data-qfrow="userKind"]');
  const rowExists = !!row && document.querySelector('#filterRows [data-badge="userKind"]') !== null;
  // 種別 row's first value renamed to キャプチャ (not SNS投稿)
  click(document.querySelector('#filterRows [data-qfrow="kind"]')); await wait(60);
  const pop = document.querySelector('.qf-pop');
  const kindRenamed = [...pop.querySelectorAll('[data-qfval]')].some(r => r.textContent.includes('キャプチャ')) &&
    ![...pop.querySelectorAll('[data-qfval]')].some(r => r.textContent.includes('SNS投稿'));

  // open メディア/ポスト → choose ポスト(plain) → only the plain post shows
  click(row); await wait(60);
  const vals = [...pop.querySelectorAll('[data-qfval]')];
  const hasMediaPost = vals.some(r => r.dataset.qfval === 'media') && vals.some(r => r.dataset.qfval === 'plain');
  click(pop.querySelector('[data-qfval="plain"]')); await wait(80);
  const plainOnly = cards() === 1;
  const badgeOn = document.querySelector('#filterRows [data-badge="userKind"]').classList.contains('on');
  // an active-bar pill labelled ポスト appears
  const pill = [...document.querySelectorAll('#queryChips .sb-active-chip.qc-userKind')].some(c => c.textContent.includes('ポスト'));
  // switch to メディア → only the media post (flyout stays open after toggling)
  click(pop.querySelector('[data-qfval="plain"]')); await wait(60);   // toggle off
  click(pop.querySelector('[data-qfval="media"]')); await wait(80);
  const mediaOnly = cards() === 1;
  document.getElementById('postResetBtn').click(); await wait(60);
  const resetAll = cards() === 3;
  return { rowExists, kindRenamed, hasMediaPost, plainOnly, badgeOn, pill, mediaOnly, resetAll };
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
  const keys = ['rowExists', 'kindRenamed', 'hasMediaPost', 'plainOnly', 'badgeOn', 'pill', 'mediaOnly', 'resetAll'];
  const ok = keys.every((k) => r[k] === true);
  console.log(keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'USERKIND_VERIFY_PASS' : 'USERKIND_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
