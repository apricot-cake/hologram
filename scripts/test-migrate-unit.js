'use strict';

// Unit tests for app/lib-migrate.js — the save-folder relocation engine
// (BACKLOG L1: captures landing in src mid-move were stranded invisibly).
// Pure Node + temp dirs, no Electron: covers the catch-up copy rounds, the
// verify-before-delete cleanup, the empty-shell removal, the straggler sweep's
// cold/hot discrimination, and the full relocateLibrary orchestration
// (config flip ordering, leftover reporting, delayed sweep).
//
//   node scripts/test-migrate-unit.js

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { copyLibraryInto, verifyAndCleanup, sweepStragglers, relocateLibrary } = require('../app/lib-migrate.js');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}

function mkroot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-migrate-'));
}
function seed(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function setOld(p, ms) {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(p, t, t);
}

(async () => {
  // --- copyLibraryInto: basic copy + tmp exclusion + collision abort ---
  {
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'a.jpg': 'AAA', 'a.json': '{"id":"a"}', '.trash/t.jpg': 'TTT', 'b.json.tmp-123': 'TMP' });
    const cp = await copyLibraryInto(src, dest, null);
    ok(cp.ok, 'basic copy succeeds');
    ok(cp.entries.length === 3, 'tmp excluded from entries, got ' + cp.entries.length);
    ok(fs.readFileSync(path.join(dest, 'a.jpg'), 'utf8') === 'AAA', 'file copied');
    ok(fs.readFileSync(path.join(dest, '.trash', 't.jpg'), 'utf8') === 'TTT', 'dir copied recursively');
    ok(!fs.existsSync(path.join(dest, 'b.json.tmp-123')), 'tmp not copied');
    ok(fs.existsSync(path.join(src, 'a.jpg')), 'src untouched by copy');
  }
  {
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'a.jpg': 'AAA' });
    seed(dest, { 'a.jpg': 'THEIRS' });
    const cp = await copyLibraryInto(src, dest, null);
    ok(!cp.ok && cp.error === 'collision' && cp.name === 'a.jpg', 'collision aborts before copying');
    ok(fs.readFileSync(path.join(dest, 'a.jpg'), 'utf8') === 'THEIRS', 'pre-existing dest file never clobbered');
  }

  // --- copyLibraryInto: catch-up round picks up files landing mid-copy (L1 core) ---
  {
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'a.jpg': 'AAA', 'b.jpg': 'BBB' });
    let dropped = false;
    const cp = await copyLibraryInto(src, dest, (done) => {
      // Simulate a native-host capture landing while the initial copy runs.
      if (done === 1 && !dropped) {
        dropped = true;
        fs.writeFileSync(path.join(src, 'late.jpg'), 'LATE');
        fs.writeFileSync(path.join(src, 'late.json'), '{"id":"late"}');
      }
    });
    ok(cp.ok, 'catch-up copy succeeds');
    ok(cp.entries.includes('late.jpg') && cp.entries.includes('late.json'), 'mid-copy arrivals included in entries');
    ok(fs.readFileSync(path.join(dest, 'late.jpg'), 'utf8') === 'LATE', 'mid-copy arrival copied to dest');
  }

  // --- copyLibraryInto: failure rolls back dest, src intact ---
  {
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'a.jpg': 'AAA' });
    const cp = await copyLibraryInto(src, dest, () => {
      // Drop a name that collides at dest mid-run → catch-up cp throws EEXIST.
      fs.writeFileSync(path.join(src, 'clash.jpg'), 'MINE');
      fs.mkdirSync(path.join(dest, 'clash.jpg'), { recursive: true });
    });
    ok(!cp.ok && cp.error === 'copy-failed', 'catch-up collision surfaces as copy-failed');
    ok(!fs.existsSync(path.join(dest, 'a.jpg')), 'partial copy rolled back from dest');
    ok(fs.existsSync(path.join(src, 'a.jpg')) && fs.existsSync(path.join(src, 'clash.jpg')), 'src fully intact after rollback');
  }

  // --- verifyAndCleanup: verified entries removed from src, shell rmdir'd ---
  {
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'a.jpg': 'AAA', 'a.json': '{"id":"a"}', '.trash/t.jpg': 'TTT' });
    const cp = await copyLibraryInto(src, dest, null);
    const cl = await verifyAndCleanup(src, dest, cp.entries);
    ok(cl.removed === 3 && cl.leftover.length === 0, 'all verified entries removed');
    ok(cl.emptied && !fs.existsSync(src), 'emptied src shell removed');
    ok(fs.existsSync(path.join(dest, 'a.jpg')), 'dest library intact');
  }

  // --- verifyAndCleanup: corrupted dest copy is re-copied (never silently lost) ---
  {
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'a.jpg': 'AAAAAA', 'tags.json': '{"v":1}' });
    const cp = await copyLibraryInto(src, dest, null);
    // Simulate torn/corrupt copy AND a post-copy src edit (org JSON rewritten).
    fs.writeFileSync(path.join(dest, 'a.jpg'), 'X');
    fs.writeFileSync(path.join(src, 'tags.json'), '{"v":2,"edited":true}');
    const cl = await verifyAndCleanup(src, dest, cp.entries);
    ok(cl.removed === 2 && cl.emptied, 'mismatched entries re-copied then removed');
    ok(fs.readFileSync(path.join(dest, 'a.jpg'), 'utf8') === 'AAAAAA', 'corrupt dest copy healed from src');
    ok(fs.readFileSync(path.join(dest, 'tags.json'), 'utf8') === '{"v":2,"edited":true}', 'post-copy src edit wins (newest state)');
  }

  // --- verifyAndCleanup: .index.json exempt; unknown arrivals become leftovers ---
  {
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'a.jpg': 'AAA', '.index.json': '{"posts":[]}' });
    const cp = await copyLibraryInto(src, dest, null);
    // Stale derived index at dest must not block cleanup (rebuildable by design).
    fs.writeFileSync(path.join(dest, '.index.json'), '{"posts":[],"stale":1}');
    // A capture landing after the last catch-up round (straddle window).
    fs.writeFileSync(path.join(src, 'straggler.jpg'), 'SSS');
    const cl = await verifyAndCleanup(src, dest, cp.entries);
    ok(!fs.existsSync(path.join(src, '.index.json')), 'derived .index.json removed without verification');
    ok(cl.leftover.length === 1 && cl.leftover[0] === 'straggler.jpg', 'straddle arrival reported as leftover');
    ok(!cl.emptied && fs.existsSync(src), 'shell kept while leftovers remain');
  }

  // --- sweepStragglers: cold files moved + verified, hot files left, shell removed ---
  {
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'cold.jpg': 'COLD', 'cold.json': '{"id":"c"}', 'stale.json.tmp-9': 'GARBAGE' });
    seed(dest, {});
    setOld(path.join(src, 'cold.jpg'), 60000);
    setOld(path.join(src, 'cold.json'), 60000);
    setOld(path.join(src, 'stale.json.tmp-9'), 60000);
    const sw = await sweepStragglers(src, dest, { minAgeMs: 15000 });
    ok(sw.moved === 2 && sw.left === 0, 'cold stragglers moved, got moved=' + sw.moved + ' left=' + sw.left);
    ok(fs.readFileSync(path.join(dest, 'cold.jpg'), 'utf8') === 'COLD', 'straggler content at dest');
    ok(sw.emptied && !fs.existsSync(src), 'cold tmp purged and shell removed');
  }
  {
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'hot.jpg': 'STILL-WRITING' });
    seed(dest, {});
    const sw = await sweepStragglers(src, dest, { minAgeMs: 15000 });
    ok(sw.moved === 0 && sw.left === 1, 'hot (possibly mid-write) file left untouched');
    ok(fs.existsSync(path.join(src, 'hot.jpg')) && !fs.existsSync(path.join(dest, 'hot.jpg')), 'hot file neither moved nor deleted');
  }
  {
    // Same name already at dest: identical → src removed; different → left alone.
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'dup.jpg': 'SAME', 'diff.jpg': 'MINE' });
    seed(dest, { 'dup.jpg': 'SAME', 'diff.jpg': 'THEIRS-LONGER' });
    for (const f of ['dup.jpg', 'diff.jpg']) setOld(path.join(src, f), 60000);
    // Give the identical pair identical mtimes (as a real earlier copy would have).
    const t = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(dest, 'dup.jpg'), t, t);
    const sw = await sweepStragglers(src, dest, { minAgeMs: 15000 });
    ok(sw.moved === 1 && sw.left === 1, 'dup reclaimed, ambiguous name left, got moved=' + sw.moved + ' left=' + sw.left);
    ok(!fs.existsSync(path.join(src, 'dup.jpg')), 'verified duplicate removed from src');
    ok(fs.readFileSync(path.join(dest, 'diff.jpg'), 'utf8') === 'THEIRS-LONGER', 'differing dest file never clobbered');
    ok(fs.existsSync(path.join(src, 'diff.jpg')), 'ambiguous src file kept');
  }

  // --- relocateLibrary: full orchestration (flip ordering, phases, sweep) ---
  {
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'a.jpg': 'AAA', 'a.json': '{"id":"a"}' });
    let cfg = { saveFolder: src, extensionId: 'x' };
    const phases = [];
    let flippedBeforeCleanup = false;
    let afterFlipCalled = false;
    const res = await relocateLibrary(src, dest, {
      readConfig: () => ({ ...cfg }),
      writeConfig: (c) => {
        cfg = c;
      },
      emit: (p) => {
        phases.push(p.phase);
        if (p.phase === 'cleanup') flippedBeforeCleanup = cfg.saveFolder === dest;
      },
      afterFlip: () => {
        afterFlipCalled = true;
      },
      stillCurrent: () => cfg.saveFolder === dest,
      sweepDelayMs: 50,
    });
    ok(res.ok && res.moved === 2 && res.leftover === 0, 'relocate succeeds');
    ok(cfg.saveFolder === dest && cfg.extensionId === 'x', 'config flipped, other keys preserved');
    ok(flippedBeforeCleanup, 'config flip happens BEFORE any src deletion (crash-safe order)');
    ok(afterFlipCalled, 'watcher/delta hook invoked');
    ok(phases[0] === 'copy' && phases.includes('switch') && phases.includes('cleanup') && phases[phases.length - 1] === 'done', 'phases in order: ' + phases.join(','));
    ok(!fs.existsSync(src) && fs.existsSync(path.join(dest, 'a.jpg')), 'library fully moved, shell gone');
  }
  {
    // Collision → error result, nothing flipped, nothing deleted.
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'a.jpg': 'AAA' });
    seed(dest, { 'a.jpg': 'THEIRS' });
    let cfg = { saveFolder: src };
    const phases = [];
    const res = await relocateLibrary(src, dest, {
      readConfig: () => ({ ...cfg }),
      writeConfig: (c) => {
        cfg = c;
      },
      emit: (p) => phases.push(p.phase),
      afterFlip: () => {},
      stillCurrent: () => true,
      sweepDelayMs: 50,
    });
    ok(!res.ok && res.error === 'collision', 'collision reported');
    ok(cfg.saveFolder === src, 'config NOT flipped on failure');
    ok(fs.existsSync(path.join(src, 'a.jpg')), 'src untouched on failure');
    ok(phases[phases.length - 1] === 'error', 'error phase emitted');
  }
  {
    // Leftover + delayed sweep: a straggler landing right before cleanup is
    // reported, then collected by the scheduled sweep once cold.
    const root = mkroot();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    seed(src, { 'a.jpg': 'AAA' });
    let cfg = { saveFolder: src };
    const events = [];
    let plantedLate = false;
    const res = await relocateLibrary(src, dest, {
      readConfig: () => ({ ...cfg }),
      writeConfig: (c) => {
        cfg = c;
        if (!plantedLate) {
          plantedLate = true;
          // Lands after the last catch-up readdir (straddle window), already cold
          // so the 50ms-delayed sweep with minAge irrelevance can take it — the
          // sweep uses the default 15s minAge, so backdate the file.
          fs.writeFileSync(path.join(src, 'late.jpg'), 'LATE');
          setOld(path.join(src, 'late.jpg'), 60000);
        }
      },
      emit: (p) => events.push(p),
      afterFlip: () => {},
      stillCurrent: () => cfg.saveFolder === dest,
      sweepDelayMs: 50,
    });
    ok(res.ok && res.leftover === 1, 'straddle arrival counted as leftover, got ' + res.leftover);
    const done = events.find((p) => p.phase === 'done');
    ok(done && done.leftover === 1, 'done phase carries leftover count');
    await new Promise((r) => setTimeout(r, 400));
    const strag = events.find((p) => p.phase === 'straggler');
    ok(strag && strag.moved === 1, 'delayed sweep collected the straggler');
    ok(fs.readFileSync(path.join(dest, 'late.jpg'), 'utf8') === 'LATE', 'straggler content at dest');
    ok(!fs.existsSync(src), 'shell removed after sweep');
  }

  console.log(`PASS test-migrate-unit: ${passed} assertions`);
})().catch((e) => {
  console.error('FAIL test-migrate-unit:', e && e.message);
  process.exit(1);
});
