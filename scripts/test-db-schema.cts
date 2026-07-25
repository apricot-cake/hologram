'use strict';

// Unit tests for the v1 DDL (#5 St2 / #295, app/lib-db-schema.mts) applied
// through app/lib-db.mts's real migration runner — not the fake db test-db-unit.cts
// uses for ordering/transaction checks, because what matters here is whether the
// SQL actually parses and the constraints actually hold in real SQLite.
//
// St2 is schema-only (nothing populates these tables yet — St3 is the sidecar
// importer), so these tests write throwaway rows just to prove a constraint
// fires, not to exercise a real data flow.
//
//   node scripts/test-db-schema.cts

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../app/lib-db.mts');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}

const dirs: string[] = [];
function mkdb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-db-schema-'));
  dirs.push(dir);
  return path.join(dir, 'test.db');
}

const EXPECTED_TABLES = ['posts', 'media', 'tags', 'tag_parents', 'tag_aliases', 'post_tags', 'folders', 'folder_items', 'poster_folders', 'poster_folder_items', 'poster_tags', 'manual_groups', 'manual_group_items', 'ungrouped_keys', 'tabs', 'tab_windows', 'store_state'];

// --- migration applies + every table lands -----------------------------

{
  const { db, sqlite } = openDatabase(mkdb());
  assert.strictEqual(sqlite.pragma('user_version', { simple: true }), 6, 'v1 DDL plus the five appended migrations through #41 add-folder-parent');

  const names = new Set(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name),
  );
  for (const t of EXPECTED_TABLES) ok(names.has(t), `table ${t} exists`);
  // FTS5 registers itself plus shadow tables (posts_fts_data, _idx, _docsize, _config).
  ok(names.has('posts_fts'), 'posts_fts virtual table exists');
  ok(!names.has('clip_items'), 'clip_items is dropped by the #135 migration');
  ok(!names.has('poster_workspace_items'), 'poster_workspace_items is dropped by the drop-poster-workspace-items migration');
  passed += 3;

  sqlite.close();
}

// --- posts_fts: the query contract (#5 2026-07-17/18 confirmed items) --------

{
  const { sqlite } = openDatabase(mkdb());
  sqlite.prepare('INSERT INTO posts_fts (postId, text, title, displayName, screenName, eagleName, description, hashtags, tagsText, reading) VALUES (?,?,?,?,?,?,?,?,?,?)').run('cap-1', '吾輩は猫である名前はまだ無い', null, null, null, null, null, null, null, 'わがはいはねこであるなまえはまだない');
  sqlite.prepare('INSERT INTO posts_fts (postId, text, title, displayName, screenName, eagleName, description, hashtags, tagsText, reading) VALUES (?,?,?,?,?,?,?,?,?,?)').run('cap-2', '犬も歩けば棒に当たる', null, null, null, null, null, null, null, 'いぬもあるけばぼうにあたる');

  // trigram needs >=3 characters to form a token at all — a bare 1-char query
  // (the naive first guess) silently matches nothing, same trap the St1 test
  // (test-db-unit.cts) sidesteps with a 4-char phrase.
  const hit = sqlite.prepare('SELECT postId, bm25(posts_fts) AS rank FROM posts_fts WHERE posts_fts MATCH ? ORDER BY rank').all('"猫である"');
  assert.strictEqual(hit.length, 1, 'MATCH searches the indexed columns, mid-token substring included (trigram)');
  assert.strictEqual(hit[0].postId, 'cap-1', 'postId round-trips through an UNINDEXED column');
  ok(typeof hit[0].rank === 'number', 'bm25(posts_fts) is the rank query contract (#5 2026-07-18 comment), not a stored column');
  passed += 2;

  // The reading column exists and is independently searchable (#164's future
  // job is populating it — St2 only proves the column + query shape exist).
  const readingHit = sqlite.prepare('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?').all('reading:"ねこである"');
  assert.strictEqual(readingHit.length, 1, 'the reading column is queryable on its own (column-scoped MATCH)');
  passed++;

  sqlite.close();
}

// --- tags: ID entity, name not unique, multi-parent + single display parent --

{
  const { sqlite } = openDatabase(mkdb());
  const insTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  const alice1 = insTag.run('アリス').lastInsertRowid;
  const alice2 = insTag.run('アリス').lastInsertRowid; // same-name different entity (#21 problem this schema fixes)
  ok(alice1 !== alice2, 'two tags may share a name — identity is the id, not the name');
  passed++;

  const touhou = insTag.run('東方').lastInsertRowid;
  const ba = insTag.run('ブルーアーカイブ').lastInsertRowid;
  const insParent = sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?,?,?)');
  insParent.run(alice1, touhou, 1); // alice1's disambiguation parent
  insParent.run(alice1, ba, 0); // a second, non-display parent — multi-parent is allowed
  const parents = sqlite.prepare('SELECT parentTagId, isDisplay FROM tag_parents WHERE tagId = ? ORDER BY parentTagId').all(alice1);
  assert.strictEqual(parents.length, 2, 'a tag may have more than one parent (2026-07-18 10:24 comment)');
  passed++;

  assert.throws(() => insParent.run(alice1, ba, 1), /UNIQUE constraint failed/, 'at most one parent may be flagged the display parent per tag');
  passed++;

  // A second tag CAN have its own display parent — the partial index scopes
  // "at most one" per tagId, not globally.
  insParent.run(alice2, touhou, 1);
  ok(true, 'a different tag gets its own display-parent slot');
  passed++;

  sqlite.close();
}

// --- FK cascade: deleting a post drops its media/post_tags/folder_items ------

{
  const { sqlite } = openDatabase(mkdb());
  sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('cap-1', '2026-01-01', '2026-01-01')").run();
  sqlite.prepare("INSERT INTO media (postId, seq, file) VALUES ('cap-1', 0, 'cap-1-media-0.jpg')").run();
  const tagId = sqlite.prepare('INSERT INTO tags (name) VALUES (?)').run('タグ').lastInsertRowid;
  sqlite.prepare('INSERT INTO post_tags (postId, tagId) VALUES (?,?)').run('cap-1', tagId);
  sqlite.prepare("INSERT INTO folders (id, name) VALUES ('f1', 'フォルダ')").run();
  sqlite.prepare("INSERT INTO folder_items (folderId, postId) VALUES ('f1', 'cap-1')").run();

  sqlite.prepare("DELETE FROM posts WHERE captureId = 'cap-1'").run();

  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM media').get().n, 0, 'media cascades on post delete');
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM post_tags').get().n, 0, 'post_tags cascades on post delete');
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM folder_items').get().n, 0, 'folder_items cascades on post delete');
  // The tag itself is untouched — only the junction row referencing the deleted post is gone.
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM tags').get().n, 1, 'the tag survives (only membership is scoped to the post)');
  passed += 4;

  sqlite.close();
}

// --- folders: kind stays a closed pair; parentId is the nesting edge (#41) ---

{
  const { sqlite } = openDatabase(mkdb());
  assert.throws(() => sqlite.prepare("INSERT INTO folders (id, name, kind) VALUES ('f1', 'x', 'nested')").run(), /CHECK constraint failed/, 'kind is constrained to static/dynamic — nesting is parentId, not another kind');
  sqlite.prepare("INSERT INTO folders (id, name) VALUES ('parent', 'Parent')").run();
  sqlite.prepare("INSERT INTO folders (id, name, parentId) VALUES ('child', 'Child', 'parent')").run();
  assert.strictEqual(sqlite.prepare("SELECT parentId FROM folders WHERE id = 'child'").get().parentId, 'parent', 'parentId persists the flat tree edge');
  sqlite.prepare("DELETE FROM folders WHERE id = 'parent'").run();
  assert.strictEqual(sqlite.prepare("SELECT COUNT(*) AS n FROM folders WHERE id = 'child'").get().n, 0, 'deleting a parent cascades to its subtree');
  passed += 3;
  sqlite.close();
}

// --- posts.assetClass is intentionally UNCONSTRAINED (extensibility, #5 2026-07-19) --

{
  const { sqlite } = openDatabase(mkdb());
  sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt, assetClass) VALUES ('cap-1', '2026-01-01', '2026-01-01', 'link')").run();
  const row = sqlite.prepare("SELECT assetClass FROM posts WHERE captureId = 'cap-1'").get();
  assert.strictEqual(row.assetClass, 'link', 'a value outside the current media|file pair is accepted — no CHECK enum to re-migrate past');
  passed++;

  sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('cap-2', '2026-01-01', '2026-01-01')").run();
  assert.strictEqual(sqlite.prepare("SELECT assetClass FROM posts WHERE captureId = 'cap-2'").get().assetClass, 'media', "assetClass defaults to 'media' when omitted");
  passed++;

  sqlite.close();
}

// --- reopening an existing v1 database is a no-op, not a re-run --------------

{
  const file = mkdb();
  const first = openDatabase(file);
  first.sqlite.prepare("INSERT INTO tags (name) VALUES ('x')").run();
  first.sqlite.close();

  const second = openDatabase(file);
  assert.strictEqual(second.sqlite.pragma('user_version', { simple: true }), 6, 'reopen does not re-run the migrations');
  ok(second.sqlite.prepare("SELECT name FROM tags WHERE name = 'x'").get(), 'data from the first session survives reopen');
  passed += 2;
  second.sqlite.close();
}

// --- Kysely's typed Schema matches the real table/column names ---------------

{
  const { db, sqlite } = openDatabase(mkdb());
  (async () => {
    await db.insertInto('tags').values({ name: 'タイプチェック用' }).execute();
    const row = await db.selectFrom('tags').select(['id', 'name', 'kind', 'reading']).executeTakeFirst();
    ok(row && row.name === 'タイプチェック用', 'the typed Kysely Schema resolves against the real DDL (a table/column name typo here fails at compile time, not just at runtime)');
    passed++;
    sqlite.close();

    for (const d of dirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch (e) {
        /* best-effort cleanup */
      }
    }
    console.log(`PASS test-db-schema: ${passed} assertions`);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
