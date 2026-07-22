'use strict';

// Bridge saved-post index — the read path behind the timeline "saved" badge
// (#54). Covers the three sources the answer is assembled from (the app's
// .index.json snapshot, sidecars newer than it, and the bridge's own journal),
// the URL-spelling normalization they share with the renderer, and the cache
// invalidation that keeps a long-lived port's answers current.
//
//   node scripts/test-bridge-query.cts

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-query-'));
process.env.APPDATA = tmp;
process.env.HOLOGRAM_CONFIG_DIR = path.join(tmp, 'Hologram'); // isolate configDir to the sandbox
const configDir = path.join(tmp, 'Hologram');
fs.mkdirSync(configDir, { recursive: true });
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

const { handleQuery, noteSaved, _resetSavedIndex } = require('../native-host/bridge.cts');

let ok = true;
const check = (label, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) ok = false;
};

const ask = (...urls) => handleQuery({ type: 'query', urls }).results;

// A sidecar as the bridge writes one. `id` doubles as the basename, so its
// leading epoch is what scanRecentSidecars reads as the save time.
function writeSidecar(id, url) {
  fs.writeFileSync(path.join(saveFolder, `${id}.json`), JSON.stringify({ captureId: id, url, image: `${id}.jpg` }), 'utf8');
}

// The app's snapshot. mtime is set explicitly: every staleness rule in the index
// is a comparison against THIS timestamp, so the test has to own it rather than
// race the filesystem clock.
function writeSnapshot(records, mtimeMs) {
  const entries = {};
  for (const rec of records) entries[`${rec.captureId}.json`] = { mtimeMs, record: rec };
  const p = path.join(saveFolder, '.index.json');
  fs.writeFileSync(p, JSON.stringify({ version: 2, entries }), 'utf8');
  fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
}

// --- 1. the snapshot answers, and only for posts it holds ---
const SNAP_MS = 1_700_000_000_000;
writeSnapshot([{ captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111', image: 'x.jpg' }], SNAP_MS);
_resetSavedIndex();
let res = ask('https://x.com/someone/status/111', 'https://x.com/someone/status/999');
check('snapshot hit returns the captureId', res['https://x.com/someone/status/111'] === '1700000000000-aa');
check('unsaved post returns null', res['https://x.com/someone/status/999'] === null);

// --- 2. URL spelling is normalized (the renderer's rule, one implementation) ---
res = ask('https://twitter.com/other_handle/status/111?s=20', 'https://x.com/someone/status/111/photo/1');
check('twitter.com + query string is the same post', res['https://twitter.com/other_handle/status/111?s=20'] === '1700000000000-aa');
check('/photo/N permalink is the same post', res['https://x.com/someone/status/111/photo/1'] === '1700000000000-aa');
res = ask('https://x.com/someone', 'not a url');
check('a profile URL is not a post', res['https://x.com/someone'] === null);
check('an unparseable URL is not a post', res['not a url'] === null);

// --- 3. saved while the app was closed: a sidecar newer than the snapshot ---
// The desktop app would have to run to fold this into .index.json; the badge
// must not wait for that.
writeSidecar(`${SNAP_MS + 5000}-bb`, 'https://www.pixiv.net/artworks/4242');
_resetSavedIndex();
res = ask('https://www.pixiv.net/en/artworks/4242');
check('sidecar newer than the snapshot is found (language-prefixed URL matches)', res['https://www.pixiv.net/en/artworks/4242'] === `${SNAP_MS + 5000}-bb`);

// --- 4. the journal: a save this process made, before anything hits the index ---
// noteSaved is what handleSave/handleSaveDragged call once the sidecar lands.
noteSaved('https://bsky.app/profile/alice.test/post/3kzz', '1700000009999-cc');
res = ask('https://bsky.app/profile/alice.test/post/3kzz');
check('a just-saved post answers immediately (live map)', res['https://bsky.app/profile/alice.test/post/3kzz'] === '1700000009999-cc');
_resetSavedIndex(); // a fresh process (new port) must reach the same answer via the journal file
res = ask('https://bsky.app/profile/alice.test/post/3kzz');
check('…and after a restart, via bridge-journal.jsonl', res['https://bsky.app/profile/alice.test/post/3kzz'] === '1700000009999-cc');
check('journal file written to configDir', fs.existsSync(path.join(configDir, 'bridge-journal.jsonl')));

// --- 5. journal entries the snapshot has caught up with are dropped ---
// Rewriting the snapshot with a LATER mtime than the journal line's timestamp
// means the line is redundant; the post must still answer saved, now from the
// snapshot itself.
writeSnapshot(
  [
    { captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111', image: 'x.jpg' },
    { captureId: '1700000009999-cc', url: 'https://bsky.app/profile/alice.test/post/3kzz', image: 'b.jpg' },
  ],
  Date.now() + 60_000,
);
_resetSavedIndex();
res = ask('https://bsky.app/profile/alice.test/post/3kzz');
check('a post the snapshot caught up with still answers saved', res['https://bsky.app/profile/alice.test/post/3kzz'] === '1700000009999-cc');

// --- 6. the cache follows the snapshot's mtime (a port lives for a whole feed) ---
// No _resetSavedIndex here: this is the invalidation path, not a cold build.
res = ask('https://misskey.io/notes/9newnote');
check('unknown before the app writes it', res['https://misskey.io/notes/9newnote'] === null);
writeSnapshot(
  [
    { captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111', image: 'x.jpg' },
    { captureId: '1700000011111-dd', url: 'https://misskey.io/notes/9newnote', image: 'm.jpg' },
  ],
  Date.now() + 120_000,
);
res = ask('https://misskey.io/notes/9newnote');
check('a rewritten snapshot invalidates the cached index', res['https://misskey.io/notes/9newnote'] === '1700000011111-dd');

// --- 7. a batch is capped, and junk in it is skipped rather than answered ---
const many: unknown[] = Array.from({ length: 400 }, (_, i) => `https://x.com/u/status/${900000 + i}`);
const capped = handleQuery({ type: 'query', urls: [...many, null, 42, ''] }).results;
check('batch capped at 300 URLs', Object.keys(capped).length === 300);
check('empty batch is answered, not refused', Object.keys(handleQuery({ type: 'query', urls: [] }).results).length === 0);
check('a malformed message is answered, not thrown', Object.keys(handleQuery({ type: 'query' }).results).length === 0);

// --- 8. no save folder / no library: answers "not saved", never throws ---
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: path.join(tmp, 'gone') }));
_resetSavedIndex();
res = ask('https://x.com/someone/status/111');
check('a missing save folder answers null instead of throwing', res['https://x.com/someone/status/111'] === null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(ok ? 'PASS test-bridge-query' : 'FAIL test-bridge-query');
process.exit(ok ? 0 : 1);
