'use strict';

// Switches the Electron app to 画像閲覧 (image-view) mode and verifies the
// info-plus tile grid renders sidecar records (media original preferred, else
// image), that tiles use the psimg:// protocol, and that the fullscreen viewer
// opens. Also captures a screenshot of the grid.
//
//   node scripts/test-app-imageview.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-iv-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const W = (name) => fs.writeFileSync(path.join(saveFolder, name), jpeg);

// A: X post-click save — screenshot + one original in media[] (image-view shows the original)
W('1700000000000-aa01.jpg');
W('1700000000000-aa01-media-0.jpg');
fs.writeFileSync(path.join(saveFolder, '1700000000000-aa01.json'), JSON.stringify({
  captureId: '1700000000000-aa01', image: '1700000000000-aa01.jpg', url: 'https://x.com/u/status/1',
  platform: 'x', displayName: 'X絵師', screenName: 'xartist', likes: 12000,
  capturedAt: '2026-04-04T12:00:00Z', date: '2026-04-04T10:00:00Z',
  media: [{ url: 'https://pbs.twimg.com/media/x.jpg', file: '1700000000000-aa01-media-0.jpg' }], tags: [], hashtags: []
}, null, 2));

// B: pixiv illustration record (image-only, no media — the drag/migration shape)
W('1700000000001-aa02.jpg');
fs.writeFileSync(path.join(saveFolder, '1700000000001-aa02.json'), JSON.stringify({
  captureId: '1700000000001-aa02', image: '1700000000001-aa02.jpg', url: 'https://www.pixiv.net/artworks/2',
  platform: 'pixiv', title: 'ピクシブ作品', displayName: '絵師名', screenName: '882569', likes: 5000,
  capturedAt: '2026-04-05T12:00:00Z', date: '2026-04-03T10:00:00Z', media: [], tags: [], hashtags: ['オリジナル']
}, null, 2));

const shot = path.join(appDir, '.smoke-shot-iv.png');
try { fs.unlinkSync(shot); } catch { /* ignore */ }

const evalJs = `(async () => {
  document.getElementById('modeImageBtn').click();
  await new Promise(r => setTimeout(r, 700));
  const cards = document.querySelectorAll('#ivGrid .iv-card');
  const firstImg = cards[0] && cards[0].querySelector('img');
  const hasPsimg = !!(firstImg && /^psimg:\\/\\/img\\//.test(firstImg.getAttribute('src') || ''));
  if (cards[0]) cards[0].click();
  const viewerOpen = !document.getElementById('ivViewer').hidden;
  document.getElementById('ivViewer').hidden = true; // close so the screenshot shows the grid
  return { cards: cards.length, hasPsimg, viewerOpen, imageVisible: document.getElementById('mode-image').style.display !== 'none',
    postActive: document.getElementById('modePostBtn').classList.contains('active'),
    imgActive: document.getElementById('modeImageBtn').classList.contains('active') };
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs, CORPUS_SMOKE_SHOT: shot
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  const shotOk = fs.existsSync(shot);
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.cards === 2 && r.hasPsimg === true && r.viewerOpen === true && r.imageVisible === true && shotOk;
  console.log(`cards=${r.cards} psimg=${r.hasPsimg} viewer=${r.viewerOpen} imageVisible=${r.imageVisible} screenshot=${shotOk}`);
  console.log(ok ? 'IMAGEVIEW_TEST_PASS' : 'IMAGEVIEW_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
