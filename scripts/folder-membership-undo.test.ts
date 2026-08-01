// Tests whether folder membership changes report "only what actually changed" (#235).
// The undo stack stacks this report as-is for the diff, so if this over-reports,
// undoing would kick posts that were already in the folder back out = corrupting real data.
//
// What's under test is the library-side store in
// app/src/renderer/src/services/folders.ts (a layer that needs neither DOM nor
// Electron). The semantics of the stack itself belong to undo.test.ts.

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

// Each test creates its own folder (the module holds a singleton store).
let fid = '';
beforeEach(() => {
  F.setUndoRecorder(null);
  fid = F.createFolder('置き場').id;
  lastWritten = null;
});

test('toggleIn は追加した captureId だけを返す（元から入っていた分は含めない）', () => {
  F.toggleIn(fid, ['c1'], 'c1'); // put only c1 in first

  const res = F.toggleIn(fid, ['c1', 'c2', 'c3'], 'c2'); // anchor c2 is not yet a member = add direction

  expect(res).toEqual({ op: 'added', keys: ['c2', 'c3'] });
  expect(F.byId(fid).items).toEqual(['c1', 'c2', 'c3']);
});

test('toggleIn は削除した captureId だけを返す（入っていなかった分は含めない）', () => {
  F.toggleIn(fid, ['c1', 'c2'], 'c1');

  const res = F.toggleIn(fid, ['c1', 'c2', 'c9'], 'c1'); // anchor c1 is already a member = remove direction

  expect(res).toEqual({ op: 'removed', keys: ['c1', 'c2'] });
  expect(F.byId(fid).items).toEqual([]);
});

test('往復: 報告された差分を applyFolderItems で逆適用すると元の所属に戻る', () => {
  F.toggleIn(fid, ['c1'], 'c1');
  const before = F.byId(fid).items.slice();

  const res = F.toggleIn(fid, ['c1', 'c2', 'c3'], 'c2');
  expect(F.byId(fid).items).not.toEqual(before);

  F.applyFolderItems(fid, [], res.keys); // undo = remove only the added ones

  expect(F.byId(fid).items).toEqual(before);
});

test('applyFolderItems は実際に動いた分だけを返し、何も動かなければ永続化しない', () => {
  F.toggleIn(fid, ['c1'], 'c1');
  lastWritten = null;

  const moved = F.applyFolderItems(fid, ['c1'], ['c9']); // c1 is already there, c9 was never there to begin with

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

  F.toggleIn(fid, ['c1', 'c2'], 'c2'); // c1 is already a member = only c2 moves in this operation

  expect(seen[1]).toEqual({ folderId: fid, added: ['c2'], removed: [] });
});
