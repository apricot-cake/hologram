'use strict';

// Unit tests for the collections merge layer in app/lib-archive.js:
//  - mergeCollections: id-union on items; name/kind/created/tree local-wins;
//    activeId stays local-if-valid; posterWorkspace union
//  - foldersToCollections: legacy folders → static collections; workspace dropped
//  - importCompleteZip: a legacy folders.json ZIP folds into collections.json (no
//    folders.json resurrected, no item loss); a collections.json ZIP merges in
//
//   node scripts/test-collections-merge.cts

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { importCompleteZip, mergeCollections, foldersToCollections, mergeManualGroups, mergeFolders, mergeTagGroups } = require('../app/lib-archive.mts');

(async () => {
  // --- mergeCollections (pure) ---
  {
    const cur = {
      collections: [
        { id: 'f-1', name: 'Local', kind: 'static', created: null, items: ['a', 'b'] },
        { id: 'c-x', name: 'WS', kind: 'static', created: 1, items: ['z'] },
        { id: 'd-1', name: 'Saved', kind: 'dynamic', created: 2, items: [], tree: { kind: 'group', op: 'and', children: [] } },
      ],
      activeId: 'c-x',
      posterWorkspace: ['p1'],
    };
    const inc = {
      collections: [
        { id: 'f-1', name: 'Remote', kind: 'static', created: null, items: ['b', 'c'] },
        { id: 'f-2', name: 'New', kind: 'static', created: null, items: ['d'] },
      ],
      activeId: 'f-2',
      posterWorkspace: ['p2'],
    };
    const m = mergeCollections(cur, inc);
    const f1 = m.collections.find((c) => c.id === 'f-1');
    assert.strictEqual(f1.name, 'Local', 'name local-wins on same id');
    assert.deepStrictEqual(f1.items.slice().sort(), ['a', 'b', 'c'], 'items union on same id');
    assert.ok(
      m.collections.find((c) => c.id === 'f-2'),
      'new incoming id added',
    );
    assert.strictEqual(m.activeId, 'c-x', 'activeId stays local when still valid');
    assert.deepStrictEqual(m.posterWorkspace.slice().sort(), ['p1', 'p2'], 'posterWorkspace union');
    const d1 = m.collections.find((c) => c.id === 'd-1');
    assert.ok(d1 && d1.kind === 'dynamic' && d1.tree, 'dynamic kind + tree passthrough');
    // invalid activeId on both → null
    const m2 = mergeCollections({ collections: [], activeId: 'gone', posterWorkspace: [] }, { collections: [{ id: 'f-3', name: 'X', items: [] }], activeId: 'nope', posterWorkspace: [] });
    assert.strictEqual(m2.activeId, null, 'invalid activeId → null');
    // incoming activeId adopted only if local is null and it exists
    const m3 = mergeCollections({ collections: [], activeId: null, posterWorkspace: [] }, { collections: [{ id: 'f-9', name: 'Y', items: [] }], activeId: 'f-9', posterWorkspace: [] });
    assert.strictEqual(m3.activeId, 'f-9', 'incoming activeId adopted when local null + valid');
    console.log('PASS mergeCollections');
  }

  // --- foldersToCollections (pure) ---
  {
    const conv = foldersToCollections({ folders: [{ id: 'f-9', name: 'Old', items: ['x', 'x', 'y'] }], workspace: ['w1'], posterWorkspace: ['p9'] });
    assert.deepStrictEqual(conv.collections, [{ id: 'f-9', name: 'Old', kind: 'static', created: null, items: ['x', 'y'] }], 'folders → static collection (deduped)');
    assert.strictEqual(conv.activeId, null, 'no active from a folded import');
    assert.ok(JSON.stringify(conv).indexOf('w1') < 0, 'imported workspace is dropped');
    assert.deepStrictEqual(conv.posterWorkspace, ['p9'], 'posterWorkspace kept');
    console.log('PASS foldersToCollections');
  }

  // --- importCompleteZip: legacy folders.json folds into an existing collections.json ---
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-colmerge-'));
    const dest = path.join(root, 'lib');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, 'collections.json'),
      JSON.stringify({
        collections: [{ id: 'c-local', name: 'Local WS', kind: 'static', created: null, items: ['x'] }],
        activeId: 'c-local',
        posterWorkspace: ['p-local'],
      }),
    );
    const zip = new JSZip();
    zip.file('library/capY.jpg', Buffer.from('JPEGY'));
    zip.file('library/folders.json', JSON.stringify({ folders: [{ id: 'f-imp', name: 'Imported', items: ['y'] }], workspace: ['ignored'], posterWorkspace: ['p-imp'] }));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await importCompleteZip(JSZip, dest, buf);

    const col = JSON.parse(fs.readFileSync(path.join(dest, 'collections.json'), 'utf8'));
    assert.ok(
      col.collections.find((c) => c.id === 'c-local'),
      'local collection kept',
    );
    assert.ok(
      col.collections.find((c) => c.id === 'f-imp'),
      'imported folder folded in as collection',
    );
    assert.strictEqual(col.activeId, 'c-local', 'local activeId preserved');
    assert.deepStrictEqual(col.posterWorkspace.slice().sort(), ['p-imp', 'p-local'], 'posterWorkspace union on fold-in');
    assert.ok(!fs.existsSync(path.join(dest, 'folders.json')), 'no folders.json resurrected');
    assert.ok(JSON.stringify(col).indexOf('ignored') < 0, 'imported workspace not adopted');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('PASS import: legacy folders.json fold-in');
  }

  // --- importCompleteZip: a collections.json ZIP merges into the local one ---
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-colmerge2-'));
    const dest = path.join(root, 'lib');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, 'collections.json'),
      JSON.stringify({
        collections: [{ id: 'c1', name: 'L', kind: 'static', created: null, items: ['a'] }],
        activeId: null,
        posterWorkspace: [],
      }),
    );
    const zip = new JSZip();
    zip.file(
      'library/collections.json',
      JSON.stringify({
        collections: [
          { id: 'c1', name: 'R', kind: 'static', created: null, items: ['b'] },
          { id: 'c2', name: 'New', kind: 'static', created: null, items: ['c'] },
        ],
        activeId: 'c2',
        posterWorkspace: ['pp'],
      }),
    );
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await importCompleteZip(JSZip, dest, buf);

    const col = JSON.parse(fs.readFileSync(path.join(dest, 'collections.json'), 'utf8'));
    const c1 = col.collections.find((c) => c.id === 'c1');
    assert.strictEqual(c1.name, 'L', 'name local-wins');
    assert.deepStrictEqual(c1.items.slice().sort(), ['a', 'b'], 'items union');
    assert.ok(
      col.collections.find((c) => c.id === 'c2'),
      'new collection added',
    );
    assert.strictEqual(col.activeId, 'c2', 'incoming activeId adopted (local was null)');
    assert.deepStrictEqual(col.posterWorkspace, ['pp'], 'posterWorkspace union');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('PASS import: collections.json merge');
  }

  // --- mergeManualGroups (pure): union-find over members (BACKLOG L4) ---
  // Invariant = ONE group per captureId, so intersecting groups must collapse:
  // plain dedup would keep [A,B] and [B,C] both, leaving B in two groups.
  {
    const m = mergeManualGroups(
      {
        groups: [
          ['a', 'b'],
          ['x', 'y'],
        ],
      },
      {
        groups: [
          ['b', 'c'],
          ['p', 'q'],
        ],
      },
    );
    const sorted = m.groups.map((g) => g.slice().sort().join(','));
    assert.ok(sorted.includes('a,b,c'), 'intersecting groups collapse transitively, got ' + JSON.stringify(m.groups));
    assert.ok(sorted.includes('x,y') && sorted.includes('p,q'), 'disjoint groups survive untouched');
    assert.strictEqual(m.groups.length, 3, 'no duplicate/leftover groups');
    // Chain through a third group: [a,b]+[c,d] locally, [b,c] incoming bridges all four.
    const chain = mergeManualGroups(
      {
        groups: [
          ['a', 'b'],
          ['c', 'd'],
        ],
      },
      { groups: [['b', 'c']] },
    );
    assert.strictEqual(chain.groups.length, 1, 'bridge group unifies the chain');
    assert.deepStrictEqual(chain.groups[0].slice().sort(), ['a', 'b', 'c', 'd'], 'chained union complete');
    // Identical groups still dedup; degenerate [A,A] never yields a singleton.
    const dup = mergeManualGroups(
      { groups: [['a', 'b']] },
      {
        groups: [
          ['b', 'a'],
          ['z', 'z'],
        ],
      },
    );
    assert.strictEqual(dup.groups.length, 1, 'same set (any order) dedups; [z,z] singleton dropped');
    console.log('PASS mergeManualGroups union-find');
  }

  // --- unionById-backed mergers keep their contract (refactor guard) ---
  {
    const f = mergeFolders(
      { folders: [{ id: 'f1', name: 'Local', items: ['a'] }], defaultId: 'f1' },
      {
        folders: [
          { id: 'f1', name: 'Remote', items: ['b'] },
          { id: 'f2', name: 'N', items: [] },
        ],
        defaultId: 'f2',
      },
    );
    const f1 = f.folders.find((x) => x.id === 'f1');
    assert.strictEqual(f1.name, 'Local', 'folder name local-wins');
    assert.deepStrictEqual(f1.items.slice().sort(), ['a', 'b'], 'folder items union');
    assert.strictEqual(f.defaultId, 'f1', 'defaultId local-wins while alive');
    const g = mergeTagGroups({ groups: [{ id: 'g1', name: 'L', tags: ['t1'] }] }, { groups: [{ id: 'g1', name: 'R', tags: ['t2'] }] });
    assert.deepStrictEqual(g.groups[0].tags.slice().sort(), ['t1', 't2'], 'tag-group tags union');
    assert.strictEqual(g.groups[0].name, 'L', 'tag-group name local-wins');
    console.log('PASS unionById mergers');
  }

  console.log('MERGE_TEST_PASS');
})().catch((e) => {
  console.error('MERGE_TEST_FAIL:', e && e.message ? e.message : e);
  process.exit(1);
});
