// フォルダの所属の変更が「実際に動いた分だけ」を報告するかを見る（#235）。
// 取り消しのスタックはこの報告をそのまま差分として積むので、多めに報告すると、
// 取り消しで元からフォルダに入っていた投稿まで外へ蹴り出す＝実データを壊す。
//
// 対象は app/src/renderer/src/services/folders.ts のライブラリ側のストア
// （DOM も Electron も要らない層）。スタック自体の意味づけは undo.test.ts の担当。

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

// テストごとに自分のフォルダを作る（モジュールが持つストアはシングルトン）。
let fid = '';
beforeEach(() => {
  F.setUndoRecorder(null);
  fid = F.createFolder('置き場').id;
  lastWritten = null;
});

test('toggleIn は追加した captureId だけを返す（元から入っていた分は含めない）', () => {
  F.toggleIn(fid, ['c1'], 'c1'); // まず c1 だけ入れる

  const res = F.toggleIn(fid, ['c1', 'c2', 'c3'], 'c2'); // 起点の c2 はまだ所属していない＝追加の向き

  expect(res).toEqual({ op: 'added', keys: ['c2', 'c3'] });
  expect(F.byId(fid).items).toEqual(['c1', 'c2', 'c3']);
});

test('toggleIn は削除した captureId だけを返す（入っていなかった分は含めない）', () => {
  F.toggleIn(fid, ['c1', 'c2'], 'c1');

  const res = F.toggleIn(fid, ['c1', 'c2', 'c9'], 'c1'); // 起点の c1 はすでに所属している＝削除の向き

  expect(res).toEqual({ op: 'removed', keys: ['c1', 'c2'] });
  expect(F.byId(fid).items).toEqual([]);
});

test('往復: 報告された差分を applyFolderItems で逆適用すると元の所属に戻る', () => {
  F.toggleIn(fid, ['c1'], 'c1');
  const before = F.byId(fid).items.slice();

  const res = F.toggleIn(fid, ['c1', 'c2', 'c3'], 'c2');
  expect(F.byId(fid).items).not.toEqual(before);

  F.applyFolderItems(fid, [], res.keys); // 取り消し＝追加した分だけを外す

  expect(F.byId(fid).items).toEqual(before);
});

test('applyFolderItems は実際に動いた分だけを返し、何も動かなければ永続化しない', () => {
  F.toggleIn(fid, ['c1'], 'c1');
  lastWritten = null;

  const moved = F.applyFolderItems(fid, ['c1'], ['c9']); // c1 はすでに入っていて、c9 はそもそも入っていない

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

  F.toggleIn(fid, ['c1', 'c2'], 'c2'); // c1 はすでに所属している＝この操作で動くのは c2 だけ

  expect(seen[1]).toEqual({ folderId: fid, added: ['c2'], removed: [] });
});
