'use strict';

// フォルダのストア（folders.json）のディスク上の形と、ファイルをアプリの残りへ渡して安全に
// するための修復のパス。純粋なデータ＝Electron も fs も使わない＝ので、ipc-organize.ts がその
// 周りに IPC を登録できるし、単体テストが直接呼べる。
//
// 入れ子（#41）は平坦な配列＋`parentId`。木は導出された見え方としてしか存在しない。Eagle と
// Lightroom が内部でそう持っているし、このコードベースの CRUD・統合・正規化の経路をすべて平坦に
// 保てる。代償は、ファイルが木でないものを記述し得ること＝だから読み手は信用せず修復する。

/**
 * 親の辺を、その場で本物の木へ矯正する。
 *   - 誰も持たない parentId（や自分自身を指すもの）→ ルート
 *   - 循環 → 歩きが閉じるノードで切る
 * どちらの修復も黙って行い、着地はルート側になる。フォルダが1つ思わぬ場所にある状態で開く
 * ライブラリの方が、開かないライブラリより良い。
 */
function repairParents(list) {
  const byId = new Map(list.map((f) => [f.id, f]));
  for (const f of list) if (f.parentId != null && (f.parentId === f.id || !byId.has(f.parentId))) f.parentId = null;
  for (const f of list) {
    const seen = new Set([f.id]);
    let cur = f;
    while (cur.parentId != null) {
      if (seen.has(cur.parentId)) {
        cur.parentId = null;
        break;
      }
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId); // 上のパスの後は、どの parentId も生きている id
    }
  }
  return list;
}

/**
 * folders.json から読んだ（あるいはこれから書く）`folders` の配列を正規化する。知らない欄は
 * 落とす。この許可リストがスキーマそのもの。ここに載っていない欄はファイルの中には残るが、アプリへは
 * 決して届かない＝だから欄を1つ足すには、この関数と、レンダラーのストアの setAll と、型を揃えて
 * 触ることになる。
 *
 * 保存した検索（kind:'dynamic'）は入れ子にならない。あれはサイドバーで自分たちの組を成すので、
 * 親を持たせても誰も読まないデータになる。
 */
function normFolders(arr) {
  const list = Array.isArray(arr)
    ? arr
        .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
        .map((c) => {
          const dynamic = c.kind === 'dynamic';
          const out = {
            id: c.id,
            name: c.name,
            kind: dynamic ? 'dynamic' : 'static',
            created: typeof c.created === 'number' ? c.created : null,
            parentId: !dynamic && typeof c.parentId === 'string' ? c.parentId : null,
            items: Array.isArray(c.items) ? [...new Set(c.items.map(String))] : [],
          };
          if (dynamic && c.tree && typeof c.tree === 'object') (out as any).tree = c.tree; // 保存した検索
          return out;
        })
    : [];
  return repairParents(list);
}

export { normFolders, repairParents };
