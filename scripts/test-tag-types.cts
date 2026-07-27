'use strict';

// Unit + import test for the tag 用語帳 (Phase 2 ①): tag-types.json.
// Covers mergeTagTypes (union; current library wins on a tag already classified;
// labels merge) and the end-to-end importCompleteZip merge of tag-types.json.
//
//   node scripts/test-tag-types.cts

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { mergeTagTypes, importCompleteZip, ORG_MERGE } = require('../app/src/main/lib-archive.ts');

// --- mergeTagTypes (pure) -----------------------------------------------------
{
  // Union of disjoint maps.
  const m = mergeTagTypes({ types: { ブルアカ: 'work' } }, { types: { アロナ: 'character' } });
  assert.strictEqual(m.types.ブルアカ, 'work', 'current entry kept');
  assert.strictEqual(m.types.アロナ, 'character', 'incoming entry added');

  // Conflict: the current (local) classification wins — an import must not
  // silently overwrite a deliberate local kind.
  const c = mergeTagTypes({ types: { アリス: 'character' } }, { types: { アリス: 'work' } });
  assert.strictEqual(c.types.アリス, 'character', 'current wins on conflict');

  // Empty / missing shapes don't throw.
  assert.deepStrictEqual(mergeTagTypes({}, {}).types, {}, 'empty merge → empty types');
  assert.deepStrictEqual(mergeTagTypes(null, null).types, {}, 'null-safe');

  // Labels merge, current wins.
  const l = mergeTagTypes({ types: {}, labels: { work: '作品' } }, { types: {}, labels: { work: 'シリーズ', character: '話数' } });
  assert.strictEqual(l.labels.work, '作品', 'current label wins');
  assert.strictEqual(l.labels.character, '話数', 'incoming label filled in');

  // No labels anywhere → no labels key emitted.
  assert.ok(!('labels' in mergeTagTypes({ types: { a: 'work' } }, { types: {} })), 'labels omitted when absent');
  console.log('ok  mergeTagTypes: union / current-wins / labels / null-safe');
}

// --- tag-types.json is registered for import merge ----------------------------
assert.ok(ORG_MERGE.includes('tag-types.json'), 'tag-types.json in ORG_MERGE');

// --- importCompleteZip merges tag-types.json ----------------------------------
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tagtypes-'));
  const dest = path.join(root, 'lib');
  fs.mkdirSync(dest, { recursive: true });

  // Existing library already classifies アリス=character and ブルアカ=work.
  fs.writeFileSync(path.join(dest, 'tag-types.json'), JSON.stringify({ types: { アリス: 'character', ブルアカ: 'work' } }), 'utf8');

  // Incoming ZIP: adds アロナ=character, and tries to flip アリス→work (must lose).
  const zip = new JSZip();
  zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
  zip.file('library/tag-types.json', JSON.stringify({ types: { アロナ: 'character', アリス: 'work' } }));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  await importCompleteZip(JSZip, dest, buf);

  const merged = JSON.parse(fs.readFileSync(path.join(dest, 'tag-types.json'), 'utf8'));
  assert.strictEqual(merged.types.アリス, 'character', 'local classification preserved on import');
  assert.strictEqual(merged.types.ブルアカ, 'work', 'existing entry kept');
  assert.strictEqual(merged.types.アロナ, 'character', 'imported entry merged in');
  console.log('ok  importCompleteZip: tag-types.json merged (local wins, union)');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS test-tag-types');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
