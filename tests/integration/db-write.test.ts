// DB が持つ整理データ (#298/St5) の書き込み。置き換え操作が、サイドカーにも整理用の
// JSON ファイルにも触らずに往復することを見る。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { createDbWriter } from '../../app/src/main/lib-db-write';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer';
import { MAX_TAG_NAME_INPUT_LENGTH } from '../../native-host/tag-normalize.mts';

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

describe('画像ビューのローカル閲覧回数', () => {
  test('1文ずつ加算し、加算後の値を返す', () => {
    expect(writer.recordPostView('post-1')).toBe(1);
    expect(writer.recordPostView('post-1')).toBe(2);
    expect(sqlite.prepare("SELECT lastViewedAt FROM posts WHERE captureId = 'post-1'").get()).toEqual({ lastViewedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(sqlite.prepare("SELECT localViewCount FROM posts WHERE captureId = 'post-1'").get()).toEqual({ localViewCount: 2 });
  });

  test('存在しない投稿には履歴を作らない', () => {
    expect(writer.recordPostView('missing')).toBeNull();
  });
});

describe('画像ごとの可逆クロップ', () => {
  test('旧形式の単一画像にもクロップを保存・解除できる', () => {
    sqlite.prepare("INSERT INTO posts(captureId, image, capturedAt, updatedAt) VALUES ('legacy-crop', 'legacy.png', '2026-01-01', '2026-01-01')").run();
    const crop = { x: 0.1, y: 0.2, width: 0.7, height: 0.6 };
    expect(writer.setMediaCrop('legacy-crop', 0, crop)).toBe(true);
    expect(writer.setMediaCrop('legacy-crop', 0, crop)).toBe(true);
    expect(sqlite.prepare("SELECT seq,file,cropX FROM media WHERE postId='legacy-crop'").all()).toEqual([{ seq: 0, file: 'legacy.png', cropX: 0.1 }]);
    expect(writer.setMediaCrop('legacy-crop', 1, crop)).toBe(false);
    expect(writer.setMediaCrop('legacy-crop', 0, null)).toBe(true);
  });
  test('正規化座標を保存し、null で解除する', () => {
    sqlite.prepare("INSERT INTO media (postId, seq, file) VALUES ('post-1', 0, 'image.jpg')").run();
    expect(writer.setMediaCrop('post-1', 0, { x: 0.1, y: 0.2, width: 0.7, height: 0.6 })).toBe(true);
    expect(sqlite.prepare("SELECT cropX, cropY, cropWidth, cropHeight FROM media WHERE postId='post-1' AND seq=0").get()).toEqual({ cropX: 0.1, cropY: 0.2, cropWidth: 0.7, cropHeight: 0.6 });
    expect(writer.setMediaCrop('post-1', 0, null)).toBe(true);
    expect(sqlite.prepare("SELECT cropX, cropY, cropWidth, cropHeight FROM media WHERE postId='post-1' AND seq=0").get()).toEqual({ cropX: null, cropY: null, cropWidth: null, cropHeight: null });
  });

  test('範囲外の座標と存在しない画像は拒否する', () => {
    expect(() => writer.setMediaCrop('post-1', 0, { x: 0.8, y: 0, width: 0.4, height: 1 })).toThrow();
    expect(writer.setMediaCrop('missing', 0, { x: 0, y: 0, width: 1, height: 1 })).toBe(false);
  });

  test('同じ投稿を再取り込みしても、入力にクロップ指定がなければ既存値を保つ', () => {
    const stmts = preparePostStmts(sqlite);
    const resolveTagId = makeTagResolver(sqlite);
    const base = { captureId: 'post-crop-reimport', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: [], hashtags: [] };
    writePost(stmts, resolveTagId, { ...base, media: [{ file: 'image.jpg', type: 'image', crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 } }] } as any, null);
    writePost(stmts, resolveTagId, { ...base, updatedAt: '2026-01-02T00:00:00Z', media: [{ file: 'image.jpg', type: 'image' }] } as any, null);

    expect(sqlite.prepare("SELECT cropX, cropY, cropWidth, cropHeight FROM media WHERE postId='post-crop-reimport' AND seq=0").get()).toEqual({ cropX: 0.1, cropY: 0.2, cropWidth: 0.7, cropHeight: 0.6 });
  });
});

// #810: Kind のストアは tags.id をキーにする。読みが name/label も一緒に運ぶのは、どの
// 投稿も持っていない Kind 付きのタグをレンダラーが一覧に出せるようにするため。書きは
// id/kind しか読まない。
describe('タグ用語帳（Kind・実体キー #810）', () => {
  const tagId = (name: string) => (sqlite.prepare('SELECT id FROM tags WHERE name = ? ORDER BY id').get(name) as { id: number }).id;

  test('実体キーで往復する', () => {
    sqlite.prepare("INSERT INTO tags (name) VALUES ('alice')").run();
    const id = tagId('alice');
    writer.setTagGroups([{ id, groupId: 'character', name: 'alice', label: 'alice' }], { character: 'Character' });

    expect(writer.getTagGroups()).toEqual({ memberships: [{ id, groupId: 'character', name: 'alice', label: 'alice' }], labels: { character: 'Character' } });
  });

  // #810 が問題にした欠落。名前をキーにするストアは、同名の2実体を読みの時点で1エントリ
  // へ畳んでいた。そしてマップ丸ごとの書き込みは、Kind を片方にしか適用し直さない。結果、
  // どのタグの Kind を編集しても、もう片方の Kind が消えていた。
  test('同名2実体はそれぞれの Kind を保ち、片方の書き込みでもう片方が消えない', () => {
    sqlite.prepare("INSERT INTO tags (name) VALUES ('nick'), ('nick')").run();
    const [a, b] = (sqlite.prepare("SELECT id FROM tags WHERE name = 'nick' ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
    writer.setTagGroups(
      [
        { id: a, groupId: 'character', name: 'nick', label: 'nick' },
        { id: b, groupId: 'work', name: 'nick', label: 'nick' },
      ],
      { work: '作品', character: 'キャラ' },
    );

    const kinds = writer.getTagGroups().memberships.filter((r) => r.name === 'nick');
    expect(kinds.map((r) => [r.id, r.groupId])).toEqual([
      [a, 'character'],
      [b, 'work'],
    ]);
  });

  // #774 の表示名の規則。ピッカーで同名の2実体を見分けさせているのがラベルなので、保存
  // せずに読みの時点で計算する。
});

// #810: 投稿者のタグを実体として読み、#774 の実効集合を適用する＝「親タグで絞ると子タグ
// も取れる」の投稿者側の半分。
describe('ポスタータグの実体読み（#810）', () => {
  let pdir: string;
  let pdb: any;
  let pw: ReturnType<typeof createDbWriter>;

  beforeAll(() => {
    pdir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-db-write-poster-'));
    ({ sqlite: pdb } = openDatabase(path.join(pdir, 'test.db')));
    pw = createDbWriter(pdb);
  });

  afterAll(() => {
    pdb.close();
    fs.rmSync(pdir, { recursive: true, force: true });
  });

  const idOf = (name: string) => (pdb.prepare('SELECT id FROM tags WHERE name = ? ORDER BY id').get(name) as { id: number }).id;

  test('名前と並行して id を返す', () => {
    pw.setPosterTags({ tags: { 'x:1': ['レミリア'] } });

    const row = pw.getPosterTags().tags['x:1'];
    expect(row.tags).toEqual(['レミリア']);
    expect(row.tagIds).toEqual([idOf('レミリア')]);
  });

  // #21 が求め、#774 が守っている可逆性。投稿者のデータには何も焼き付けないので、規則を
  // 消せば次の読み込みでその効果も消える。

  test('ZIP 用の名前だけの読みは並行配列を持たない', () => {
    expect(pw.getPosterTagNames()).toEqual({ tags: { 'x:1': ['レミリア'] } });
  });
});

// #197: setPostTags / setPosterTags / setTagGroups はどれも共有の tagResolver を通るので、
// グリフの正規化（NFKC + 前後の空白除去）は入口ごとに分けず、ここで1まとめに見る＝どの入口
// から書いても同じ tags の行へ収束する。
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

  test('長すぎる作成入力は既存タグを消す前に拒否する', () => {
    own.setPostTags('tn-post', ['維持するタグ'], null);
    const pathological = 'a' + '\u0300\u0316'.repeat(MAX_TAG_NAME_INPUT_LENGTH);

    expect(() => own.setPostTags('tn-post', [pathological], null)).toThrow(RangeError);
    expect(own.getPostFlags('tn-post')?.tags).toEqual(['維持するタグ']);
  });

  test('setPosterTags も同じ正規化を通る', () => {
    own.setPosterTags({ tags: { 'poster:1': ['ＶＴｕｂｅｒ', '  猫  '] } });

    expect(own.getPosterTags().tags['poster:1'].tags).toEqual(['VTuber', '猫']);
  });

  // #810 で IPC の Kind 書き込みは id 基準になった。名前をキーにする経路は ZIP の取り込み
  // のためだけに残っている (tag-groups.json はライブラリ間の交換形式)。正規化がまだ要るのは
  // そちらの経路。
  test('fillTagGroupsByName もキー（タグ名）を正規化してから解決する', () => {
    own.fillTagGroupsByName({ ＶＴｕｂｅｒ: 'character' }, {});
    // 別の入口 (setPostTags) が既に作ったのと同じ半角形の名前で、同じ tags の行へ収束する。
    own.setPostTags('tn-post', ['VTuber'], null);

    expect(db.prepare("SELECT COUNT(*) n FROM tags WHERE name = 'VTuber'").get().n).toBe(1);
    expect(own.getTagGroupNames()).toEqual({ memberships: { VTuber: 'character' }, labels: {} });
  });

  // 埋めるだけで、決して置き換えない。入ってくる書庫が、このライブラリの既に持っている
  // Kind を戻してはいけない。まして、名前をキーにする形式では言及すらできない同名実体の
  // Kind ならなおさら。
  test('fillTagGroupsByName は既存の Kind を上書きしない', () => {
    db.prepare("INSERT INTO tags (name, groupId) VALUES ('doppel', 'work'), ('doppel', NULL)").run();
    own.fillTagGroupsByName({ doppel: 'character' }, {});

    const rows = db.prepare("SELECT groupId FROM tags WHERE name = 'doppel' ORDER BY id").all() as Array<{ groupId: string | null }>;
    expect(rows.map((r) => r.groupId)).toEqual(['work', 'character']);
  });

  test('大小文字・カナ⇔かなは畳まない', () => {
    own.setPostTags('tn-post', ['ネコ', 'ねこ', 'Neko', 'neko'], null);

    expect(own.getPostFlags('tn-post')?.tags?.sort()).toEqual(['Neko', 'neko', 'ねこ', 'ネコ'].sort());
  });
});

describe('タグ名の保存', () => {
  let ownDir: string;
  let db: any;
  let own: ReturnType<typeof createDbWriter>;

  beforeAll(() => {
    ownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-db-write-tag-names-'));
    ({ sqlite: db } = openDatabase(path.join(ownDir, 'test.db')));
    own = createDbWriter(db);
    db.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('name-post', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
  });
  afterAll(() => {
    db.close();
    fs.rmSync(ownDir, { recursive: true, force: true });
  });

  test('投稿と投稿者のタグは入力した名前を保つ', () => {
    own.setPostTags('name-post', ['猫', 'ねこ'], null);
    own.setPosterTags({ tags: { 'poster:1': ['猫', 'ねこ'] } });
    expect(own.getPostFlags('name-post')?.tags?.sort()).toEqual(['ねこ', '猫']);
    expect(own.getPosterTags().tags['poster:1'].tags.sort()).toEqual(['ねこ', '猫']);
  });

  test('最後の紐付けを外してもタグ自体は残る', () => {
    own.setPostTags('name-post', [], null);
    own.setPosterTags({ tags: {} });
    expect(own.tagVocabOverview().map((row) => ({ name: row.name, unused: row.isOrphan }))).toEqual([
      { name: 'ねこ', unused: true },
      { name: '猫', unused: true },
    ]);
  });

  test('取り込みは同じ名前を再利用し、異なる名前には別のタグを作る', () => {
    const resolve = makeTagResolver(db);
    const cat = resolve('猫');
    const hiragana = resolve('ねこ');
    expect(hiragana).not.toBe(cat);
    expect(resolve(' 猫 ')).toBe(cat);
    expect(resolve('ねこ')).toBe(hiragana);
    expect(db.prepare('SELECT COUNT(*) n FROM tags').get().n).toBe(2);
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
      { id: 'tab-1', pinned: false, title: null, state: { view: null } },
      { id: 'tab-2', pinned: true, title: 'Saved', state: { view: { tree: null } } },
    ],
  };
  writer.setTabs(tabs);

  expect(writer.getTabs()).toEqual(tabs);
});

test('state の単純な key/value が往復する', () => {
  writer.stateSet('activeFolderId', 'f-1');

  expect(writer.stateGet('activeFolderId')).toBe('f-1');
});

// #593: 削除 → 復元で「どこに整理していたか」が戻る。フォルダの所属も手動グループの所属
// も、外部キーの CASCADE で投稿もろとも消える。だから削除の前に読み出し、ゴミ箱のレコード
// に載せて運び、復元で戻すよりない（レコードからは再構成できない）。
describe('削除→復元で整理した位置が戻る（#593）', () => {
  let ownDir: string;
  let db: any;
  let own: ReturnType<typeof createDbWriter>;

  // このスイートは投稿とフォルダを消す（上の節が組み上げた状態を壊してしまう）ので、自分専用の DB を持つ。
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
    // p-1 はグループの2番目の項目 (seq=1)＝先頭に置かない。復元で並び順が保たれることを見たいため。
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
    // 投稿がゴミ箱にある間にフォルダを1つ消す＝「戻す先が無い」状態を作る。
    own.setFolders({ folders: [{ id: 'keep', name: 'Keep', kind: 'static', created: 1, items: [] }], activeId: 'keep' });
    own.deletePost('p-1');
    expect(db.prepare('SELECT COUNT(*) n FROM folder_items WHERE postId = ?').get('p-1').n).toBe(0);

    // 復元＝投稿の行を作り直し、ゴミ箱のレコードが持っていた所属を戻す。
    db.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('p-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
    own.restorePostFlags('p-1', { ...flags, localViewCount: 4 });

    expect((db.prepare('SELECT folderId FROM folder_items WHERE postId = ?').all('p-1') as Array<{ folderId: string }>).map((r) => r.folderId)).toEqual(['keep']);
    expect(db.prepare('SELECT groupId, seq FROM manual_group_items WHERE postId = ?').get('p-1')).toEqual({ groupId, seq: 1 });
    expect(db.prepare('SELECT localViewCount FROM posts WHERE captureId = ?').get('p-1')).toEqual({ localViewCount: 4 });
  });

  test('外部から来た不正な閲覧回数は復元しない', () => {
    expect(() => own.restorePostFlags('p-1', { localViewCount: -3 })).toThrow();
    expect(() => own.restorePostFlags('p-1', { localViewCount: 1.5 })).toThrow();
    expect(db.prepare('SELECT localViewCount FROM posts WHERE captureId = ?').get('p-1')).toEqual({ localViewCount: 4 });
  });

  test('同じ復元を2度流しても重複しない（部分失敗の後の再実行）', () => {
    own.restorePostFlags('p-1', own.getPostFlags('p-1'));

    expect(db.prepare('SELECT COUNT(*) n FROM folder_items WHERE postId = ?').get('p-1').n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM manual_group_items WHERE postId = ?').get('p-1').n).toBe(1);
  });

  // ゴミ箱のレコードは外から書き込める (#324)＝壊れた id が文まで届くと、外部キー違反で
  // 復元そのものが丸ごと落ちる。INSERT の前に型検査を通す。
  test('壊れた所属があれば正常な所属も書き込まない', () => {
    expect(() =>
      own.restorePostFlags('p-2', {
        folders: ['keep', 42, '', null, { id: 'keep' }],
        manualGroups: [{ groupId: 'x', seq: 0 }, { groupId: 1, seq: 'y' }, null, 7],
      }),
    ).toThrow();

    expect((db.prepare('SELECT folderId FROM folder_items WHERE postId = ?').all('p-2') as Array<{ folderId: string }>).map((r) => r.folderId)).toEqual([]);
  });
});
