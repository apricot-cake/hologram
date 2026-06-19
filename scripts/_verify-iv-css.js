'use strict';
// Throwaway: confirm the slimmed <style> block still parses and the kept classes
// apply real computed styles (detail popup box width, folder management modal row).
// A typo in the rewritten block would drop these back to defaults.
// (The old .iv-andor AND/OR toggle was removed in the query-builder 改訂③ redesign —
//  operators are now the inline .qb-op connector; that check was dropped.)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-css-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
for (let i = 0; i < 2; i++) {
  const id = '170000000000' + i + '-cs' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (700 + i),
    platform: 'x', text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: ['tagX'], hashtags: []
  }, null, 2));
}
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const grid = document.getElementById('postGrid');
  await waitFor(() => grid.querySelectorAll('.post-card').length >= 2);
  // ℹ on the first card opens the inspector (#postDetail = the right-column aside now)
  grid.querySelector('.post-card .info-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(60);
  const detailOpen = !document.getElementById('postDetail').hidden;
  document.getElementById('postDetail').hidden = true;
  // folder management modal (opened from the flyout footer): its .iv-detail-box must be
  // styled (max-width 420px) and .iv-folder-new is its flex row.
  window.corpusFolders.openManager();
  await wait(40);
  const box = document.querySelector('#ivFolderModal .iv-detail-box');
  const boxMaxW = box ? getComputedStyle(box).maxWidth : 'none';
  const fnew = document.querySelector('.iv-folder-new');
  const fnewDisplay = fnew ? getComputedStyle(fnew).display : 'none';
  return { detailOpen, boxMaxW, fnewDisplay };
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
  const ok = r.detailOpen === true && r.boxMaxW === '420px' && r.fnewDisplay === 'flex';
  console.log(`detailOpen=${r.detailOpen} boxMaxW=${r.boxMaxW} fnew=${r.fnewDisplay}`);
  console.log(ok ? 'CSS_VERIFY_PASS' : 'CSS_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
