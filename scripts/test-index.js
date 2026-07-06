'use strict';

// Unit test for app/lib-index.js (the listPosts() index). Uses a read-counting
// fs wrapper to assert the O(changed) guarantee: unchanged sidecars are never
// re-read, a new/edited sidecar reads exactly that one, deletes prune without a
// read, and a fresh index instance restores from the .index.json snapshot
// without re-reading any sidecar.
//
//   node scripts/test-index.js

const assert = require('node:assert');
const realFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPostIndex, computeDelta } = require('../app/lib-index.mts');

const dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'corpus-index-'));
const INTERNAL = new Set(['config.json', '.index.json', 'tabs.json', 'folders.json', 'tag-groups.json', 'ungrouped.json', 'manual-groups.json']);

let sidecarReads = 0;
const countingFs = {
  promises: {
    readdir: (...a) => realFs.promises.readdir(...a),
    stat: (...a) => realFs.promises.stat(...a),
    readFile: (p, ...a) => {
      const s = String(p);
      if (/\.json$/i.test(s) && !s.endsWith('.index.json')) sidecarReads++;
      return realFs.promises.readFile(p, ...a);
    },
    writeFile: (...a) => realFs.promises.writeFile(...a),
    rename: (...a) => realFs.promises.rename(...a),
  },
};
const writeSidecar = (name, rec) => realFs.writeFileSync(path.join(dir, name), JSON.stringify(rec));

(async () => {
  writeSidecar('a.json', { captureId: 'a', image: 'a.jpg', capturedAt: '2026-01-01T00:00:00Z' });
  writeSidecar('b.json', { captureId: 'b', image: 'b.jpg', capturedAt: '2026-01-03T00:00:00Z' });
  writeSidecar('c.json', { captureId: 'c', image: 'c.jpg', capturedAt: '2026-01-02T00:00:00Z' });
  writeSidecar('notapost.json', { foo: 1 }); // no image/video/media -> excluded
  writeSidecar('config.json', { saveFolder: dir }); // internal -> excluded

  const idx = createPostIndex({ fs: countingFs, internalFiles: INTERNAL });

  // First scan: 3 posts, sorted by capturedAt desc, everything read once.
  sidecarReads = 0;
  let r = await idx.list(dir);
  assert.deepStrictEqual(
    r.posts.map((p) => p.captureId),
    ['b', 'c', 'a'],
    'posts sorted desc by capturedAt',
  );
  assert.strictEqual(r.changed, true, 'first scan reports changed');
  assert.strictEqual(sidecarReads, 4, 'first scan reads all 4 sidecars (a,b,c,notapost)');

  // Re-scan, nothing changed: zero reads (all reused by mtime).
  sidecarReads = 0;
  r = await idx.list(dir);
  assert.strictEqual(r.changed, false, 'unchanged re-scan reports no change');
  assert.strictEqual(sidecarReads, 0, 'unchanged re-scan re-reads nothing');

  // Add one sidecar: exactly that one is read.
  writeSidecar('d.json', { captureId: 'd', image: 'd.jpg', capturedAt: '2026-01-04T00:00:00Z' });
  sidecarReads = 0;
  r = await idx.list(dir);
  assert.strictEqual(r.posts.length, 4, 'new post appears');
  assert.strictEqual(r.posts[0].captureId, 'd', 'newest sorts first');
  assert.strictEqual(r.changed, true, 'add reports changed');
  assert.strictEqual(sidecarReads, 1, 'add reads ONLY the new sidecar');

  // Delete one sidecar: pruned, no read.
  realFs.rmSync(path.join(dir, 'a.json'));
  sidecarReads = 0;
  r = await idx.list(dir);
  assert.deepStrictEqual(
    r.posts.map((p) => p.captureId),
    ['d', 'b', 'c'],
    'deleted post pruned',
  );
  assert.strictEqual(r.changed, true, 'delete reports changed');
  assert.strictEqual(sidecarReads, 0, 'delete reads nothing');

  // Persist snapshot, then a FRESH instance restores from it without re-reading.
  await idx.writeSnapshot(dir);
  assert.ok(realFs.existsSync(path.join(dir, '.index.json')), '.index.json written');

  const idx2 = createPostIndex({ fs: countingFs, internalFiles: INTERNAL });
  sidecarReads = 0;
  r = await idx2.list(dir);
  assert.deepStrictEqual(
    r.posts.map((p) => p.captureId),
    ['d', 'b', 'c'],
    'cold instance returns same posts',
  );
  assert.strictEqual(r.changed, false, 'cold instance with matching mtimes reports no change');
  assert.strictEqual(sidecarReads, 0, 'cold instance restores from snapshot, reads no sidecar');

  // --- computeDelta: the renderer diff (new / mtime-moved => added; gone => removed) ---
  const post = (id, m) => ({ captureId: id, _m: m });
  const stampsOf = (arr) => new Map(arr.map((p) => [p.captureId, p._m]));
  // baseline a@1, b@1, c@1
  const base = [post('a', 1), post('b', 1), post('c', 1)];
  const last = stampsOf(base);
  // now: a unchanged, b edited (mtime 2), c removed, d added
  const now = [post('a', 1), post('b', 2), post('d', 5)];
  const d = computeDelta(last, now, stampsOf(now));
  assert.deepStrictEqual(d.added.map((p) => p.captureId).sort(), ['b', 'd'], 'added = new + mtime-moved');
  assert.deepStrictEqual(d.removed.sort(), ['c'], 'removed = gone');
  // no-op delta
  const d0 = computeDelta(stampsOf(now), now, stampsOf(now));
  assert.strictEqual(d0.added.length, 0, 'unchanged => no adds');
  assert.strictEqual(d0.removed.length, 0, 'unchanged => no removes');

  // --- applyChanges: targeted update from an fs-watch hint (re-stats ONLY the
  //     named sidecars, not the whole folder) ---
  const dir2 = realFs.mkdtempSync(path.join(os.tmpdir(), 'corpus-index2-'));
  const w2 = (name, rec) => realFs.writeFileSync(path.join(dir2, name), JSON.stringify(rec));
  w2('x.json', { captureId: 'x', image: 'x.jpg', capturedAt: '2026-02-01T00:00:00Z' });
  w2('y.json', { captureId: 'y', image: 'y.jpg', capturedAt: '2026-02-02T00:00:00Z' });
  const idxB = createPostIndex({ fs: countingFs, internalFiles: INTERNAL });
  let rb = await idxB.list(dir2);
  assert.deepStrictEqual(
    rb.posts.map((p) => p.captureId),
    ['y', 'x'],
    'baseline built',
  );

  // y edited (force a new mtime), z added, x deleted — then hint only those three.
  w2('y.json', { captureId: 'y', image: 'y.jpg', capturedAt: '2026-02-02T00:00:00Z', tags: ['edited'] });
  realFs.utimesSync(path.join(dir2, 'y.json'), new Date(), new Date(Date.now() + 10000));
  w2('z.json', { captureId: 'z', image: 'z.jpg', capturedAt: '2026-02-03T00:00:00Z' });
  realFs.rmSync(path.join(dir2, 'x.json'));

  sidecarReads = 0;
  const chg = await idxB.applyChanges(dir2, ['y.json', 'z.json', 'x.json']);
  assert.deepStrictEqual(chg.added.map((a) => a.id).sort(), ['y', 'z'], 'added = edited + new');
  assert.deepStrictEqual(chg.removed.sort(), ['x'], 'removed = deleted');
  assert.ok(chg.added.find((a) => a.id === 'y').record.tags[0] === 'edited', 'edited record carries new content');
  assert.strictEqual(sidecarReads, 2, 'targeted update reads ONLY y + z (x deleted = stat fail, no read)');

  // A subsequent full list() agrees with the targeted state (no drift, no re-read).
  sidecarReads = 0;
  rb = await idxB.list(dir2);
  assert.deepStrictEqual(
    rb.posts.map((p) => p.captureId),
    ['z', 'y'],
    'full scan matches targeted state',
  );
  assert.strictEqual(rb.changed, false, 'targeted update left the map consistent');
  assert.strictEqual(sidecarReads, 0, 'consistent map = no re-read on the following full scan');
  realFs.rmSync(dir2, { recursive: true, force: true });

  // --- BOM tolerance (BACKLOG L3): a hand-edited sidecar saved with a UTF-8 BOM
  //     must still parse — a throw here reads as record:null and the post silently
  //     vanishes (worst case: reconcile purges it from collections/clip). Same for
  //     a BOM'd .index.json snapshot (cold restore must not fall back to a rescan).
  const BOM = String.fromCharCode(0xfeff);
  const dir3 = realFs.mkdtempSync(path.join(os.tmpdir(), 'corpus-index3-'));
  realFs.writeFileSync(path.join(dir3, 'bom.json'), BOM + JSON.stringify({ captureId: 'bom', image: 'bom.jpg', capturedAt: '2026-03-01T00:00:00Z' }));
  const idxC = createPostIndex({ fs: countingFs, internalFiles: INTERNAL });
  const rc = await idxC.list(dir3);
  assert.strictEqual(rc.posts.length, 1, 'BOM sidecar still parses');
  assert.strictEqual(rc.posts[0].captureId, 'bom', 'BOM sidecar record intact');
  await idxC.writeSnapshot(dir3);
  const snapPath = path.join(dir3, '.index.json');
  realFs.writeFileSync(snapPath, BOM + realFs.readFileSync(snapPath, 'utf8'));
  const idxD = createPostIndex({ fs: countingFs, internalFiles: INTERNAL });
  sidecarReads = 0;
  const rd = await idxD.list(dir3);
  assert.strictEqual(rd.posts.length, 1, 'BOM snapshot restores');
  assert.strictEqual(sidecarReads, 0, 'BOM snapshot still avoids the cold rescan');
  realFs.rmSync(dir3, { recursive: true, force: true });

  realFs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS test-index: reuse, prune, snapshot cold-restore, computeDelta, targeted applyChanges, and BOM tolerance verified');
})().catch((e) => {
  try {
    realFs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  console.error('FAIL test-index:', e && e.message ? e.message : e);
  process.exit(1);
});
