// フォルダの階層 (#41) のロジックの単体テスト。2つの層を直に見る:
//  - app/src/main/lib-folder-tree.ts ... 読み込み時の形の正規化と親エッジの修復
//    （孤児の昇格・自分を親に指すもの・循環の切断・保存した検索は入れ子にしない）
//  - app/src/renderer/src/services/folders.ts ... 派生した木の意味論
//    （子孫を含む所属・「このフォルダのみ」・連鎖削除と葉の掃除・移動の防ぎ）
// どちらも DOM も Electron も要らない純粋なロジックの層。UI（サイドバーの木と DnD）の方は、
// 実アプリのスイート test-app-folders が覆う。
//
// レンダラー側のストアのテストは、1つのストアを順に育てていくので、宣言の順序に意味がある。

import { beforeAll, describe, expect, test } from 'vitest';
import { normFolders, repairParents } from './lib-folder-tree';

// folders.ts は変更のたびに preload のブリッジ越しに永続化する。差し替えの受け手はその代役で、
// 同時に「ストアが書き出す形にいまも parentId が乗っているか」の検査も兼ねる＝この欄は往復の
// ために3か所へ書かれる必要があり、どこかで落ちるとフォルダは黙ってルートへ戻る。
let lastWritten: any = null;
let F: any;

beforeAll(async () => {
  (globalThis as any).window = {
    hologram: {
      setFolders: async (data: any) => {
        lastWritten = data;
        return { ok: true };
      },
    },
  };
  F = await import('../renderer/src/services/folders');
});

describe('normFolders: 形の正規化と親エッジの修復（読み込み時）', () => {
  const out = normFolders([
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B', parentId: 'a' },
    { id: 'c', name: 'C', parentId: 'b' },
    { id: 'orphan', name: 'O', parentId: 'ghost' },
    { id: 'self', name: 'S', parentId: 'self' },
    { id: 'saved', name: 'Q', kind: 'dynamic', parentId: 'a', tree: { kind: 'group', op: 'and', children: [] } },
  ]);
  const by = new Map(out.map((f: any) => [f.id, f]));

  test('親子の連鎖はそのまま残る', () => {
    expect(by.get('b').parentId).toBe('a');
    expect(by.get('c').parentId).toBe('b');
  });

  test('parentId 不在はルート（null）', () => {
    expect(by.get('a').parentId).toBeNull();
  });

  test('実在しない親を指すものはルートへ昇格', () => {
    expect(by.get('orphan').parentId).toBeNull();
  });

  test('自分自身を親に指すものはルートへ昇格', () => {
    expect(by.get('self').parentId).toBeNull();
  });

  test('修復してもフォルダ自体は消えない', () => {
    expect(out).toHaveLength(6);
  });
});

// 循環は「戻ってきたエッジ」で切る。切ったあとは、どのフォルダもルートへ辿り着けなければ
// いけない＝このテストはその木であるという事実そのものを見る（どのエッジを切るかは実装に任せる）。
describe('normFolders: 循環の切断', () => {
  const out = normFolders([
    { id: 'x', name: 'X', parentId: 'z' },
    { id: 'y', name: 'Y', parentId: 'x' },
    { id: 'z', name: 'Z', parentId: 'y' },
  ]);
  const by = new Map(out.map((f: any) => [f.id, f]));

  test('全フォルダがルートへ辿り着く', () => {
    for (const f of out) {
      const seen = new Set([f.id]);
      let cur: any = f;
      while (cur.parentId != null) {
        expect(seen.has(cur.parentId)).toBe(false);
        seen.add(cur.parentId);
        cur = by.get(cur.parentId);
      }
    }
  });

  test('フォルダは失われない', () => {
    expect(out).toHaveLength(3);
  });
});

test('repairParents は長い親チェーンを線形時間で検査する', () => {
  let parentReads = 0;
  const folders = Array.from({ length: 1_000 }, (_, index) => {
    let parentId = index === 0 ? null : `folder-${index - 1}`;
    return {
      id: `folder-${index}`,
      name: `Folder ${index}`,
      kind: 'static' as const,
      created: null,
      items: [],
      get parentId() {
        parentReads += 1;
        return parentId;
      },
      set parentId(value: string | null) {
        parentId = value;
      },
    };
  });

  repairParents(folders);

  expect(folders.at(-1)?.parentId).toBe('folder-998');
  expect(parentReads).toBeLessThan(folders.length * 10);
});

// createFolder / removeFolder は本番の経路をそのまま通る。IPC が無ければ persist() は何もしない
// ので、実際に動くのはストアの中身だけ。
describe('派生ツリーの意味論（レンダラー側ストア）', () => {
  let parent: any;
  let child: any;
  let grand: any;
  let other: any;

  beforeAll(() => {
    parent = F.createFolder('親');
    child = F.createFolder('子', { parentId: parent.id });
    grand = F.createFolder('孫', { parentId: child.id });
    other = F.createFolder('別');
    F.byId(grand.id).items.push('cap-deep');
    F.byId(parent.id).items.push('cap-own');
  });

  test('子として作ったフォルダに親が付く', () => {
    expect(child.parentId).toBe(parent.id);
    expect(grand.parentId).toBe(child.id);
  });

  test('childrenOf は直下の子だけを返す', () => {
    expect(F.childrenOf(parent.id).map((f: any) => f.id)).toEqual([child.id]);
  });

  test('subtreeIds は自分＋全子孫', () => {
    expect(F.subtreeIds(parent.id).size).toBe(3);
    expect(F.subtreeIds(parent.id).has(grand.id)).toBe(true);
  });

  test('親は子孫の投稿を含む（集約が既定）', () => {
    expect(F.hasDeep(parent.id, 'cap-deep')).toBe(true);
  });

  test('「このフォルダのみ」は直下限定', () => {
    expect(F.hasDeep(parent.id, 'cap-deep', true)).toBe(false);
    expect(F.hasDeep(parent.id, 'cap-own', true)).toBe(true);
  });

  test('無関係なフォルダは巻き込まない', () => {
    expect(F.hasDeep(other.id, 'cap-deep')).toBe(false);
  });

  test('has は従来どおり直下だけを見る', () => {
    expect(F.has(parent.id, 'cap-deep')).toBe(false);
  });

  test('永続化されるデータに parentId が乗る', () => {
    expect(lastWritten.folders.find((f: any) => f.id === grand.id).parentId).toBe(child.id);
  });

  // 木の外でフォルダを並べる画面（カードの「フォルダに追加」・絞り込みの値の行）は、パスで同定する
  test('pathOf は祖先を辿ってパスにする', () => {
    expect(F.pathOf(grand.id)).toBe('親 / 子 / 孫');
    expect(F.pathOf(parent.id)).toBe('親');
  });

  // 移動の防ぎ。自分自身の下や自分の子孫の下へは移せない（ストア側も UI 側の無効化と同じ判定を
  // 持つ＝二重の防ぎ）
  describe('移動（reparentFolder）', () => {
    test('自分自身の下・自分の子孫の下へは移動できず、親も変わらない', () => {
      expect(F.reparentFolder(parent.id, parent.id)).toBe(false);
      expect(F.reparentFolder(parent.id, grand.id)).toBe(false);
      expect(F.byId(parent.id).parentId).toBeNull();
    });

    test('別の木の下へは移動でき、派生インデックスにも反映される', () => {
      expect(F.reparentFolder(other.id, child.id)).toBe(true);
      expect(F.byId(other.id).parentId).toBe(child.id);
      expect(F.childrenOf(child.id)).toHaveLength(2);
    });

    test('ルートへ戻せる', () => {
      expect(F.reparentFolder(other.id, null)).toBe(true);
      expect(F.byId(other.id).parentId).toBeNull();
    });
  });

  // 連鎖削除。子孫はまとめて消え、保存した検索に残る葉も一緒に掃除される
  // （葉が1つでも残ると、その保存した検索は以後ずっと黙って0件を返し続ける）
  describe('連鎖削除', () => {
    let gone: Set<string>;

    beforeAll(() => {
      gone = F.removeFolder(parent.id);
    });

    test('返り値は消えた id 全部（子孫ごと）', () => {
      expect(gone.size).toBe(3);
      expect(gone.has(grand.id)).toBe(true);
      expect(gone.has(child.id)).toBe(true);
    });

    test('子孫はストアから消えている', () => {
      expect(F.byId(grand.id)).toBeNull();
      expect(F.byId(child.id)).toBeNull();
    });

    test('巻き込まれていないフォルダは残る', () => {
      expect(F.byId(other.id)).not.toBeNull();
    });
  });
});

// 兄弟の順序は配列の順そのものなので、「A の手前」は結果の並びで確かめる
describe('ツリー DnD の着地（placeFolder）: 1ドロップ＝1書き込み', () => {
  let a: any;
  let b: any;
  let c: any;

  // 前のテストで作ったフォルダも同じルートに並ぶので、この3つだけを見る
  const rootOrder = () =>
    F.childrenOf(null)
      .map((f: any) => f.name)
      .filter((n: string) => 'ABC'.includes(n));

  beforeAll(() => {
    a = F.createFolder('A');
    b = F.createFolder('B');
    c = F.createFolder('C');
  });

  test('中央へのドロップ＝子にする', () => {
    expect(F.placeFolder(c.id, a.id, 'into')).toBe(true);
    expect(F.byId(c.id).parentId).toBe(a.id);
  });

  test('自分の子孫の下へは落とせない', () => {
    expect(F.placeFolder(a.id, c.id, 'into')).toBe(false);
    expect(F.byId(a.id).parentId).toBeNull();
  });

  test('同じ親への「子にする」は書き込まない', () => {
    expect(F.placeFolder(c.id, a.id, 'into')).toBe(false);
  });

  // 「隣に置く」は落とした先の親を引き継ぐ＝親の付け替えと並べ替えが同時に起きる
  test('行の上端へのドロップ＝その手前の兄弟になる', () => {
    expect(F.placeFolder(c.id, b.id, 'before')).toBe(true);
    expect(F.byId(c.id).parentId).toBeNull();
    expect(rootOrder()).toEqual(['A', 'C', 'B']);
  });

  test('行の下端へのドロップ＝その直後', () => {
    expect(F.placeFolder(c.id, b.id, 'after')).toBe(true);
    expect(rootOrder()).toEqual(['A', 'B', 'C']);
  });

  test('見出しへのドロップ＝ルートへ戻す', () => {
    F.placeFolder(b.id, a.id, 'into');
    expect(F.byId(b.id).parentId).toBe(a.id);

    expect(F.placeFolder(b.id, null, 'into')).toBe(true);
    expect(F.byId(b.id).parentId).toBeNull();
  });
});

describe('フォルダ索引: 深い経路と構造変更', () => {
  const folder = (id: string, name: string, parentId: string | null = null, items: string[] = []) => ({ id, name, parentId, items, kind: 'static' });

  test('安全な規模の深いチェーンを、根から葉の順の経路にする', () => {
    const store = F.createFolderStore({ idPrefix: 'test', persist: () => {}, isLibrary: true });
    const depth = 256;
    const chain = Array.from({ length: depth }, (_, i) => folder(`deep-${i}`, `階層${i}`, i ? `deep-${i - 1}` : null));
    store.setAll(chain);

    const path = store.pathOf(`deep-${depth - 1}`);
    expect(path.split(' / ')).toEqual(chain.map((f) => f.name));
  });

  test('ID 重複では従来どおり先の要素を返し、setAll 後は新しい索引になる', () => {
    const store = F.createFolderStore({ idPrefix: 'test', persist: () => {}, isLibrary: true });
    store.setAll([folder('same', '先'), folder('same', '後')]);
    expect(store.byId('same').name).toBe('先');

    store.setAll([folder('replacement', '入れ替え後')]);
    expect(store.byId('same')).toBeNull();
    expect(store.byId('replacement').name).toBe('入れ替え後');
  });

  test('create/remove/reparent/place/move 後も ID・子・経路の索引と意味論が同期する', () => {
    const store = F.createFolderStore({ idPrefix: 'test', persist: () => {}, isLibrary: true });
    store.setAll([folder('a', 'A', null, ['投稿-a']), folder('b', 'B'), folder('c', 'C', 'a', ['投稿-c'])]);
    // 先にすべての索引を作り、以後の各変更がキャッシュ済みの状態から始まるようにする。
    expect(store.pathOf('c')).toBe('A / C');
    expect(store.childrenOf(null).map((f: any) => f.id)).toEqual(['a', 'b']);

    const made = store.create('D', { parentId: 'a' });
    expect(store.byId(made.id)).toBe(made);
    expect(store.childrenOf('a').map((f: any) => f.id)).toEqual(['c', made.id]);

    expect(store.reparent('c', 'b')).toBe(true);
    expect(store.pathOf('c')).toBe('B / C');
    expect(store.hasDeep('a', '投稿-c')).toBe(false);
    expect(store.hasDeep('b', '投稿-c')).toBe(true);
    expect(store.hasDeep('b', '投稿-c', true)).toBe(false);

    expect(store.place('c', 'a', 'after')).toBe(true);
    expect(store.pathOf('c')).toBe('C');
    expect(store.childrenOf(null).map((f: any) => f.id)).toEqual(['a', 'c', 'b']);

    expect(store.move('b', 'a', true)).toBe(true);
    expect(store.childrenOf(null).map((f: any) => f.id)).toEqual(['b', 'a', 'c']);

    store.remove('a');
    expect(store.byId('a')).toBeNull();
    expect(store.byId(made.id)).toBeNull();
    expect(store.childrenOf(null).map((f: any) => f.id)).toEqual(['b', 'c']);
  });

  test('rename は参照中の要素を更新し、子孫の path 表示にも直ちに反映する', () => {
    const store = F.createFolderStore({ idPrefix: 'test', persist: () => {}, isLibrary: true });
    store.setAll([folder('parent', '変更前'), folder('child', '子', 'parent')]);
    expect(store.pathOf('child')).toBe('変更前 / 子');

    expect(store.rename('parent', '変更後')).toBe(true);
    expect(store.pathOf('child')).toBe('変更後 / 子');
  });
});
