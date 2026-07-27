'use strict';

// Hardening regressions for app/main.js, driven through the real IPC handlers via
// the HOLOGRAM_SMOKE harness. Covers three independent fixes:
//
//   件1 delete-post reaps the author avatar (<base>-avatar.<ext>) into .trash/
//        instead of leaving it orphaned in the save folder.
//   件2 navigation lockdown: renderer-initiated window.open is denied
//        (setWindowOpenHandler), and the renderer's global drop guard
//        preventDefault()s a file dropped onto the window.
//   件3 legacy org-JSON files (pre-#298/St5 truth-source flip) are read-only
//        residue now: a present-but-corrupt folders.json/tag-types.json is
//        skipped (not imported) rather than crashing the one-time legacy
//        import, get-* still returns empty (DB has nothing for them), set-*
//        is an ordinary DB write and SUCCEEDS (there is no file to clobber —
//        organization state no longer round-trips through these files at
//        all), and the corrupt file itself is left untouched on disk because
//        nothing in the current write path ever touches it.
//
//   node scripts/test-app-hardening.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-harden-'));
const configDir = path.join(tmp, 'Hologram');
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
fs.writeFileSync(
  path.join(saveFolder, `${POST}.json`),
  JSON.stringify(
    {
      captureId: POST,
      image: `${POST}.jpg`,
      avatar: 'https://h/a.png',
      avatarFile: `${POST}-avatar.png`,
      url: `https://x.com/u/status/${POST}`,
      platform: 'x',
      text: 't',
      tags: [],
      capturedAt: '2026-01-01T00:00:00.000Z',
      date: '2026-01-01T00:00:00.000Z',
    },
    null,
    2,
  ),
);

// 件3: two legacy org files that are present-but-corrupt (torn JSON). The
// one-time legacy import (lib-db-import.ts, runs while truthSource !== 'db')
// must skip them without crashing — get-* then reads empty from the DB, and
// a live set-* afterward is an unrelated ordinary DB write.
const CORRUPT = '{ "folders": [ { "id": "c1", "nam'; // truncated mid-object
fs.writeFileSync(path.join(saveFolder, 'folders.json'), CORRUPT);
fs.writeFileSync(path.join(saveFolder, 'tag-types.json'), CORRUPT);

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

  // 件3: the corrupt legacy files failed to import, so the DB has nothing for
  // them — get-* reads back empty (UI keeps working) ...
  const coll = await window.hologram.getFolders();
  const collEmpty = Array.isArray(coll.folders) && coll.folders.length === 0;
  const tt = await window.hologram.getTagTypes();
  const tgEmpty = tt && tt.types && typeof tt.types === 'object' && Object.keys(tt.types).length === 0;
  // ... and a follow-up set-* (the renderer persisting that empty) SUCCEEDS —
  // it's an ordinary DB write, unrelated to the untouched file on disk.
  const setColl = await window.hologram.setFolders({ folders: [] });
  const setTg = await window.hologram.setTagTypes({}, {});
  const setCollOk = !!(setColl && setColl.ok === true);
  const setTgOk = !!(setTg && setTg.ok === true);

  // 件1: delete the post → its files move to .trash/.
  await window.hologram.deletePost('${POST}.jpg');

  return { openDenied, dropPrevented, dragPrevented, collEmpty, tgEmpty, setCollOk, setTgOk };
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'),
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
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r: Record<string, any> = {};
  try {
    r = JSON.parse((m && m[1]) as string);
  } catch {
    /* ignore */
  }

  const trashDir = path.join(saveFolder, '.trash');
  // 件1 assertions (disk state): avatar + primary moved into .trash, none left orphaned.
  const avatarOrphaned = fs.existsSync(path.join(saveFolder, `${POST}-avatar.png`));
  const avatarInTrash = fs.existsSync(path.join(trashDir, `${POST}-avatar.png`));
  const primaryGone = !fs.existsSync(path.join(saveFolder, `${POST}.jpg`));
  const primaryInTrash = fs.existsSync(path.join(trashDir, `${POST}.jpg`));

  // 件3 assertions (disk state): the corrupt legacy files are PRESERVED
  // byte-for-byte — nothing in the current write path ever touches them.
  let collPreserved = false;
  let tgPreserved = false;
  try {
    collPreserved = fs.readFileSync(path.join(saveFolder, 'folders.json'), 'utf8') === CORRUPT;
  } catch {
    /* missing = fail */
  }
  try {
    tgPreserved = fs.readFileSync(path.join(saveFolder, 'tag-types.json'), 'utf8') === CORRUPT;
  } catch {
    /* missing = fail */
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
    if (!cond) ok = false;
  };

  console.log('\n--- main.js hardening regressions ---\n');
  // 件1
  check('件1 アバターが保存先に孤児化していない', !avatarOrphaned);
  check('件1 アバターが .trash へ回収された', avatarInTrash);
  check('件1 主画像が保存先から消えた', primaryGone);
  check('件1 主画像が .trash へ回収された', primaryInTrash);
  // 件2
  check('件2 window.open が拒否された', r.openDenied === true);
  check('件2 window drop が preventDefault された', r.dropPrevented === true);
  check('件2 window dragover が preventDefault された', r.dragPrevented === true);
  // 件3
  check('件3 壊れた folders.json は空として読まれる', r.collEmpty === true);
  check('件3 壊れた tag-types.json は空として読まれる', r.tgEmpty === true);
  check('件3 空での folders 上書きが成功する(DB書き込みでファイルと無関係)', r.setCollOk === true);
  check('件3 空での tag-types 上書きが成功する(DB書き込みでファイルと無関係)', r.setTgOk === true);
  check('件3 壊れた folders.json が温存された', collPreserved);
  check('件3 壊れた tag-types.json が温存された', tgPreserved);

  console.log('\n' + (ok ? 'HARDENING_TEST_PASS' : 'HARDENING_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
