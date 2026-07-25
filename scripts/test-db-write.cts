'use strict';

// DB-owned organization writes for #298/St5. Verify the replacement operations
// round-trip without touching any sidecar or organization JSON file.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../app/lib-db.mts');
const { createDbWriter } = require('../app/lib-db-write.mts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-db-write-'));
const { sqlite } = openDatabase(path.join(dir, 'test.db'));
const writer = createDbWriter(sqlite);

try {
  sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('post-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'), ('post-2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();

  writer.setTagTypes({ alice: 'character' }, { character: 'Character' });
  assert.deepStrictEqual(writer.getTagTypes(), { types: { alice: 'character' }, labels: { character: 'Character' } });

  writer.setFolders({
    folders: [{ id: 'folder-1', name: 'Favorites', kind: 'static', created: 1, items: ['post-1', 'missing'] }],
    activeId: 'folder-1',
  });
  assert.deepStrictEqual(writer.getFolders(), {
    folders: [{ id: 'folder-1', name: 'Favorites', kind: 'static', created: 1, items: ['post-1'] }],
    activeId: 'folder-1',
  });

  writer.setManualGroups([
    ['post-1', 'missing'],
    ['post-1', 'post-2'],
  ]);
  assert.deepStrictEqual(writer.getManualGroups(), { groups: [['post-1', 'post-2']] });

  writer.setTabs({
    activeTabId: 'tab-2',
    tabs: [
      { id: 'tab-1', pinned: false, title: null, state: {} },
      { id: 'tab-2', pinned: true, title: 'Saved', state: { tree: null } },
    ],
  });
  assert.deepStrictEqual(writer.getTabs(), {
    activeTabId: 'tab-2',
    tabs: [
      { id: 'tab-1', pinned: false, title: null, state: {} },
      { id: 'tab-2', pinned: true, title: 'Saved', state: { tree: null } },
    ],
  });

  writer.stateSet('truthSource', 'db');
  assert.strictEqual(writer.stateGet('truthSource'), 'db');
  console.log('PASS test-db-write');
} finally {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
