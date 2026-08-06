'use strict';

// Verifies the automatic backup plumbing end-to-end via IPC:
//  - set-backup rejects an output dir that overlaps the save folder
//  - run-backup copies the library into <dir>/Hologram-backup/ (individual files)
//  - a second run is idempotent (immutable assets → nothing new copied)
//  - a file that APPEARS in the library after the first backup is picked up by the
//    next run (the destination is not frozen at its first pass)
//  - everything a backup carries from the library is write-once since #302, so a
//    file already at the destination is never re-copied. What used to change in
//    place — the organization JSON — lives in the DB now and reaches the
//    destination as the DB generation below, not as a tracked file.
//  - the DB lane (#233) writes a generation into the library's OWN
//    .db-generations/ store, and the destination gets a copy of that store
//  - deleting a post is a MOVE at the destination (#233): the file lands under
//    .trash/ instead of being deleted and copied over again
//  - the prune-safety guard holds the prune when src collapses (clear-all → empty),
//    leaving the destination intact (regression for the 2026-06-23 library-loss
//    incident)
//  - the destination records which library it belongs to (#233/#176) and a run
//    against a destination claimed by ANOTHER library is refused before anything
//    is written or pruned
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
const { rendererWaits } = require('./lib-wait.cts');

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
// 8 posts: enough that the clear-all collapse drops src well below the prune-guard's
// 50% shrink ratio even though the post trashed earlier in the run keeps its files
// (under .trash/, which #233 backs up too), so the guard-held assertion stays
// unambiguous.
for (let i = 0; i < 8; i++) {
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

const backupDir = path.join(outDir, 'Hologram-backup');
const countBackupRoot = () => {
  try {
    // Top-level FILES only: .db-generations/, .trash/ and the shared stores are
    // standing subfolders unrelated to post-asset pruning, so counting them would
    // stop the prune-intact assertions below from comparing like with like (post
    // files only) — the same reasoning that already applied to .hologram-inbox.
    // .hologram-backup.json is out for the same reason: it is the destination's
    // own record of which library owns it (#233/#176), never a copied asset.
    return fs.readdirSync(backupDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name !== '.hologram-backup.json' && !/\.tmp(-\d+)?$/i.test(e.name)).length;
  } catch {
    return -1;
  }
};
// The single generation file inside a store directory (the library's own, or a
// destination's copy of it), or null when there is none.
const oneGeneration = (root: string): string | null => {
  try {
    const names = fs.readdirSync(path.join(root, '.db-generations')).filter((n) => /^hologram-\d{8}-\d{6}\.db$/.test(n));
    return names.length ? names[0] : null;
  } catch {
    return null;
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
    ${rendererWaits()}
    // The library answering with the seeded posts is what the 400ms that used to
    // sit here was hoping for: the database is open and holds all 8, which run 1
    // below counts.
    await waitFor('the library to report the seeded posts', async () => ((await window.hologram.listPosts()).posts || []).length >= ${records.length});
    const bad = await window.hologram.setBackup({ dir: ${JSON.stringify(path.join(saveFolder, 'nested'))} });
    const overlapRejected = !!(bad && bad.ok === false && bad.error === 'overlap');
    const good = await window.hologram.setBackup({ dir: ${JSON.stringify(outDir)} });
    const dirSet = !!(good && good.backup && good.backup.dir);

    // Don't hardcode the count — assert against fileCount, which is the media lane's
    // own tally. The one extra write is the DB lane's first generation (#233), which
    // the same run creates and carries over.
    const r1 = await window.hologram.runBackup();
    const run1 = !!(r1 && r1.ok && r1.fileCount >= 8 && r1.written === r1.fileCount + 1 && r1.pruned === 0 && !r1.pruneSkipped);

    // idempotent — assets are immutable, nothing new to copy or prune
    const r2 = await window.hologram.runBackup();
    const run2 = !!(r2 && r2.ok && r2.written === 0 && r2.pruned === 0 && !r2.pruneSkipped);

    return { overlapRejected, dirSet, run1, run2 };
  })()`;
  const rA = await launch(evalA);

  // DB lane (#301 / #233): run1 must have written a generation through the SQLite
  // backup API into the LIBRARY's own store — never a raw copy of the live (and
  // here, out-of-tree) DB file — and carried that same generation to the destination.
  const localGeneration = oneGeneration(saveFolder);
  let dbGenerationWritten = false;
  let dbGenerationCopied = false;
  if (localGeneration) {
    try {
      dbGenerationWritten = fs.statSync(path.join(saveFolder, '.db-generations', localGeneration)).size > 0;
    } catch {
      /* missing → stays false */
    }
    dbGenerationCopied = fs.existsSync(path.join(backupDir, '.db-generations', localGeneration));
  }

  // The destination must not freeze at its first pass: a file that appears later is
  // still picked up by the next run.
  fs.writeFileSync(lateFilePath, JSON.stringify({ notes: ['A'] }, null, 2));

  const evalB = `(async () => {
    const e1 = await window.hologram.runBackup();
    const edit1 = !!(e1 && e1.ok && e1.written >= 1 && !e1.pruneSkipped);
    return { edit1 };
  })()`;
  const rB = await launch(evalB);

  // Change it in place. Nothing a backup carries changes after it is written, so
  // a run after this must copy nothing — write-once is the contract, not an
  // oversight (see runBackup's comment).
  fs.writeFileSync(lateFilePath, JSON.stringify({ notes: ['A', 'B'] }, null, 2));

  const evalC = `(async () => {
    const e2 = await window.hologram.runBackup();
    const writeOnce = !!(e2 && e2.ok && e2.written === 0 && !e2.pruneSkipped);
    const e3 = await window.hologram.runBackup();
    const editIdempotent = !!(e3 && e3.ok && e3.written === 0 && !e3.pruneSkipped);

    // delete one post → since #233 the destination MOVES its file under .trash/
    // instead of deleting it: a backup keeps a pending deletion pending. The trash
    // sidecar the delete writes is new, so the same run copies that one over.
    await window.hologram.deletePost(${JSON.stringify(ids[0] + '.jpg')});
    const r3 = await window.hologram.runBackup();
    const trashMoved = !!(r3 && r3.ok && r3.moved === 1 && r3.pruned === 0 && !r3.pruneSkipped);

    // collapse src (clear-all wipes every post asset) → guard MUST hold the prune
    // and leave the destination untouched. Reason is shrink/empty depending on what
    // is left at the root; either is a valid trip.
    await window.hologram.clearAll();
    const r4 = await window.hologram.runBackup();
    const guardHeld = !!(r4 && r4.ok && r4.pruned === 0 && (r4.pruneSkipped === 'empty' || r4.pruneSkipped === 'shrink'));

    // The destination root should still hold what r3 left there (the guard stopped
    // every deletion). r3.fileCount counts the whole media lane, so the two entries
    // that live under .trash/ come off to get the root's own count.
    return { writeOnce, editIdempotent, trashMoved, guardHeld, expectRoot: r3.fileCount - 2 };
  })()`;
  const rC = await launch(evalC);

  const r = Object.assign({}, rA, rB, rC);

  // filesystem-side verification: the guarded collapse run left the destination
  // exactly as r3 did (no files deleted) — proof the prune was truly held back on
  // disk.
  const rootAfter = countBackupRoot();
  const backupIntact = typeof r.expectRoot === 'number' && rootAfter === r.expectRoot;
  // filesystem-side verification of the trash move: the trashed post's file sits
  // under .trash/ at the destination and no longer at its root.
  const trashedOnDisk = fs.existsSync(path.join(backupDir, '.trash', ids[0] + '.jpg')) && !fs.existsSync(path.join(backupDir, ids[0] + '.jpg'));
  // filesystem-side verification of write-once: the copy at the destination holds the
  // file as it was when it was first copied (1 note), NOT the later in-place edit.
  let writeOnceOnDisk = false;
  try {
    const mj = JSON.parse(fs.readFileSync(path.join(backupDir, LATE_FILE), 'utf8'));
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
  // #233/#176: the destination carries the id of the library it belongs to, and
  // the first run above adopted it. Rewrite that id to a stranger's — the state
  // a user reaches by opening a different library with this destination still
  // configured — and the next run must refuse OUTRIGHT. The prune guard would
  // not save them here: another library is not a "collapsed source", it is a
  // different one, so the mirror would happily prune this backup down to it.
  const identityFile = path.join(backupDir, '.hologram-backup.json');
  const identityAdopted = fs.existsSync(identityFile);
  fs.writeFileSync(identityFile, JSON.stringify({ libraryId: 'another-library', lastRunAt: null }));
  const rootBeforeMismatch = countBackupRoot();
  const evalD = `(async () => {
    const r = await window.hologram.runBackup();
    return { mismatchRefused: !!(r && r.ok === false && r.error === 'library-mismatch') };
  })()`;
  const rD = await launch(evalD);
  // Refused means refused: nothing copied, nothing pruned, and the claim itself
  // left alone (a refused run must not quietly re-adopt the destination).
  let mismatchLeftAlone = false;
  try {
    mismatchLeftAlone = countBackupRoot() === rootBeforeMismatch && JSON.parse(fs.readFileSync(identityFile, 'utf8')).libraryId === 'another-library';
  } catch {
    /* unreadable → stays false */
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.overlapRejected && r.dirSet && r.run1 && r.run2 && r.edit1 && r.writeOnce && r.editIdempotent && writeOnceOnDisk && r.trashMoved && trashedOnDisk && r.guardHeld && backupIntact && clearSweptAssets && dbGenerationWritten && dbGenerationCopied && identityAdopted && rD.mismatchRefused && mismatchLeftAlone;
  console.log(
    `overlap=${r.overlapRejected} dirSet=${r.dirSet} run1=${r.run1} run2=${r.run2} lateFile=${r.edit1} writeOnce=${r.writeOnce} idem=${r.editIdempotent} writeOnceOnDisk=${writeOnceOnDisk} trashMoved=${r.trashMoved}/${trashedOnDisk} guard=${r.guardHeld} root=${rootAfter}/${backupIntact} clearSweptAssets=${clearSweptAssets} dbGeneration=${dbGenerationWritten}/${dbGenerationCopied} identity=${identityAdopted}/${rD.mismatchRefused}/${mismatchLeftAlone}`,
  );
  console.log(ok ? 'BACKUP_TEST_PASS' : 'BACKUP_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
