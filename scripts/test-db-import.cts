'use strict';

// Unit tests for app/lib-db-import.mts (#5 St3 / #296 — the sidecar -> DB sync
// importer). Builds a small synthetic save folder (sidecars + every org-layer
// JSON file + tabs.json), imports it into a real SQLite DB via lib-db.mts, and
// checks the three acceptance criteria directly:
//   - full import -> re-run is idempotent (same rows, same tag/post ids, no
//     duplicates) and picks up edits/adds/removes on a third run
//   - incremental sync (importChanged) applies exactly a watch-style filename
//     batch, and is itself idempotent against a spurious re-fire
//   - the report reconciles sidecar count against DB row count and lists
//     parse failures (corrupt JSON, valid JSON that isn't a post record)
//
//   node scripts/test-db-import.cts

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../app/lib-db.mts');
const { createDbImporter } = require('../app/lib-db-import.mts');

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
  const folder = mkTempDir('hologram-db-import-lib-');
  const dbFile = path.join(mkTempDir('hologram-db-import-db-'), 'test.db');

  // --- fixture: 3 posts, every org-layer file, one non-post, one corrupt ---
  writeJson(folder, 'cap-1.json', {
    captureId: 'cap-1',
    image: 'cap-1.jpg',
    media: [{ url: 'https://x.example/1.mp4', alt: 'alt1', width: 100, height: 200, file: 'cap-1-media-0.mp4', type: 'video', posterFile: 'cap-1-poster.jpg' }],
    text: 'a beautiful sunset today',
    hashtags: ['nature', 'photo'],
    tags: ['character:alice', 'style:sketch'],
    capturedAt: '2026-01-01T00:00:00Z',
  });
  writeJson(folder, 'cap-2.json', {
    captureId: 'cap-2',
    image: 'cap-2.jpg',
    media: [],
    text: 'a rainy morning',
    tags: ['character:alice'],
    capturedAt: '2026-01-02T00:00:00Z',
  });
  writeJson(folder, 'cap-3.json', {
    captureId: 'cap-3',
    image: 'cap-3.jpg',
    text: 'to be deleted',
    capturedAt: '2026-01-03T00:00:00Z',
  });
  writeJson(folder, 'notapost.json', { foo: 1 }); // no image/video/media -> not a post record
  fs.writeFileSync(path.join(folder, 'corrupt.json'), '{ not valid json');

  writeJson(folder, 'tag-types.json', { types: { 'character:alice': 'character', 'style:sketch': 'work' } });
  writeJson(folder, 'folders.json', {
    folders: [
      { id: 'f-root', name: 'Root', kind: 'static', created: 122, items: [] },
      { id: 'f1', name: 'F1', kind: 'static', created: 123, parentId: 'f-root', items: ['cap-1', 'cap-2', 'cap-3'] },
    ],
  });
  writeJson(folder, 'manual-groups.json', { groups: [['cap-1', 'cap-2']] });
  writeJson(folder, 'poster-folders.json', { folders: [{ id: 'pf1', name: 'PF1', items: ['poster-key-1'] }] });
  writeJson(folder, 'poster-tags.json', { tags: { 'poster-key-1': ['character:alice'] } });
  writeJson(folder, 'ungrouped.json', { keys: ['url-key-1'] });
  writeJson(folder, 'tabs.json', {
    activeTabId: 't1',
    tabs: [
      { id: 't1', pinned: false, title: 'Tab 1', state: { tree: null } },
      { id: 't2', pinned: true, title: null, state: {} },
    ],
  });

  const { db, sqlite } = openDatabase(dbFile);
  const importer = createDbImporter();

  // --- full import #1 -----------------------------------------------------
  const r1 = await importer.importAll(folder, { db, sqlite });
  assert.strictEqual(r1.sidecarCount, 3, 'sidecarCount counts only real post sidecars (cap-1/2/3), not notapost/corrupt');
  assert.strictEqual(r1.postsWritten, 3, 'postsWritten matches sidecarCount on a clean import');
  assert.strictEqual(r1.postsRemoved, 0, 'nothing to remove on the first import');
  assert.strictEqual(r1.dbPostCount, 3, 'dbPostCount reconciles against sidecarCount');
  assert.strictEqual(r1.parseFailures.length, 2, 'parseFailures lists notapost.json and corrupt.json');
  ok(
    r1.parseFailures.some((f: any) => f.file === 'corrupt.json' && f.error),
    'corrupt.json reports a real parse error message',
  );
  ok(
    r1.parseFailures.some((f: any) => f.file === 'notapost.json'),
    'notapost.json is reported (valid JSON, not a post record)',
  );
  passed += 6;

  const post1 = sqlite.prepare('SELECT * FROM posts WHERE captureId = ?').get('cap-1') as any;
  assert.strictEqual(post1.text, 'a beautiful sunset today', 'post row carries the sidecar text');
  assert.deepStrictEqual(JSON.parse(post1.hashtags), ['nature', 'photo'], 'hashtags land as a JSON array column');
  passed += 2;

  const media1 = sqlite.prepare('SELECT * FROM media WHERE postId = ?').all('cap-1') as any[];
  assert.strictEqual(media1.length, 1, 'cap-1 has one media row');
  assert.strictEqual(media1[0].file, 'cap-1-media-0.mp4', 'media row carries the sidecar file name');
  assert.strictEqual(media1[0].type, 'video', 'media row carries type (#119 St1)');
  assert.strictEqual(media1[0].posterFile, 'cap-1-poster.jpg', 'media row carries posterFile (#119 St1)');
  passed += 4;

  const tags = sqlite.prepare('SELECT id, name, kind FROM tags ORDER BY name').all() as any[];
  assert.strictEqual(tags.length, 2, 'exactly 2 distinct tag names resolved (character:alice, style:sketch)');
  const aliceTag = tags.find((t) => t.name === 'character:alice');
  const sketchTag = tags.find((t) => t.name === 'style:sketch');
  assert.strictEqual(aliceTag.kind, 'character', 'tag kind comes from tag-types.json');
  assert.strictEqual(sketchTag.kind, 'work', 'tag kind comes from tag-types.json');
  passed += 3;

  const cap1TagIds = (sqlite.prepare('SELECT tagId FROM post_tags WHERE postId = ?').all('cap-1') as any[]).map((r) => r.tagId).sort();
  const cap2TagIds = (sqlite.prepare('SELECT tagId FROM post_tags WHERE postId = ?').all('cap-2') as any[]).map((r) => r.tagId).sort();
  assert.deepStrictEqual(cap1TagIds, [aliceTag.id, sketchTag.id].sort(), 'cap-1 carries both tags');
  assert.deepStrictEqual(cap2TagIds, [aliceTag.id], 'cap-2 shares the SAME alice tag id — tag resolution dedups by name');
  passed += 2;

  const ftsHit = sqlite.prepare('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?').all('"sunset"') as any[];
  assert.strictEqual(ftsHit.length, 1, 'posts_fts is populated and searchable');
  assert.strictEqual(ftsHit[0].postId, 'cap-1', 'the FTS row resolves back to the right post');
  passed += 2;

  const folderItems = (sqlite.prepare('SELECT postId FROM folder_items WHERE folderId = ? ORDER BY postId').all('f1') as any[]).map((r) => r.postId);
  assert.deepStrictEqual(folderItems, ['cap-1', 'cap-2', 'cap-3'], 'folder_items reflects folders.json (all 3 posts exist at this point)');
  assert.strictEqual(sqlite.prepare('SELECT parentId FROM folders WHERE id = ?').get('f1').parentId, 'f-root', 'folders.json parentId survives the one-time DB import');
  passed += 2;

  const groupRows = sqlite.prepare('SELECT g.id AS groupId, gi.postId, gi.seq FROM manual_groups g JOIN manual_group_items gi ON gi.groupId = g.id ORDER BY gi.seq').all() as any[];
  assert.strictEqual(groupRows.length, 2, "manual-groups.json's one group of 2 becomes 2 manual_group_items rows");
  assert.deepStrictEqual(
    groupRows.map((r) => r.postId),
    ['cap-1', 'cap-2'],
    'manual group item order preserved (seq)',
  );
  passed += 2;

  ok(sqlite.prepare('SELECT 1 FROM poster_folder_items WHERE folderId = ? AND posterKey = ?').get('pf1', 'poster-key-1'), 'poster_folder_items round-trips');
  const posterTagIds = (sqlite.prepare('SELECT tagId FROM poster_tags WHERE posterKey = ?').all('poster-key-1') as any[]).map((r) => r.tagId);
  assert.deepStrictEqual(posterTagIds, [aliceTag.id], 'poster_tags resolves the SAME tag id as the post-side tag');
  ok(sqlite.prepare('SELECT 1 FROM ungrouped_keys WHERE postKey = ?').get('url-key-1'), 'ungrouped_keys round-trips');
  passed += 3;

  const tabRows = sqlite.prepare('SELECT id, position, pinned FROM tabs ORDER BY position').all() as any[];
  assert.deepStrictEqual(
    tabRows.map((r) => r.id),
    ['t1', 't2'],
    'tabs land in tabs.json order',
  );
  assert.strictEqual(tabRows[1].pinned, 1, 'pinned boolean maps to 1/0');
  const win = sqlite.prepare('SELECT activeTabId FROM tab_windows WHERE windowId = ?').get('main') as any;
  assert.strictEqual(win.activeTabId, 't1', "tab_windows.activeTabId carries tabs.json's activeTabId");
  passed += 3;

  // --- full import #2: unchanged folder -> byte-identical result, no dupes --
  const r2 = await importer.importAll(folder, { db, sqlite });
  assert.strictEqual(r2.postsWritten, 3, 'unchanged re-run still reports 3 (writes are upserts, not appends)');
  assert.strictEqual(r2.postsRemoved, 0, 'nothing removed on an unchanged re-run');
  assert.strictEqual(r2.dbPostCount, 3, 'row count unchanged');
  assert.strictEqual((sqlite.prepare('SELECT COUNT(*) AS n FROM tags').get() as any).n, 2, 'tags are NOT duplicated on re-run (get-or-create)');
  assert.strictEqual((sqlite.prepare('SELECT COUNT(*) AS n FROM media').get() as any).n, 1, 'media is NOT duplicated on re-run (delete+reinsert per post, not append)');
  assert.strictEqual((sqlite.prepare('SELECT COUNT(*) AS n FROM manual_group_items').get() as any).n, 2, 'manual_group_items not duplicated on re-run');
  const aliceTagAfterRerun = sqlite.prepare('SELECT id FROM tags WHERE name = ?').get('character:alice') as any;
  assert.strictEqual(aliceTagAfterRerun.id, aliceTag.id, 'a re-run keeps the SAME tag row id (no delete+reinsert of tags — see module comment)');
  passed += 6;

  // --- full import #3: edit cap-1, delete cap-3, add cap-4 ----------------
  writeJson(folder, 'cap-1.json', {
    captureId: 'cap-1',
    image: 'cap-1.jpg',
    media: [{ url: 'https://x.example/1.jpg', alt: 'alt1', width: 100, height: 200, file: 'cap-1-media-0.jpg' }],
    text: 'an edited sunrise instead',
    hashtags: ['nature'],
    tags: ['character:alice'],
    capturedAt: '2026-01-01T00:00:00Z',
  });
  fs.rmSync(path.join(folder, 'cap-3.json'));
  writeJson(folder, 'cap-4.json', { captureId: 'cap-4', image: 'cap-4.jpg', capturedAt: '2026-01-04T00:00:00Z' });

  const r3 = await importer.importAll(folder, { db, sqlite });
  assert.strictEqual(r3.postsWritten, 3, 'cap-1 (edited), cap-2, cap-4 = 3 current posts');
  assert.strictEqual(r3.postsRemoved, 1, 'cap-3 is gone from disk -> removed from the DB');
  assert.strictEqual(r3.dbPostCount, 3, 'dbPostCount reflects the new total');
  assert.strictEqual(sqlite.prepare('SELECT text FROM posts WHERE captureId = ?').get('cap-1').text, 'an edited sunrise instead', 'the edit landed');
  ok(!sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('cap-3'), 'cap-3 row is gone');
  const folderItemsAfterDelete = (sqlite.prepare('SELECT postId FROM folder_items WHERE folderId = ? ORDER BY postId').all('f1') as any[]).map((r) => r.postId);
  assert.deepStrictEqual(folderItemsAfterDelete, ['cap-1', 'cap-2'], 'folders.json still lists cap-3, but it is filtered out (no longer a valid post)');
  ok(sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('cap-4'), 'the new post cap-4 was imported');
  const ftsAfterEdit = sqlite.prepare('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?').all('"sunrise"') as any[];
  assert.strictEqual(ftsAfterEdit.length, 1, 'posts_fts reflects the edited text (old row was replaced, not left stale)');
  passed += 7;

  // --- incremental sync: exactly the named batch, plus its own idempotency --
  writeJson(folder, 'cap-5.json', { captureId: 'cap-5', image: 'cap-5.jpg', capturedAt: '2026-01-05T00:00:00Z' });
  writeJson(folder, 'cap-1.json', {
    captureId: 'cap-1',
    image: 'cap-1.jpg',
    media: [],
    text: 'a third revision',
    capturedAt: '2026-01-01T00:00:00Z',
  });
  fs.rmSync(path.join(folder, 'cap-2.json'));

  const rc1 = await importer.importChanged(folder, { db, sqlite }, ['cap-5.json', 'cap-1.json', 'cap-2.json']);
  assert.strictEqual(rc1.postsWritten, 2, 'the named batch adds cap-5 and re-writes edited cap-1');
  assert.strictEqual(rc1.postsRemoved, 1, 'cap-2 (deleted, named in the batch) is removed');
  ok(sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('cap-5'), 'cap-5 was imported by the incremental path');
  assert.strictEqual(sqlite.prepare('SELECT text FROM posts WHERE captureId = ?').get('cap-1').text, 'a third revision', 'cap-1 edit applied by the incremental path');
  ok(!sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('cap-2'), 'cap-2 removed by the incremental path');
  ok(sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('cap-4'), 'cap-4 (not named in this batch) is untouched');
  passed += 5;

  const rc2 = await importer.importChanged(folder, { db, sqlite }, ['cap-5.json', 'cap-1.json', 'cap-2.json']);
  assert.strictEqual(rc2.postsWritten, 0, 'a spurious re-fire of the same names with nothing moved writes nothing');
  assert.strictEqual(rc2.postsRemoved, 0, 'cap-2 is already gone from the index — the second delete event is a no-op, not a re-report');
  passed += 2;

  sqlite.close();
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
  console.log(`PASS test-db-import: ${passed} assertions`);
})().catch((err) => {
  console.error('FAIL test-db-import:', err);
  process.exit(1);
});
