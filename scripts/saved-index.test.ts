// app/src/main/lib-saved-index.ts のユニットテスト＝ブリッジが読む「保存済み」
// スナップショット（configDir/bridge-saved-index.json）を DB から組み立てる側。
// 読み出し側（ブリッジの handleQuery とその3情報源の合流）は bridge-query.test.ts。
//
// ここが押さえるのは2つ。①投稿の同一性は postKey（URL の表記ゆれを畳んだ鍵）であって
// captureId ではない ②#334 以降、エントリはその投稿の保存済みの絵まで運ぶ＝複数枚投稿の
// 1枚だけを保存した状態を答えられること。②は「同じ投稿の2枚目は別レコードになる」ので、
// 鍵をまたぐ合流が要る（1レコードだけ読むと、保存済みの絵に保存ボタンを出す）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';
import { buildSavedIndex, SAVED_INDEX_VERSION } from '../app/src/main/lib-saved-index';
import { postKeyOf } from '../native-host/post-key.mts';

const MULTI = 'https://x.com/dave/status/444';
const IMG_A = 'https://pbs.twimg.com/media/AAA?format=jpg&name=orig';
const IMG_B = 'https://pbs.twimg.com/media/BBB?format=jpg&name=orig';

let dir: string;
let handle: any;
let index: any;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-saved-index-'));
  handle = openDatabase(path.join(dir, 'test.db'));
  const stmts = preparePostStmts(handle.sqlite);
  const resolveTagId = makeTagResolver(handle.sqlite);
  const base = { capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', platform: 'x' };

  // 複数枚投稿を、1枚ずつ2回に分けて保存した状態（ホバー保存・ドラッグ保存の実際の形）。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-a', url: MULTI, image: 'cap-a.jpg', media: [{ url: IMG_A, file: 'cap-a.jpg' }] });
  // 同じ投稿を twitter.com 表記＋クエリつきで保存したもの＝postKey は同じ鍵に畳まれる。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-b', url: `${MULTI.replace('x.com', 'twitter.com')}?s=20`, image: 'cap-b.jpg', media: [{ url: IMG_B, file: 'cap-b.jpg' }] });
  // 絵を持たないレコード（テキストのみ／取り込みが1枚も落とせなかった投稿）。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-c', url: 'https://x.com/erin/status/555', image: 'cap-c.jpg', media: [] });
  // ゴミ箱の中身は「ライブラリに在る」ではない。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-d', url: 'https://x.com/frank/status/666', image: 'cap-d.jpg', media: [{ url: 'https://pbs.twimg.com/media/CCC?name=orig', file: 'cap-d.jpg' }], trashedAt: '2026-01-02T00:00:00Z' });

  index = buildSavedIndex(handle.sqlite, () => '2026-01-03T00:00:00Z');
});

afterAll(() => {
  handle.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('スナップショットの形', () => {
  test('絵まで運ぶ v2', () => {
    expect(index.version).toBe(SAVED_INDEX_VERSION);
    expect(SAVED_INDEX_VERSION).toBe(2);
  });

  test('鍵は postKey＝URL の表記ゆれを畳んだもの', () => {
    expect(Object.keys(index.entries).sort()).toEqual([postKeyOf(MULTI), postKeyOf('https://x.com/erin/status/555')].sort());
  });
});

describe('投稿の保存済みの絵', () => {
  test('同じ投稿の2レコードの絵が1つのエントリに合流する', () => {
    expect(index.entries[postKeyOf(MULTI) as string].media).toEqual([IMG_A, IMG_B]);
  });

  test('captureId は最初に鍵を取ったレコードのもの（バッジには「どれか1つ」で足りる）', () => {
    expect(index.entries[postKeyOf(MULTI) as string].id).toBe('cap-a');
  });

  test('絵を持たない投稿は空の一覧＝保存済み・粒度は不明', () => {
    expect(index.entries[postKeyOf('https://x.com/erin/status/555') as string]).toEqual({ id: 'cap-c', media: [] });
  });

  test('ゴミ箱の投稿は載らない', () => {
    expect(index.entries[postKeyOf('https://x.com/frank/status/666') as string]).toBeUndefined();
  });
});
