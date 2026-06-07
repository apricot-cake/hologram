'use strict';

// Verifies auto-reload: starts the app with one post, then writes a second
// sidecar to the save folder after the renderer has loaded, and checks the grid
// re-rendered to 2 cards on its own (via the folder watcher).
//
//   node scripts/test-app-watch.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-watch-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
function writePost(id) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  fs.writeFileSync(path.join(saveFolder, `${id}.json`), JSON.stringify({
    captureId: id, image: `${id}.jpg`, url: `https://x.com/u/status/${id}`, platform: 'x',
    text: 't', tags: [], capturedAt: '2026-01-01T00:00:00.000Z', date: '2026-01-01T00:00:00.000Z'
  }));
}
writePost('a1');

// After the renderer has loaded (and rendered 1 card), wait for the grid to
// reach 2 cards on its own.
const evalJs = `(async () => {
  for (let i = 0; i < 40; i++) {
    if (document.querySelectorAll('.post-card').length >= 2) return 2;
    await new Promise(r => setTimeout(r, 150));
  }
  return document.querySelectorAll('.post-card').length;
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); });

// Write the second post a bit after launch, once the watcher is active and the
// initial render has happened.
setTimeout(() => writePost('a2'), 2500);

child.on('close', () => {
  const m = out.match(/EVAL_RESULT (.+)/);
  const count = m ? Number(m[1]) : -1;
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('rendered cards after add:', count);
  console.log(count === 2 ? 'WATCH_TEST_PASS' : 'WATCH_TEST_FAIL');
  process.exit(count === 2 ? 0 : 1);
});
