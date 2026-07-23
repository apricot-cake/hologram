'use strict';

// Unit tests for the folder-store merge layer in app/lib-archive.mts:
//  - mergeFolders: id-union on items; name/kind/created/tree local-wins;
//    activeId stays local-if-valid; clip + posterWorkspace union
//  - mergePosterFolders: plain { folders:[{id,name,items}] } id-union (poster folders)
//  - importCompleteZip: a folders.json ZIP merges into the local folders.json (no
//    item loss, name local-wins)
//
//   node scripts/test-folders-merge.cts

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { importCompleteZip, mergeFolders, mergePosterFolders, mergeManualGroups } = require('../app/lib-archive.mts');

(async () => {
  // --- mergeFolders (pure) ---
  {
    const cur = {
      folders: [
        { id: 'f-1', name: 'Local', kind: 'static', created: null, items: ['a', 'b'] },
        { id: 'c-x', name: 'WS', kind: 'static', created: 1, items: ['z'] },
        { id: 'd-1', name: 'Saved', kind: 'dynamic', created: 2, items: [], tree: { kind: 'group', op: 'and', children: [] } },
      ],
      activeId: 'c-x',
      clip: ['k1'],
      posterWorkspace: ['p1'],
    };
    const inc = {
      folders: [
        { id: 'f-1', name: 'Remote', kind: 'static', created: null, items: ['b', 'c'] },
        { id: 'f-2', name: 'New', kind: 'static', created: null, items: ['d'] },
      ],
      activeId: 'f-2',
      clip: ['k2'],
      posterWorkspace: ['p2'],
    };
    const m = mergeFolders(cur, inc);
    const f1 = m.folders.find((c) => c.id === 'f-1');
    assert.strictEqual(f1.name, 'Local', 'name local-wins on same id');
    assert.deepStrictEqual(f1.items.slice().sort(), ['a', 'b', 'c'], 'items union on same id');
    assert.ok(
      m.folders.find((c) => c.id === 'f-2'),
      'new incoming id added',
    );
    assert.strictEqual(m.activeId, 'c-x', 'activeId stays local when still valid');
    assert.deepStrictEqual(m.clip.slice().sort(), ['k1', 'k2'], 'clip union');
    assert.deepStrictEqual(m.posterWorkspace.slice().sort(), ['p1', 'p2'], 'posterWorkspace union');
    const d1 = m.folders.find((c) => c.id === 'd-1');
    assert.ok(d1 && d1.kind === 'dynamic' && d1.tree, 'dynamic kind + tree passthrough');
    // invalid activeId on both → null
    const m2 = mergeFolders({ folders: [], activeId: 'gone', posterWorkspace: [] }, { folders: [{ id: 'f-3', name: 'X', items: [] }], activeId: 'nope', posterWorkspace: [] });
    assert.strictEqual(m2.activeId, null, 'invalid activeId → null');
    // incoming activeId adopted only if local is null and it exists
    const m3 = mergeFolders({ folders: [], activeId: null, posterWorkspace: [] }, { folders: [{ id: 'f-9', name: 'Y', items: [] }], activeId: 'f-9', posterWorkspace: [] });
    assert.strictEqual(m3.activeId, 'f-9', 'incoming activeId adopted when local null + valid');
    console.log('PASS mergeFolders');
  }

  // --- importCompleteZip: a folders.json ZIP merges into the local folders.json ---
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-foldmerge-'));
    const dest = path.join(root, 'lib');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, 'folders.json'),
      JSON.stringify({
        folders: [{ id: 'c-local', name: 'Local', kind: 'static', created: null, items: ['x'] }],
        activeId: 'c-local',
        clip: ['clip-local'],
        posterWorkspace: ['p-local'],
      }),
    );
    const zip = new JSZip();
    zip.file('library/capY.jpg', Buffer.from('JPEGY'));
    // The ZIP entry carries a plain (kind-less) folder — the store merger fills in static.
    zip.file('library/folders.json', JSON.stringify({ folders: [{ id: 'f-imp', name: 'Imported', items: ['y'] }], clip: ['clip-imp'], posterWorkspace: ['p-imp'] }));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await importCompleteZip(JSZip, dest, buf);

    const col = JSON.parse(fs.readFileSync(path.join(dest, 'folders.json'), 'utf8'));
    assert.ok(
      col.folders.find((c) => c.id === 'c-local'),
      'local folder kept',
    );
    const imp = col.folders.find((c) => c.id === 'f-imp');
    assert.ok(imp, 'imported folder folded in');
    assert.strictEqual(imp.kind, 'static', 'kind-less imported folder defaults to static');
    assert.strictEqual(col.activeId, 'c-local', 'local activeId preserved');
    assert.deepStrictEqual(col.clip.slice().sort(), ['clip-imp', 'clip-local'], 'clip union on merge');
    assert.deepStrictEqual(col.posterWorkspace.slice().sort(), ['p-imp', 'p-local'], 'posterWorkspace union on merge');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('PASS import: folders.json merge');
  }

  // --- importCompleteZip: name local-wins, items union across the same id ---
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-foldmerge2-'));
    const dest = path.join(root, 'lib');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, 'folders.json'),
      JSON.stringify({
        folders: [{ id: 'c1', name: 'L', kind: 'static', created: null, items: ['a'] }],
        activeId: null,
        clip: [],
        posterWorkspace: [],
      }),
    );
    const zip = new JSZip();
    zip.file(
      'library/folders.json',
      JSON.stringify({
        folders: [
          { id: 'c1', name: 'R', kind: 'static', created: null, items: ['b'] },
          { id: 'c2', name: 'New', kind: 'static', created: null, items: ['c'] },
        ],
        activeId: 'c2',
        clip: [],
        posterWorkspace: ['pp'],
      }),
    );
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await importCompleteZip(JSZip, dest, buf);

    const col = JSON.parse(fs.readFileSync(path.join(dest, 'folders.json'), 'utf8'));
    const c1 = col.folders.find((c) => c.id === 'c1');
    assert.strictEqual(c1.name, 'L', 'name local-wins');
    assert.deepStrictEqual(c1.items.slice().sort(), ['a', 'b'], 'items union');
    assert.ok(
      col.folders.find((c) => c.id === 'c2'),
      'new folder added',
    );
    assert.strictEqual(col.activeId, 'c2', 'incoming activeId adopted (local was null)');
    assert.deepStrictEqual(col.posterWorkspace, ['pp'], 'posterWorkspace union');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('PASS import: folders.json id-union');
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
    const f = mergePosterFolders(
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
    assert.strictEqual(f1.name, 'Local', 'poster folder name local-wins');
    assert.deepStrictEqual(f1.items.slice().sort(), ['a', 'b'], 'poster folder items union');
    assert.strictEqual(f.defaultId, 'f1', 'defaultId local-wins while alive');
    console.log('PASS unionById mergers');
  }

  console.log('MERGE_TEST_PASS');
})().catch((e) => {
  console.error('MERGE_TEST_FAIL:', e && e.message ? e.message : e);
  process.exit(1);
});
