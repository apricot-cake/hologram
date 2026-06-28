'use strict';

// Hardening regressions for app/main.js, driven through the real IPC handlers via
// the CORPUS_SMOKE harness. Covers three independent fixes:
//
//   件1 delete-post reaps the author avatar (<base>-avatar.<ext>) into .trash/
//        instead of leaving it orphaned in the save folder.
//   件2 navigation lockdown: renderer-initiated window.open is denied
//        (setWindowOpenHandler), and the renderer's global drop guard
//        preventDefault()s a file dropped onto the window.
//   件3 organization-JSON degraded guard: a present-but-corrupt org file is NOT
//        purged by the empty default it reads back as — get-* returns empty but
//        set-* refuses to overwrite, preserving the file on disk.
//
//   node scripts/test-app-hardening.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-harden-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');

// 件1: a post WITH an avatar file recorded in its sidecar + a sibling avatar image
// on disk. delete-post must move BOTH the primary jpg AND the avatar into .trash/.
const POST = 'dummy-har-0001';
fs.writeFileSync(path.join(saveFolder, `${POST}.jpg`), jpeg);
fs.writeFileSync(path.join(saveFolder, `${POST}-avatar.png`), png);
fs.writeFileSync(path.join(saveFolder, `${POST}.json`), JSON.stringify({
  captureId: POST, image: `${POST}.jpg`, avatar: 'https://h/a.png', avatarFile: `${POST}-avatar.png`,
  url: `https://x.com/u/status/${POST}`, platform: 'x', text: 't', tags: [],
  capturedAt: '2026-01-01T00:00:00.000Z', date: '2026-01-01T00:00:00.000Z',
}, null, 2));

// 件3: two org files that are present-but-corrupt (torn JSON). The handlers should
// read them as empty (so the UI loads) but refuse to overwrite them.
const CORRUPT = '{ "collections": [ { "id": "c1", "nam';   // truncated mid-object
fs.writeFileSync(path.join(saveFolder, 'collections.json'), CORRUPT);
fs.writeFileSync(path.join(saveFolder, 'tag-groups.json'), CORRUPT);

const evalJs = `(async () => {
  // 件2: window.open must be denied by setWindowOpenHandler (returns null when blocked).
  let openDenied = false;
  try {
    const w = window.open('https://example.com', '_blank');
    openDenied = (w === null);
  } catch { openDenied = true; }

  // 件2: the renderer's global drop guard must preventDefault a window-level drop.
  const dropEvt = new Event('drop', { bubbles: true, cancelable: true });
  window.dispatchEvent(dropEvt);
  const dropPrevented = dropEvt.defaultPrevented;
  const dragEvt = new Event('dragover', { bubbles: true, cancelable: true });
  window.dispatchEvent(dragEvt);
  const dragPrevented = dragEvt.defaultPrevented;

  // 件3: corrupt org files read back as empty (UI keeps working) ...
  const coll = await window.corpus.getCollections();
  const collEmpty = Array.isArray(coll.collections) && coll.collections.length === 0;
  const tg = await window.corpus.getTagGroups();
  const tgEmpty = Array.isArray(tg.groups) && tg.groups.length === 0;
  // ... but a follow-up set-* (e.g. the renderer auto-persisting that empty) is
  // REFUSED, so nothing overwrites the corrupt-but-recoverable file on disk.
  const setColl = await window.corpus.setCollections({ collections: [], clip: [], posterWorkspace: [] });
  const setTg = await window.corpus.setTagGroups([]);
  const setCollRefused = !!(setColl && setColl.ok === false);
  const setTgRefused = !!(setTg && setTg.ok === false);

  // 件1: delete the post → its files move to .trash/.
  await window.corpus.deletePost('${POST}.jpg');

  return { openDenied, dropPrevented, dragPrevented, collEmpty, tgEmpty, setCollRefused, setTgRefused };
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r = {};
  try { r = JSON.parse(m && m[1]); } catch { /* ignore */ }

  const trashDir = path.join(saveFolder, '.trash');
  // 件1 assertions (disk state): avatar + primary moved into .trash, none left orphaned.
  const avatarOrphaned = fs.existsSync(path.join(saveFolder, `${POST}-avatar.png`));
  const avatarInTrash = fs.existsSync(path.join(trashDir, `${POST}-avatar.png`));
  const primaryGone = !fs.existsSync(path.join(saveFolder, `${POST}.jpg`));
  const primaryInTrash = fs.existsSync(path.join(trashDir, `${POST}.jpg`));

  // 件3 assertions (disk state): the corrupt org files are PRESERVED byte-for-byte.
  let collPreserved = false; let tgPreserved = false;
  try { collPreserved = fs.readFileSync(path.join(saveFolder, 'collections.json'), 'utf8') === CORRUPT; } catch { /* missing = fail */ }
  try { tgPreserved = fs.readFileSync(path.join(saveFolder, 'tag-groups.json'), 'utf8') === CORRUPT; } catch { /* missing = fail */ }

  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + label); if (!cond) ok = false; };

  console.log('\n--- main.js hardening regressions ---\n');
  // 件1
  check('件1 アバターが保存先に孤児化していない', !avatarOrphaned);
  check('件1 アバターが .trash へ回収された',      avatarInTrash);
  check('件1 主画像が保存先から消えた',            primaryGone);
  check('件1 主画像が .trash へ回収された',        primaryInTrash);
  // 件2
  check('件2 window.open が拒否された',            r.openDenied === true);
  check('件2 window drop が preventDefault された', r.dropPrevented === true);
  check('件2 window dragover が preventDefault された', r.dragPrevented === true);
  // 件3
  check('件3 壊れた collections.json は空として読まれる', r.collEmpty === true);
  check('件3 壊れた tag-groups.json は空として読まれる',  r.tgEmpty === true);
  check('件3 空での collections 上書きが拒否された',      r.setCollRefused === true);
  check('件3 空での tag-groups 上書きが拒否された',       r.setTgRefused === true);
  check('件3 壊れた collections.json が温存された',        collPreserved);
  check('件3 壊れた tag-groups.json が温存された',         tgPreserved);

  console.log('\n' + (ok ? 'HARDENING_TEST_PASS' : 'HARDENING_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
