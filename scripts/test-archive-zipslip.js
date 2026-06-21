'use strict';

// Zip-Slip regression test for app/lib-archive.js#importCompleteZip.
// Builds a malicious library ZIP whose entry names try to escape the save folder
// via (a) Windows backslash separators, (b) POSIX `../` traversal, (c) an
// absolute / drive-letter path, alongside legitimate captures + a folders.json.
// Asserts: nothing is written outside the destination, no "evil" file lands even
// inside it, and the legitimate entries still import + merge normally.
//
//   node scripts/test-archive-zipslip.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('../app/vendor/jszip.min.js');
const { importCompleteZip } = require('../app/lib-archive.js');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-zipslip-'));
  const dest = path.join(root, 'lib');
  fs.mkdirSync(dest, { recursive: true });

  const zip = new JSZip();
  // Legitimate entries.
  zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
  zip.file('library/cap2.jpg', Buffer.from('JPEGDATA2'));
  zip.file('library/folders.json', JSON.stringify({ folders: [{ id: 'f1', name: 'X', items: ['cap1'] }] }));
  // Malicious entries — each must be rejected, never written outside dest.
  zip.file('library/..\\..\\evil-back.txt', 'PWNED-BACK');      // Windows backslash traversal
  zip.file('library/../../evil-fwd.txt', 'PWNED-FWD');          // POSIX traversal
  zip.file('library/C:\\Windows\\evil-abs.txt', 'PWNED-ABS');   // absolute / drive-letter
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  const res = await importCompleteZip(JSZip, dest, buf);

  // Legit captures imported.
  assert.ok(fs.existsSync(path.join(dest, 'cap1.jpg')), 'cap1.jpg should import');
  assert.ok(fs.existsSync(path.join(dest, 'cap2.jpg')), 'cap2.jpg should import');
  assert.strictEqual(res.imported, 2, 'exactly the 2 legit captures imported, got ' + res.imported);

  // legacy folders.json folds into collections.json (folders.json is retired).
  const merged = JSON.parse(fs.readFileSync(path.join(dest, 'collections.json'), 'utf8'));
  assert.ok(merged.collections.some((c) => c.id === 'f1'), 'imported folders.json folded into collections.json');
  assert.ok(!fs.existsSync(path.join(dest, 'folders.json')), 'no local folders.json resurrected');

  // Nothing escaped the destination.
  const escapeTargets = [
    path.resolve(dest, '..', '..', 'evil-back.txt'),
    path.resolve(dest, '..', '..', 'evil-fwd.txt'),
    path.resolve(root, 'evil-back.txt'),
    path.resolve(root, 'evil-fwd.txt'),
    path.resolve(dest, '..', 'evil-back.txt'),
    path.resolve(dest, '..', 'evil-fwd.txt')
  ];
  for (const p of escapeTargets) {
    assert.ok(!fs.existsSync(p), 'Zip-Slip: must NOT write outside dest: ' + p);
  }
  // No "evil" file even inside dest.
  for (const n of fs.readdirSync(dest)) {
    assert.ok(!/evil/i.test(n), 'Zip-Slip: malicious entry leaked inside dest: ' + n);
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS test-archive-zipslip: malicious entries rejected, legit imported (imported=' +
    res.imported + ', skipped=' + res.skipped + ')');
})().catch((e) => { console.error('FAIL test-archive-zipslip:', e && e.message ? e.message : e); process.exit(1); });
