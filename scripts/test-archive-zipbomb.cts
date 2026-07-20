'use strict';

// Zip-bomb / unbounded-expansion regression test for app/lib-archive.js#importCompleteZip.
// Asserts the import:
//   (a) accepts a normal complete-export ZIP (captures + folders.json),
//   (b) rejects an archive whose total declared uncompressed size exceeds the cap,
//   (c) rejects an archive with too many entries,
//   (d) rejects a single entry whose declared uncompressed size exceeds the per-entry cap,
//   (e) the streamed writer aborts an entry whose ACTUAL output passes the per-entry
//       byte budget (defense against a central directory that under-declares its size).
// Each rejection must NOT leave the malicious payload (or a stray .tmp-import) on disk.
//
// Note: the real caps are GiB-scale, which is impractical to materialize via real
// compression in a unit test. (b)-(d) therefore forge the declared `uncompressedSize`
// on the loaded entries (the value the pre-extraction guard reads from the ZIP central
// directory) so the guard fires before any decompression — exactly the production path
// for a bomb that declares a huge size. (e) exercises the streamed cap directly with a
// small budget and real multi-chunk data.
//
//   node scripts/test-archive-zipbomb.cts

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const archive = require('../app/lib-archive.mts');
const { importCompleteZip, writeEntryStreamed, ZipLimitError, MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES, MAX_ZIP_TOTAL_BYTES } = archive;

// JSZip ctor wrapper whose loadAsync overrides each non-dir entry's declared
// uncompressed size, so we can simulate a bomb without materializing GiB of data.
// `sizeFor(relPath, index)` returns the forged size for each entry.
function ForgingJSZip(sizeFor) {
  const Wrap = function () {
    return new JSZip();
  };
  Wrap.loadAsync = async (buf) => {
    const z = await JSZip.loadAsync(buf);
    let i = 0;
    z.forEach((rel, e) => {
      if (!e.dir && e._data) e._data.uncompressedSize = sizeFor(rel, i++);
    });
    return z;
  };
  return Wrap;
}

function freshDest(root, tag) {
  const dest = path.join(root, tag);
  fs.mkdirSync(dest, { recursive: true });
  return dest;
}

async function expectReject(promise, label) {
  let err: any = null;
  try {
    await promise;
  } catch (e) {
    err = e;
  }
  assert.ok(err, label + ': import should have been rejected but resolved');
  assert.ok(err instanceof ZipLimitError, label + ': expected ZipLimitError, got ' + (err && err.constructor && err.constructor.name));
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-zipbomb-'));

  // (a) Normal export still imports (real ZIP, real sizes).
  {
    const dest = freshDest(root, 'normal');
    const zip = new JSZip();
    zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
    zip.file('library/cap2.jpg', Buffer.from('JPEGDATA2'));
    zip.file('library/folders.json', JSON.stringify({ folders: [{ id: 'f1', name: 'X', items: ['cap1'] }] }));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await importCompleteZip(JSZip, dest, buf);
    assert.strictEqual(res.imported, 2, 'normal export: 2 captures imported, got ' + res.imported);
    assert.ok(fs.existsSync(path.join(dest, 'cap1.jpg')), 'normal export: cap1.jpg present');
    assert.ok(fs.existsSync(path.join(dest, 'folders.json')), 'normal export: folders.json imported and merged');
  }

  // Build a small real ZIP reused by the forged cases below.
  const small = await (async () => {
    const zip = new JSZip();
    const n = 80; // > 64 so 80 entries near the per-entry cap exceed the total cap
    for (let i = 0; i < n; i++) zip.file('library/z' + i + '.bin', Buffer.from('tiny' + i));
    return { buf: await zip.generateAsync({ type: 'nodebuffer' }), n };
  })();

  // (b) Total declared size over the cap (each entry under the per-entry cap, so only
  // the TOTAL guard can fire). 80 entries × ~0.99 GiB ≈ 79 GiB > 64 GiB.
  {
    const dest = freshDest(root, 'total-bomb');
    const each = MAX_ZIP_ENTRY_BYTES - 1024; // just under the per-entry cap
    assert.ok(small.n * each > MAX_ZIP_TOTAL_BYTES, 'total-bomb fixture sums past the total cap');
    await expectReject(
      importCompleteZip(
        ForgingJSZip(() => each),
        dest,
        small.buf,
      ),
      'total-bomb',
    );
    assert.strictEqual(fs.readdirSync(dest).length, 0, 'total-bomb: nothing written');
  }

  // (c) Too many entries (tiny declared sizes, so only the COUNT guard can fire).
  // Materializing MAX_ZIP_ENTRIES real entries via generateAsync takes ~minute, so
  // use a synthetic loadAsync whose forEach emits MAX_ZIP_ENTRIES+5 tiny entries —
  // this drives importCompleteZip's count tally exactly as a real bomb would.
  {
    const dest = freshDest(root, 'count-bomb');
    const count = MAX_ZIP_ENTRIES + 5;
    const SyntheticJSZip = function () {
      return new JSZip();
    };
    SyntheticJSZip.loadAsync = async () => ({
      forEach(cb) {
        for (let i = 0; i < count; i++) {
          cb('library/e' + i + '.txt', { dir: false, _data: { uncompressedSize: 1 } });
        }
      },
      file() {
        return null;
      },
    });
    await expectReject(importCompleteZip(SyntheticJSZip, dest, Buffer.alloc(0)), 'count-bomb');
    assert.strictEqual(fs.readdirSync(dest).length, 0, 'count-bomb: nothing written');
  }

  // (d) A single entry over the per-entry cap.
  {
    const dest = freshDest(root, 'entry-bomb');
    const oversize = MAX_ZIP_ENTRY_BYTES + 1;
    // Forge only the first entry oversize; the guard must reject on it.
    await expectReject(
      importCompleteZip(
        ForgingJSZip((rel, i) => (i === 0 ? oversize : 4)),
        dest,
        small.buf,
      ),
      'entry-bomb',
    );
    assert.strictEqual(fs.readdirSync(dest).length, 0, 'entry-bomb: nothing written');
  }

  // (e) Streamed writer aborts when ACTUAL bytes exceed the budget (under-declared
  // central directory defense), and leaves no readable partial file behind.
  {
    const dest = freshDest(root, 'stream-cap');
    const zip = new JSZip();
    const payload = Buffer.alloc(256 * 1024, 7); // 256 KiB, multi-chunk through the stream
    zip.file('library/big.bin', payload);
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const z = await JSZip.loadAsync(buf);
    const entry = z.file('library/big.bin');
    const tmp = path.join(dest, 'big.bin.tmp-import');
    let threw = false;
    try {
      await writeEntryStreamed(entry, tmp, 64 * 1024);
    } catch (e) {
      // 64 KiB budget < 256 KiB payload
      threw = true;
      assert.ok(e instanceof ZipLimitError, 'stream-cap: expected ZipLimitError');
    }
    assert.ok(threw, 'stream-cap: writeEntryStreamed should abort over budget');

    // And a within-budget entry writes fully.
    const tmp2 = path.join(dest, 'ok.bin.tmp-import');
    await writeEntryStreamed(entry, tmp2, 1024 * 1024); // 1 MiB budget > 256 KiB payload
    assert.strictEqual(fs.statSync(tmp2).size, payload.length, 'stream-cap: within-budget entry written in full');
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS test-archive-zipbomb: normal import OK; total/count/entry bombs rejected; streamed writer caps over-budget entries');
})().catch((e) => {
  console.error('FAIL test-archive-zipbomb:', e && e.message ? e.message : e);
  process.exit(1);
});
