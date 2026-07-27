// フォルダ階層（#41）のロジック単体テスト。二層を直接検証する:
//  - app/src/main/lib-folder-tree.ts … 読み込み時の形正規化と親エッジの修復
//    （孤児の昇格・自己親・循環の切断・保存した検索は入れ子にしない）
//  - app/src/renderer/src/services/folders.ts … 派生ツリーの意味論
//    （子孫を含む所属判定・「このフォルダのみ」・連鎖削除と葉掃除・移動ガード）
// どちらも DOM も Electron も要らない純ロジック層。UI（サイドバーのツリーと DnD）は
// 実機スイート test-app-folders 側で見る。
//
// レンダラ側ストアのテストは1つのストアを順に育てるので、宣言順に意味がある。

import { beforeAll, describe, expect, test } from 'vitest';
import { normFolders } from '../app/src/main/lib-folder-tree';

// folders.ts は変更のたび preload ブリッジ越しに永続化する。スタブの受け皿がその代わりを
// し、同時に「ストアが書き出す形に parentId が残っているか」の検査も兼ねる（このフィールドは
// 往復のために3か所へ書く必要があり、どこかで落ちるとフォルダが黙ってルートへ戻る）。
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
  F = await import('../app/src/renderer/src/services/folders');
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

  test('保存した検索は入れ子にしない（tree は残る）', () => {
    expect(by.get('saved').parentId).toBeNull();
    expect(by.get('saved').tree).toBeTruthy();
  });

  test('修復してもフォルダ自体は消えない', () => {
    expect(out).toHaveLength(6);
  });
});

// 循環は「歩いて戻ってきた辺」で切る。切ったあとは全員がルートまで辿れる＝木として
// 成立していること自体を検査する（どの辺が切れたかは実装の自由）。
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

// createFolder / removeFolder は本番の経路そのまま。persist() は IPC 不在時に何もしないので、
// ストアの中身だけが動く。
describe('派生ツリーの意味論（レンダラ側ストア）', () => {
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

  // ツリーの外に並ぶ面（カードの「フォルダに追加」・フィルタの値行）はパスで名乗る
  test('pathOf は祖先を辿ってパスにする', () => {
    expect(F.pathOf(grand.id)).toBe('親 / 子 / 孫');
    expect(F.pathOf(parent.id)).toBe('親');
  });

  // 移動ガード: 自分・自分の子孫の下へは入れない（UI 側の無効化と同じ判断をストア側にも
  // 持たせてある＝二重の歯止め）
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

  // 連鎖削除: 子孫ごと消え、保存した検索に残った葉も一緒に掃除される
  // （葉が1つでも残ると、その保存検索は以後だまって0件を返し続ける）
  describe('連鎖削除', () => {
    let saved: any;
    let gone: Set<string>;

    beforeAll(() => {
      saved = F.createFolder('保存', {
        kind: 'dynamic',
        tree: {
          kind: 'group',
          op: 'and',
          children: [
            { kind: 'cond', type: 'folder', value: grand.id },
            { kind: 'cond', type: 'tag', value: 'keep' },
          ],
        },
      });
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

    test('保存した検索から、消えたフォルダの葉だけが掃除される', () => {
      const leaves = F.byId(saved.id).tree.children;
      expect(leaves.some((c: any) => c.type === 'folder')).toBe(false);
      expect(leaves.some((c: any) => c.type === 'tag' && c.value === 'keep')).toBe(true);
    });
  });
});

// 兄弟順は配列順そのものなので、「A の前へ」は結果の並びで検証する
describe('ツリー DnD の着地（placeFolder）: 1ドロップ＝1書き込み', () => {
  let a: any;
  let b: any;
  let c: any;

  // 前段のテストが作ったフォルダも同じルートに並ぶので、この3つだけを見る
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

  // 「隣へ」は落とした先の親を引き継ぐ＝親の変更と並べ替えが同時に起きる
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
