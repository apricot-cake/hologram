// app/src/main/lib-saved-index.ts の単体テスト＝ブリッジが読む「保存済み」のスナップ
// ショット（configDir/bridge-saved-index.json）を DB から組み立てる側。
// 読む側（ブリッジの handleQuery と3つの出どころの統合）は bridge-query.test.ts。
//
// ここで固定するのは2つ。① 投稿の同一性は captureId ではなく postKey（URL の表記ゆれを
// 畳んだ鍵）。② #334 以降、エントリはその投稿の保存済みの絵も運ぶ＝複数画像の投稿のうち
// 1枚だけ保存した状態にも答えられなければいけない。② には鍵をまたぐ合流が要る。「同じ投稿の
// 2枚目は別のレコードになる」ためで、レコードを1つしか読まないと、既に保存済みの絵に保存
// ボタンが出てしまう。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer';
import { buildSavedIndex, SAVED_INDEX_VERSION } from '../../app/src/main/lib-saved-index';
import { postKeyOf } from '../../native-host/post-key.mts';

const MULTI = 'https://x.com/dave/status/444';
const IMG_A = 'https://pbs.twimg.com/media/AAA?format=jpg&name=orig';
const IMG_B = 'https://pbs.twimg.com/media/BBB?format=jpg&name=orig';
const TWICE = 'https://x.com/jun/status/1010';

// ゴミ箱にある記録 (#158)＝ライブラリの posts の行が消えたあと、ファイルの隣に残るもの。
// 呼び出し側 (index.ts) が `.trash/` から読んで渡してくる形のまま置いてある。
const TRASH = [
  // 素の場合＝ライブラリに対応する投稿が無い。
  { captureId: 'trash-1', url: 'https://x.com/ivy/status/999', trashedAt: '2026-01-02T10:00:00Z' },
  // 同じ投稿を2回削除した場合（1枚ずつ保存して、1枚ずつ削除した）。
  // 新しい方の日付を取る＝告知は日付を読み上げるので、古い方を取ると別の判断の日付を見せる
  // ことになる。表記ゆれも畳む。
  { captureId: 'trash-2a', url: TWICE, trashedAt: '2026-01-02T10:00:00Z' },
  { captureId: 'trash-2b', url: `${TWICE.replace('x.com', 'twitter.com')}?s=20`, trashedAt: '2026-01-05T10:00:00Z' },
  // 削除時刻を持たない記録（記録の書き込みが途中で切れた）＝載るが、日付は null。
  { captureId: 'trash-3', url: 'https://x.com/kai/status/1111', trashedAt: null },
  // postKey が作れない＝載せようが無い。
  { captureId: 'trash-4', url: null, trashedAt: '2026-01-02T10:00:00Z' },
  // 同じ投稿がライブラリにまだ生きている（複数画像の投稿のうち1枚だけ削除した形）。
  { captureId: 'trash-5', url: MULTI, trashedAt: '2026-01-02T10:00:00Z' },
];

let dir: string;
let handle: any;
let index: any;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-saved-index-'));
  handle = openDatabase(path.join(dir, 'test.db'));
  const stmts = preparePostStmts(handle.sqlite);
  const resolveTagId = makeTagResolver(handle.sqlite);
  const base = { capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', platform: 'x' };

  // 複数画像の投稿を、1枚ずつ2回に分けて保存した場合（ホバー保存・ドラッグ保存の実際の形）。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-a', url: MULTI, image: 'cap-a.jpg', imageIndex: 1, imageCount: 2, media: [{ url: IMG_A, file: 'cap-a.jpg' }] });
  // 同じ投稿を twitter.com 表記とクエリ文字列付きで保存した場合＝postKey は同じ鍵へ畳む。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-b', url: `${MULTI.replace('x.com', 'twitter.com')}?s=20`, image: 'cap-b.jpg', imageIndex: 2, imageCount: 2, media: [{ url: IMG_B, file: 'cap-b.jpg' }] });
  // 絵を持たないレコード（テキストのみか、取り込みが1枚も落とせなかった投稿）。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-c', url: 'https://x.com/erin/status/555', image: 'cap-c.jpg', media: [] });
  // ゴミ箱の中身は「ライブラリに在る」ではない。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-d', url: 'https://x.com/frank/status/666', image: 'cap-d.jpg', media: [{ url: 'https://pbs.twimg.com/media/CCC?name=orig', file: 'cap-d.jpg' }], trashedAt: '2026-01-02T00:00:00Z' });
  // 殻レコード (#492)＝投稿が削除済み・非公開などで、何も取れなかった保存。URL から復元
  // できる screenName と日付しか持たない。ブリッジはもう書かないが、直す前に書かれたものは
  // ライブラリに残っている。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-e', url: 'https://x.com/gina/status/777', screenName: 'gina', date: '2026-06-23T11:15:10.728Z', image: null, media: [] });
  // テキストのみ投稿 (#365) は殻ではない＝本文がライブラリに在る。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-f', url: 'https://x.com/hana/status/888', text: '本文だけの投稿', image: null, media: [] });
  // リンクだけの共有 (#181) も殻ではない＝自前の text/title/displayName/media を持たなくても、
  // OGP のカードがライブラリに在る。
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-g', url: 'https://x.com/iris/status/9099', image: null, media: [], linkCard: { url: 'https://example.com/article', title: 'A great article', description: null, thumbnailFile: null } });

  // ゴミ箱の記録は DB に無い（posts の行がまるごと消えている）ので、呼び出し側が渡す＝#158。
  // 本番では listTrashRecords が `.trash/*.json` から読む。
  index = buildSavedIndex(handle.sqlite, TRASH, () => '2026-01-03T00:00:00Z');
});

afterAll(() => {
  handle.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('スナップショットの形', () => {
  test('絵・総数・その絵を持つレコード・ゴミ箱の中身と保存の種類を運ぶ v6', () => {
    expect(index.version).toBe(SAVED_INDEX_VERSION);
    expect(SAVED_INDEX_VERSION).toBe(6);
  });

  test('鍵は postKey＝URL の表記ゆれを畳んだもの', () => {
    expect(Object.keys(index.entries).sort()).toEqual([postKeyOf(MULTI), postKeyOf('https://x.com/erin/status/555'), postKeyOf('https://x.com/hana/status/888'), postKeyOf('https://x.com/iris/status/9099')].sort());
  });
});

// #492: 印は「もう試さなくていい」と読まれる＝中身を何も持たない投稿でこれが点くと、以降の
// 取り込みはすべてその投稿を飛ばし、やり直す機会が永久に失われる。判定の規則は
// native-host/post-record.mts の recordHoldsContent と同じもの（あちらはレコードの上、
// こちらは SQL の上で動く）で、両者がずれると、この取り決めが壊れる。
describe('中身を持たない投稿は「保存済み」と答えない', () => {
  test('殻レコードは載らない', () => {
    expect(index.entries[postKeyOf('https://x.com/gina/status/777') as string]).toBeUndefined();
  });

  test('テキストのみ投稿は載る（本文がライブラリに在る＝殻ではない）', () => {
    expect(index.entries[postKeyOf('https://x.com/hana/status/888') as string]).toEqual({ post: true, individualMedia: [], id: 'cap-f', media: [], owners: [], total: null });
  });

  // #181: recordHoldsContent の SQL 側にも linkCard の条件を足した回帰（足す前
  // はこの投稿が殻扱いされ、バッジが点かず再取込のたびに再保存されていた）。
  test('リンクカードのみの投稿も載る（カードがライブラリに在る＝殻ではない）', () => {
    expect(index.entries[postKeyOf('https://x.com/iris/status/9099') as string]).toEqual({ post: true, individualMedia: [], id: 'cap-g', media: [], owners: [], total: null });
  });
});

describe('投稿の保存済みの絵', () => {
  test('同じ投稿の2レコードの絵が1つのエントリに合流する', () => {
    expect(index.entries[postKeyOf(MULTI) as string].media).toEqual([IMG_A, IMG_B]);
  });

  test('captureId は最初に鍵を取ったレコードのもの（バッジには「どれか1つ」で足りる）', () => {
    expect(index.entries[postKeyOf(MULTI) as string].id).toBe('cap-a');
  });

  // #34: 「差し替え」はどのレコードを退けるかを名指しできなければいけない。エントリの id は
  // 鍵を最初に取ったレコードでしかないので、絵ごとの owners を一覧で持つ。
  test('絵ごとに、その絵を持つレコードが分かる', () => {
    expect(index.entries[postKeyOf(MULTI) as string].owners).toEqual(['cap-a', 'cap-b']);
  });

  test('個別保存の imageCount から元投稿の総数を保つ', () => {
    expect(index.entries[postKeyOf(MULTI) as string].total).toBe(2);
  });

  test('絵を持たない投稿は空の一覧＝保存済み・粒度は不明', () => {
    expect(index.entries[postKeyOf('https://x.com/erin/status/555') as string]).toEqual({ post: true, individualMedia: [], id: 'cap-c', media: [], owners: [], total: null });
  });

  test('ゴミ箱の投稿は載らない', () => {
    expect(index.entries[postKeyOf('https://x.com/frank/status/666') as string]).toBeUndefined();
  });
});

// #158: 実体のファイルがゴミ箱に残っている間に出す告知の出どころ。要点は、保存済みのマップ
// とは別の場所に置くこと＝TL の印は「エントリがある＝ライブラリに在る」と読まれるので、
// 混ぜ込むと、実際にはゴミ箱にある投稿で印が点き、保存ボタンが消える。
describe('ゴミ箱マップ', () => {
  test('ゴミ箱の投稿が載る（鍵は postKey・削除日を運ぶ）', () => {
    expect(index.trashed[postKeyOf('https://x.com/ivy/status/999') as string]).toEqual({ id: 'trash-1', deletedAt: '2026-01-02T10:00:00Z' });
  });

  test('同じ投稿を2回削除したら新しい方の日付', () => {
    expect(index.trashed[postKeyOf(TWICE) as string]).toEqual({ id: 'trash-2b', deletedAt: '2026-01-05T10:00:00Z' });
  });

  test('削除日時が無い記録も載る（日付だけ null＝告知は日付を省く）', () => {
    expect(index.trashed[postKeyOf('https://x.com/kai/status/1111') as string]).toEqual({ id: 'trash-3', deletedAt: null });
  });

  test('postKey が作れない記録は載らない', () => {
    expect(Object.values(index.trashed).some((e: any) => e.id === 'trash-4')).toBe(false);
  });

  // 複数画像の投稿のうち1枚だけ削除した状態＝その投稿への正しい答えは「保存済み」で、#34 の
  // 3択が要る。ゴミ箱の告知（差し替えの無い2択）を出すと、まだ生きているレコードを差し替える
  // 道が消える。
  test('ライブラリに生きている同じ投稿があるなら載らない（保存済みが勝つ）', () => {
    expect(index.trashed[postKeyOf(MULTI) as string]).toBeUndefined();
    expect(index.entries[postKeyOf(MULTI) as string]).toBeDefined();
  });

  test('ゴミ箱の記録を渡さなければ空（既定引数＝呼び出し側がまだ読んでいない場合）', () => {
    expect(buildSavedIndex(handle.sqlite).trashed).toEqual({});
  });
});
