'use strict';
// Throwaway: confirm the motion pass is wired — fresh render adds .anim-in and
// cards get the corpusCardIn animation; ℹ opens the (non-modal) inspector panel;
// the lightbox slide gets .lb-in + corpusSlideIn. CSS keyframes resolve at runtime.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-mo-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
for (let i = 0; i < 2; i++) {
  const id = '170000000000' + i + '-mo' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (600 + i),
    platform: 'x', text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
}
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const grid = document.getElementById('postGrid');
  await waitFor(() => grid.querySelectorAll('.post-card').length >= 2);
  const gridAnimIn = grid.classList.contains('anim-in');
  const card = grid.querySelector('.post-card');
  const cardAnim = card ? getComputedStyle(card).animationName : 'none';
  // ℹ opens the persistent inspector panel (no pop animation by design — it
  // is a non-modal aside, not a popup)
  grid.querySelector('.post-card .info-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(50);
  const inspOpen = !document.getElementById('postDetail').hidden;
  document.getElementById('postDetail').hidden = true;
  // lightbox / gallery
  grid.querySelector('.post-card .card-img').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(50);
  const lb = document.getElementById('lightbox');
  const lbShown = lb.classList.contains('show');
  const img = document.getElementById('lightboxImg');
  const imgHasLbIn = img.classList.contains('lb-in');
  const imgAnim = getComputedStyle(img).animationName;
  return { gridAnimIn, cardAnim, inspOpen, lbShown, imgHasLbIn, imgAnim };
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
  const ok = r.gridAnimIn === true && /corpusCardIn/.test(r.cardAnim || '') &&
    r.inspOpen === true && r.lbShown === true &&
    r.imgHasLbIn === true && /corpusSlideIn/.test(r.imgAnim || '');
  console.log(`animIn=${r.gridAnimIn} card=${r.cardAnim} insp=${r.inspOpen} lbShown=${r.lbShown} imgLbIn=${r.imgHasLbIn} img=${r.imgAnim}`);
  console.log(ok ? 'MOTION_VERIFY_PASS' : 'MOTION_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
