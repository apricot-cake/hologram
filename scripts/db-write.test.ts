// Writing organization data held by the DB (#298/St5). Checks that replace
// operations round-trip without touching either the sidecar or organization's JSON files.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';

let dir: string;
let sqlite: any;
let writer: ReturnType<typeof createDbWriter>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-db-write-'));
  ({ sqlite } = openDatabase(path.join(dir, 'test.db')));
  writer = createDbWriter(sqlite);

  sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('post-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'), ('post-2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('タグ用語帳が往復する', () => {
  writer.setTagTypes({ alice: 'character' }, { character: 'Character' });

  expect(writer.getTagTypes()).toEqual({ types: { alice: 'character' }, labels: { character: 'Character' } });
});

// #23 St1: poster-alias groups (non-destructive name-merging). Round-trips the
// same replace-whole-thing shape as poster folders/tags above.
describe('poster-aliases（#23 St1）', () => {
  test('グループが往復する', () => {
    writer.setPosterAliases({ groups: [{ id: 'al-1', primary: 'x:alice', members: ['x:alice', 'misskey:alice2'] }] });

    expect(writer.getPosterAliases()).toEqual({ groups: [{ id: 'al-1', primary: 'x:alice', members: ['x:alice', 'misskey:alice2'] }] });
  });

  test('メンバー1件以下のグループは落ちる', () => {
    writer.setPosterAliases({ groups: [{ id: 'al-lonely', primary: 'x:solo', members: ['x:solo'] }] });

    expect(writer.getPosterAliases()).toEqual({ groups: [] });
  });

  test('primary が members に無ければ先頭のメンバーへ落ちる', () => {
    writer.setPosterAliases({ groups: [{ id: 'al-2', primary: 'x:not-a-member', members: ['x:a', 'x:b'] }] });

    expect(writer.getPosterAliases().groups[0]).toMatchObject({ primary: 'x:a', members: ['x:a', 'x:b'] });
  });

  test('置き換え全消し＝空にすると全グループが消える', () => {
    writer.setPosterAliases({ groups: [{ id: 'al-3', primary: 'x:c', members: ['x:c', 'x:d'] }] });
    writer.setPosterAliases({ groups: [] });

    expect(writer.getPosterAliases()).toEqual({ groups: [] });
  });
});

// #197: since setPostTags / setPosterTags / setTagTypes all go through the
// shared tagResolver, glyph normalization (NFKC + trim) is checked here in one
// batch rather than separately per entry point = writing through any entry point converges on the same tags row.
describe('タグ名の字形正規化（#197）', () => {
  let ownDir: string;
  let db: any;
  let own: ReturnType<typeof createDbWriter>;

  beforeAll(() => {
    ownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-db-write-tagnorm-'));
    ({ sqlite: db } = openDatabase(path.join(ownDir, 'test.db')));
    own = createDbWriter(db);
    db.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('tn-post', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
  });

  afterAll(() => {
    db.close();
    fs.rmSync(ownDir, { recursive: true, force: true });
  });

  test('setPostTags: 前後の空白と全角/半角の字形ゆれを畳んで保存する', () => {
    own.setPostTags('tn-post', ['  猫  ', 'ＡＢＣ'], null);

    expect(own.getPostFlags('tn-post')?.tags).toEqual(['猫', 'ABC']);
  });

  test('同じ post に半角/全角の同じ語を渡すと1つのタグ行へ収束する', () => {
    own.setPostTags('tn-post', ['ABC', 'ＡＢＣ', ' ABC '], null);

    expect(own.getPostFlags('tn-post')?.tags).toEqual(['ABC']);
    expect(db.prepare("SELECT COUNT(*) n FROM tags WHERE name = 'ABC'").get().n).toBe(1);
  });

  test('setPosterTags も同じ正規化を通る', () => {
    own.setPosterTags({ tags: { 'poster:1': ['ＶＴｕｂｅｒ', '  猫  '] } });

    expect(own.getPosterTags()).toEqual({ tags: { 'poster:1': ['VTuber', '猫'] } });
  });

  test('setTagTypes もキー（タグ名）を正規化してから解決する', () => {
    own.setTagTypes({ ＶＴｕｂｅｒ: 'character' }, {});
    // Converges as the same tags row, onto the same half-width-form name that another entry point (setPostTags) already created.
    own.setPostTags('tn-post', ['VTuber'], null);

    expect(db.prepare("SELECT COUNT(*) n FROM tags WHERE name = 'VTuber'").get().n).toBe(1);
    expect(own.getTagTypes()).toEqual({ types: { VTuber: 'character' }, labels: {} });
  });

  test('大小文字・カナ⇔かなは畳まない', () => {
    own.setPostTags('tn-post', ['ネコ', 'ねこ', 'Neko', 'neko'], null);

    expect(own.getPostFlags('tn-post')?.tags?.sort()).toEqual(['Neko', 'neko', 'ねこ', 'ネコ'].sort());
  });
});

describe('フォルダ', () => {
  beforeAll(() => {
    writer.setFolders({
      folders: [
        { id: 'folder-2', name: 'Child', kind: 'static', created: 2, parentId: 'folder-1', items: ['post-2'] },
        { id: 'folder-1', name: 'Favorites', kind: 'static', created: 1, items: ['post-1', 'missing'] },
      ],
      activeId: 'folder-1',
    });
  });

  test('parentId の既定を補い、存在しない投稿は落として往復する', () => {
    expect(writer.getFolders()).toEqual({
      folders: [
        { id: 'folder-2', name: 'Child', kind: 'static', created: 2, parentId: 'folder-1', items: ['post-2'] },
        { id: 'folder-1', name: 'Favorites', kind: 'static', created: 1, parentId: null, items: ['post-1'] },
      ],
      activeId: 'folder-1',
    });
  });
});

test('手動グループは、存在しない投稿を含む組を落として往復する', () => {
  writer.setManualGroups([
    ['post-1', 'missing'],
    ['post-1', 'post-2'],
  ]);

  expect(writer.getManualGroups()).toEqual({ groups: [['post-1', 'post-2']] });
});

test('タブが往復する', () => {
  const tabs = {
    activeTabId: 'tab-2',
    tabs: [
      { id: 'tab-1', pinned: false, title: null, state: {} },
      { id: 'tab-2', pinned: true, title: 'Saved', state: { tree: null } },
    ],
  };
  writer.setTabs(tabs);

  expect(writer.getTabs()).toEqual(tabs);
});

test('state の単純な key/value が往復する', () => {
  writer.stateSet('activeFolderId', 'f-1');

  expect(writer.stateGet('activeFolderId')).toBe('f-1');
});

// #593: on delete -> restore, "where it was organized" comes back. Since both
// folder membership and manual group membership vanish along with the post via
// the foreign key CASCADE, there's no way but to read them out before deletion,
// carry them on the trash record, and put them back on restore (they can't be reconstructed from the record).
describe('削除→復元で整理した位置が戻る（#593）', () => {
  let ownDir: string;
  let db: any;
  let own: ReturnType<typeof createDbWriter>;

  // This suite deletes posts and folders (which would break the state the section above built), so it has its own DB.
  beforeAll(() => {
    ownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-restore-'));
    ({ sqlite: db } = openDatabase(path.join(ownDir, 'test.db')));
    own = createDbWriter(db);
    db.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('p-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'), ('p-2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
    own.setFolders({
      folders: [
        { id: 'keep', name: 'Keep', kind: 'static', created: 1, items: ['p-1'] },
        { id: 'doomed', name: 'Doomed', kind: 'static', created: 2, items: ['p-1'] },
      ],
      activeId: 'keep',
    });
    // p-1 is the group's second item (seq=1) = not placed first, since we want to check that the order is preserved on restore.
    own.setManualGroups([['p-2', 'p-1']]);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(ownDir, { recursive: true, force: true });
  });

  test('削除前に読む状態が、所属を2種類とも運ぶ', () => {
    const flags = own.getPostFlags('p-1');

    expect(flags?.folders?.sort()).toEqual(['doomed', 'keep']);
    expect(flags?.manualGroups).toEqual([{ groupId: expect.any(Number), seq: 1 }]);
  });

  test('復元で所属が戻る（グループ内の並び順ごと）／消えたフォルダの分だけ落ちる', () => {
    const flags = own.getPostFlags('p-1');
    const groupId = flags?.manualGroups?.[0]?.groupId;
    // Deletes one folder while the post is in the trash = this is the "nowhere to restore it to" state.
    own.setFolders({ folders: [{ id: 'keep', name: 'Keep', kind: 'static', created: 1, items: [] }], activeId: 'keep' });
    own.deletePost('p-1');
    expect(db.prepare('SELECT COUNT(*) n FROM folder_items WHERE postId = ?').get('p-1').n).toBe(0);

    // Restore = re-create the post's row, then put back the membership the trash record held.
    db.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('p-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
    own.restorePostFlags('p-1', flags);

    expect((db.prepare('SELECT folderId FROM folder_items WHERE postId = ?').all('p-1') as Array<{ folderId: string }>).map((r) => r.folderId)).toEqual(['keep']);
    expect(db.prepare('SELECT groupId, seq FROM manual_group_items WHERE postId = ?').get('p-1')).toEqual({ groupId, seq: 1 });
  });

  test('同じ復元を2度流しても重複しない（部分失敗の後の再実行）', () => {
    own.restorePostFlags('p-1', own.getPostFlags('p-1'));

    expect(db.prepare('SELECT COUNT(*) n FROM folder_items WHERE postId = ?').get('p-1').n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM manual_group_items WHERE postId = ?').get('p-1').n).toBe(1);
  });

  // A trash record can be written to from outside (#324) = if a broken id
  // reaches the statement, it would take down the whole restore with a foreign
  // key violation. Pass it through a type check before inserting.
  test('壊れた所属は黙って落ち、復元自体は成功する', () => {
    own.restorePostFlags('p-2', {
      folders: ['keep', 42, '', null, { id: 'keep' }],
      manualGroups: [{ groupId: 'x', seq: 0 }, { groupId: 1, seq: 'y' }, null, 7],
    });

    expect((db.prepare('SELECT folderId FROM folder_items WHERE postId = ?').all('p-2') as Array<{ folderId: string }>).map((r) => r.folderId)).toEqual(['keep']);
  });
});

// #444. Writing a post, editing its tags, and deleting it all keep pointing at
// the same single FTS row (posts.ftsRowid). If this breaks, the index silently drifts from the real data.
describe('FTS 行の鍵の一生（#444）', () => {
  let ownDir: string;
  let db: any;
  let ownWriter: ReturnType<typeof createDbWriter>;
  const rec = (over: Record<string, unknown> = {}) => ({ captureId: 'cap-1', text: '吾輩は猫である', tags: ['アリス'], hashtags: ['写真'], capturedAt: '2026-01-01T00:00:00Z', ...over });
  const ftsRowidOf = (id: string) => db.prepare('SELECT ftsRowid FROM posts WHERE captureId = ?').get(id)?.ftsRowid;
  const write = (record: Record<string, unknown>) => writePost(preparePostStmts(db), makeTagResolver(db), record as any);

  beforeAll(() => {
    ownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-db-write-fts-'));
    ({ sqlite: db } = openDatabase(path.join(ownDir, 'test.db')));
    ownWriter = createDbWriter(db);
    write(rec());
    write(rec({ captureId: 'cap-2', text: '犬も歩けば棒に当たる', tags: [] }));
  });

  afterAll(() => {
    db.close();
    fs.rmSync(ownDir, { recursive: true, force: true });
  });

  test('初回の書き込みで鍵が振られ、FTS 行と一致する', () => {
    const key = ftsRowidOf('cap-1');
    expect(key).toBeTypeOf('number');
    expect(db.prepare('SELECT postId FROM posts_fts WHERE rowid = ?').get(key)).toEqual({ postId: 'cap-1' });
  });

  test('書き直しても鍵は変わらず、FTS 行は1本のまま', () => {
    const before = ftsRowidOf('cap-1');
    write(rec({ text: '名前はまだ無い' }));

    expect(ftsRowidOf('cap-1')).toBe(before);
    expect((db.prepare("SELECT COUNT(*) AS n FROM posts_fts WHERE postId = 'cap-1'").get() as { n: number }).n).toBe(1);
    expect(db.prepare('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?').all('"名前はまだ"')).toMatchObject([{ postId: 'cap-1' }]);
  });

  test('タグ編集は自分の FTS 行だけを書き換える', () => {
    ownWriter.setPostTags('cap-1', ['ブルーアーカイブ'], null);

    expect(db.prepare('SELECT tagsText FROM posts_fts WHERE rowid = ?').get(ftsRowidOf('cap-1'))).toEqual({ tagsText: 'ブルーアーカイブ' });
    expect(db.prepare('SELECT tagsText FROM posts_fts WHERE rowid = ?').get(ftsRowidOf('cap-2'))).toEqual({ tagsText: '' });
  });

  test('削除は自分の FTS 行だけを落とす', () => {
    ownWriter.deletePost('cap-1');

    expect(db.prepare('SELECT postId FROM posts_fts').all()).toEqual([{ postId: 'cap-2' }]);
  });

  test('鍵の無い投稿行（別経路の直接 INSERT）でもタグ編集は落ちない', () => {
    db.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('bare-1', '2026-01-01', '2026-01-01')").run();

    expect(ownWriter.setPostTags('bare-1', ['アリス'], null)).toBe(true);
    expect(db.prepare('SELECT postId FROM posts_fts').all()).toEqual([{ postId: 'cap-2' }]);
  });
});
