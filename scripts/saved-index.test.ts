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
  // 殻レコード（#492）＝投稿が削除・非公開などで何も取れなかった保存。URL から復元できる
  // screenName と日時しか持たない。ブリッジはもう書かないが、直る前に書かれたものが
  // ライブラリに残っている。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-e', url: 'https://x.com/gina/status/777', screenName: 'gina', date: '2026-06-23T11:15:10.728Z', image: null, media: [] });
  // テキストのみ投稿（#365）は殻ではない＝本文がライブラリに在る。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-f', url: 'https://x.com/hana/status/888', text: '本文だけの投稿', image: null, media: [] });

  index = buildSavedIndex(handle.sqlite, () => '2026-01-03T00:00:00Z');
});

afterAll(() => {
  handle.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('スナップショットの形', () => {
  test('絵と、その絵を持つレコードまで運ぶ v3', () => {
    expect(index.version).toBe(SAVED_INDEX_VERSION);
    expect(SAVED_INDEX_VERSION).toBe(3);
  });

  test('鍵は postKey＝URL の表記ゆれを畳んだもの', () => {
    expect(Object.keys(index.entries).sort()).toEqual([postKeyOf(MULTI), postKeyOf('https://x.com/erin/status/555'), postKeyOf('https://x.com/hana/status/888')].sort());
  });
});

// #492: バッジは「取り直す必要が無い」の意味で読まれる＝中身を1つも持たない投稿に点くと、
// 以後の取込がそれを飛ばし、取り直す機会が永久に失われる。判定規則は
// native-host/post-record.mts の recordHoldsContent と同じもの（あちらはレコード、
// ここは SQL）で、ずれると壊れるのはこの一致。
describe('中身を持たない投稿は「保存済み」と答えない', () => {
  test('殻レコードは載らない', () => {
    expect(index.entries[postKeyOf('https://x.com/gina/status/777') as string]).toBeUndefined();
  });

  test('テキストのみ投稿は載る（本文がライブラリに在る＝殻ではない）', () => {
    expect(index.entries[postKeyOf('https://x.com/hana/status/888') as string]).toEqual({ id: 'cap-f', media: [], owners: [] });
  });
});

describe('投稿の保存済みの絵', () => {
  test('同じ投稿の2レコードの絵が1つのエントリに合流する', () => {
    expect(index.entries[postKeyOf(MULTI) as string].media).toEqual([IMG_A, IMG_B]);
  });

  test('captureId は最初に鍵を取ったレコードのもの（バッジには「どれか1つ」で足りる）', () => {
    expect(index.entries[postKeyOf(MULTI) as string].id).toBe('cap-a');
  });

  // #34: 「置換」はどのレコードを引退させるか名指しできないといけない。エントリの id は
  // 最初に鍵を取ったレコードでしかないので、絵ごとの持ち主を並べて持つ。
  test('絵ごとに、その絵を持つレコードが分かる', () => {
    expect(index.entries[postKeyOf(MULTI) as string].owners).toEqual(['cap-a', 'cap-b']);
  });

  test('絵を持たない投稿は空の一覧＝保存済み・粒度は不明', () => {
    expect(index.entries[postKeyOf('https://x.com/erin/status/555') as string]).toEqual({ id: 'cap-c', media: [], owners: [] });
  });

  test('ゴミ箱の投稿は載らない', () => {
    expect(index.entries[postKeyOf('https://x.com/frank/status/666') as string]).toBeUndefined();
  });
});
