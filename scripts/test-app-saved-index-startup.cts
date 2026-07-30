'use strict';

// Regression test for #466: bridge-saved-index.json must exist after a launch
// even when there is nothing for ensurePostsSynced to drain from the inbox and
// no orphan recovery ever ran — the two occasions that used to be the only
// callers of scheduleSavedIndexWrite. A library that was seeded straight into
// the DB (a moved/restored library, or simply "hasn't saved anything in a
// while") never hit either path, so the bridge answered {type:'query'} for an
// already-saved post from its journal + loose-inbox fallback alone, which
// both miss anything older than their own limits (#466's 2026-07-29 repro).
//
//   node scripts/test-app-saved-index-startup.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { seedLibrary } = require('./lib-seed-library.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-savedidx-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const POST_URL = 'https://x.com/EGOBJ4/status/2079187119311118431';
const CAPTURE_ID = 'dummy-466';
const SNAPSHOT_FILE = path.join(configDir, 'bridge-saved-index.json');

// Seeded straight into the DB via writePost (lib-seed-library.cts),
// never through the inbox and with no orphan to recover — exactly the shape that used
// to leave scheduleSavedIndexWrite uncalled for an entire app lifetime (#466).
seedLibrary(configDir, [
  {
    captureId: CAPTURE_ID,
    image: `${CAPTURE_ID}.jpg`,
    url: POST_URL,
    platform: 'x',
    text: 't',
    tags: [],
    media: [{ url: 'https://pbs.twimg.com/media/EGOBJ4?format=jpg&name=orig', file: `${CAPTURE_ID}.jpg` }],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  },
]);

process.env.HOLOGRAM_CONFIG_DIR = configDir;
const bridge = require(path.join(__dirname, '..', 'native-host', 'bridge.cts'));

const snapshotMissingBeforeLaunch = !fs.existsSync(SNAPSHOT_FILE);
// The bug reproduction: with no snapshot, the bridge's other two sources (journal,
// loose-inbox rescan) know nothing about a post that was seeded straight into the DB,
// so the query wrongly answers "not saved" for a post the library actually has.
const answerBeforeLaunch = bridge.handleQuery({ type: 'query', urls: [POST_URL] }).results[POST_URL];

const evalJs = `(async () => {
  await window.hologram.listPosts();
  // scheduleSavedIndexWrite debounces 1500ms; wait past it before the harness quits.
  await new Promise((r) => setTimeout(r, 1800));
  return 'primed';
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  const evalOk = /EVAL_RESULT "primed"/.test(out);
  const snapshotWritten = fs.existsSync(SNAPSHOT_FILE);
  let snapshotOk = false;
  if (snapshotWritten) {
    try {
      const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
      const entries = Object.values(snap.entries || {}) as Array<{ id: string }>;
      snapshotOk = entries.length === 1 && entries[0].id === CAPTURE_ID;
    } catch {
      snapshotOk = false;
    }
  }

  bridge._resetSavedIndex();
  const answerAfterLaunch = bridge.handleQuery({ type: 'query', urls: [POST_URL] }).results[POST_URL];
  const answerAfterOk = !!answerAfterLaunch && answerAfterLaunch.id === CAPTURE_ID;

  fs.rmSync(tmp, { recursive: true, force: true });

  const pass = snapshotMissingBeforeLaunch && answerBeforeLaunch === null && evalOk && snapshotWritten && snapshotOk && answerAfterOk;
  console.log(`snapshotMissingBefore=${snapshotMissingBeforeLaunch} answerBefore=${JSON.stringify(answerBeforeLaunch)} eval=${evalOk} snapshotWritten=${snapshotWritten} snapshotOk=${snapshotOk} answerAfter=${JSON.stringify(answerAfterLaunch)}`);
  console.log(pass ? 'SAVED_INDEX_STARTUP_PASS' : 'SAVED_INDEX_STARTUP_FAIL');
  process.exit(pass ? 0 : 1);
});
