'use strict';

// フォルダ階層（#41）のロジック単体テスト。二層を直接検証する:
//  - app/src/main/lib-folder-tree.ts     … 読み込み時の形正規化と親エッジの修復
//    （孤児の昇格・自己親・循環の切断・保存した検索は入れ子にしない）
//  - app/src/renderer/src/services/folders.ts     … 派生ツリーの意味論
//    （子孫を含む所属判定・「このフォルダのみ」・連鎖削除と葉掃除・移動ガード）
// どちらも DOM も Electron も要らない純ロジック層。UI（サイドバーのツリーと DnD）は
// 実機スイート test-app-folders 側で見る。
//
//   node scripts/test-folder-nesting.cts

const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const load = (rel: string) => import(pathToFileURL(path.join(__dirname, '..', 'app', rel)).href);
  const T = await load('src/main/lib-folder-tree.ts');
  // folders.ts persists through the preload bridge on every mutation. A stub sink
  // stands in for it — and doubles as the check that what the store writes out
  // still carries parentId (the field has to be listed in three places to survive
  // a round trip; dropping it anywhere sends the folder silently back to the root).
  let lastWritten: any = null;
  (globalThis as any).window = {
    hologram: {
      setFolders: async (data: any) => {
        lastWritten = data;
        return { ok: true };
      },
    },
  };
  const F = await load('src/renderer/src/services/folders.ts');

  let failed = 0;
  function assert(name: string, cond: unknown) {
    if (cond) {
      console.log('ok  ', name);
    } else {
      console.log('FAIL', name);
      failed++;
    }
  }

  // --- 形の正規化と親エッジの修復（読み込み時） ---
  {
    const out = T.normFolders([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'b' },
      { id: 'orphan', name: 'O', parentId: 'ghost' },
      { id: 'self', name: 'S', parentId: 'self' },
      { id: 'saved', name: 'Q', kind: 'dynamic', parentId: 'a', tree: { kind: 'group', op: 'and', children: [] } },
    ]);
    const by = new Map(out.map((f) => [f.id, f]));
    assert('親子の連鎖はそのまま残る', by.get('b').parentId === 'a' && by.get('c').parentId === 'b');
    assert('parentId 不在はルート（null）', by.get('a').parentId === null);
    assert('実在しない親を指す＝ルートへ昇格', by.get('orphan').parentId === null);
    assert('自分自身を親に指す＝ルートへ昇格', by.get('self').parentId === null);
    assert('保存した検索は入れ子にしない', by.get('saved').parentId === null && !!by.get('saved').tree);
    assert('修復してもフォルダ自体は消えない', out.length === 6);
  }
  {
    // 循環は「歩いて戻ってきた辺」で切る。切ったあとは全員がルートまで辿れる＝
    // 木として成立していること自体を検査する（どの辺が切れたかは実装の自由）。
    const out = T.normFolders([
      { id: 'x', name: 'X', parentId: 'z' },
      { id: 'y', name: 'Y', parentId: 'x' },
      { id: 'z', name: 'Z', parentId: 'y' },
    ]);
    const by = new Map(out.map((f) => [f.id, f]));
    let ok = true;
    for (const f of out) {
      const seen = new Set([f.id]);
      let cur = f;
      while (cur.parentId != null) {
        if (seen.has(cur.parentId)) {
          ok = false;
          break;
        }
        seen.add(cur.parentId);
        cur = by.get(cur.parentId);
      }
    }
    assert('循環は切断され、全フォルダがルートへ辿り着く', ok);
    assert('循環の切断でフォルダは失われない', out.length === 3);
  }

  // --- 派生ツリーの意味論（レンダラ側ストア） ---
  // createFolder / removeFolder は本番の経路そのまま。persist() は IPC 不在時に
  // 何もしないので、ストアの中身だけが動く。
  const parent = F.createFolder('親');
  const child = F.createFolder('子', { parentId: parent.id });
  const grand = F.createFolder('孫', { parentId: child.id });
  const other = F.createFolder('別');
  F.byId(grand.id).items.push('cap-deep');
  F.byId(parent.id).items.push('cap-own');

  assert('子として作ったフォルダに親が付く', child.parentId === parent.id && grand.parentId === child.id);
  assert('childrenOf は直下の子だけを返す', F.childrenOf(parent.id).length === 1 && F.childrenOf(parent.id)[0].id === child.id);
  assert('subtreeIds は自分＋全子孫', F.subtreeIds(parent.id).size === 3 && F.subtreeIds(parent.id).has(grand.id));
  assert('親は子孫の投稿を含む（集約が既定）', F.hasDeep(parent.id, 'cap-deep') === true);
  assert('「このフォルダのみ」は直下限定', F.hasDeep(parent.id, 'cap-deep', true) === false && F.hasDeep(parent.id, 'cap-own', true) === true);
  assert('無関係なフォルダは巻き込まない', F.hasDeep(other.id, 'cap-deep') === false);
  assert('has は従来どおり直下だけを見る', F.has(parent.id, 'cap-deep') === false);
  assert('永続化されるデータに parentId が乗る', !!lastWritten && lastWritten.folders.find((f) => f.id === grand.id).parentId === child.id);
  // ツリーの外に並ぶ面（カードの「フォルダに追加」・フィルタの値行）はパスで名乗る。
  assert('pathOf は祖先を辿ってパスにする', F.pathOf(grand.id) === '親 / 子 / 孫');
  assert('ルート直下はパスも名前だけ', F.pathOf(parent.id) === '親');

  // 移動ガード: 自分・自分の子孫の下へは入れない（UI 側の無効化と同じ判断を
  // ストア側にも持たせてある＝二重の歯止め）。
  assert('自分自身の下へは移動できない', F.reparentFolder(parent.id, parent.id) === false);
  assert('自分の子孫の下へは移動できない', F.reparentFolder(parent.id, grand.id) === false);
  assert('ガードで弾かれた移動は親を変えない', F.byId(parent.id).parentId === null);
  assert('別の木の下へは移動できる', F.reparentFolder(other.id, child.id) === true && F.byId(other.id).parentId === child.id);
  assert('移動は派生インデックスに反映される', F.childrenOf(child.id).length === 2);
  assert('ルートへ戻せる', F.reparentFolder(other.id, null) === true && F.byId(other.id).parentId === null);

  // 連鎖削除: 子孫ごと消え、保存した検索に残った葉も一緒に掃除される
  // （葉が1つでも残ると、その保存検索は以後だまって0件を返し続ける）。
  const saved = F.createFolder('保存', {
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
  const gone = F.removeFolder(parent.id);
  assert('削除は子孫ごと（返り値が消えた id 全部）', gone.size === 3 && gone.has(grand.id) && gone.has(child.id));
  assert('削除後、子孫はストアから消えている', F.byId(grand.id) === null && F.byId(child.id) === null);
  assert('巻き込まれていないフォルダは残る', F.byId(other.id) !== null);
  const leaves = F.byId(saved.id).tree.children;
  assert('保存した検索から消えたフォルダの葉が掃除される', !leaves.some((c) => c.type === 'folder'));
  assert(
    '掃除は他の条件を巻き込まない',
    leaves.some((c) => c.type === 'tag' && c.value === 'keep'),
  );

  // --- ツリー DnD の着地（placeFolder）: 1ドロップ＝1書き込み ---
  // 兄弟順は配列順そのものなので、「A の前へ」は結果の並びで検証する。
  const a = F.createFolder('A');
  const b = F.createFolder('B');
  const c = F.createFolder('C');
  // 前段のテストが作ったフォルダも同じルートに並ぶので、この3つだけを見る。
  const rootOrder = () =>
    F.childrenOf(null)
      .map((f) => f.name)
      .filter((n) => 'ABC'.includes(n));

  assert('中央へのドロップ＝子にする', F.placeFolder(c.id, a.id, 'into') === true && F.byId(c.id).parentId === a.id);
  assert('自分の子孫の下へは落とせない', F.placeFolder(a.id, c.id, 'into') === false && F.byId(a.id).parentId === null);
  assert('同じ親への「子にする」は書き込まない', F.placeFolder(c.id, a.id, 'into') === false);
  // 「隣へ」は落とした先の親を引き継ぐ＝親の変更と並べ替えが同時に起きる。
  assert('行の上端へのドロップ＝その手前の兄弟になる', F.placeFolder(c.id, b.id, 'before') === true && F.byId(c.id).parentId === null);
  assert('並び順が実際に入れ替わる', rootOrder().join(',') === 'A,C,B');
  assert('行の下端へのドロップ＝その直後', F.placeFolder(c.id, b.id, 'after') === true && rootOrder().join(',') === 'A,B,C');
  F.placeFolder(b.id, a.id, 'into');
  assert('見出しへのドロップ＝ルートへ戻す', F.byId(b.id).parentId === a.id && F.placeFolder(b.id, null, 'into') === true && F.byId(b.id).parentId === null);

  console.log(failed ? `\n${failed} test(s) FAILED` : '\nall folder-nesting tests passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
