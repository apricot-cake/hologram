// app/src/main/lib-archive.ts の #300 (St7) の仕事のうち、DB を軸にしたインポートの側
// (importCompleteZipToDb) の単体テスト。空の DB への欠落の無いインポート、空でない DB への
// 合流、二重インポートの冪等性、.trash/ のファイルシステムへの復元、旧形式（#300 以前）の
// ZIP との互換を見る。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { importCompleteZipToDb, writeCompleteZip, ZipLimitError } from '../../app/src/main/lib-archive';
import { createDbWriter } from '../../app/src/main/lib-db-write';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer';
import { applyPendingReplacements } from '../../app/src/main/lib-db-replaces';
import { PostRecordInputSchema } from '../../native-host/post-schemas.mts';
import { PostFlagsSchema } from '../../app/src/shared/data-schemas';
import { evalNode, makePostPredOf } from '../../app/src/renderer/src/services/query';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let handle: any;
let destFolder: string;

beforeEach(() => {
  handle = openDatabase(path.join(mkTempDir('hologram-archive-import-db-'), 'test.db'));
  destFolder = mkTempDir('hologram-archive-import-dest-');
});

afterEach(() => {
  handle.sqlite.close();
});

// importCompleteZipToDb が受け取るのは今はパス (#485＝main が yauzl で開く) なので、
// フィクスチャはディスクへ書く。JSZip は書く側にだけ残す。任意の書庫を組み立てるには
// 一番早い手段であり、読み戻すのは yauzl の役目。
let seq = 0;
function zipFileOf(buf: Buffer) {
  const p = path.join(mkTempDir('hologram-archive-import-zip-'), `fixture-${seq++}.zip`);
  fs.writeFileSync(p, buf);
  return p;
}
async function buildZip(entries: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zipFileOf(Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })));
}

describe('importCompleteZipToDb: 空DBへの完全インポート', () => {
  test.each(['deep', 'wide'])('過大な旧検索木（%s）は取り込みを拒否し、既存 DB を保持する', async (shape) => {
    let tree: unknown = { kind: 'cond', type: 'collection', value: 'source' };
    if (shape === 'deep') {
      for (let i = 0; i < 200; i++) tree = { kind: 'group', op: 'and', neg: false, children: [tree] };
    } else {
      tree = { kind: 'group', op: 'or', neg: false, children: Array.from({ length: 10_001 }, () => ({ kind: 'cond', type: 'collection', value: 'source' })) };
    }
    const writer = createDbWriter(handle.sqlite);
    writer.setFolders({ folders: [{ id: 'keep', name: 'Keep' }] });
    const before = writer.getFolders();
    const zipPath = await buildZip({
      'library/first.json': JSON.stringify({ captureId: 'first', text: '先行投稿' }),
      'library/collections.json': JSON.stringify({ collections: [{ id: 'search', name: 'Search', q: 'cat', tree }] }),
    });
    await expect(importCompleteZipToDb(handle.sqlite, zipPath, destFolder)).rejects.toThrow(ZipLimitError);
    expect(writer.getFolders()).toEqual(before);
    expect(handle.sqlite.prepare('SELECT captureId FROM posts').all()).toEqual([]);
  });

  test.each([{ choices: Array.from({ length: 101 }, () => ({ text: '選択肢', votes: 0 })) }, { choices: [{ text: 'a'.repeat(1001), votes: 0 }] }])('過大な投票を含むZIPを拒否し、既存DBとファイルを保持する: %#', async ({ choices }) => {
    writePost(preparePostStmts(handle.sqlite), makeTagResolver(handle.sqlite), { captureId: 'keep', text: '既存本文', image: 'keep.jpg', tags: ['既存タグ'] });
    const writer = createDbWriter(handle.sqlite);
    writer.setFolders({ folders: [{ id: 'keep-folder', name: '既存フォルダー' }] });
    fs.writeFileSync(path.join(destFolder, 'keep.jpg'), 'KEEP');
    const beforeRows = handle.sqlite.prepare('SELECT * FROM posts').all();
    const beforeTags = handle.sqlite.prepare('SELECT * FROM tags').all();
    const beforeFolders = writer.getFolders();
    const zipPath = await buildZip({
      'library/first.json': JSON.stringify({ captureId: 'first', text: '正常な先行投稿', tags: ['追加タグ'] }),
      'library/first.jpg': 'NEW',
      'library/oversized.json': JSON.stringify({ captureId: 'oversized', poll: { choices } }),
    });
    await expect(importCompleteZipToDb(handle.sqlite, zipPath, destFolder)).rejects.toThrow();
    expect(handle.sqlite.prepare('SELECT * FROM posts').all()).toEqual(beforeRows);
    expect(handle.sqlite.prepare('SELECT * FROM tags').all()).toEqual(beforeTags);
    expect(writer.getFolders()).toEqual(beforeFolders);
    // バイナリはDBトランザクションより先に取り込まれる。既存ファイルを上書きしない。
    expect(fs.existsSync(path.join(destFolder, 'oversized.json'))).toBe(false);
    expect(fs.readFileSync(path.join(destFolder, 'keep.jpg'), 'utf8')).toBe('KEEP');
  });
  test.each(['folders', 'collections'])('不正な %s 配列は拒否し、既存の DB 状態を保つ', async (key) => {
    const writer = createDbWriter(handle.sqlite);
    writer.setFolders({ folders: [{ id: 'keep', name: 'Keep' }] });
    const before = writer.getFolders();
    const zipPath = await buildZip({ [`library/${key}.json`]: JSON.stringify({ [key]: 'invalid' }) });
    await expect(importCompleteZipToDb(handle.sqlite, zipPath, destFolder)).rejects.toThrow();
    expect(writer.getFolders()).toEqual(before);
  });
  test('病的に長いタグを含む投稿は取り込み全体を拒否し、途中のDB書き込みを戻す', async () => {
    const pathological = '\u0300\uff9f'.repeat(30_000);
    const zipPath = await buildZip({
      'library/first.json': JSON.stringify({ captureId: 'first', text: '先に処理される投稿', tags: ['通常'], capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
      'library/pathological.json': JSON.stringify({ captureId: 'pathological', tags: [pathological], capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
    });

    await expect(importCompleteZipToDb(handle.sqlite, zipPath, destFolder)).rejects.toThrow();
    expect(handle.sqlite.prepare('SELECT captureId FROM posts').all()).toEqual([]);
    expect(handle.sqlite.prepare('SELECT name FROM tags').all()).toEqual([]);
  });
  test('投稿サイドカーがDBへ書かれ、ディスクへは書かれない', async () => {
    const zipPath = await buildZip({
      'library/cap-1.json': JSON.stringify({ captureId: 'cap-1', text: 'hello', tags: ['a'], capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
      'library/cap-1.jpg': 'JPEGDATA',
    });
    const res = await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    expect(res.ok).toBe(true);
    expect(res.imported).toBe(2); // 投稿 + バイナリ
    const row = handle.sqlite.prepare('SELECT text FROM posts WHERE captureId = ?').get('cap-1');
    expect(row.text).toBe('hello');
    expect(fs.existsSync(path.join(destFolder, 'cap-1.json'))).toBe(false); // サイドカーはディスクに残さない
    expect(fs.existsSync(path.join(destFolder, 'cap-1.jpg'))).toBe(true); // バイナリはディスクに残る
  });

  test('項目フォルダーの実体と参照をその階層のまま復元する', async () => {
    const zipPath = await buildZip({
      'library/cap-item.json': JSON.stringify({ captureId: 'cap-item', image: 'items/cap-item/cap-item.jpg', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
      'library/items/cap-item/cap-item.jpg': 'ITEMDATA',
    });
    const res = await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    expect(res.ok).toBe(true);
    expect(fs.readFileSync(path.join(destFolder, 'items', 'cap-item', 'cap-item.jpg'), 'utf8')).toBe('ITEMDATA');
    expect(handle.sqlite.prepare('SELECT image FROM posts WHERE captureId = ?').get('cap-item').image).toBe('items/cap-item/cap-item.jpg');
  });

  test('folders.json / tag-groups.json がDBへ反映される', async () => {
    const zipPath = await buildZip({
      'library/folders.json': JSON.stringify({ folders: [{ id: 'f1', name: 'X', kind: 'static', items: [] }] }),
      'library/tag-groups.json': JSON.stringify({ memberships: { a: 'character' } }),
    });
    await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    const dbw = createDbWriter(handle.sqlite);
    expect(dbw.getFolders().folders.map((f: any) => f.id)).toEqual(['f1']);
    expect(dbw.getTagGroupNames().memberships.a).toBe('character');
  });

  test('tabs.json はインポートしない', async () => {
    const zipPath = await buildZip({ 'library/tabs.json': JSON.stringify({ tabs: [{ id: 't1', pinned: false, title: 'x', state: {} }], activeTabId: 't1' }) });
    await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    expect(createDbWriter(handle.sqlite).getTabs()).toBeNull();
  });

  test('poster-favorites.json（旧形式のみ）はDBテーブルが無いため無視される', async () => {
    const zipPath = await buildZip({ 'library/poster-favorites.json': JSON.stringify({ keys: ['a'] }) });
    const res = await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    expect(res.ok).toBe(true); // エラーにはならず、黙って無視されるだけ
  });
});

describe('importCompleteZipToDb: 非空DBへはマージ（置換ではない）', () => {
  test.each(['collections', 'folders'])('%s だけの旧書庫でも q と否定されたフォルダ条件を両方保つ', async (key) => {
    const zipPath = await buildZip({
      [`library/${key}.json`]: JSON.stringify({
        [key]: [
          { id: 'source', name: 'Source', kind: 'static', items: ['member'] },
          { id: 'empty-query', name: 'Empty query', q: '   ' },
          { id: 'explicit-static', name: 'Static', kind: 'static', q: 'cat', items: ['member'] },
          { id: 'search', name: 'Search', q: ' cat ', tree: { kind: 'group', op: 'or', neg: true, children: [{ kind: 'cond', type: 'collection', value: 'source' }] } },
        ],
      }),
      'library/member.json': JSON.stringify({ captureId: 'member', text: 'cat' }),
    });
    await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    const state = createDbWriter(handle.sqlite).getFolders();
    expect(state.folders.find((folder) => folder.id === 'empty-query')?.kind).toBe('static');
    expect(state.folders.find((folder) => folder.id === 'explicit-static')).toMatchObject({ kind: 'static', items: ['member'] });
    const search = state.folders.find((folder) => folder.id === 'search');
    expect(search?.kind).toBe('dynamic');
    const predicates = makePostPredOf({ isInFolder: (id, captureId) => id === 'source' && captureId === 'member', postMatcher: (query) => (post) => post.text?.includes(query) ?? false });
    const matches = (captureId: string, text: string) => evalNode(search?.tree, { captureId, text, media: [], tags: [], hashtags: [] } as any, predicates);
    expect(matches('outside', 'cat')).toBe(true);
    expect(matches('member', 'cat')).toBe(false);
    expect(matches('outside', 'dog')).toBe(false);
  });

  test('同じ ID の既存 DB の名前・種類・親・検索条件を保ち、所属だけを統合する', async () => {
    const writer = createDbWriter(handle.sqlite);
    const statements = preparePostStmts(handle.sqlite);
    const tags = makeTagResolver(handle.sqlite);
    writePost(statements, tags, { captureId: 'existing-member', text: 'local' });
    const tree = { kind: 'cond', type: 'text', value: 'local' };
    writer.setFolders({
      folders: [
        { id: 'parent', name: 'Parent' },
        { id: 'duplicate', name: 'Local', kind: 'dynamic', items: ['existing-member'], tree },
        { id: 'static-duplicate', name: 'Local static', kind: 'static', parentId: 'parent', items: ['existing-member'] },
      ],
    });
    const zipPath = await buildZip({
      'library/collections.json': JSON.stringify({ collections: [{ id: 'duplicate', name: 'Legacy', kind: 'static', items: ['incoming-member'] }] }),
      'library/folders.json': JSON.stringify({
        folders: [
          { id: 'duplicate', name: 'Modern', kind: 'static', items: ['incoming-member'] },
          { id: 'static-duplicate', name: 'Modern static', kind: 'static', items: ['incoming-member'] },
        ],
      }),
      'library/incoming-member.json': JSON.stringify({ captureId: 'incoming-member', text: 'incoming' }),
    });
    await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    const folder = writer.getFolders().folders.find((entry) => entry.id === 'duplicate');
    expect(folder).toMatchObject({ name: 'Local', kind: 'dynamic', parentId: null, tree });
    expect(folder?.items.slice().sort()).toEqual(['existing-member', 'incoming-member']);
    const staticFolder = writer.getFolders().folders.find((entry) => entry.id === 'static-duplicate');
    expect(staticFolder).toMatchObject({ name: 'Local static', kind: 'static', parentId: 'parent' });
    expect(staticFolder?.items.slice().sort()).toEqual(['existing-member', 'incoming-member']);
  });

  test('旧 collections を内容から移行し、現形式優先のまま ZIP roundtrip 後も検索意図を保つ', async () => {
    const dbw = createDbWriter(handle.sqlite);
    dbw.setFolders({ folders: [{ id: 'local', name: 'Local', kind: 'static', items: ['local-post'] }] });
    const legacyTree = {
      kind: 'group',
      op: 'and',
      neg: false,
      children: [{ kind: 'group', op: 'or', neg: false, children: [{ kind: 'cond', type: 'collection', value: 'source' }] }],
    };
    const zipPath = await buildZip({
      'library/collections.json': JSON.stringify({
        collections: [
          { id: 'legacy', name: 'Legacy', q: 'cat', tree: legacyTree },
          { id: 'legacy-parent', name: 'Legacy parent', kind: 'static' },
          { id: 'legacy-static', name: 'Editable legacy', kind: 'static', parentId: 'legacy-parent', items: ['static-member'] },
          { id: 'modern-wins', name: 'Old duplicate', q: 'must-not-win' },
        ],
      }),
      // 移行途中の版は、ファイル名だけ folders に変えて内側を collections のまま書いた。
      'library/folders.json': JSON.stringify({
        folders: [
          { id: 'modern-wins', name: 'Modern duplicate', kind: 'static', items: ['modern-post'] },
          { id: 'source', name: 'Source', kind: 'static', items: ['in'] },
          { id: 'transitional', name: 'Transitional folders entry', q: 'fox', tree: legacyTree },
        ],
        collections: [{ id: 'half', name: 'Half migrated', q: 'bird', tree: legacyTree }],
      }),
      'library/in.json': JSON.stringify({ captureId: 'in', text: 'source member', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
      'library/modern-post.json': JSON.stringify({ captureId: 'modern-post', text: 'modern', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
      'library/static-member.json': JSON.stringify({ captureId: 'static-member', text: 'editable', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
    });

    await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    const first = dbw.getFolders();
    expect(first.folders.find((f: any) => f.id === 'local')?.name).toBe('Local');
    expect(first.folders.find((f: any) => f.id === 'modern-wins')).toMatchObject({ name: 'Modern duplicate', kind: 'static', items: ['modern-post'] });
    expect(first.folders.find((f: any) => f.id === 'legacy-static')).toMatchObject({ kind: 'static', parentId: 'legacy-parent', items: ['static-member'] });
    expect(first.folders.find((f: any) => f.id === 'transitional')?.kind).toBe('dynamic');

    const exported = path.join(mkTempDir('hologram-legacy-roundtrip-'), 'roundtrip.zip');
    await writeCompleteZip(handle.sqlite, destFolder, null, exported);
    const secondHandle = openDatabase(path.join(mkTempDir('hologram-legacy-roundtrip-db-'), 'test.db'));
    try {
      await importCompleteZipToDb(secondHandle.sqlite, exported, mkTempDir('hologram-legacy-roundtrip-dest-'));
      const roundtripped = createDbWriter(secondHandle.sqlite).getFolders();
      const byId = new Map(roundtripped.folders.map((folder: any) => [folder.id, folder]));
      const membership = new Map(roundtripped.folders.map((folder: any) => [folder.id, new Set(folder.items)]));
      const predOf = makePostPredOf({
        isInFolder: (id, captureId) => membership.get(id)?.has(captureId) ?? false,
        postMatcher: (query) => (post: any) => post.text.includes(query),
      });
      const matches = (id: string, post: any) => evalNode(byId.get(id).tree, post, predOf);

      expect(matches('legacy', { captureId: 'in', text: 'a cat', media: [], tags: [], hashtags: [] })).toBe(true);
      expect(matches('legacy', { captureId: 'out', text: 'a cat', media: [], tags: [], hashtags: [] })).toBe(false);
      expect(matches('legacy', { captureId: 'in', text: 'a dog', media: [], tags: [], hashtags: [] })).toBe(false);
      expect(matches('half', { captureId: 'in', text: 'a bird', media: [], tags: [], hashtags: [] })).toBe(true);
      expect(matches('half', { captureId: 'out', text: 'a bird', media: [], tags: [], hashtags: [] })).toBe(false);
      expect(matches('transitional', { captureId: 'in', text: 'a fox', media: [], tags: [], hashtags: [] })).toBe(true);
      expect(matches('transitional', { captureId: 'out', text: 'a fox', media: [], tags: [], hashtags: [] })).toBe(false);
      expect(byId.get('legacy').tree.children[1].children[0].type).toBe('folder');
      expect(byId.get('transitional').tree.children[1].children[0].type).toBe('folder');
      expect(byId.get('legacy-static')).toMatchObject({ kind: 'static', parentId: 'legacy-parent', items: ['static-member'] });
      for (const id of ['legacy', 'legacy-parent', 'legacy-static', 'modern-wins', 'source', 'transitional', 'half']) {
        const portable = (value: unknown) => JSON.parse(JSON.stringify(value, (key, child) => (key.startsWith('_') ? undefined : child)));
        expect(portable(byId.get(id))).toEqual(portable(first.folders.find((folder: any) => folder.id === id)));
      }
    } finally {
      secondHandle.sqlite.close();
    }
  });

  test('既存の投稿を上書きしない（skip-if-exists と同じ契約）', async () => {
    const { sqlite } = handle;
    const stmts = preparePostStmts(sqlite);
    const resolveTagId = makeTagResolver(sqlite);
    writePost(stmts, resolveTagId, { captureId: 'cap-1', text: 'ORIGINAL', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', media: [], tags: [], hashtags: [] } as any, null);

    const zipPath = await buildZip({ 'library/cap-1.json': JSON.stringify({ captureId: 'cap-1', text: 'INCOMING', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }) });
    const res = await importCompleteZipToDb(sqlite, zipPath, destFolder);
    expect(res.skipped).toBe(1);
    expect(sqlite.prepare('SELECT text FROM posts WHERE captureId = ?').get('cap-1').text).toBe('ORIGINAL');
  });

  test('既存フォルダは、着信フォルダとの id 和集合になる（丸ごと置換されない）', async () => {
    const dbw = createDbWriter(handle.sqlite);
    dbw.setFolders({ folders: [{ id: 'local', name: 'Local', kind: 'static', items: [] }] });

    const zipPath = await buildZip({ 'library/folders.json': JSON.stringify({ folders: [{ id: 'incoming', name: 'Incoming', kind: 'static', items: [] }] }) });
    await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);

    const ids = createDbWriter(handle.sqlite)
      .getFolders()
      .folders.map((f: any) => f.id)
      .sort();
    expect(ids).toEqual(['incoming', 'local']);
  });

  test('投稿サイドカーの replaces を置換命令として取り込まない', async () => {
    const { sqlite } = handle;
    writePost(preparePostStmts(sqlite), makeTagResolver(sqlite), { captureId: 'local-post', url: 'https://example.com/local', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', media: [], tags: [], hashtags: [] } as any, null);
    const zipPath = await buildZip({
      'library/imported-post.json': JSON.stringify({
        captureId: 'imported-post',
        url: 'https://attacker.example/unrelated',
        replaces: 'local-post',
        capturedAt: '2026-01-02T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      }),
    });

    await importCompleteZipToDb(sqlite, zipPath, destFolder);
    expect(sqlite.prepare('SELECT replaces FROM posts WHERE captureId = ?').get('imported-post')).toEqual({ replaces: null });

    const report = await applyPendingReplacements({ sqlite, folder: destFolder, trashDir: path.join(destFolder, '.trash'), mediaExts: ['.jpg'] });
    expect(report.applied).toEqual([]);
    expect(sqlite.prepare('SELECT captureId FROM posts ORDER BY captureId').all()).toEqual([{ captureId: 'imported-post' }, { captureId: 'local-post' }]);
  });
});

describe('importCompleteZipToDb: 冪等性', () => {
  test('同じZIPを2回インポートしても重複しない', async () => {
    const zipPath = await buildZip({
      'library/cap-1.json': JSON.stringify({ captureId: 'cap-1', text: 'hello', tags: ['a'], capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
    });
    const first = await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    const second = await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
    expect(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n).toBe(1);
  });
});

describe('importCompleteZipToDb: .trash/ の復元', () => {
  test('.trash/ 配下はファイルシステムへ復元され、DBのpostsには書かれない', async () => {
    // これが complete のエクスポートだと示すのは manifest（#485 でその判定は main へ移った）。
    // 本物の includeTrash のエクスポートは、.trash/ と一緒に必ず manifest を持つ。
    const zipPath = await buildZip({ 'hologram-export.json': '{"app":"Hologram","kind":"complete"}', '.trash/cap-9.json': JSON.stringify({ captureId: 'cap-9' }), '.trash/cap-9.jpg': 'TRASHED' });
    const res = await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    expect(res.imported).toBe(2);
    expect(fs.readFileSync(path.join(destFolder, '.trash', 'cap-9.json'), 'utf8')).toContain('cap-9');
    expect(fs.readFileSync(path.join(destFolder, '.trash', 'cap-9.jpg'), 'utf8')).toBe('TRASHED');
    expect(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n).toBe(0);
  });
});

describe('完全ZIPのゴミ箱レコードの置換指示', () => {
  test.each(['json', 'JSON'])('復元用の%sから置換指示を除き、投稿と利用者の情報は残す', async (extension) => {
    const { sqlite } = handle;
    writePost(preparePostStmts(sqlite), makeTagResolver(sqlite), { captureId: 'local-post', text: 'KEEP' });
    const incoming = { captureId: 'imported-trash', replaces: 'local-post', text: 'RESTORE', tags: ['kept-tag'], userKind: 'media', tagReviewed: true, localViewCount: 7, trashedAt: '2026-01-01T00:00:00Z' };
    const zipPath = await buildZip({ 'hologram-export.json': '{}', [`.trash/imported-trash.${extension}`]: JSON.stringify(incoming), '.trash/imported-trash.jpg': 'MEDIA' });
    await importCompleteZipToDb(sqlite, zipPath, destFolder);
    const stored = JSON.parse(fs.readFileSync(path.join(destFolder, '.trash', `imported-trash.${extension}`), 'utf8'));
    expect(stored).toEqual({ ...incoming, replaces: null });
    const restored = { ...PostRecordInputSchema.parse(stored), ...PostFlagsSchema.parse(stored), trashedAt: null };
    writePost(preparePostStmts(sqlite), makeTagResolver(sqlite), restored);
    createDbWriter(sqlite).restorePostFlags(restored.captureId, restored);
    const report = await applyPendingReplacements({ sqlite, folder: destFolder, trashDir: path.join(destFolder, '.trash'), mediaExts: ['.jpg'] });
    expect(report.applied).toEqual([]);
    expect(sqlite.prepare('SELECT text FROM posts WHERE captureId = ?').get('local-post')).toEqual({ text: 'KEEP' });
    expect(sqlite.prepare('SELECT text, replaces, tagReviewed, localViewCount FROM posts WHERE captureId = ?').get('imported-trash')).toEqual({ text: 'RESTORE', replaces: null, tagReviewed: 1, localViewCount: 7 });
    expect(fs.readFileSync(path.join(destFolder, '.trash', 'imported-trash.jpg'), 'utf8')).toBe('MEDIA');
  });
});
