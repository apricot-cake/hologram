'use strict';

// #158: the trash notice, end to end through a real app launch.
//
// Two things are proven here that no unit test can, because both live in the
// wiring rather than in a pure function:
//
//   1. Deleting a post REWRITES bridge-saved-index.json. Before #158 nothing in
//      ipc-trash.ts touched it (scheduleSavedIndexWrite's only callers were the
//      startup priming, the inbox drain, the ZIP import and orphan recovery), so
//      a deleted post kept its "saved" entry — the timeline badge stayed lit and
//      the duplicate-save warning kept naming a capture that was in the trash.
//   2. The post moves from `entries` to `trashed`, and back again on restore.
//      The bridge is asked, not just the file, because the answer the extension
//      acts on is handleQuery's — a snapshot the reader cannot use proves nothing.
//
// Every check runs against the SAME sandbox library within one launch, in the
// order a user would produce it: delete -> restore -> delete -> empty trash.
//
//   node scripts/test-app-trash-notice.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-trashnotice-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const POST_URL = 'https://x.com/trashnotice/status/158158158';
const CAPTURE_ID = 'dummy-158';
const IMAGE = `${CAPTURE_ID}.jpg`;
const SNAPSHOT_FILE = path.join(configDir, 'bridge-saved-index.json');

// A real media file has to exist: delete-post moves this capture's files into
// .trash/, and restore-post moves them back. With nothing on disk the record
// would still round-trip, but the harness would not be exercising the file half
// the notice's lifetime is tied to.
fs.writeFileSync(path.join(saveFolder, IMAGE), Buffer.from('89504e470d0a1a0a', 'hex'));

seedLibrary(configDir, [
  {
    captureId: CAPTURE_ID,
    image: IMAGE,
    url: POST_URL,
    platform: 'x',
    text: 'trash notice fixture',
    tags: ['tag-a'],
    media: [{ url: 'https://pbs.twimg.com/media/TRASH?format=jpg&name=orig', file: IMAGE }],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  },
]);

process.env.HOLOGRAM_CONFIG_DIR = configDir;
const bridge = require(path.join(__dirname, '..', 'native-host', 'bridge.mts'));

// One "what does the extension see right now" reading. The cache is dropped
// first because this process holds the index for the life of a port, and the
// app has just rewritten the file underneath it.
function ask() {
  bridge._resetSavedIndex();
  const ack = bridge.handleQuery({ type: 'query', urls: [POST_URL] });
  return { saved: ack.results[POST_URL] || null, trashed: (ack.trashed || {})[POST_URL] || null };
}

// scheduleSavedIndexWrite debounces 1500ms, so every step waits past it before
// the next one moves the library on. The waits are what make the readings below
// answers about a settled state rather than a race.
const evalJs = evalSource(
  async ({ sleep }, args) => {
    const w = window as any;
    // The debounce IS the specification: scheduleSavedIndexWrite waits 1500ms, and
    // until it elapses there is nothing observable from the renderer that says the
    // snapshot for THIS step has been written. Every step sits past it so the
    // harness's poll samples a settled state instead of a race.
    // biome-ignore lint/plugin: the 1500ms saved-index debounce is the spec — nothing is observable until it elapses.
    const settle = () => sleep(1900);
    await w.hologram.listPosts();
    await settle();
    await w.hologram.deletePost(args.image);
    await settle();
    w.__afterDelete = (await w.hologram.listTrash()).length;
    await w.hologram.restorePost(args.image);
    await settle();
    await w.hologram.deletePost(args.image);
    await settle();
    await w.hologram.emptyTrash();
    await settle();
    return 'done ' + w.__afterDelete;
  },
  { image: IMAGE },
);

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
});

// Each stage is sampled as the app reaches it: the harness cannot step the eval,
// so it polls the snapshot's own mtime and records what the bridge answers at
// every rewrite. The sequence of answers IS the assertion.
const readings: Array<{ saved: string | null; trashed: string | null }> = [];
let lastMtime = -1;
const poll = setInterval(() => {
  let mtime: number;
  try {
    mtime = fs.statSync(SNAPSHOT_FILE).mtimeMs;
  } catch {
    return; // not written yet
  }
  if (mtime === lastMtime) return;
  lastMtime = mtime;
  const a = ask();
  readings.push({ saved: a.saved ? a.saved.id : null, trashed: a.trashed ? a.trashed.id : null });
}, 150);

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  clearInterval(poll);
  const evalOk = /EVAL_RESULT "done 1"/.test(out);

  // The final state is read after the app is gone, so nothing can rewrite the
  // file between the reading and the check.
  const final = ask();

  // Collapse consecutive identical readings: the debounce can fire more than
  // once for one library change (a listPosts on the way past re-primes it), and
  // what this test is about is the ORDER of distinct states, not how many
  // rewrites each took.
  const states: string[] = [];
  for (const r of readings) {
    const state = r.saved ? 'saved' : r.trashed ? 'trashed' : 'none';
    if (states[states.length - 1] !== state) states.push(state);
  }

  // saved (the seeded library) -> trashed (delete) -> saved (restore) ->
  // trashed (delete again) -> none (empty trash). A missing 'trashed' between
  // two 'saved's is the pre-#158 behaviour: the delete never reached the index.
  const sequenceOk = states.join(',') === 'saved,trashed,saved,trashed,none';
  const finalOk = final.saved === null && final.trashed === null;

  // The trash notice must NOT be reachable as a saved entry: the badge and the
  // hover save button read any entry as "the library holds this", so a trashed
  // post listed among `entries` would light the badge for a post that is gone.
  let trashedIsNotSaved = true;
  try {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    trashedIsNotSaved = Object.keys(snap.entries || {}).every((k) => !(snap.trashed || {})[k]);
  } catch {
    trashedIsNotSaved = false;
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  const pass = evalOk && sequenceOk && finalOk && trashedIsNotSaved;
  console.log(`eval=${evalOk} states=${states.join(',')} final=${JSON.stringify(final)} trashedDisjointFromSaved=${trashedIsNotSaved}`);
  console.log(pass ? 'TRASH_NOTICE_PASS' : 'TRASH_NOTICE_FAIL');
  process.exit(pass ? 0 : 1);
});
