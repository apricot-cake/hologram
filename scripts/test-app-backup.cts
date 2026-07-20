'use strict';

// Verifies the 自動バックアップ (incremental mirror) plumbing end-to-end via IPC:
//  - set-backup rejects an output dir that overlaps the save folder
//  - run-backup mirrors the library into <dir>/Hologram-mirror/ (individual files)
//  - a second run is idempotent (immutable assets → nothing new copied)
//  - a MUTABLE organization JSON (tag-groups.json) re-copies on every edit:
//    edit twice → the mirror reflects the LATEST contents, not the first backup's
//    (regression: existence-check skip used to freeze internal JSON forever, so a
//    restore silently lost all tagging/foldering done after the first backup)
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
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

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
// 4 posts: enough that the clear-all collapse (only metadata json survives) drops
// src well below the prune-guard's 50% shrink ratio even after the tag-groups edit
// adds a file, so the guard-held assertion stays unambiguous.
for (let i = 0; i < 4; i++) {
  const id = '170000000000' + i + '-bk' + i;
  ids.push(id);
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
}

const mirror = path.join(outDir, 'Hologram-mirror');
const countMirror = () => {
  try {
    return fs.readdirSync(mirror).filter((n) => !/\.tmp(-\d+)?$/i.test(n)).length;
  } catch {
    return -1;
  }
};

const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  await wait(400);
  // output dir nested inside the save folder must be rejected (overlap)
  const bad = await window.hologram.setBackup({ dir: ${JSON.stringify(path.join(saveFolder, 'nested'))} });
  const overlapRejected = !!(bad && bad.ok === false && bad.error === 'overlap');
  const good = await window.hologram.setBackup({ dir: ${JSON.stringify(outDir)} });
  const dirSet = !!(good && good.backup && good.backup.dir);

  // run 1: first mirror copies everything fresh (our 2 posts + app metadata json).
  // Don't hardcode the count — metadata files count too; assert written === fileCount.
  const r1 = await window.hologram.runBackup();
  const run1 = !!(r1 && r1.ok && r1.written >= 4 && r1.written === r1.fileCount && r1.pruned === 0 && !r1.pruneSkipped);

  // run 2: idempotent — assets are immutable, nothing new to copy or prune
  const r2 = await window.hologram.runBackup();
  const run2 = !!(r2 && r2.ok && r2.written === 0 && r2.pruned === 0 && !r2.pruneSkipped);

  // mutable organization JSON must NOT freeze at its first backup. Edit tag-groups
  // twice (different sizes so drift is unambiguous) and back up after each edit;
  // every edited run must re-copy the file (written >= 1) so the mirror tracks the
  // latest contents. The on-disk mirror content is checked in the close handler.
  await window.hologram.setTagGroups([{ id: 'g1', name: 'first', tags: ['a'] }]);
  const e1 = await window.hologram.runBackup();
  const edit1 = !!(e1 && e1.ok && e1.written >= 1 && !e1.pruneSkipped);
  await window.hologram.setTagGroups([
    { id: 'g1', name: 'second', tags: ['a', 'b'] },
    { id: 'g2', name: 'extra', tags: ['c'] },
    { id: 'g3', name: 'more', tags: ['d', 'e'] }
  ]);
  const e2 = await window.hologram.runBackup();
  const edit2 = !!(e2 && e2.ok && e2.written >= 1 && !e2.pruneSkipped);
  // an UNEDITED follow-up run must be idempotent again (mtime+size preserved → no
  // re-copy), proving the refresh is drift-gated, not unconditional churn.
  const e3 = await window.hologram.runBackup();
  const editIdempotent = !!(e3 && e3.ok && e3.written === 0 && !e3.pruneSkipped);

  // delete one post → next run prunes BOTH its files (jpg+json) from the mirror.
  // Baseline is e3.fileCount (after the tag-groups edits added that file), not r2.
  await window.hologram.deletePost(${JSON.stringify(ids[0] + '.jpg')});
  const r3 = await window.hologram.runBackup();
  const pruneWorks = !!(r3 && r3.ok && r3.pruned === 2 && r3.fileCount === e3.fileCount - 2 && !r3.pruneSkipped);

  // collapse src (clear-all wipes posts, keeps metadata) → guard MUST hold the
  // prune and leave the mirror untouched. Reason is shrink/empty depending on how
  // much metadata survives; either is a valid trip.
  await window.hologram.clearAll();
  const r4 = await window.hologram.runBackup();
  const guardHeld = !!(r4 && r4.ok && r4.pruned === 0 && (r4.pruneSkipped === 'empty' || r4.pruneSkipped === 'shrink'));

  // mirror should still hold exactly what r3 left (guard prevented any deletion)
  return { overlapRejected, dirSet, run1, run2, edit1, edit2, editIdempotent, pruneWorks, guardHeld, expectMirror: r3.fileCount };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
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
  // filesystem-side verification: the guarded collapse run left the mirror exactly
  // as r3 did (no files deleted) — proof the prune was truly held back on disk.
  const mirrorAfter = countMirror();
  const mirrorIntact = typeof r.expectMirror === 'number' && mirrorAfter === r.expectMirror;
  // filesystem-side verification of the mutable-JSON refresh: the mirrored
  // tag-groups.json must hold the SECOND edit (3 groups, name 'second'), not the
  // first — proof the backup re-copied the drifted internal file rather than
  // freezing it at its initial contents.
  let mutableFresh = false;
  try {
    const mj = JSON.parse(fs.readFileSync(path.join(mirror, 'tag-groups.json'), 'utf8'));
    mutableFresh = Array.isArray(mj.groups) && mj.groups.length === 3 && mj.groups[0] && mj.groups[0].name === 'second';
  } catch {
    /* missing/unreadable → stays false */
  }
  // filesystem-side verification of the clear-all skip list: the wipe must keep
  // app-internal organization JSON (the shared INTERNAL_FILES set) while removing
  // every post asset — a regression here means an internal file fell out of the
  // skip set and got wiped along with the posts.
  let clearKeptOrg = false;
  try {
    const left = fs.readdirSync(saveFolder);
    clearKeptOrg = left.includes('tag-groups.json') && !left.some((f) => /\.jpe?g$/i.test(f));
  } catch {
    /* unreadable → stays false */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.overlapRejected && r.dirSet && r.run1 && r.run2 && r.edit1 && r.edit2 && r.editIdempotent && mutableFresh && r.pruneWorks && r.guardHeld && mirrorIntact && clearKeptOrg;
  console.log(`overlap=${r.overlapRejected} dirSet=${r.dirSet} run1=${r.run1} run2=${r.run2} edit1=${r.edit1} edit2=${r.edit2} editIdem=${r.editIdempotent} mutableFresh=${mutableFresh} prune=${r.pruneWorks} guard=${r.guardHeld} mirror=${mirrorAfter}/${mirrorIntact} clearKeptOrg=${clearKeptOrg}`);
  console.log(ok ? 'BACKUP_TEST_PASS' : 'BACKUP_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
