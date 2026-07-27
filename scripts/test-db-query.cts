'use strict';

// Unit tests for app/src/main/lib-db-query.ts (#5 St4 / #297 — the DB-backed read
// path). Builds a small DB via the real importer (app/src/main/lib-db-import.ts, #296)
// and checks postsFromDb/postsByIds reconstruct the exact sidecar-record
// shape (including the tags/tagIds parallel-array contract query.ts's tag
// leaf needs) and that the FTS5 rank contract documented in
// app/src/main/lib-db-schema.ts actually returns ranked hits.
//
//   node scripts/test-db-query.cts

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../app/src/main/lib-db.ts');
const { createDbImporter } = require('../app/src/main/lib-db-import.ts');
const { postsFromDb, postsByIds, searchPostsFts } = require('../app/src/main/lib-db-query.ts');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}
function writeJson(folder: string, name: string, data: unknown) {
  fs.writeFileSync(path.join(folder, name), JSON.stringify(data));
}

(async () => {
  const folder = mkTempDir('hologram-db-query-lib-');
  const dbFile = path.join(mkTempDir('hologram-db-query-db-'), 'test.db');

  writeJson(folder, 'cap-1.json', {
    captureId: 'cap-1',
    image: 'cap-1.jpg',
    media: [
      { url: 'https://x.example/1.jpg', alt: 'alt1', width: 100, height: 200, file: 'cap-1-media-0.jpg' },
      { url: 'https://x.example/2.mp4', alt: 'alt2', width: 50, height: 60, file: 'cap-1-media-1.mp4', type: 'video', posterFile: 'cap-1-poster.jpg' },
    ],
    text: 'a beautiful sunset over the mountains',
    hashtags: ['nature', 'photo'],
    tags: ['character:alice', 'style:sketch'],
    platform: 'x',
    isReply: true,
    isQuote: false,
    capturedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  writeJson(folder, 'cap-2.json', {
    captureId: 'cap-2',
    image: 'cap-2.jpg',
    media: [],
    text: 'a rainy morning downtown',
    tags: ['character:alice'],
    platform: 'bluesky',
    capturedAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  });

  const handle = openDatabase(dbFile);
  const importer = createDbImporter();
  const report = await importer.importAll(folder, handle);
  ok(report.dbPostCount === 2, 'importAll seeded 2 posts');

  // --- postsFromDb: shape + ordering (newest capturedAt first) ---
  const all = await postsFromDb(handle.sqlite);
  ok(all.length === 2, 'postsFromDb returns every post');
  ok(all[0].captureId === 'cap-2' && all[1].captureId === 'cap-1', 'newest capturedAt first, same ordering as lib-index.ts');

  const cap1 = all.find((p: any) => p.captureId === 'cap-1');
  ok(cap1.text === 'a beautiful sunset over the mountains', 'text column round-trips');
  assert.deepStrictEqual(cap1.hashtags, ['nature', 'photo'], 'hashtags JSON column parses back to an array');
  assert.deepStrictEqual(
    cap1.media.map((m: any) => m.file),
    ['cap-1-media-0.jpg', 'cap-1-media-1.mp4'],
    'media rows come back in seq order',
  );
  assert.strictEqual(cap1.media[0].type, null, 'a still-image entry has no type (#119 St1)');
  assert.strictEqual(cap1.media[1].type, 'video', 'a video entry carries its type (#119 St1)');
  assert.strictEqual(cap1.media[1].posterFile, 'cap-1-poster.jpg', 'a video entry carries its posterFile (#119 St1)');
  passed += 3;
  ok(cap1.isReply === true && cap1.isQuote === false, 'INTEGER 0/1 booleans coerce back to true/false, not 0/1');
  const cap2 = all.find((p: any) => p.captureId === 'cap-2');
  ok(cap2.isReply === null, 'an unset boolean column stays null, not false');

  // --- tags/tagIds parallel-array contract (#5 2026-07-18 comment: tag leaves
  // match by id so a rename doesn't orphan a saved search) ---
  ok(cap1.tags.length === 2 && cap1.tagIds.length === 2, 'tags and tagIds are the same length');
  const aliceIdx = cap1.tags.indexOf('character:alice');
  ok(aliceIdx >= 0, 'cap-1 carries the alice tag by name');
  const aliceId = cap1.tagIds[aliceIdx];
  ok(cap2.tagIds.includes(aliceId), 'cap-1 and cap-2 resolve the SAME tag id for the same tag name (get-or-create dedup)');

  // Rename the tag directly in the DB (simulating a future tag-rename feature)
  // and confirm postsFromDb picks up the new name while the id — and thus
  // tagId-based matching — is unaffected.
  handle.sqlite.prepare('UPDATE tags SET name = ? WHERE id = ?').run('character:alice-renamed', aliceId);
  const afterRename = await postsFromDb(handle.sqlite);
  const cap1AfterRename = afterRename.find((p: any) => p.captureId === 'cap-1');
  ok(cap1AfterRename.tags.includes('character:alice-renamed'), 'renamed tag name is reflected on next read');
  ok(cap1AfterRename.tagIds.includes(aliceId), 'the id survives the rename — this is what lets a saved tagId leaf keep matching');

  // --- postsByIds: a subset, same shape ---
  const subset = await postsByIds(handle.sqlite, ['cap-2']);
  ok(subset.length === 1 && subset[0].captureId === 'cap-2', 'postsByIds returns exactly the requested subset');
  ok((await postsByIds(handle.sqlite, [])).length === 0, 'postsByIds([]) short-circuits to empty, no query with an empty IN()');

  // --- FTS5 rank contract (lib-db-schema.ts's documented query shape) ---
  const hits = searchPostsFts(handle.sqlite, 'mountains');
  ok(hits.length === 1 && hits[0].postId === 'cap-1', 'FTS5 MATCH finds the post containing the term');
  ok(typeof hits[0].rank === 'number', 'rank is exposed as a number (bm25 — more negative is more relevant)');
  ok(searchPostsFts(handle.sqlite, '').length === 0, 'an empty query returns no hits rather than matching everything');
  ok(searchPostsFts(handle.sqlite, '"unbalanced').length === 0, 'a malformed MATCH expression fails soft (empty), not throw');

  handle.sqlite.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });

  console.log(`PASS test-db-query: ${passed} assertions`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
