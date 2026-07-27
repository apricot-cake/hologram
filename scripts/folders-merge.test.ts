// app/src/main/lib-archive.ts のフォルダストア合流層のユニットテスト:
//  - mergeFolders: items は id で和集合／name・kind・created・tree はローカル優先／
//    activeId は有効な限りローカルのまま
//  - mergePosterFolders: 素の { folders:[{id,name,items}] } の id 和集合（投稿者フォルダ）
//  - mergeManualGroups: メンバーの union-find
//  - importCompleteZip: folders.json 入り ZIP がローカルの folders.json へ合流する
//    （項目を落とさず、名前はローカル優先）

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { importCompleteZip, mergeFolders, mergeManualGroups, mergePosterFolders } from '../app/src/main/lib-archive';

const roots: string[] = [];
function freshLib(prefix: string, folders: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  const dest = path.join(root, 'lib');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'folders.json'), JSON.stringify(folders));
  return dest;
}

afterAll(() => {
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

  // ツリー上の置き場所はローカルの整理なので、別マシンの ZIP が違う親を名乗っても動かない（#41）
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

describe('importCompleteZip: folders.json の合流', () => {
  let col: any;

  beforeAll(async () => {
    const dest = freshLib('hologram-foldmerge-', {
      folders: [{ id: 'c-local', name: 'Local', kind: 'static', created: null, items: ['x'] }],
      activeId: 'c-local',
    });

    const zip = new JSZip();
    zip.file('library/capY.jpg', Buffer.from('JPEGY'));
    // ZIP 側は kind を持たない素のフォルダ＝ストア側の合流が static を補う
    zip.file('library/folders.json', JSON.stringify({ folders: [{ id: 'f-imp', name: 'Imported', items: ['y'] }] }));
    await importCompleteZip(JSZip, dest, await zip.generateAsync({ type: 'nodebuffer' }));

    col = JSON.parse(fs.readFileSync(path.join(dest, 'folders.json'), 'utf8'));
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

describe('importCompleteZip: 同じ id での名前ローカル優先・items 和集合', () => {
  let col: any;

  beforeAll(async () => {
    const dest = freshLib('hologram-foldmerge2-', {
      folders: [{ id: 'c1', name: 'L', kind: 'static', created: null, items: ['a'] }],
      activeId: null,
    });

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
    await importCompleteZip(JSZip, dest, await zip.generateAsync({ type: 'nodebuffer' }));

    col = JSON.parse(fs.readFileSync(path.join(dest, 'folders.json'), 'utf8'));
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

// 不変条件＝1つの captureId は1グループ。交差するグループは畳まなければならない＝
// 素の重複排除だと [A,B] と [B,C] が両方残り、B が2グループに属してしまう（BACKLOG L4）
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

  // ローカルの [a,b]+[c,d] を、取り込み側の [b,c] が橋渡しして4件がつながる
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

// unionById を土台にした合流の契約（リファクタのガード）
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
