// app/src/main/lib-db-replaces.ts のユニットテスト＝重複保存の警告で「置換」を選んだ
// ときに走る掃除（#34）。拡張は write-once のネイティブホスト越しに保存するので、旧
// レコードを消せるのはアプリだけ＝新レコードに載ってくるのは `replaces` という印だけで、
// 実際の置換はここが行う。
//
// ここが押さえるのは受け入れ条件そのもの:
//   - 旧レコードのファイルが .trash へ移り、記録（<captureId>.json）が並んで残る
//   - 旧タグが新レコードへ union で合流する（新レコードのタグは消えない）
//   - フォルダ・手動グループの captureId 参照が新レコードへ付け替わる（孤児にしない）
//   - 取得原本（#292）も引き継ぐ＝置換は「原本を忘れてくれ」という意味ではない
//   - 印は消化され、2回目の掃除は何もしない（posts-changed ごとに走るので冪等が要る）
//   - このライブラリに無い captureId を指す印は、何も動かさずに消える（replay 由来）

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { applyPendingReplacements } from '../app/src/main/lib-db-replaces';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';

const MEDIA_EXTS = ['jpg', 'png', 'webp'] as const;
const POST = 'https://x.com/dave/status/444';

let dir: string;
let folder: string;
let trashDir: string;
let handle: any;
let report: any;

const one = (sql: string, ...args: any[]) => handle.sqlite.prepare(sql).get(...args);
const all = (sql: string, ...args: any[]) => handle.sqlite.prepare(sql).all(...args);

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-replaces-'));
  folder = path.join(dir, 'library');
  trashDir = path.join(folder, '.trash');
  fs.mkdirSync(folder, { recursive: true });
  handle = openDatabase(path.join(dir, 'test.db'));
  const sqlite = handle.sqlite;
  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  const base = { capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', platform: 'x', url: POST };

  fs.writeFileSync(path.join(folder, 'old.jpg'), 'old-bytes');
  fs.writeFileSync(path.join(folder, 'old-media-0.png'), 'old-original');
  fs.writeFileSync(path.join(folder, 'new.jpg'), 'new-bytes');

  writePost(stmts, resolveTagId, { ...base, captureId: 'old', image: 'old.jpg', media: [{ url: 'https://pbs.twimg.com/media/AAA', file: 'old-media-0.png' }], tags: ['風景', '保留'] });
  writePost(stmts, resolveTagId, { ...base, captureId: 'new', image: 'new.jpg', media: [{ url: 'https://pbs.twimg.com/media/AAA', file: 'new.jpg' }], tags: ['風景'], replaces: 'old' });
  // 印が「このライブラリに無い captureId」を指す形（別マシンの inbox を replay した後）。
  writePost(stmts, resolveTagId, { ...base, captureId: 'lonely', url: 'https://x.com/erin/status/555', image: 'new.jpg', replaces: 'never-existed' });

  // 旧レコードだけが持つ整理情報。置換で新レコードへ移らなければ「フォルダから消えた」
  // として出る（#34 設計コメントの罠）。
  sqlite.prepare("INSERT INTO folders (id, name, kind) VALUES ('f1','お気に入り','static')").run();
  sqlite.prepare("INSERT INTO folder_items (folderId, postId) VALUES ('f1','old')").run();
  sqlite.prepare('INSERT INTO manual_groups DEFAULT VALUES').run();
  sqlite.prepare('INSERT INTO manual_group_items (groupId, postId, seq) VALUES (1, ?, ?)').run('old', 3);
  sqlite.prepare("UPDATE posts SET userKind = 'media', tagReviewed = 1 WHERE captureId = 'old'").run();
  sqlite.prepare("INSERT INTO raw_payloads (postId, sourceKind, acquiredAt, contentType, encoding, sha256, byteLength, payload) VALUES ('old','x-post','2026-01-01T00:00:00Z','application/json','gzip','abc',10,NULL)").run();

  report = await applyPendingReplacements({ sqlite, folder, trashDir, mediaExts: MEDIA_EXTS });
});

afterAll(() => {
  handle?.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('置換の掃除', () => {
  test('置換した分と、指す先の無い印を分けて報告する', () => {
    expect(report.applied).toEqual([{ newId: 'new', oldId: 'old' }]);
    expect(report.cleared).toEqual(['lonely']);
    expect(report.failed).toEqual([]);
  });

  test('旧レコードの行は消え、新レコードは残る', () => {
    expect(one("SELECT captureId FROM posts WHERE captureId = 'old'")).toBeUndefined();
    expect(one("SELECT captureId FROM posts WHERE captureId = 'new'")).toBeTruthy();
    expect(one("SELECT postId FROM posts_fts WHERE postId = 'old'")).toBeUndefined();
  });

  test('印は消化される＝2回目の掃除は何もしない', async () => {
    expect(all('SELECT captureId FROM posts WHERE replaces IS NOT NULL')).toEqual([]);
    const second = await applyPendingReplacements({ sqlite: handle.sqlite, folder, trashDir, mediaExts: MEDIA_EXTS });
    expect(second).toEqual({ applied: [], cleared: [], failed: [] });
  });

  test('旧レコードのファイルが .trash へ移り、記録が並ぶ', () => {
    expect(fs.existsSync(path.join(folder, 'old.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(folder, 'old-media-0.png'))).toBe(false);
    expect(fs.readFileSync(path.join(trashDir, 'old.jpg'), 'utf8')).toBe('old-bytes');
    expect(fs.readFileSync(path.join(trashDir, 'old-media-0.png'), 'utf8')).toBe('old-original');
    const rec = JSON.parse(fs.readFileSync(path.join(trashDir, 'old.json'), 'utf8'));
    expect(rec.captureId).toBe('old');
    expect(rec.trashedAt).toBeTruthy();
    // 復元したときにタグと種別が戻せること＝delete-post と同じ内容を残す。
    expect(rec.tags.sort()).toEqual(['保留', '風景']);
    expect(rec.userKind).toBe('media');
  });

  test('新レコードのファイルは触らない', () => {
    expect(fs.readFileSync(path.join(folder, 'new.jpg'), 'utf8')).toBe('new-bytes');
  });
});

describe('引き継ぐもの', () => {
  const tagsOf = (id: string) => (all('SELECT t.name AS name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ?', id) as Array<{ name: string }>).map((r) => r.name).sort();

  test('タグは union＝新レコードのタグを消さずに旧レコードの分を足す', () => {
    expect(tagsOf('new')).toEqual(['保留', '風景']);
  });

  test('全文検索のタグ列も合流後の内容になる', () => {
    const row = one("SELECT tagsText FROM posts_fts WHERE postId = 'new'") as { tagsText: string };
    expect(row.tagsText.split(' ').sort()).toEqual(['保留', '風景']);
  });

  test('フォルダ所属が新レコードへ付け替わる', () => {
    expect(all("SELECT postId FROM folder_items WHERE folderId = 'f1'")).toEqual([{ postId: 'new' }]);
  });

  test('手動グループの席順ごと付け替わる', () => {
    expect(all('SELECT postId, seq FROM manual_group_items WHERE groupId = 1')).toEqual([{ postId: 'new', seq: 3 }]);
  });

  test('DB だけが持つ種別・確認済みフラグを引き継ぐ', () => {
    expect(one("SELECT userKind, tagReviewed FROM posts WHERE captureId = 'new'")).toEqual({ userKind: 'media', tagReviewed: 1 });
  });

  test('取得原本（#292）も新レコードへ移る', () => {
    expect(all("SELECT sourceKind, sha256 FROM raw_payloads WHERE postId = 'new'")).toEqual([{ sourceKind: 'x-post', sha256: 'abc' }]);
  });
});
