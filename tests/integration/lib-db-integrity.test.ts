// app/src/main/lib-db-integrity.ts の単体テスト。DB とメディアの突き合わせと孤児の回復
// （#5 St8 / #301。サイドカーの採用は #511）を見る。やり方は db-inbox.test.ts と同じ＝合成した
// saveFolder と本物の SQLite（lib-db.ts 経由）で、確定した設計を直接見る。
//
// 最後の describe（復元リハーサル）はそのまま #301 の受け入れ条件。DB を失ったとき、
// (a) inbox 経由で入った投稿はリプレイで復活し、(b) writePost で直に書かれた投稿（ZIP インポート
// やドラッグ取り込みを模した、サイドカーも inbox イベントも残さない経路）は孤児メディアとして
// 検出され、最小レコードの合成で復活する。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildEnvelope, writeInboxEvent } from '../../native-host/inbox.mts';
import { normalizePostRecord } from '../../native-host/post-record.mts';
import { openDatabase } from '../../app/src/main/lib-db';
import { drainInbox } from '../../app/src/main/lib-db-inbox';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer';
import { checkOrphans, findMissingMedia, findOrphanMedia, recoverOrphanRecords, capturedAtFromId } from '../../app/src/main/lib-db-integrity';
import { snapshotDatabase } from '../../app/src/main/lib-db-snapshot';

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
      /* できる範囲で片付ける */
    }
  }
});

// ipc-transfer.ts の ZIP インポート・ドラッグインポートのハンドラを模す。writePost で posts の行
// を直に書き、サイドカーも inbox のエンベロープも一切作らない＝#301 が狙う「リプレイする跡が無
// い」穴そのもの。
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

  // #290: avatars/ と同じく共有ストアなので除外する。そこでどの投稿からも参照されないファイル
  // という問いは、キャプチャ単位の孤児検出が問うものとは別。
  test('emoji/ も同じ理由で無視される', () => {
    fs.mkdirSync(path.join(saveFolder, 'emoji'), { recursive: true });
    fs.writeFileSync(path.join(saveFolder, 'emoji', 'deadbeef.png'), 'x');

    const orphans = findOrphanMedia(saveFolder, handle.sqlite);

    expect(orphans.some((o) => o.file.includes('emoji'))).toBe(false);
  });

  test('knownFilesを渡すとreaddirせずそれを使う', () => {
    // saveFolder には何も無く knownFiles にだけ在る captureId を含める。
    const orphans = findOrphanMedia(saveFolder, handle.sqlite, new Set(['1700000000099-ab99.jpg']));

    expect(orphans).toEqual([{ captureId: '1700000000099-ab99', file: '1700000000099-ab99.jpg' }]);
  });

  test('項目フォルダーはフォルダー名のcaptureId単位で孤児を検出する', () => {
    const captureId = 'drag-1700000000000-0000';
    const itemDir = path.join(saveFolder, 'items', captureId);
    fs.mkdirSync(itemDir, { recursive: true });
    fs.writeFileSync(path.join(itemDir, `${captureId}.png`), 'x');
    fs.writeFileSync(path.join(itemDir, `${captureId}-media-0.jpg`), 'x');

    const orphan = findOrphanMedia(saveFolder, handle.sqlite).find((entry) => entry.captureId === captureId);

    expect(orphan).toMatchObject({ captureId, files: [`items/${captureId}/${captureId}-media-0.jpg`, `items/${captureId}/${captureId}.png`] });
  });

  test('バックアップの既走査一覧にある項目パスも孤児として解釈する', () => {
    const rel = 'items/1700000000098-ab98/1700000000098-ab98.jpg';
    expect(findOrphanMedia(saveFolder, handle.sqlite, new Set([rel]))).toEqual([{ captureId: '1700000000098-ab98', file: rel, files: [rel] }]);
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
    writePost(stmts, makeTagResolver(handle.sqlite), rec, null); // ファイルは .trash/ に在る想定なので直下には書かない

    const missing = findMissingMedia(saveFolder, handle.sqlite);

    expect(missing.find((m) => m.captureId === '1700000000004-aa05')).toBeUndefined();
  });

  test('checkOrphansは両方をまとめて返す', () => {
    const result = checkOrphans(saveFolder, handle.sqlite);
    expect(result).toHaveProperty('orphanMedia');
    expect(result).toHaveProperty('missingMedia');
  });
});

// #511: 直下の <captureId>.json はメディアではなく「そのキャプチャのレコード」。#302 以降は誰も
// 書いていないが、#302 より前の保存にはすべて付いているし、#299 より前のバンドルが動けば今でも
// 作られうる（実際に2件作られた）。
describe('直下サイドカーの扱い（#511）', () => {
  let saveFolder: string;
  let handle: { db: any; sqlite: any };

  beforeAll(() => {
    saveFolder = mkTempDir('hologram-integrity-sidecar-');
    handle = openDatabase(path.join(mkTempDir('hologram-integrity-sidecar-db-'), 'test.db'));
  });

  test('メディアとサイドカーが揃っている孤児はメディア側のファイルで報告される（.jsonをimageに入れない）', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000002000-bb01.jpg'), 'x');
    fs.writeFileSync(path.join(saveFolder, '1700000002000-bb01.json'), JSON.stringify({ captureId: '1700000002000-bb01', image: '1700000002000-bb01.jpg', url: 'https://x.com/u/status/1' }));

    const orphans = findOrphanMedia(saveFolder, handle.sqlite);

    expect(orphans).toEqual([{ captureId: '1700000002000-bb01', file: '1700000002000-bb01.jpg' }]);
  });

  test('サイドカーだけで直下にcaptureId名のメディアが無い動画の孤児も、レコードを読んで検出される', () => {
    // 動画の保存の形（#496）＝image は null で、ファイルとポスターは media[0] に入る。直下の
    // ファイル名は -media-0 と -poster なので、レコードを読まなければ孤児として検出すらされない。
    fs.writeFileSync(path.join(saveFolder, '1700000002001-bb02-media-0.mp4'), 'x');
    fs.writeFileSync(path.join(saveFolder, '1700000002001-bb02-poster.jpg'), 'x');
    fs.writeFileSync(
      path.join(saveFolder, '1700000002001-bb02.json'),
      JSON.stringify({ captureId: '1700000002001-bb02', image: null, mediaType: 'video', media: [{ url: 'https://video.example.invalid/v.mp4', file: '1700000002001-bb02-media-0.mp4', type: 'video', posterFile: '1700000002001-bb02-poster.jpg' }], url: 'https://x.com/u/status/2' }),
    );

    const orphans = findOrphanMedia(saveFolder, handle.sqlite);

    expect(orphans).toEqual(expect.arrayContaining([{ captureId: '1700000002001-bb02', file: '1700000002001-bb02-media-0.mp4' }]));
  });

  test('サイドカーが名指すメディアが無ければ孤児として数えない（回復してもmissingになるだけ）', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000002002-bb03.json'), JSON.stringify({ captureId: '1700000002002-bb03', image: '1700000002002-bb03.jpg', url: 'https://x.com/u/status/3' }));

    const orphans = findOrphanMedia(saveFolder, handle.sqlite);

    expect(orphans.some((o) => o.captureId === '1700000002002-bb03')).toBe(false);
  });

  test('サイドカーの在る孤児を回復するとURL・本文・投稿者・media[]が失われない', () => {
    const recovered = recoverOrphanRecords(saveFolder, handle.sqlite);

    expect(recovered.find((r) => r.captureId === '1700000002000-bb01')).toMatchObject({ via: 'sidecar' });
    expect(recovered.find((r) => r.captureId === '1700000002001-bb02')).toMatchObject({ via: 'sidecar' });

    const video = handle.sqlite.prepare('SELECT image, video, url, source FROM posts WHERE captureId = ?').get('1700000002001-bb02');
    expect(video).toMatchObject({ image: null, url: 'https://x.com/u/status/2', source: null });
    const media = handle.sqlite.prepare('SELECT file, posterFile FROM media WHERE postId = ?').all('1700000002001-bb02');
    expect(media).toEqual([{ file: '1700000002001-bb02-media-0.mp4', posterFile: '1700000002001-bb02-poster.jpg' }]);
    // 回復後は posts の行があるのでもう孤児ではない＝警告は消える
    expect(findOrphanMedia(saveFolder, handle.sqlite).some((o) => o.captureId.startsWith('1700000002000') || o.captureId.startsWith('1700000002001'))).toBe(false);
  });

  test('サイドカーがcaptureIdを偽っていてもファイル名側が勝つ', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000002003-bb04.jpg'), 'x');
    fs.writeFileSync(path.join(saveFolder, '1700000002003-bb04.json'), JSON.stringify({ captureId: '9999999999999-dead', image: '1700000002003-bb04.jpg', text: 'claims a different id' }));

    recoverOrphanRecords(saveFolder, handle.sqlite);

    expect(handle.sqlite.prepare('SELECT text FROM posts WHERE captureId = ?').get('1700000002003-bb04')).toMatchObject({ text: 'claims a different id' });
    expect(handle.sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('9999999999999-dead')).toBeUndefined();
  });

  test('trashedAt付きのサイドカーは.trashではなく直下にメディアが在る＝ディスクが勝ち、生きた投稿として復活する', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000002004-bb05.jpg'), 'x');
    fs.writeFileSync(path.join(saveFolder, '1700000002004-bb05.json'), JSON.stringify({ captureId: '1700000002004-bb05', image: '1700000002004-bb05.jpg', text: 'stale trash flag', trashedAt: '2020-01-01T00:00:00.000Z' }));

    recoverOrphanRecords(saveFolder, handle.sqlite);

    expect(handle.sqlite.prepare('SELECT trashedAt FROM posts WHERE captureId = ?').get('1700000002004-bb05')).toMatchObject({ trashedAt: null });
  });

  test('中身が空のサイドカー（投稿の中身が何も無い＝#492の殻）は採用せず合成に落ちる', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000002005-bb06.jpg'), 'x');
    fs.writeFileSync(path.join(saveFolder, '1700000002005-bb06.json'), JSON.stringify({ captureId: '1700000002005-bb06', url: 'https://x.com/u/status/6' }));

    const recovered = recoverOrphanRecords(saveFolder, handle.sqlite);

    expect(recovered.find((r) => r.captureId === '1700000002005-bb06')).toMatchObject({ via: 'synthesized' });
    expect(handle.sqlite.prepare('SELECT url, source FROM posts WHERE captureId = ?').get('1700000002005-bb06')).toMatchObject({ url: null, source: 'orphan-recovery' });
  });

  test('壊れたJSONのサイドカーは合成に落ちる（回復自体は止まらない）', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000002006-bb07.jpg'), 'x');
    fs.writeFileSync(path.join(saveFolder, '1700000002006-bb07.json'), '{ not json');

    const recovered = recoverOrphanRecords(saveFolder, handle.sqlite);

    expect(recovered.find((r) => r.captureId === '1700000002006-bb07')).toMatchObject({ via: 'synthesized' });
    expect(handle.sqlite.prepare('SELECT image FROM posts WHERE captureId = ?').get('1700000002006-bb07')).toMatchObject({ image: '1700000002006-bb07.jpg' });
  });
});

describe('capturedAtFromId', () => {
  test('captureIdの先頭epochMillisをcapturedAtとして復元する', () => {
    expect(capturedAtFromId('1700000000000-aa01')).toBe(new Date(1700000000000).toISOString());
  });
});

describe('recoverOrphanRecords', () => {
  let saveFolder: string;
  let handle: { db: any; sqlite: any };
  const one = (sql: string, ...args: any[]) => handle.sqlite.prepare(sql).get(...args);

  beforeAll(() => {
    saveFolder = mkTempDir('hologram-integrity-synth-save-');
    handle = openDatabase(path.join(mkTempDir('hologram-integrity-synth-db-'), 'test.db'));
  });

  test('孤児メディアから最小postsレコードを書く（url null・source=orphan-recovery・capturedAtはID由来）', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000000500-ee01.jpg'), 'x');

    const written = recoverOrphanRecords(saveFolder, handle.sqlite);

    expect(written).toEqual([{ captureId: '1700000000500-ee01', file: '1700000000500-ee01.jpg', via: 'synthesized' }]);
    const row = one('SELECT image, video, url, source, capturedAt FROM posts WHERE captureId = ?', '1700000000500-ee01');
    expect(row).toMatchObject({ image: '1700000000500-ee01.jpg', video: null, url: null, source: 'orphan-recovery', capturedAt: new Date(1700000000500).toISOString() });
  });

  test('動画拡張子はimageでなくvideo列に入る', () => {
    fs.writeFileSync(path.join(saveFolder, '1700000000501-ee02.mp4'), 'x');

    recoverOrphanRecords(saveFolder, handle.sqlite);

    const row = one('SELECT image, video FROM posts WHERE captureId = ?', '1700000000501-ee02');
    expect(row).toMatchObject({ image: null, video: '1700000000501-ee02.mp4' });
  });

  test('項目フォルダーの複数メディアを一つの投稿として回収する', () => {
    const captureId = '1700000000502-ee03';
    const itemDir = path.join(saveFolder, 'items', captureId);
    fs.mkdirSync(itemDir, { recursive: true });
    fs.writeFileSync(path.join(itemDir, `${captureId}-media-0.jpg`), 'a');
    fs.writeFileSync(path.join(itemDir, `${captureId}-media-1.png`), 'b');

    const recovered = recoverOrphanRecords(saveFolder, handle.sqlite);

    expect(recovered.find((entry) => entry.captureId === captureId)?.files).toHaveLength(2);
    expect(handle.sqlite.prepare('SELECT file FROM media WHERE postId = ? ORDER BY seq').all(captureId)).toEqual([{ file: `items/${captureId}/${captureId}-media-0.jpg` }, { file: `items/${captureId}/${captureId}-media-1.png` }]);
  });

  test('再実行は冪等（既にposts行がある孤児は既にorphanでないので再合成されない）', () => {
    const before = handle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n;

    const written = recoverOrphanRecords(saveFolder, handle.sqlite);

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

    // (a) inbox 経由で入った投稿＝#299 のリプレイで救えるはずの経路
    const inboxRec = normalizePostRecord({ captureId: '1700000001000-ff01', url: 'https://x.com/u/status/1', image: '1700000001000-ff01.jpg', text: 'via inbox' });
    fs.writeFileSync(path.join(saveFolder, '1700000001000-ff01.jpg'), 'x');
    await writeInboxEvent(saveFolder, buildEnvelope(inboxRec));
    drainInbox(saveFolder, handle.sqlite);
    expect(handle.sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('1700000001000-ff01')).toBeTruthy();

    // (b) 直に書かれた投稿。サイドカーも inbox イベントも持たず、孤児の回復でしか救えない経路
    writeDirectPost(handle.sqlite, saveFolder, '1700000001001-ff02', '1700000001001-ff02.jpg');
    expect(handle.sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('1700000001001-ff02')).toBeTruthy();

    // スナップショット (lib-db-snapshot.ts)＝backup API で静止した複製を作る
    const snapshotFile = path.join(mkTempDir('hologram-backup-rehearsal-'), 'hologram.db');
    await snapshotDatabase(handle.sqlite, snapshotFile);
    expect(fs.existsSync(snapshotFile)).toBe(true);

    // DB の消失を模す。(b) の投稿はスナップショットの後に新しいイベントを出さないので、
    // スナップショット自体に (b) の行が既に入っている。孤児の回復が本当に相手にすべきなのは
    // 「スナップショットの後に直に書かれ、その後 DB を失った」場合なので、スナップショットした
    // DB は捨てて空の DB から始める（＝スナップショットが無い、または古くなっている最悪の場合の
    // 再現）。
    handle.sqlite.close();
    fs.rmSync(dbFile, { force: true });
    fs.rmSync(`${dbFile}-wal`, { force: true });
    fs.rmSync(`${dbFile}-shm`, { force: true });
    handle = openDatabase(dbFile); // まっさらな空の DB

    // リプレイ: (a) は inbox の loose なイベントから drainInbox で復活する
    const report = drainInbox(saveFolder, handle.sqlite);
    expect(report.applied).toContain('1700000001000-ff01');
    expect(handle.sqlite.prepare('SELECT text FROM posts WHERE captureId = ?').get('1700000001000-ff01')).toMatchObject({ text: 'via inbox' });

    // (b) はまだ存在しない＝リプレイでは救えない
    expect(handle.sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('1700000001001-ff02')).toBeUndefined();

    // 孤児の検出 → 最小レコードの合成で (b) も復活する
    const { orphanMedia } = checkOrphans(saveFolder, handle.sqlite);
    expect(orphanMedia).toEqual(expect.arrayContaining([{ captureId: '1700000001001-ff02', file: '1700000001001-ff02.jpg' }]));
    const recovered = recoverOrphanRecords(saveFolder, handle.sqlite);
    expect(recovered.map((r) => r.captureId)).toContain('1700000001001-ff02');

    const restoredB = handle.sqlite.prepare('SELECT image, source, url FROM posts WHERE captureId = ?').get('1700000001001-ff02');
    expect(restoredB).toMatchObject({ image: '1700000001001-ff02.jpg', source: 'orphan-recovery', url: null });

    // 最終確認: 両方とも posts として復活している
    expect(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n).toBe(2);

    handle.sqlite.close();
  });
});
