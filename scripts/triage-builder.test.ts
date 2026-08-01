// 高速トリアージモード（#46）のキュー構築・単キー操作・1手 undo のテスト。
// DOM も Electron も要らない層（services/triage.ts・services/triage-builder.ts・
// services/folders.ts）だけを対象にする。IPC は folder-membership-undo.test.ts と
// 同じ形で window.hologram をスタブする。

import { beforeAll, beforeEach, expect, test } from 'vitest';

let lastTagsWritten: Record<string, string[]> = {};
let TR: any; // triage.ts（純状態）
let TB: any; // triage-builder.ts（deps 注入）
let F: any; // folders.ts

beforeAll(async () => {
  (globalThis as any).window = {
    hologram: {
      updateTags: async (image: string, tags: string[]) => {
        lastTagsWritten[image] = tags.slice();
        return { ok: true };
      },
      setFolders: async () => ({ ok: true }),
      getPrefs: async () => ({ triagePinnedTags: [] }),
      setPref: async () => ({ ok: true }),
    },
  };
  TR = await import('../app/src/renderer/src/services/triage');
  TB = await import('../app/src/renderer/src/services/triage-builder');
  F = await import('../app/src/renderer/src/services/folders');
});

// makeTriage の deps を、テスト用の in-memory 投稿配列に対して素直に実装したもの。
// groupRecords は「1投稿 = 1グループ」の恒等写像（グルーピングの中身は records.ts
// 側の別テストの担当）。pushUndo は undo-builder.ts の実セマンティクスを縮小再現し、
// 「返ってきた undo() を呼べば実データが戻る」ところまで検証する。
function makeDeps(posts: any[]) {
  const byId = new Map(posts.map((p) => [p.captureId, p]));
  return {
    t: (key: string, subs?: any[]) => (subs && subs.length ? `${key}(${subs.join(',')})` : key),
    buildGroupGalleryItems: (g: any) => [{ src: 'asset://img/' + (g.rep.image || ''), video: !!g.rep.video, alt: '' }],
    getAllPosts: () => posts,
    groupRecords: (list: any[]) => list.map((p) => ({ key: p.captureId, records: [p], rep: p, files: [p.image].filter(Boolean) })),
    pushUndo: (changes: any[]) => {
      if (!changes.length) return null;
      return () => {
        for (const c of changes) {
          if (c.kind === 'post-tags') {
            const rec = byId.get(c.target);
            if (rec) rec.tags = (rec.tags || []).filter((t: string) => !c.added.includes(t));
          } else if (c.kind === 'folder-items') {
            F.applyFolderItems(c.target, c.removed, c.added); // 逆適用: added を外す
          }
        }
      };
    },
    getPostById: (id: string) => byId.get(id),
    markPostsMutated: () => {},
    renderPosts: () => {},
  };
}

let posts: any[];
beforeEach(() => {
  F.setUndoRecorder(null);
  for (const f of F.staticFolders()) F.removeFolder(f.id);
  lastTagsWritten = {};
  posts = [
    { captureId: 'c1', image: 'c1.jpg', tags: [] }, // 対象: 未タグ・未フォルダ
    { captureId: 'c2', image: 'c2.jpg', tags: ['猫'] }, // 除外: タグ済み
    { captureId: 'c3', image: 'c3.jpg', tags: [] }, // 除外予定: フォルダに入れる
  ];
});

test('キューは未タグ・未フォルダの投稿だけを含む', () => {
  const fid = F.createFolder('置き場').id;
  F.applyFolderItems(fid, ['c3'], null);
  const tr = TB.makeTriage(makeDeps(posts));

  expect(tr.queueCount()).toBe(1);
  tr.openTriage();

  expect(TR.current().rep.captureId).toBe('c1');
});

test('タグ付けは全レコードに保存され、キューを1件進め、直前操作を記録する', async () => {
  const tr = TB.makeTriage(makeDeps(posts));
  tr.openTriage();

  await tr.applyTag('猫');

  expect(lastTagsWritten['c1.jpg']).toEqual(['猫']);
  expect(posts[0].tags).toEqual(['猫']);
  expect(TR.get().idx).toBe(1);
  expect(TR.get().lastAction?.kind).toBe('tag');
});

test('フォルダへの追加はメンバーシップを書き換え、キューを進める', () => {
  const fid = F.createFolder('置き場').id;
  const tr = TB.makeTriage(makeDeps(posts));
  tr.openTriage();

  tr.applyFolder(fid);

  expect(F.byId(fid).items).toEqual(['c1']);
  expect(TR.get().idx).toBe(1);
  expect(TR.get().lastAction?.kind).toBe('folder');
});

test('スキップはデータを変えずにキューだけ進める', () => {
  const tr = TB.makeTriage(makeDeps(posts));
  tr.openTriage();

  tr.skip();

  expect(posts[0].tags).toEqual([]);
  expect(TR.get().idx).toBe(1);
  expect(TR.get().lastAction?.kind).toBe('skip');
});

test('Backspace（undoLast）はタグ付けを1件だけ取り消し、カーソルを1件戻す', async () => {
  const tr = TB.makeTriage(makeDeps(posts));
  tr.openTriage();
  await tr.applyTag('猫');

  tr.undoLast();

  expect(posts[0].tags).toEqual([]); // 付けたタグが戻る
  expect(TR.get().idx).toBe(0); // カーソルも1件戻る
  expect(TR.get().lastAction).toBeNull(); // 「直前操作」自体は消える＝連打しても2手戻らない
});

test('undoLast はフォルダ追加も逆適用する', () => {
  const fid = F.createFolder('置き場').id;
  const tr = TB.makeTriage(makeDeps(posts));
  tr.openTriage();
  tr.applyFolder(fid);

  tr.undoLast();

  expect(F.byId(fid).items).toEqual([]);
  expect(TR.get().idx).toBe(0);
});

test('1-9 キーはピン留めタグを即タグ付けする', async () => {
  TR.setPinnedTag(0, '猫'); // キー '1' = スロット0
  const tr = TB.makeTriage(makeDeps(posts));
  tr.openTriage();

  tr.handleTriageKey({ key: '1', target: { tagName: 'DIV' } } as any);
  await Promise.resolve(); // applyTag は async

  expect(posts[0].tags).toEqual(['猫']);
});

test('タグ入力欄にフォーカスがある間は Space/数字キーが通らない（typing 中は自分のキー入力を優先）', () => {
  TR.setPinnedTag(0, '猫');
  const tr = TB.makeTriage(makeDeps(posts));
  tr.openTriage();

  tr.handleTriageKey({ key: '1', target: { tagName: 'INPUT' } } as any);

  expect(posts[0].tags).toEqual([]); // 数字キーが素通りしていない
});
