'use strict';

import { FolderSchema, type FolderRecord } from '../shared/data-schemas.ts';

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
function repairParents(list: FolderRecord[]) {
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
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      cur = parent;
    }
  }
  return list;
}

// 構造検証と既定値は共通スキーマ、親子関係の修復は repairParents が担当する。
function normFolders(arr: unknown): FolderRecord[] {
  const list = FolderSchema.array().parse(arr);
  for (const folder of list) {
    if (folder.kind === 'dynamic') folder.parentId = null;
    else delete folder.tree;
  }
  return repairParents(list);
}

export { normFolders, repairParents };
