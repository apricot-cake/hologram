'use strict';

// Verifies the 自動バックアップ (incremental mirror) plumbing end-to-end via IPC:
//  - set-backup rejects an output dir that overlaps the save folder
//  - run-backup mirrors the library into <dir>/Corpus-mirror/ (individual files)
//  - a second run is idempotent (immutable assets → nothing new copied)
//  - deleting a post propagates: the file is pruned from the mirror
//  - the prune-safety guard holds the prune when src collapses (clear-all → empty),
//    leaving the mirror intact (regression for the 2026-06-23 library-loss incident)
//
//   node scripts/test-app-backup.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-bk-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
const outDir = path.join(tmp, 'out');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const ids = [];
for (let i = 0; i < 2; i++) {
  const id = '170000000000' + i + '-bk' + i;
  ids.push(id);
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (800 + i),
    platform: 'x', text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 1 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
}

const mirror = path.join(outDir, 'Corpus-mirror');
const countMirror = () => { try { return fs.readdirSync(mirror).filter(n => !/\.tmp(-\d+)?$/i.test(n)).length; } catch { return -1; } };

const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  await wait(400);
  // output dir nested inside the save folder must be rejected (overlap)
  const bad = await window.corpus.setBackup({ dir: ${JSON.stringify(path.join(saveFolder, 'nested'))} });
  const overlapRejected = !!(bad && bad.ok === false && bad.error === 'overlap');
  const good = await window.corpus.setBackup({ dir: ${JSON.stringify(outDir)} });
  const dirSet = !!(good && good.backup && good.backup.dir);

  // run 1: first mirror copies everything fresh (our 2 posts + app metadata json).
  // Don't hardcode the count — metadata files count too; assert written === fileCount.
  const r1 = await window.corpus.runBackup();
  const run1 = !!(r1 && r1.ok && r1.written >= 4 && r1.written === r1.fileCount && r1.pruned === 0 && !r1.pruneSkipped);

  // run 2: idempotent — assets are immutable, nothing new to copy or prune
  const r2 = await window.corpus.runBackup();
  const run2 = !!(r2 && r2.ok && r2.written === 0 && r2.pruned === 0 && !r2.pruneSkipped);

  // delete one post → next run prunes BOTH its files (jpg+json) from the mirror
  await window.corpus.deletePost(${JSON.stringify(ids[0] + '.jpg')});
  const r3 = await window.corpus.runBackup();
  const pruneWorks = !!(r3 && r3.ok && r3.pruned === 2 && r3.fileCount === r2.fileCount - 2 && !r3.pruneSkipped);

  // collapse src (clear-all wipes posts, keeps metadata) → guard MUST hold the
  // prune and leave the mirror untouched. Reason is shrink/empty depending on how
  // much metadata survives; either is a valid trip.
  await window.corpus.clearAll();
  const r4 = await window.corpus.runBackup();
  const guardHeld = !!(r4 && r4.ok && r4.pruned === 0 && (r4.pruneSkipped === 'empty' || r4.pruneSkipped === 'shrink'));

  // mirror should still hold exactly what r3 left (guard prevented any deletion)
  return { overlapRejected, dirSet, run1, run2, pruneWorks, guardHeld, expectMirror: r3.fileCount };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  // filesystem-side verification: the guarded collapse run left the mirror exactly
  // as r3 did (no files deleted) — proof the prune was truly held back on disk.
  const mirrorAfter = countMirror();
  const mirrorIntact = typeof r.expectMirror === 'number' && mirrorAfter === r.expectMirror;
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.overlapRejected && r.dirSet && r.run1 && r.run2 && r.pruneWorks && r.guardHeld && mirrorIntact;
  console.log(`overlap=${r.overlapRejected} dirSet=${r.dirSet} run1=${r.run1} run2=${r.run2} prune=${r.pruneWorks} guard=${r.guardHeld} mirror=${mirrorAfter}/${mirrorIntact}`);
  console.log(ok ? 'BACKUP_TEST_PASS' : 'BACKUP_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
