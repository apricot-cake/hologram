// Unit tests for app/src/main/lib-saved-index.ts = the side that builds the "saved"
// snapshot (configDir/bridge-saved-index.json) the bridge reads, from the DB.
// The read side (the bridge's handleQuery and its merge of 3 sources) is bridge-query.test.ts.
//
// This pins down 2 things. ① A post's identity is postKey (a key that folds URL
// notation variants together), not captureId. ② Since #334, an entry also carries the
// saved images for that post = it must be able to answer for a state where only one of a
// multi-image post was saved. ② needs a merge across keys, because "the 2nd image of the
// same post becomes a separate record" (reading only one record would show a save button
// on an image that's already saved).

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
const TWICE = 'https://x.com/jun/status/1010';

// Records sitting in the trash (#158) = what remains next to a file after the library's
// posts row has been deleted. Left exactly as the shape the caller (index.ts) reads from
// `.trash/` and passes in.
const TRASH = [
  // Plain case = the library has no matching post.
  { captureId: 'trash-1', url: 'https://x.com/ivy/status/999', trashedAt: '2026-01-02T10:00:00Z' },
  // The same post deleted twice (saved one image at a time, deleted one image at a time).
  // Take the newer date = the notice speaks the date, so taking the older one would show
  // the date of a different decision. Notation variants are also folded together.
  { captureId: 'trash-2a', url: TWICE, trashedAt: '2026-01-02T10:00:00Z' },
  { captureId: 'trash-2b', url: `${TWICE.replace('x.com', 'twitter.com')}?s=20`, trashedAt: '2026-01-05T10:00:00Z' },
  // A record with no deletion timestamp (the record write was interrupted) = it appears, but the date is null.
  { captureId: 'trash-3', url: 'https://x.com/kai/status/1111', trashedAt: null },
  // No postKey can be built = there's no way to list it.
  { captureId: 'trash-4', url: null, trashedAt: '2026-01-02T10:00:00Z' },
  // The same post is still alive in the library (the shape of deleting just one image of a multi-image post).
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

  // A multi-image post saved in two separate passes, one image at a time (the actual shape of hover-save / drag-save).
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-a', url: MULTI, image: 'cap-a.jpg', media: [{ url: IMG_A, file: 'cap-a.jpg' }] });
  // The same post saved with twitter.com notation plus a query string = postKey folds it into the same key.
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-b', url: `${MULTI.replace('x.com', 'twitter.com')}?s=20`, image: 'cap-b.jpg', media: [{ url: IMG_B, file: 'cap-b.jpg' }] });
  // A record with no image (text-only, or a post where intake couldn't land even one image).
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-c', url: 'https://x.com/erin/status/555', image: 'cap-c.jpg', media: [] });
  // Trash contents are not "present in the library".
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-d', url: 'https://x.com/frank/status/666', image: 'cap-d.jpg', media: [{ url: 'https://pbs.twimg.com/media/CCC?name=orig', file: 'cap-d.jpg' }], trashedAt: '2026-01-02T00:00:00Z' });
  // A shell record (#492) = a save that got nothing because the post was deleted, private,
  // etc. Only carries the screenName and date recoverable from the URL. The bridge no
  // longer writes these, but ones written before the fix remain in the library.
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-e', url: 'https://x.com/gina/status/777', screenName: 'gina', date: '2026-06-23T11:15:10.728Z', image: null, media: [] });
  // A text-only post (#365) is not a shell = its text is present in the library.
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-f', url: 'https://x.com/hana/status/888', text: '本文だけの投稿', image: null, media: [] });

  // Trash records aren't in the DB (their posts row is gone entirely), so the caller passes them in = #158.
  // In production, listTrashRecords reads these from `.trash/*.json`.
  index = buildSavedIndex(handle.sqlite, TRASH, () => '2026-01-03T00:00:00Z');
});

afterAll(() => {
  handle.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('スナップショットの形', () => {
  test('絵・その絵を持つレコード・ゴミ箱の中身まで運ぶ v4', () => {
    expect(index.version).toBe(SAVED_INDEX_VERSION);
    expect(SAVED_INDEX_VERSION).toBe(4);
  });

  test('鍵は postKey＝URL の表記ゆれを畳んだもの', () => {
    expect(Object.keys(index.entries).sort()).toEqual([postKeyOf(MULTI), postKeyOf('https://x.com/erin/status/555'), postKeyOf('https://x.com/hana/status/888')].sort());
  });
});

// #492: the badge is read as "no need to retry" = if it lights up on a post holding no
// content at all, every intake afterward skips it and the chance to retry is lost
// forever. The judging rule is the same one as recordHoldsContent in
// native-host/post-record.mts (that one operates on a record, this one on SQL), and if
// they drift apart, this agreement is what breaks.
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

  // #34: a "replace" must be able to name which record it retires. Since an entry's id
  // is only the record that claimed the key first, per-image owners are kept in a list.
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

// #158: the source of the notice shown while the actual file remains in the trash. The
// key point is putting it in a **separate place** from the saved map = the TL badge is
// read as "an entry exists = the library has it", so mixing them in would light the
// badge and remove the save button for a post that's actually in the trash.
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

  // The state of deleting just one image of a multi-image post = "saved" is the correct
  // answer for that post, and #34's 3-way choice is needed. Showing the trash notice
  // (2-way, no replace) would remove the path to replace the still-live record.
  test('ライブラリに生きている同じ投稿があるなら載らない（保存済みが勝つ）', () => {
    expect(index.trashed[postKeyOf(MULTI) as string]).toBeUndefined();
    expect(index.entries[postKeyOf(MULTI) as string]).toBeDefined();
  });

  test('ゴミ箱の記録を渡さなければ空（既定引数＝呼び出し側がまだ読んでいない場合）', () => {
    expect(buildSavedIndex(handle.sqlite).trashed).toEqual({});
  });
});
