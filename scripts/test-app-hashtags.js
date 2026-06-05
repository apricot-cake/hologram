'use strict';

// Verifies the Hashtags tab: seeds posts whose text contains #tags, opens the
// tab in the renderer, and checks the extracted/counted list.
//
//   node scripts/test-app-hashtags.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postsnap-ht-'));
const configDir = path.join(tmp, 'PostSnap');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

function writePost(id, text) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  fs.writeFileSync(path.join(saveFolder, `${id}.json`), JSON.stringify({
    captureId: id, image: `${id}.jpg`, url: `https://x.com/u/status/${id}`, platform: 'x',
    text, tags: [], capturedAt: '2026-01-01T00:00:00.000Z', date: '2026-01-01T00:00:00.000Z'
  }, null, 2));
}
writePost('p1', 'TypeScript最高 #typescript #プログラミング');
writePost('p2', '別記事 #typescript の続き');
writePost('p3', 'タグなし投稿');

const evalJs = `(async () => {
  document.querySelector('.tab-btn[data-tab="tags"]').click();
  await new Promise(r => setTimeout(r, 250));
  return [...document.querySelectorAll('.hashtag-chip')].map(c => c.dataset.tag + ':' + c.querySelector('.ht-count').textContent);
})()`;

const shot = path.join(appDir, '.smoke-shot.png');
try { fs.unlinkSync(shot); } catch {}

const env = Object.assign({}, process.env, {
  APPDATA: tmp, POSTSNAP_SMOKE: '1', POSTSNAP_SMOKE_EVAL: evalJs, POSTSNAP_SMOKE_SHOT: shot
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  const m = out.match(/EVAL_RESULT (.+)/);
  let chips = [];
  try { chips = JSON.parse(m[1]); } catch {}
  const has = (s) => chips.includes(s);
  const pass = has('#typescript:2') && has('#プログラミング:1') && chips.length === 2;
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('chips:', JSON.stringify(chips));
  console.log(pass ? 'HASHTAG_TEST_PASS' : 'HASHTAG_TEST_FAIL');
  process.exit(pass ? 0 : 1);
});
