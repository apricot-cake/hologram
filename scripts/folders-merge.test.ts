// Unit tests for the folder store merge layer in app/src/main/lib-archive.ts:
//  - mergeFolders: items are unioned by id / name, kind, created, and tree prefer local /
//    activeId stays local as long as it's still valid
//  - mergePosterFolders: id union of the plain { folders:[{id,name,items}] } shape (poster folders)
//  - mergeManualGroups: union-find over members
//  - Complete ZIP import: a ZIP containing folders.json merges into the library's folder layer (DB)
//    (no items are dropped, names prefer local)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { importCompleteZipToDb, mergeFolders, mergeManualGroups, mergePosterFolders } from '../app/src/main/lib-archive';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';

// importCompleteZipToDb takes a PATH (#485 — main opens it with yauzl). JSZip is only used
// on the side that builds the fixture.
let zipSeq = 0;
async function zipToFile(zip: JSZip, near: string) {
  const p = path.join(path.dirname(near), `fixture-${zipSeq++}.zip`);
  fs.writeFileSync(p, Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })));
  return p;
}

const roots: string[] = [];
const handles: any[] = [];
// The library's "current folder layer" lives on the DB side (no folders.json on disk since #302).
function freshLib(prefix: string, folders: unknown, memberIds: string[] = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  const dest = path.join(root, 'lib');
  fs.mkdirSync(dest, { recursive: true });
  const handle = openDatabase(path.join(root, 'test.db'));
  handles.push(handle);
  // folder_items is a foreign key into posts = a captureId with no row gets dropped. Since we
  // want to test the union of folder membership, pre-create the posts the test uses.
  const stmts = preparePostStmts(handle.sqlite);
  const resolveTagId = makeTagResolver(handle.sqlite);
  for (const captureId of memberIds) writePost(stmts, resolveTagId, { captureId, capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } as any);
  createDbWriter(handle.sqlite).setFolders(folders);
  return { dest, sqlite: handle.sqlite };
}

afterAll(() => {
  for (const h of handles) h.sqlite.close();
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

describe('mergeFolders（純関数）', () => {
  const merged = mergeFolders(
    {
      folders: [
        { id: 'f-1', name: 'Local', kind: 'static', created: null, parentId: 'c-x', items: ['a', 'b'] },
        { id: 'c-x', name: 'WS', kind: 'static', created: 1, items: ['z'] },
        { id: 'd-1', name: 'Saved', kind: 'dynamic', created: 2, items: [], tree: { kind: 'group', op: 'and', children: [] } },
      ],
      activeId: 'c-x',
    },
    {
      folders: [
        { id: 'f-1', name: 'Remote', kind: 'static', created: null, parentId: 'f-2', items: ['b', 'c'] },
        { id: 'f-2', name: 'New', kind: 'static', created: null, items: ['d'] },
      ],
      activeId: 'f-2',
    },
  );
  const byId = (id: string) => merged.folders.find((c: any) => c.id === id);

  test('同じ id では名前はローカルが勝つ', () => {
    expect(byId('f-1').name).toBe('Local');
  });

  test('同じ id では items が和集合になる', () => {
    expect(byId('f-1').items.slice().sort()).toEqual(['a', 'b', 'c']);
  });

  test('取り込み側の新しい id は足される', () => {
    expect(byId('f-2')).toBeTruthy();
  });

  test('activeId は有効な限りローカルのまま', () => {
    expect(merged.activeId).toBe('c-x');
  });

  // Placement in the tree is a local arrangement, so a ZIP from another machine claiming a different parent has no effect (#41)
  test('parentId はローカルが勝ち、取り込み側のルートはルートのまま', () => {
    expect(byId('f-1').parentId).toBe('c-x');
    expect(byId('f-2').parentId).toBeNull();
  });

  test('dynamic の kind と tree はそのまま通る', () => {
    expect(byId('d-1')).toMatchObject({ kind: 'dynamic' });
    expect(byId('d-1').tree).toBeTruthy();
  });

  test('どちらの activeId も無効なら null', () => {
    expect(mergeFolders({ folders: [], activeId: 'gone' }, { folders: [{ id: 'f-3', name: 'X', items: [] }], activeId: 'nope' }).activeId).toBeNull();
  });

  test('ローカルが null で取り込み側が有効なときだけ、取り込み側の activeId を採る', () => {
    expect(mergeFolders({ folders: [], activeId: null }, { folders: [{ id: 'f-9', name: 'Y', items: [] }], activeId: 'f-9' }).activeId).toBe('f-9');
  });
});

describe('完全ZIPの取り込み: folders.json の合流', () => {
  let col: any;

  beforeAll(async () => {
    const { dest, sqlite } = freshLib('hologram-foldmerge-', {
      folders: [{ id: 'c-local', name: 'Local', kind: 'static', created: null, items: ['x'] }],
      activeId: 'c-local',
    });

    const zip = new JSZip();
    zip.file('library/capY.jpg', Buffer.from('JPEGY'));
    // The ZIP side has plain folders with no kind = the store's merge fills in static
    zip.file('library/folders.json', JSON.stringify({ folders: [{ id: 'f-imp', name: 'Imported', items: ['y'] }] }));
    await importCompleteZipToDb(sqlite, await zipToFile(zip, dest), dest);

    col = createDbWriter(sqlite).getFolders();
  });

  test('ローカルのフォルダが残る', () => {
    expect(col.folders.find((c: any) => c.id === 'c-local')).toBeTruthy();
  });

  test('取り込んだフォルダが畳み込まれ、kind 無しは static になる', () => {
    expect(col.folders.find((c: any) => c.id === 'f-imp')).toMatchObject({ kind: 'static' });
  });

  test('ローカルの activeId が保たれる', () => {
    expect(col.activeId).toBe('c-local');
  });
});

describe('完全ZIPの取り込み: 同じ id での名前ローカル優先・items 和集合', () => {
  let col: any;

  beforeAll(async () => {
    const { dest, sqlite } = freshLib(
      'hologram-foldmerge2-',
      {
        folders: [{ id: 'c1', name: 'L', kind: 'static', created: null, items: ['a'] }],
        activeId: null,
      },
      ['a', 'b', 'c'],
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
      }),
    );
    await importCompleteZipToDb(sqlite, await zipToFile(zip, dest), dest);

    col = createDbWriter(sqlite).getFolders();
  });

  test('名前はローカルが勝ち、items は和集合', () => {
    const c1 = col.folders.find((c: any) => c.id === 'c1');
    expect(c1.name).toBe('L');
    expect(c1.items.slice().sort()).toEqual(['a', 'b']);
  });

  test('新しいフォルダが足される', () => {
    expect(col.folders.find((c: any) => c.id === 'c2')).toBeTruthy();
  });

  test('ローカルが null だったので取り込み側の activeId を採る', () => {
    expect(col.activeId).toBe('c2');
  });
});

// Invariant: one captureId belongs to one group. Intersecting groups must be collapsed = with
// plain dedup, [A,B] and [B,C] would both remain, leaving B in two groups (BACKLOG L4)
describe('mergeManualGroups（union-find）', () => {
  test('交差するグループは推移的に畳まれ、交わらないグループはそのまま', () => {
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

    expect(m.groups.map((g: string[]) => g.slice().sort().join(',')).sort()).toEqual(['a,b,c', 'p,q', 'x,y']);
  });

  // Local's [a,b]+[c,d] get bridged by the incoming side's [b,c], linking all 4 members together
  test('橋渡しのグループが連鎖を1つにまとめる', () => {
    const chain = mergeManualGroups(
      {
        groups: [
          ['a', 'b'],
          ['c', 'd'],
        ],
      },
      { groups: [['b', 'c']] },
    );

    expect(chain.groups).toHaveLength(1);
    expect(chain.groups[0].slice().sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('同じ集合は順序が違っても重複排除され、[z,z] のような単元は落ちる', () => {
    const dup = mergeManualGroups(
      { groups: [['a', 'b']] },
      {
        groups: [
          ['b', 'a'],
          ['z', 'z'],
        ],
      },
    );

    expect(dup.groups).toHaveLength(1);
  });
});

// The merge contract built on top of unionById (a guard against refactors)
describe('mergePosterFolders', () => {
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

  test('名前はローカルが勝ち、items は和集合', () => {
    const f1 = f.folders.find((x: any) => x.id === 'f1');
    expect(f1.name).toBe('Local');
    expect(f1.items.slice().sort()).toEqual(['a', 'b']);
  });

  test('defaultId は生きている限りローカルが勝つ', () => {
    expect(f.defaultId).toBe('f1');
  });
});
