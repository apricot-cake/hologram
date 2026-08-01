'use strict';

// Verifies the automatic backup (incremental mirror) plumbing end-to-end via IPC:
//  - set-backup rejects an output dir that overlaps the save folder
//  - run-backup mirrors the library into <dir>/Hologram-mirror/ (individual files)
//  - a second run is idempotent (immutable assets → nothing new copied)
//  - a file that APPEARS in the library after the first backup is picked up by the
//    next run (the mirror is not frozen at its first snapshot)
//  - everything the mirror carries from the library is write-once since #302, so a
//    file already at the destination is never re-copied. What used to change in
//    place — the organization JSON — lives in the DB now and reaches the mirror as
//    the snapshot below, not as a tracked file.
//  - deleting a post propagates: the file is pruned from the mirror
//  - the prune-safety guard holds the prune when src collapses (clear-all → empty),
//    leaving the mirror intact (regression for the 2026-06-23 library-loss incident)
//
//   node scripts/test-app-backup.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-bk-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
const outDir = path.join(tmp, 'out');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const ids: any[] = [];
const records: any[] = [];
// 4 posts: enough that the clear-all collapse drops src well below the prune-guard's
// 50% shrink ratio, so the guard-held assertion stays unambiguous.
for (let i = 0; i < 4; i++) {
  const id = '170000000000' + i + '-bk' + i;
  ids.push(id);
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (800 + i),
    platform: 'x',
    text: '本文' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 1 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

const mirror = path.join(outDir, 'Hologram-mirror');
const countMirror = () => {
  try {
    // hologram-db/ (#301's DB snapshot) is a standing subfolder unrelated to
    // post-asset pruning — exclude it so the prune-intact assertions below
    // keep comparing like with like (post files only), same reasoning that
    // already applies to .hologram-inbox in runBackup itself.
    return fs.readdirSync(mirror).filter((n) => !/\.tmp(-\d+)?$/i.test(n) && n !== 'hologram-db').length;
  } catch {
    return -1;
  }
};

function launch(evalJs): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
    const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.on('close', () => {
      let r: Record<string, any> = {};
      const m = out.match(/EVAL_RESULT (.+)/);
      if (m) {
        try {
          r = JSON.parse(m[1]);
        } catch {
          /* ignore */
        }
      }
      resolve(r);
    });
  });
}

// A file that turns up in the library after the first backup. The name is
// arbitrary; what matters is that the mirror carries whatever it finds at the
// library root, and that a later in-place edit does NOT re-copy (write-once).
const LATE_FILE = 'late-arrival.json';
const lateFilePath = path.join(saveFolder, LATE_FILE);

(async () => {
  // launch A: output dir nested inside the save folder must be rejected (overlap);
  // then run 1 (fresh copy of the 4 seed posts) and run 2 (idempotent — nothing changed).
  const evalA = `(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    await wait(400);
    const bad = await window.hologram.setBackup({ dir: ${JSON.stringify(path.join(saveFolder, 'nested'))} });
    const overlapRejected = !!(bad && bad.ok === false && bad.error === 'overlap');
    const good = await window.hologram.setBackup({ dir: ${JSON.stringify(outDir)} });
    const dirSet = !!(good && good.backup && good.backup.dir);

    // Don't hardcode the count — metadata files count too; assert written === fileCount.
    const r1 = await window.hologram.runBackup();
    const run1 = !!(r1 && r1.ok && r1.written >= 4 && r1.written === r1.fileCount && r1.pruned === 0 && !r1.pruneSkipped);

    // idempotent — assets are immutable, nothing new to copy or prune
    const r2 = await window.hologram.runBackup();
    const run2 = !!(r2 && r2.ok && r2.written === 0 && r2.pruned === 0 && !r2.pruneSkipped);

    return { overlapRejected, dirSet, run1, run2 };
  })()`;
  const dbSnapshotFile = path.join(outDir, 'Hologram-mirror', 'hologram-db', 'hologram.db');
  const rA = await launch(evalA);

  // DB snapshot (#301): run1 must have produced a hologram-db/hologram.db via
  // the backup API, not a raw copy of the live (and here, out-of-tree) DB file.
  let dbSnapshotWritten = false;
  try {
    dbSnapshotWritten = fs.statSync(dbSnapshotFile).size > 0;
  } catch {
    /* missing → stays false */
  }

  // The mirror must not freeze at its first snapshot: a file that appears later is
  // still picked up by the next run.
  fs.writeFileSync(lateFilePath, JSON.stringify({ notes: ['A'] }, null, 2));

  const evalB = `(async () => {
    const e1 = await window.hologram.runBackup();
    const edit1 = !!(e1 && e1.ok && e1.written >= 1 && !e1.pruneSkipped);
    return { edit1 };
  })()`;
  const rB = await launch(evalB);

  // Change it in place. Nothing the mirror carries changes after it is written, so
  // a run after this must copy nothing — write-once is the contract, not an
  // oversight (see runBackup's comment).
  fs.writeFileSync(lateFilePath, JSON.stringify({ notes: ['A', 'B'] }, null, 2));

  const evalC = `(async () => {
    const e2 = await window.hologram.runBackup();
    const writeOnce = !!(e2 && e2.ok && e2.written === 0 && !e2.pruneSkipped);
    const e3 = await window.hologram.runBackup();
    const editIdempotent = !!(e3 && e3.ok && e3.written === 0 && !e3.pruneSkipped);

    // delete one post → next run prunes its file from the mirror. Since #302 a post
    // is one file in the library (its record is in the DB), so exactly one goes.
    // Baseline is e3.fileCount (after the late file was added), not r2.
    await window.hologram.deletePost(${JSON.stringify(ids[0] + '.jpg')});
    const r3 = await window.hologram.runBackup();
    const pruneWorks = !!(r3 && r3.ok && r3.pruned === 1 && r3.fileCount === e3.fileCount - 1 && !r3.pruneSkipped);

    // collapse src (clear-all wipes every post asset) → guard MUST hold the prune
    // and leave the mirror untouched. Reason is shrink/empty depending on what is
    // left at the root; either is a valid trip.
    await window.hologram.clearAll();
    const r4 = await window.hologram.runBackup();
    const guardHeld = !!(r4 && r4.ok && r4.pruned === 0 && (r4.pruneSkipped === 'empty' || r4.pruneSkipped === 'shrink'));

    // mirror should still hold exactly what r3 left (guard prevented any deletion)
    return { writeOnce, editIdempotent, pruneWorks, guardHeld, expectMirror: r3.fileCount };
  })()`;
  const rC = await launch(evalC);

  const r = Object.assign({}, rA, rB, rC);

  // filesystem-side verification: the guarded collapse run left the mirror exactly
  // as r3 did (no files deleted) — proof the prune was truly held back on disk.
  const mirrorAfter = countMirror();
  const mirrorIntact = typeof r.expectMirror === 'number' && mirrorAfter === r.expectMirror;
  // filesystem-side verification of write-once: the mirrored copy holds the file as
  // it was when it was first copied (1 note), NOT the later in-place edit.
  let writeOnceOnDisk = false;
  try {
    const mj = JSON.parse(fs.readFileSync(path.join(mirror, LATE_FILE), 'utf8'));
    writeOnceOnDisk = Array.isArray(mj.notes) && mj.notes.length === 1;
  } catch {
    /* missing/unreadable → stays false */
  }
  // filesystem-side verification of clear-all: since #302 a library holds media and
  // nothing else, so the wipe is exactly "every post asset goes" — a non-media file
  // sitting at the root is none of its business and must survive.
  let clearSweptAssets = false;
  try {
    const left = fs.readdirSync(saveFolder);
    clearSweptAssets = !left.some((f) => /\.jpe?g$/i.test(f)) && left.includes(LATE_FILE);
  } catch {
    /* unreadable → stays false */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.overlapRejected && r.dirSet && r.run1 && r.run2 && r.edit1 && r.writeOnce && r.editIdempotent && writeOnceOnDisk && r.pruneWorks && r.guardHeld && mirrorIntact && clearSweptAssets && dbSnapshotWritten;
  console.log(
    `overlap=${r.overlapRejected} dirSet=${r.dirSet} run1=${r.run1} run2=${r.run2} lateFile=${r.edit1} writeOnce=${r.writeOnce} idem=${r.editIdempotent} writeOnceOnDisk=${writeOnceOnDisk} prune=${r.pruneWorks} guard=${r.guardHeld} mirror=${mirrorAfter}/${mirrorIntact} clearSweptAssets=${clearSweptAssets} dbSnapshot=${dbSnapshotWritten}`,
  );
  console.log(ok ? 'BACKUP_TEST_PASS' : 'BACKUP_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
