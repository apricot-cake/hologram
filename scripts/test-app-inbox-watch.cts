'use strict';

// Verifies the durable inbox queue's app-side consumer end-to-end (#5 St6 / #299):
//   - a post saved to .hologram-inbox/new WHILE THE APP IS CLOSED is drained into
//     the DB and rendered at the next launch (no sidecar involved at all — the
//     "saved while the app isn't running -> picked up on the next launch" acceptance criterion)
//   - a post saved to .hologram-inbox/new WHILE THE APP IS RUNNING is picked up by
//     watchInboxFolder's fs.watch (400ms debounce) without a restart (the
//     "a save while the app is running is reflected via the watcher" criterion)
// Idempotent re-apply of the same envelope is covered by the unit suite
// (scripts/db-inbox.test.ts) — this harness only proves the two are wired
// together through a real Electron boot + fs.watch, which a unit test cannot.
//
//   node scripts/test-app-inbox-watch.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { buildEnvelope, writeInboxEvent } = require(path.join(__dirname, '..', 'native-host', 'inbox.mts'));
const { normalizePostRecord } = require(path.join(__dirname, '..', 'native-host', 'post-record.mts'));

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-inboxwatch-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// Writes ONLY into .hologram-inbox/new + the screenshot file — no sidecar, the
// same artifacts bridge.cts's handleSave produces post-#299.
async function saveViaInbox(id) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  const rec = normalizePostRecord({ captureId: id, image: `${id}.jpg`, url: `https://x.com/u/status/${id}`, platform: 'x', text: 't' });
  await writeInboxEvent(saveFolder, buildEnvelope(rec));
}

// After the renderer has loaded (and rendered the app-closed capture), wait
// for the grid to reach 2 cards on its own once the second capture lands.
const evalJs = `(async () => {
  for (let i = 0; i < 40; i++) {
    if (document.querySelectorAll('[data-slot="post-card"]').length >= 2) return 2;
    await new Promise(r => setTimeout(r, 150));
  }
  return document.querySelectorAll('[data-slot="post-card"]').length;
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });

(async () => {
  // Saved while the app was never running — must be there at first render.
  const id1 = `${Date.now()}-aaaa`;
  await saveViaInbox(id1);

  const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d.toString();
  });

  // Saved once the app (and its watchInboxFolder watcher) is up.
  const id2 = `${Date.now() + 1}-bbbb`;
  setTimeout(() => {
    saveViaInbox(id2).catch(() => {});
  }, 2500);

  child.on('close', () => {
    const m = out.match(/EVAL_RESULT (.+)/);
    const count = m ? Number(m[1]) : -1;
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('rendered cards after inbox watch:', count);
    console.log(count === 2 ? 'INBOX_WATCH_TEST_PASS' : 'INBOX_WATCH_TEST_FAIL');
    process.exit(count === 2 ? 0 : 1);
  });
})();
