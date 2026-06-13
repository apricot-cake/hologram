'use strict';

// Unit test for app/lib-index.js (the listPosts() index). Uses a read-counting
// fs wrapper to assert the O(changed) guarantee: unchanged sidecars are never
// re-read, a new/edited sidecar reads exactly that one, deletes prune without a
// read, and a fresh index instance restores from the .index.json snapshot
// without re-reading any sidecar.
//
//   node scripts/test-index.js

const assert = require('assert');
const realFs = require('fs');
const os = require('os');
const path = require('path');
const { createPostIndex } = require('../app/lib-index.js');

const dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'corpus-index-'));
const INTERNAL = new Set(['config.json', '.index.json', 'tabs.json', 'folders.json',
  'tag-groups.json', 'ungrouped.json', 'manual-groups.json']);

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
    rename: (...a) => realFs.promises.rename(...a)
  }
};
const writeSidecar = (name, rec) => realFs.writeFileSync(path.join(dir, name), JSON.stringify(rec));

(async () => {
  writeSidecar('a.json', { captureId: 'a', image: 'a.jpg', capturedAt: '2026-01-01T00:00:00Z' });
  writeSidecar('b.json', { captureId: 'b', image: 'b.jpg', capturedAt: '2026-01-03T00:00:00Z' });
  writeSidecar('c.json', { captureId: 'c', image: 'c.jpg', capturedAt: '2026-01-02T00:00:00Z' });
  writeSidecar('notapost.json', { foo: 1 });                       // no image/video/media -> excluded
  writeSidecar('config.json', { saveFolder: dir });               // internal -> excluded

  const idx = createPostIndex({ fs: countingFs, internalFiles: INTERNAL });

  // First scan: 3 posts, sorted by capturedAt desc, everything read once.
  sidecarReads = 0;
  let r = await idx.list(dir);
  assert.deepStrictEqual(r.posts.map((p) => p.captureId), ['b', 'c', 'a'], 'posts sorted desc by capturedAt');
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
  assert.deepStrictEqual(r.posts.map((p) => p.captureId), ['d', 'b', 'c'], 'deleted post pruned');
  assert.strictEqual(r.changed, true, 'delete reports changed');
  assert.strictEqual(sidecarReads, 0, 'delete reads nothing');

  // Persist snapshot, then a FRESH instance restores from it without re-reading.
  await idx.writeSnapshot(dir);
  assert.ok(realFs.existsSync(path.join(dir, '.index.json')), '.index.json written');

  const idx2 = createPostIndex({ fs: countingFs, internalFiles: INTERNAL });
  sidecarReads = 0;
  r = await idx2.list(dir);
  assert.deepStrictEqual(r.posts.map((p) => p.captureId), ['d', 'b', 'c'], 'cold instance returns same posts');
  assert.strictEqual(r.changed, false, 'cold instance with matching mtimes reports no change');
  assert.strictEqual(sidecarReads, 0, 'cold instance restores from snapshot, reads no sidecar');

  realFs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS test-index: O(changed) reuse, prune, and snapshot cold-restore verified');
})().catch((e) => { try { realFs.rmSync(dir, { recursive: true, force: true }); } catch {} console.error('FAIL test-index:', e && e.message ? e.message : e); process.exit(1); });
