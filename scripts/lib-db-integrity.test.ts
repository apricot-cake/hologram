// app/src/main/lib-db-integrity.ts のユニットテスト＝DB<->メディア相互照合と
// orphan最小レコード合成（#5 St8 / #301）。db-inbox.test.ts と同じ流儀＝合成の
// saveFolder + 本物の SQLite（lib-db.ts 経由）で確定済み設計を直接見る。
//
// 最後の describe（'復元リハーサル'）は #301 の受け入れ条件そのもの:
// DB消失 → (a) inbox経由の投稿はリプレイで復活、(b) writePost直書き（ZIPイン
// ポート/ドラッグ取込を模した、sidecarもinboxイベントも残さない経路）で入っ
// た投稿は孤児メディアとして検出され、最小レコード合成で復活する。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildEnvelope, writeInboxEvent } from '../native-host/inbox.mts';
import { normalizePostRecord } from '../native-host/post-record.mts';
import { openDatabase } from '../app/src/main/lib-db';
import { drainInbox } from '../app/src/main/lib-db-inbox';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';
import { checkOrphans, findMissingMedia, findOrphanMedia, synthesizeOrphanRecords, capturedAtFromId } from '../app/src/main/lib-db-integrity';
import { snapshotDatabase } from '../app/src/main/lib-db-snapshot';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

// Simulates ipc-transfer.ts's ZIP-import/drag-import handlers: writes a posts
// row directly via writePost, with NO sidecar and NO inbox envelope — exactly
// the "no trail to replay" gap #301 targets.
function writeDirectPost(sqlite: any, saveFolder: string, captureId: string, mediaFile: string) {
  fs.writeFileSync(path.join(saveFolder, mediaFile), 'x');
  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  const rec = normalizePostRecord({ captureId, image: mediaFile, url: 'https://example.invalid/zip-imported', text: 'from a ZIP import' });
  writePost(stmts, resolveTagId, rec, null);
}

describe('findOrphanMedia / findMissingMedia', () => {
  let saveFolder: string;
  let handle: { db: any; sqlite: any };

  beforeAll(() => {
    saveFolder = mkTempDir('hologram-integrity-save-');
    handle = openDatabase(path.join(mkTempDir('hologram-integrity-db-'), 'test.db'));
  });

  test('DBに行の無いcaptureId命名のファイルはorphanとして検出される', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000000000-aa01.jpg'), 'x');

    const orphans = findOrphanMedia(saveFolder, handle.sqlite);

    expect(orphans).toEqual([{ captureId: '1700000000000-aa01', file: '1700000000000-aa01.jpg' }]);
  });

  test('posts行があるファイルはorphanに含まれない', () => {
    writeDirectPost(handle.sqlite, saveFolder, '1700000000001-aa02', '1700000000001-aa02.jpg');

    const orphans = findOrphanMedia(saveFolder, handle.sqlite);

    expect(orphans.find((o) => o.captureId === '1700000000001-aa02')).toBeUndefined();
  });

  test('付属メディア(-media-N)やposter用ファイルはcaptureId本体ではないのでorphan扱いされない', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000000002-aa03-media-0.jpg'), 'x');
    fs.writeFileSync(path.join(saveFolder, '1700000000002-aa03-poster.jpg'), 'x');

    const orphans = findOrphanMedia(saveFolder, handle.sqlite);

    expect(orphans.some((o) => o.file.startsWith('1700000000002-aa03-'))).toBe(false);
  });

  test('avatars/やJSON設定ファイルはSAFE_IDに一致しないので無視される', () => {
    fs.mkdirSync(path.join(saveFolder, 'avatars'), { recursive: true });
    fs.writeFileSync(path.join(saveFolder, 'avatars', 'deadbeef.jpg'), 'x');
    fs.writeFileSync(path.join(saveFolder, 'folders.json'), '{}');

    const orphans = findOrphanMedia(saveFolder, handle.sqlite);

    expect(orphans.some((o) => o.file.includes('avatars'))).toBe(false);
    expect(orphans.some((o) => o.file === 'folders.json')).toBe(false);
  });

  test('knownFilesを渡すとreaddirせずそれを使う（runBackupのsrcSet相乗り）', () => {
    // saveFolder上には何も対応する物が無い captureId を knownFiles だけに含める。
    const orphans = findOrphanMedia(saveFolder, handle.sqlite, new Set(['1700000000099-ab99.jpg']));

    expect(orphans).toEqual([{ captureId: '1700000000099-ab99', file: '1700000000099-ab99.jpg' }]);
  });

  test('DB行があってもファイルが無ければmissing扱い', () => {
    const rec = normalizePostRecord({ captureId: '1700000000003-aa04', image: '1700000000003-aa04.jpg' });
    const stmts = preparePostStmts(handle.sqlite);
    writePost(stmts, makeTagResolver(handle.sqlite), rec, null); // ファイルは書かない

    const missing = findMissingMedia(saveFolder, handle.sqlite);

    expect(missing).toEqual(expect.arrayContaining([{ captureId: '1700000000003-aa04', file: '1700000000003-aa04.jpg' }]));
  });

  test('trashedAtが付いた投稿は.trash/へ物理移動済み前提なのでmissingに含めない', () => {
    const rec = normalizePostRecord({ captureId: '1700000000004-aa05', image: '1700000000004-aa05.jpg', trashedAt: new Date().toISOString() });
    const stmts = preparePostStmts(handle.sqlite);
    writePost(stmts, makeTagResolver(handle.sqlite), rec, null); // ファイルは.trash/にある想定＝rootには書かない

    const missing = findMissingMedia(saveFolder, handle.sqlite);

    expect(missing.find((m) => m.captureId === '1700000000004-aa05')).toBeUndefined();
  });

  test('checkOrphansは両方をまとめて返す', () => {
    const result = checkOrphans(saveFolder, handle.sqlite);
    expect(result).toHaveProperty('orphanMedia');
    expect(result).toHaveProperty('missingMedia');
  });
});

describe('capturedAtFromId', () => {
  test('captureIdの先頭epochMillisをcapturedAtとして復元する', () => {
    expect(capturedAtFromId('1700000000000-aa01')).toBe(new Date(1700000000000).toISOString());
  });
});

describe('synthesizeOrphanRecords', () => {
  let saveFolder: string;
  let handle: { db: any; sqlite: any };
  const one = (sql: string, ...args: any[]) => handle.sqlite.prepare(sql).get(...args);

  beforeAll(() => {
    saveFolder = mkTempDir('hologram-integrity-synth-save-');
    handle = openDatabase(path.join(mkTempDir('hologram-integrity-synth-db-'), 'test.db'));
  });

  test('孤児メディアから最小postsレコードを書く（url null・source=orphan-recovery・capturedAtはID由来）', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000000500-ee01.jpg'), 'x');

    const written = synthesizeOrphanRecords(saveFolder, handle.sqlite);

    expect(written).toEqual([{ captureId: '1700000000500-ee01', file: '1700000000500-ee01.jpg' }]);
    const row = one('SELECT image, video, url, source, capturedAt FROM posts WHERE captureId = ?', '1700000000500-ee01');
    expect(row).toMatchObject({ image: '1700000000500-ee01.jpg', video: null, url: null, source: 'orphan-recovery', capturedAt: new Date(1700000000500).toISOString() });
  });

  test('動画拡張子はimageでなくvideo列に入る', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000000501-ee02.mp4'), 'x');

    synthesizeOrphanRecords(saveFolder, handle.sqlite);

    const row = one('SELECT image, video FROM posts WHERE captureId = ?', '1700000000501-ee02');
    expect(row).toMatchObject({ image: null, video: '1700000000501-ee02.mp4' });
  });

  test('再実行は冪等（既にposts行がある孤児は既にorphanでないので再合成されない）', () => {
    const before = handle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n;

    const written = synthesizeOrphanRecords(saveFolder, handle.sqlite);

    expect(written).toEqual([]);
    expect(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n).toBe(before);
  });
});

describe('復元リハーサル（#301受け入れ条件: DB消失→スナップショット＋リプレイ＋最小レコード合成）', () => {
  test('inbox経由の投稿はリプレイで、直書き（ZIPインポート相当）の投稿は孤児合成で、両方とも復活する', async () => {
    const saveFolder = mkTempDir('hologram-rehearsal-save-');
    const dbDir = mkTempDir('hologram-rehearsal-db-');
    const dbFile = path.join(dbDir, 'hologram.db');
    let handle = openDatabase(dbFile);

    // (a) inbox経由の投稿 — #299のリプレイで救えるはずの経路
    const inboxRec = normalizePostRecord({ captureId: '1700000001000-ff01', url: 'https://x.com/u/status/1', image: '1700000001000-ff01.jpg', text: 'via inbox' });
    fs.writeFileSync(path.join(saveFolder, '1700000001000-ff01.jpg'), 'x');
    await writeInboxEvent(saveFolder, buildEnvelope(inboxRec));
    drainInbox(saveFolder, handle.sqlite);
    expect(handle.sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('1700000001000-ff01')).toBeTruthy();

    // (b) 直書きの投稿 — sidecarもinboxイベントも無い、orphan-recoveryでしか救えない経路
    writeDirectPost(handle.sqlite, saveFolder, '1700000001001-ff02', '1700000001001-ff02.jpg');
    expect(handle.sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('1700000001001-ff02')).toBeTruthy();

    // スナップショット（lib-db-snapshot.ts）— backup APIで静止コピーを作る
    const snapshotFile = path.join(mkTempDir('hologram-rehearsal-mirror-'), 'hologram.db');
    await snapshotDatabase(handle.sqlite, snapshotFile);
    expect(fs.existsSync(snapshotFile)).toBe(true);

    // DB消失を模擬: (b)の投稿はスナップショット後に何も新しいイベントを生まない
    // ため、スナップショット自体には既に(b)の行が入っている。orphan-recoveryが
    // 本当に必要なのは「スナップショットより後に直書きされ、かつDBが失われた」
    // ケースなので、スナップショット済みDBを捨てて空DBから始める（=スナップ
    // ショットが無い/古い最悪ケースの再現）。
    handle.sqlite.close();
    fs.rmSync(dbFile, { force: true });
    fs.rmSync(`${dbFile}-wal`, { force: true });
    fs.rmSync(`${dbFile}-shm`, { force: true });
    handle = openDatabase(dbFile); // 真っさらな空DB

    // リプレイ: (a)はinboxのloose eventからdrainInboxで復活する
    const report = drainInbox(saveFolder, handle.sqlite);
    expect(report.applied).toContain('1700000001000-ff01');
    expect(handle.sqlite.prepare('SELECT text FROM posts WHERE captureId = ?').get('1700000001000-ff01')).toMatchObject({ text: 'via inbox' });

    // (b)はまだ無い — リプレイでは救えない
    expect(handle.sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('1700000001001-ff02')).toBeUndefined();

    // 孤児検出 → 最小レコード合成で(b)も復活する
    const { orphanMedia } = checkOrphans(saveFolder, handle.sqlite);
    expect(orphanMedia).toEqual(expect.arrayContaining([{ captureId: '1700000001001-ff02', file: '1700000001001-ff02.jpg' }]));
    const recovered = synthesizeOrphanRecords(saveFolder, handle.sqlite);
    expect(recovered.map((r) => r.captureId)).toContain('1700000001001-ff02');

    const restoredB = handle.sqlite.prepare('SELECT image, source, url FROM posts WHERE captureId = ?').get('1700000001001-ff02');
    expect(restoredB).toMatchObject({ image: '1700000001001-ff02.jpg', source: 'orphan-recovery', url: null });

    // 最終確認: 両方とも投稿として復活している
    expect(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n).toBe(2);

    handle.sqlite.close();
  });
});
