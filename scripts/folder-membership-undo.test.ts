// フォルダ所属の変更が「実際に動いた分だけ」を報告するかのテスト（#235）。
// 取り消しスタックはこの報告をそのまま差分として積むので、ここが多めに答えると
// 取り消しが元から入っていた投稿までフォルダから外す＝実データを壊す。
//
// 検証対象は app/src/renderer/src/services/folders.ts のライブラリ側ストア（DOM も
// Electron も要らない層）。スタックそのものの意味論は undo.test.ts。

import { beforeAll, beforeEach, expect, test } from 'vitest';

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

// 各テストは自分のフォルダを作る（モジュールはシングルトンのストアを持つ）。
let fid = '';
beforeEach(() => {
  F.setUndoRecorder(null);
  fid = F.createFolder('置き場').id;
  lastWritten = null;
});

test('toggleIn は追加した captureId だけを返す（元から入っていた分は含めない）', () => {
  F.toggleIn(fid, ['c1'], 'c1'); // c1 だけ先に入れておく

  const res = F.toggleIn(fid, ['c1', 'c2', 'c3'], 'c2'); // アンカー c2 は未所属＝追加方向

  expect(res).toEqual({ op: 'added', keys: ['c2', 'c3'] });
  expect(F.byId(fid).items).toEqual(['c1', 'c2', 'c3']);
});

test('toggleIn は削除した captureId だけを返す（入っていなかった分は含めない）', () => {
  F.toggleIn(fid, ['c1', 'c2'], 'c1');

  const res = F.toggleIn(fid, ['c1', 'c2', 'c9'], 'c1'); // アンカー c1 は所属済み＝削除方向

  expect(res).toEqual({ op: 'removed', keys: ['c1', 'c2'] });
  expect(F.byId(fid).items).toEqual([]);
});

test('往復: 報告された差分を applyFolderItems で逆適用すると元の所属に戻る', () => {
  F.toggleIn(fid, ['c1'], 'c1');
  const before = F.byId(fid).items.slice();

  const res = F.toggleIn(fid, ['c1', 'c2', 'c3'], 'c2');
  expect(F.byId(fid).items).not.toEqual(before);

  F.applyFolderItems(fid, [], res.keys); // 取り消し＝追加分だけを外す

  expect(F.byId(fid).items).toEqual(before);
});

test('applyFolderItems は実際に動いた分だけを返し、何も動かなければ永続化しない', () => {
  F.toggleIn(fid, ['c1'], 'c1');
  lastWritten = null;

  const moved = F.applyFolderItems(fid, ['c1'], ['c9']); // c1 は既に在り、c9 は元から無い

  expect(moved).toEqual({ added: [], removed: [] });
  expect(lastWritten).toBeNull();
});

test('保存した検索（dynamic）は所属を持たないので、どちらの経路でも動かない', () => {
  const dyn = F.createFolder('保存した検索', { kind: 'dynamic', tree: { kind: 'group', op: 'and', children: [] } });

  expect(F.toggleIn(dyn.id, ['c1'], 'c1')).toBeNull();
  expect(F.applyFolderItems(dyn.id, ['c1'], [])).toEqual({ added: [], removed: [] });
});

test('取り消しの記録役には、実際に動いた分だけが渡る', () => {
  const seen: Array<{ folderId: string; added: string[]; removed: string[] }> = [];
  F.setUndoRecorder((folderId: string, added: string[], removed: string[]) => {
    seen.push({ folderId, added, removed });
    return () => {};
  });
  F.toggleIn(fid, ['c1'], 'c1');

  F.toggleIn(fid, ['c1', 'c2'], 'c2'); // c1 は既に所属＝この操作で動くのは c2 だけ

  expect(seen[1]).toEqual({ folderId: fid, added: ['c2'], removed: [] });
});
