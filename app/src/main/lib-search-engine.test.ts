import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SearchEngine } from './lib-search-engine.ts';
import { searchFields } from '../shared/search-fields.ts';
import { ipcInputs } from '../shared/ipc-inputs.ts';

let engine: SearchEngine;
let directory: string;
const binary = path.resolve(`app/vendor/meilisearch/meilisearch${process.platform === 'win32' ? '.exe' : ''}`);
afterEach(async () => {
  await engine?.stop();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
});
test('公式エンジンで誤字・更新・削除・ライブラリ分離を確認する', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'hologram-meili-'));
  engine = new SearchEngine(binary, directory);
  const docs = [
    { id: 'a', fields: { text: 'beautiful illustration 猫のイラスト' } },
    { id: 'b', fields: { text: 'beautiful landscape 犬の写真' } },
  ];
  expect((await engine.search('one', 'posts', docs, 'illustraton')).map((h) => h.postId)).toEqual(['a']);
  expect((await engine.search('one', 'posts', docs, 'illustraton'))[0]).toMatchObject({ field: 'text', matchStart: 10, matchEnd: 21 });
  expect((await engine.search('one', 'posts', docs, '猫')).map((h) => h.postId)).toEqual(['a']);
  const kana = [{ id: 'k', fields: { text: 'カタカナ' } }];
  expect((await engine.search('kana', 'posts', kana, 'かたかな')).map((h) => h.postId)).toEqual(['k']);
  const unicode = (await engine.search('unicode', 'posts', [{ id: 'u', fields: { text: '😀犬と猫の絵' } }], '猫'))[0];
  expect(unicode.snippetText?.slice(unicode.matchStart, unicode.matchEnd)).toBe('猫');
  expect(await engine.search('two', 'posts', [], '猫')).toEqual([]);
  expect(await engine.search('one', 'posts', docs.slice(1), '猫')).toEqual([]);
  expect((await engine.search('one', 'posts', [{ id: 'b', fields: { text: '猫' } }], '猫')).map((h) => h.postId)).toEqual(['b']);
}, 120000);

test('全角・半角を照合し、合成・展開で長さが変わっても原文を強調する', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'hologram-meili-'));
  engine = new SearchEngine(binary, directory);
  for (const [query, original, selected] of [
    ['abc123', '😀 ＡＢＣ１２３ の記録', 'ＡＢＣ１２３'],
    ['ＡＢＣ１２３', '😀 abc123 の記録', 'abc123'],
    ['ガール', '😀 ﾐｸとｶﾞｰﾙの絵', 'ｶﾞｰﾙ'],
    ['ガール', '😀 カ\u3099ールの絵', 'カ\u3099ール'],
    ['ffi', '😀 ﬃ test', 'ﬃ'],
  ]) {
    const docs = [{ id: 'a', fields: { text: original } }];
    const [hit] = await engine.search('normalization', 'posts', docs, query);
    expect(hit, query).toBeDefined();
    expect(hit.snippetText).toBe(original);
    expect(hit.snippetText?.slice(hit.matchStart, hit.matchEnd), query).toBe(selected);
    expect(docs[0].fields.text).toBe(original);
  }
}, 120000);

test('短い名前と数字を混同せず、ID以外の誤字補正と前方一致を保つ', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'hologram-meili-'));
  engine = new SearchEngine(binary, directory);
  const docs = [
    { id: 'miku', fields: searchFields({ text: 'ミクのイラスト' }) },
    { id: 'mika', fields: searchFields({ text: 'ミカのイラスト' }) },
    { id: 'miki', fields: searchFields({ text: 'ミキのイラスト' }) },
    { id: 'num', fields: searchFields({ text: '作品1234' }) },
    { id: 'num_other', fields: searchFields({ text: '作品1235' }) },
    { id: 'id', fields: searchFields({ screenName: 'nprmtp' }) },
    { id: 'id_other', fields: searchFields({ screenName: 'nprmtx' }) },
    { id: 'quoted_id_other', fields: searchFields({ quotedPost: { screenName: 'nprmtx' } }) },
    { id: 'quoted_id', fields: searchFields({ quotedPost: { screenName: 'nprmtp' } }) },
    { id: 'blue', fields: searchFields({ text: 'Bluesky' }) },
  ];
  const ids = async (query: string) => (await engine.search('precision', 'posts', docs, query)).map((hit) => hit.postId);
  expect(await ids('ミク')).toEqual(['miku']);
  expect(await ids('1234')).toEqual(['num']);
  expect(await ids('nprmtp')).toEqual(['id', 'quoted_id']);
  expect(await ids('Blueskyy')).toEqual(['blue']);
  expect(await ids('ミク 写真')).toEqual([]);
  const [, entries] = ipcInputs['search-candidates'].parse([
    'nprmtp',
    [
      { id: 'a', title: '作者', screenName: 'nprmtp' },
      { id: 'b', title: '作者', screenName: 'nprmtx' },
      { id: 'c', title: 'フォルダ', keywords: 'illustration' },
    ],
  ]);
  const candidates = entries.map((e) => ({ id: e.id, fields: { title: e.title, screenName: e.screenName || '', keywords: e.keywords || '' } }));
  const candidateIds = async (q: string) => (await engine.search('precision', 'candidates', candidates, q)).map((h) => h.postId);
  expect(await candidateIds('nprmtp')).toEqual(['a']);
  expect(await candidateIds('nprmt')).toEqual(['a', 'b']);
  expect(await candidateIds('illustraton')).toEqual(['c']);
}, 120000);

test('単語の完全一致を優先し、同条件ではタグ・タイトルを本文・引用より上にする', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'hologram-meili-'));
  engine = new SearchEngine(binary, directory);
  const docs = [
    { id: 'prefix', fields: searchFields({ tags: ['caterpillar'] }) },
    { id: 'exact', fields: searchFields({ text: 'cat' }) },
    { id: 'quote', fields: searchFields({ quotedPost: { text: 'セイバー' } }) },
    { id: 'body', fields: searchFields({ text: 'セイバー' }) },
    { id: 'name', fields: searchFields({ displayName: 'セイバー' }) },
    { id: 'title', fields: searchFields({ title: 'セイバー' }) },
    { id: 'tag', fields: searchFields({ tags: ['セイバー'] }) },
  ];
  expect((await engine.search('ranking', 'posts', docs, 'cat')).map((h) => h.postId)).toEqual(['exact', 'prefix']);
  expect((await engine.search('ranking', 'posts', docs, 'セイバー')).map((h) => h.postId)).toEqual(['tag', 'title', 'name', 'body', 'quote']);
}, 120000);
