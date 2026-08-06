'use strict';

// #593: restoring a post from the trash puts it back into the library's
// STRUCTURE, not just into the post list.
//
// Three things are dropped by FK ON DELETE CASCADE when a post is trashed and
// cannot be rebuilt from its record, so each one has to make the round trip
// through `.trash/<captureId>.json` explicitly:
//   folder membership, manual-group membership (with its position in the group),
//   and the acquisition originals (#292).
//
// Driven through the real IPC (delete-post / restore-post) rather than the writer
// directly, because the wiring is what was missing — db-write.test.ts already
// covers the read/apply pair in isolation. A folder is deleted WHILE the post
// sits in the trash, which is the case that decides the design: the restore drops
// that one membership and still succeeds (a foreign key would otherwise take the
// whole restore down).
//
// Ground truth is read from hologram.db after the app exits, not from an IPC
// answer, so nothing in the read path can make a missing row look present.
//
//   node scripts/test-app-restore-memberships.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');
const { createDbWriter } = require(path.join(appDir, 'src', 'main', 'lib-db-write.ts'));
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
// The real producer and reader of an original. Building the fixture with
// packRawPayloads matters: a hand-written row with encoding 'identity' is
// correctly discarded by the record normalizer (only gzip carries a payload), so
// a fixture that skipped it would test nothing and look like a code defect.
const { packRawPayloads, unpackRawPayload } = require(path.join(__dirname, '..', 'native-host', 'raw-payload.mts'));

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-restore-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const CAPTURE_ID = 'dummy-593';
const IMAGE = `${CAPTURE_ID}.jpg`;
const OTHER = 'dummy-593b';
const RAW_TEXT = '{"data":{"legacy":{"full_text":"original payload for 593"}}}';

fs.writeFileSync(path.join(saveFolder, IMAGE), Buffer.from('89504e470d0a1a0a', 'hex'));
fs.writeFileSync(path.join(saveFolder, `${OTHER}.jpg`), Buffer.from('89504e470d0a1a0a', 'hex'));

const base = { capturedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', platform: 'x', tags: ['tag-593'] };
// The originals ride in on the record itself: writePost inserts whatever `raw`
// carries, which is the same door a restore comes back through.
const handle = seedLibrary(
  configDir,
  [
    {
      ...base,
      captureId: CAPTURE_ID,
      image: IMAGE,
      url: 'https://x.com/restore/status/593',
      text: 'restore fixture',
      media: [{ url: 'https://pbs.twimg.com/media/R593?format=jpg&name=orig', file: IMAGE }],
      raw: packRawPayloads([{ sourceKind: 'x-graphql', contentType: 'application/json', body: RAW_TEXT }]),
    },
    { ...base, captureId: OTHER, image: `${OTHER}.jpg`, url: 'https://x.com/restore/status/593b', text: 'group mate', media: [] },
  ],
  { close: false },
);
const seedWriter = createDbWriter(handle.sqlite);
seedWriter.setFolders({
  folders: [
    { id: 'keep', name: 'Keep', kind: 'static', created: 1, items: [CAPTURE_ID] },
    { id: 'doomed', name: 'Doomed', kind: 'static', created: 2, items: [CAPTURE_ID] },
  ],
  activeId: 'keep',
});
// The trashed post is the group's SECOND member, so "back in the group" has to
// mean "back at seq 1" — a container whose order is the user's arrangement.
seedWriter.setManualGroups([[OTHER, CAPTURE_ID]]);
const seededRaw = handle.sqlite.prepare('SELECT COUNT(*) n FROM raw_payloads WHERE postId = ?').get(CAPTURE_ID).n;
handle.sqlite.close();

// Deleting 'doomed' between the delete and the restore is the whole point: the
// restore must drop that membership and keep going.
const evalJs = evalSource(
  async ({ sleep }, args) => {
    const hologram = (window as any).hologram;
    await hologram.listPosts();
    await hologram.deletePost(args.image);
    const folders = await hologram.getFolders();
    await hologram.setFolders({ ...folders, folders: folders.folders.filter((f) => f.id !== 'doomed') });
    await hologram.restorePost(args.image);
    // restore-post has committed its own writes by the time it resolves, but it
    // also kicks off tail work it does not await (the posts-changed refetch and
    // the debounced saved-index write, ipc-trash.ts) — this margin keeps the app
    // from being torn down in the middle of it. Nothing in the renderer reports
    // when that tail is done.
    // biome-ignore lint/plugin: no observable post-condition — the window covers main's un-awaited tail work before the app quits.
    await sleep(400);
    return 'restored';
  },
  { image: IMAGE },
);

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
  const evalOk = /EVAL_RESULT "restored"/.test(out);

  // #176: hologram.db lives inside the save folder now, not configDir (ADR 0025).
  const db = openDatabase(path.join(saveFolder, 'hologram.db'), { readonly: true }).sqlite;
  const post = db.prepare('SELECT captureId, trashedAt FROM posts WHERE captureId = ?').get(CAPTURE_ID);
  const folders = (db.prepare('SELECT folderId FROM folder_items WHERE postId = ? ORDER BY folderId').all(CAPTURE_ID) as Array<{ folderId: string }>).map((r) => r.folderId);
  const group = db.prepare('SELECT groupId, seq FROM manual_group_items WHERE postId = ?').get(CAPTURE_ID);
  const raw = db.prepare('SELECT encoding, sha256, byteLength, payload FROM raw_payloads WHERE postId = ?').all(CAPTURE_ID) as Array<{ encoding: string; sha256: string; byteLength: number; payload: Buffer | null }>;
  const tags = (db.prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ?').all(CAPTURE_ID) as Array<{ name: string }>).map((r) => r.name);
  db.close();

  const restored = !!post && !post.trashedAt;
  // 'keep' only: 'doomed' was deleted while the post was in the trash.
  const foldersOk = folders.join(',') === 'keep';
  const groupOk = !!group && group.seq === 1;
  // Byte-for-byte, not just present: a restore that wrote a truncated or
  // re-encoded original would be worse than one that wrote none. unpackRawPayload
  // is the real reader and verifies the stored sha256 as it decompresses, so this
  // also catches bytes that survived while their hash did not.
  const rawOk = raw.length === 1 && unpackRawPayload(raw[0]) === RAW_TEXT && raw[0].byteLength === Buffer.byteLength(RAW_TEXT, 'utf8');
  const tagsOk = tags.join(',') === 'tag-593';

  fs.rmSync(tmp, { recursive: true, force: true });

  const pass = evalOk && seededRaw === 1 && restored && foldersOk && groupOk && rawOk && tagsOk;
  console.log(`eval=${evalOk} seededRaw=${seededRaw} restored=${restored} folders=[${folders.join(',')}] group=${JSON.stringify(group)} raw=${raw.length}/${rawOk ? 'byte-identical' : 'MISMATCH'} tags=[${tags.join(',')}]`);
  console.log(pass ? 'RESTORE_MEMBERSHIPS_PASS' : 'RESTORE_MEMBERSHIPS_FAIL');
  process.exit(pass ? 0 : 1);
});
