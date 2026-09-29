import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { saveClassifiedTag, getClassifiedAssignments, setClassifiedAssignments } from '../../app/src/main/lib-tag-classification';
import { deleteTags, mergeTags, renameTag } from '../../app/src/main/lib-db-tag-vocab';
import { createDbWriter } from '../../app/src/main/lib-db-write';
import { writeCompleteZip, importCompleteZipToDb } from '../../app/src/main/lib-archive';
import { trashCapture } from '../../app/src/main/lib-trash-capture';
import { MAX_CLASSIFIED_TAG_VOCABULARY, PortableClassifiedTagVocabulary } from '../../app/src/shared/tag-classification';

let directory: string;
let handle: ReturnType<typeof openDatabase>;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-classification-'));
  handle = openDatabase(path.join(directory, 'test.db'));
  handle.sqlite.prepare("INSERT INTO posts(captureId,capturedAt,updatedAt) VALUES('p','2026-01-01','2026-01-01')").run();
});
afterEach(() => {
  handle.sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
const tag = (name: string, category: 'work' | 'character' | 'general', workId: number | null = null) => saveClassifiedTag(handle.sqlite, { name, category, workId });
const assign = (...tagIds: number[]) => setClassifiedAssignments(handle.sqlite, [{ postId: 'p', tagIds }]);
const links = () => handle.sqlite.prepare("SELECT tagId,implied FROM post_tags WHERE postId='p' ORDER BY tagId").all();

test('キャラに作品を自動付与し、最後のキャラを外すと作品も外す', () => {
  const work = tag('作品', 'work'),
    character = tag('キャラ', 'character', work);
  assign(character);
  expect(links()).toEqual([
    { tagId: work, implied: 1 },
    { tagId: character, implied: 0 },
  ]);
  expect(getClassifiedAssignments(handle.sqlite, ['p'])).toEqual([{ postId: 'p', tagIds: [character] }]);
  assign();
  expect(links()).toEqual([]);
});
test('明示的に付けた作品はキャラを外しても残る', () => {
  const work = tag('作品', 'work'),
    character = tag('キャラ', 'character', work);
  assign(work, character);
  assign(work);
  expect(links()).toEqual([{ tagId: work, implied: 0 }]);
});
test('作品なしキャラを単独で付与できる', () => {
  const character = tag('オリキャラ', 'character');
  assign(character);
  expect(links()).toEqual([{ tagId: character, implied: 0 }]);
});
test('既存タグのIDと付与を保って分類し、親変更も反映する', () => {
  const one = tag('作品1', 'work'),
    two = tag('作品2', 'work'),
    character = tag('既存', 'general');
  handle.sqlite.prepare('INSERT INTO post_tags(postId,tagId) VALUES(?,?)').run('p', character);
  saveClassifiedTag(handle.sqlite, { id: character, name: '既存', category: 'character', workId: one });
  expect(links()).toContainEqual({ tagId: one, implied: 1 });
  saveClassifiedTag(handle.sqlite, { id: character, name: '既存', category: 'character', workId: two });
  expect(links()).toEqual([
    { tagId: two, implied: 1 },
    { tagId: character, implied: 0 },
  ]);
});
test('同名キャラを作品ごとに区別する', () => {
  const one = tag('作品1', 'work'),
    two = tag('作品2', 'work');
  const a = tag('アリス', 'character', one),
    b = tag('アリス', 'character', two);
  expect(a).not.toBe(b);
  assign(a, b);
  expect(links()).toHaveLength(4);
  expect(renameTag(handle.sqlite, b, 'アリス')).toEqual({ ok: true });
  expect(mergeTags(handle.sqlite, a, b).ok).toBe(false);
});
test('作品削除後もキャラを作品なしとして保持する', () => {
  const work = tag('作品', 'work'),
    character = tag('キャラ', 'character', work);
  assign(character);
  deleteTags(handle.sqlite, [work]);
  expect(links()).toEqual([{ tagId: character, implied: 0 }]);
  expect(handle.sqlite.prepare('SELECT workId FROM tags WHERE id=?').get(character)).toEqual({ workId: null });
});
test('キャラ削除で自動付与の作品を残さない', () => {
  const work = tag('作品', 'work'),
    character = tag('キャラ', 'character', work);
  assign(character);
  deleteTags(handle.sqlite, [character]);
  expect(links()).toEqual([]);
});
test('自己参照と不正な親を拒否する', () => {
  const work = tag('作品', 'work');
  expect(() => saveClassifiedTag(handle.sqlite, { id: work, name: '作品', category: 'character', workId: work })).toThrow('invalid-work');
  expect(() => tag('キャラ', 'character', 999)).toThrow('invalid-work');
});
test('一括付与で途中に不正なIDがあれば全体を戻す', () => {
  const work = tag('作品', 'work');
  assign(work);
  expect(() =>
    setClassifiedAssignments(handle.sqlite, [
      { postId: 'p', tagIds: [] },
      { postId: 'missing', tagIds: [] },
    ]),
  ).toThrow();
  expect(links()).toEqual([{ tagId: work, implied: 0 }]);
});
test('バージョン49から既存タグを通常タグとして維持して移行する', () => {
  const id = tag('既存タグ', 'general');
  handle.sqlite.prepare('INSERT INTO post_tags(postId,tagId) VALUES(?,?)').run('p', id);
  handle.sqlite.exec(
    'ALTER TABLE posts DROP COLUMN saveIncomplete; ALTER TABLE posts DROP COLUMN lastViewedAt; DROP TABLE poster_names; DROP INDEX idx_tags_workId; ALTER TABLE tags DROP COLUMN workId; ALTER TABLE tags DROP COLUMN category; ALTER TABLE post_tags DROP COLUMN implied; ALTER TABLE media DROP COLUMN rotation; ALTER TABLE media DROP COLUMN flipped; PRAGMA user_version=49;',
  );
  handle.sqlite.close();
  handle = openDatabase(path.join(directory, 'test.db'));
  expect(handle.sqlite.pragma('user_version', { simple: true })).toBe(54);
  expect(handle.sqlite.prepare('SELECT id,category,workId FROM tags').all()).toEqual([{ id, category: 'general', workId: null }]);
  expect(links()).toEqual([{ tagId: id, implied: 0 }]);
});

test('ZIPの往復で所属作品、作品なし、手動付与と未使用タグを保持する', async () => {
  const work = tag('作品', 'work'),
    character = tag('キャラ', 'character', work),
    oc = tag('OC', 'character');
  tag('未使用キャラ', 'character', work);
  assign(character, oc);
  const source = path.join(directory, 'source'),
    target = path.join(directory, 'target'),
    zip = path.join(directory, 'backup.zip');
  fs.mkdirSync(source);
  fs.mkdirSync(target);
  await writeCompleteZip(handle.sqlite, source, null, zip);
  const destination = openDatabase(path.join(directory, 'restored.db'));
  try {
    await importCompleteZipToDb(destination.sqlite, zip, target);
    const writer = createDbWriter(destination.sqlite);
    expect(writer.getPostFlags('p')?.tagClassification).toEqual(createDbWriter(handle.sqlite).getPostFlags('p')?.tagClassification);
    expect(writer.tagVocabOverview().some((row) => row.name === '未使用キャラ' && row.category === 'character')).toBe(true);
    writer.setClassifiedAssignments([{ postId: 'p', tagIds: [] }]);
    expect(writer.getPostFlags('p')?.tags).toEqual([]);
  } finally {
    destination.sqlite.close();
  }
});

test('ZIPの分類タグ語彙は件数を制限し、自動付与を一括で再計算する', async () => {
  const existingWork = tag('既存作品', 'work');
  const existingCharacter = tag('既存キャラ', 'character', existingWork);
  assign(existingCharacter);
  handle.sqlite.exec(`
    CREATE TABLE implied_delete_audit (value INTEGER);
    CREATE TRIGGER audit_implied_delete AFTER DELETE ON post_tags WHEN OLD.implied = 1
    BEGIN INSERT INTO implied_delete_audit VALUES (1); END;
  `);

  const zip = new JSZip();
  zip.file(
    'library/classified-tags.json',
    JSON.stringify([
      { name: '作品1', category: 'work', workName: null },
      { name: '作品2', category: 'work', workName: null },
      { name: '作品3', category: 'work', workName: null },
    ]),
  );
  const zipPath = path.join(directory, 'vocabulary.zip');
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

  await importCompleteZipToDb(handle.sqlite, zipPath, path.join(directory, 'imported'));
  expect(handle.sqlite.prepare('SELECT COUNT(*) AS count FROM implied_delete_audit').get()).toEqual({ count: 1 });
  expect(() => PortableClassifiedTagVocabulary.parse(Array.from({ length: MAX_CLASSIFIED_TAG_VOCABULARY + 1 }, (_, i) => ({ name: `作品${i}`, category: 'work', workName: null })))).toThrow();
});

test('ゴミ箱のレコードから作品・キャラの関係を復元できる', async () => {
  const work = tag('作品', 'work'),
    character = tag('キャラ', 'character', work);
  assign(character);
  const writer = createDbWriter(handle.sqlite),
    folder = path.join(directory, 'library'),
    trashDir = path.join(directory, 'trash');
  fs.mkdirSync(folder);
  await trashCapture({ folder, trashDir, mediaExts: [], captureId: 'p', record: { captureId: 'p', media: [] }, flags: writer.getPostFlags('p') });
  const rec = JSON.parse(fs.readFileSync(path.join(trashDir, 'p.json'), 'utf8'));
  assign();
  writer.restorePostFlags('p', rec);
  expect(links()).toEqual([
    { tagId: work, implied: 1 },
    { tagId: character, implied: 0 },
  ]);
});
