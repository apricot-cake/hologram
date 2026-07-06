'use strict';

// Zip-Slip regression test for app/lib-archive.js#importCompleteZip.
// Builds a malicious library ZIP whose entry names try to escape the save folder
// via (a) Windows backslash separators, (b) POSIX `../` traversal, (c) an
// absolute / drive-letter path, alongside legitimate captures + a folders.json.
// Asserts: nothing is written outside the destination, no "evil" file lands even
// inside it, and the legitimate entries still import + merge normally.
//
//   node scripts/test-archive-zipslip.js

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('../app/vendor/jszip.min.js');
const { importCompleteZip, buildCompleteZip } = require('../app/lib-archive.mts');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-zipslip-'));
  const dest = path.join(root, 'lib');
  fs.mkdirSync(dest, { recursive: true });
  // BOM tolerance (BACKLOG L3), piggybacked on this import: both org-JSON read
  // paths — the zip entry (third-party tools export BOM'd JSON) and the existing
  // file at dest (hand-edited) — must parse, or the merge silently drops a side.
  const BOM = String.fromCharCode(0xfeff);
  fs.writeFileSync(path.join(dest, 'collections.json'), BOM + JSON.stringify({ collections: [{ id: 'pre', name: 'P', items: [] }] }));

  const zip = new JSZip();
  // Legitimate entries.
  zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
  zip.file('library/cap2.jpg', Buffer.from('JPEGDATA2'));
  zip.file('library/avatars/abcd1234.png', Buffer.from('AVATARDATA')); // shared avatar store (sanctioned subpath)
  zip.file('library/folders.json', BOM + JSON.stringify({ folders: [{ id: 'f1', name: 'X', items: ['cap1'] }] }));
  // Malicious entries — each must be rejected, never written outside dest.
  zip.file('library/..\\..\\evil-back.txt', 'PWNED-BACK'); // Windows backslash traversal
  zip.file('library/../../evil-fwd.txt', 'PWNED-FWD'); // POSIX traversal
  zip.file('library/C:\\Windows\\evil-abs.txt', 'PWNED-ABS'); // absolute / drive-letter
  // Traversal through the sanctioned subpath. Backslash form: JSZip normalizes
  // forward-slash '..' segments at add time (so 'avatars/../x' can't even be
  // constructed via zip.file()), but a hand-crafted archive can carry the raw
  // name — the backslash variant survives JSZip untouched and exercises the guard.
  zip.file('library/avatars\\..\\evil-av.txt', 'PWNED-AV');
  zip.file('library/avatars/deep/evil-deep.txt', 'PWNED-DEEP'); // deeper nesting is NOT sanctioned
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  const res = await importCompleteZip(JSZip, dest, buf);

  // Legit captures imported.
  assert.ok(fs.existsSync(path.join(dest, 'cap1.jpg')), 'cap1.jpg should import');
  assert.ok(fs.existsSync(path.join(dest, 'cap2.jpg')), 'cap2.jpg should import');
  assert.ok(fs.existsSync(path.join(dest, 'avatars', 'abcd1234.png')), 'avatars/abcd1234.png should import into the subfolder');
  assert.strictEqual(res.imported, 3, 'exactly the 3 legit entries imported, got ' + res.imported);

  // legacy folders.json folds into collections.json (folders.json is retired).
  const merged = JSON.parse(fs.readFileSync(path.join(dest, 'collections.json'), 'utf8'));
  assert.ok(
    merged.collections.some((c) => c.id === 'f1'),
    'imported folders.json folded into collections.json (BOM in zip entry tolerated)',
  );
  assert.ok(
    merged.collections.some((c) => c.id === 'pre'),
    'pre-existing BOM-prefixed collections.json read and merged, not clobbered',
  );
  assert.ok(!fs.existsSync(path.join(dest, 'folders.json')), 'no local folders.json resurrected');

  // Nothing escaped the destination.
  const escapeTargets = [path.resolve(dest, '..', '..', 'evil-back.txt'), path.resolve(dest, '..', '..', 'evil-fwd.txt'), path.resolve(root, 'evil-back.txt'), path.resolve(root, 'evil-fwd.txt'), path.resolve(dest, '..', 'evil-back.txt'), path.resolve(dest, '..', 'evil-fwd.txt')];
  for (const p of escapeTargets) {
    assert.ok(!fs.existsSync(p), 'Zip-Slip: must NOT write outside dest: ' + p);
  }
  // No "evil" file even inside dest (including the avatars subfolder).
  for (const n of fs.readdirSync(dest)) {
    assert.ok(!/evil/i.test(n), 'Zip-Slip: malicious entry leaked inside dest: ' + n);
  }
  for (const n of fs.readdirSync(path.join(dest, 'avatars'))) {
    assert.ok(!/evil|deep/i.test(n), 'Zip-Slip: malicious entry leaked inside dest/avatars: ' + n);
  }

  // --- Round-trip: buildCompleteZip carries avatars/ and import restores it ---
  const srcLib = path.join(root, 'src');
  fs.mkdirSync(path.join(srcLib, 'avatars'), { recursive: true });
  fs.writeFileSync(path.join(srcLib, 'cap9.jpg'), 'JPEGDATA9');
  fs.writeFileSync(path.join(srcLib, 'avatars', 'ffff0000.webp'), 'AVDATA');
  const built = await buildCompleteZip(JSZip, srcLib);
  assert.strictEqual(built.fileCount, 2, 'export counts the avatar file, got ' + built.fileCount);
  const dest2 = path.join(root, 'lib2');
  fs.mkdirSync(dest2, { recursive: true });
  const res2 = await importCompleteZip(JSZip, dest2, built.buffer);
  assert.ok(fs.existsSync(path.join(dest2, 'cap9.jpg')), 'round-trip: capture restored');
  assert.ok(fs.existsSync(path.join(dest2, 'avatars', 'ffff0000.webp')), 'round-trip: avatars/ restored');
  assert.strictEqual(res2.imported, 2, 'round-trip imports both entries, got ' + res2.imported);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS test-archive-zipslip: malicious entries rejected, legit imported (imported=' + res.imported + ', skipped=' + res.skipped + ')');
})().catch((e) => {
  console.error('FAIL test-archive-zipslip:', e && e.message ? e.message : e);
  process.exit(1);
});
