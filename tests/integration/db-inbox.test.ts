// 壊れない取込キューの消費側 app/src/main/lib-db-inbox.ts (#5 St6 / #299) の単体テスト。
// 合成した saveFolder を作り（native-host/inbox.mts の buildEnvelope/writeInboxEvent で
// 本物のエンベロープを .hologram-inbox/new へ書く）、drainInbox でそれを本物の SQLite
//（app/src/main/lib-db.ts 経由）へ取り込み、確定した設計の何度実行しても同じという性質と
// 衝突の規則を直に確かめる。
//   - 新しい event はちょうど1回だけ posts 行になり、受領記録が付く
//   - 同じ event をもう一度 drain しても何もしない（受け入れ条件の「何度実行しても同じ」を直に）
//   - その「何もしない」がファイルを開かずに起きる（受領記録より新しくない loose ファイルは読まない）
//   - eventId が一致してハッシュが違えば衝突として報告し、既存の行は触らない
//   - captureId がすでにあり URL/media が食い違えば衝突として報告する
//   - captureId がすでにあり URL/media が一致すれば受領記録だけ足す（上書きしない）
//   - 必須のメディアが無ければ受領記録を付けず、次回へ持ち越す。他の event はそれに堰き止められない
//   - 上のどの飛ばし方でも DB に行が増えない（トランザクションの境界の間接的な証拠）
//   - apply が例外を投げたエンベロープ (#920) は飛ばして .hologram-inbox/failed/ へ隔離する
//     ＝残りの drain はそのまま着地し、次の drain も同じところで転ばない（loose ファイルでも
//     セグメントの行でも同じ）

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildEnvelope, inboxFailedDir, inboxNewDir, inboxSegmentsDir, writeInboxEvent } from '../../native-host/inbox.mts';
import { normalizePostRecord } from '../../native-host/post-record.mts';
import { openDatabase } from '../../app/src/main/lib-db';
import { drainInbox } from '../../app/src/main/lib-db-inbox';

const dirs: string[] = [];

test('一部保存の再試行は同じ投稿を更新し、本文とタグを維持する', async () => {
  const folder = mkTempDir('hologram-retry-');
  const db = openDatabase(path.join(folder, 'library.db'));
  try {
    const original = normalizePostRecord({ captureId: '1700000000800-ab01', url: 'https://x.com/a/status/123456', text: '既存の本文', tags: ['手動タグ'], saveIncomplete: true });
    await writeInboxEvent(folder, buildEnvelope(original));
    drainInbox(folder, db.sqlite);
    db.sqlite.prepare('UPDATE posts SET localViewCount=7 WHERE captureId=?').run(original.captureId);
    const retry = normalizePostRecord({ captureId: '1700000000801-ab02', retryOf: original.captureId, url: original.url, displayName: '取得できた投稿者', saveIncomplete: false });
    await writeInboxEvent(folder, buildEnvelope(retry));
    const report = drainInbox(folder, db.sqlite);
    expect(report.skipped).toEqual([]);
    expect(db.sqlite.prepare('SELECT captureId,text,displayName,saveIncomplete,localViewCount FROM posts').all()).toEqual([{ captureId: original.captureId, text: '既存の本文', displayName: '取得できた投稿者', saveIncomplete: 0, localViewCount: 7 }]);
    expect(db.sqlite.prepare('SELECT name FROM tags JOIN post_tags ON tags.id=post_tags.tagId').all()).toEqual([{ name: '手動タグ' }]);
    expect(drainInbox(folder, db.sqlite).applied).toEqual([]);
  } finally {
    db.sqlite.close();
  }
});
test('一般ページの再試行は同じ媒体だけを更新し、別の媒体への差し替えは拒否する', async () => {
  const folder = mkTempDir('hologram-web-retry-');
  const db = openDatabase(path.join(folder, 'library.db'));
  try {
    fs.writeFileSync(path.join(folder, 'image.jpg'), 'test');
    const original = normalizePostRecord({ captureId: '1700000000900-ac01', url: 'https://example.com/article', source: 'web', saveScope: 'media', saveIncomplete: true, media: [{ url: 'https://example.com/image.jpg', file: 'image.jpg' }] });
    await writeInboxEvent(folder, buildEnvelope(original));
    drainInbox(folder, db.sqlite);
    const retry = normalizePostRecord({ ...original, captureId: '1700000000901-ac02', retryOf: original.captureId, title: '取得できたタイトル', saveIncomplete: false });
    await writeInboxEvent(folder, buildEnvelope(retry));
    expect(drainInbox(folder, db.sqlite).skipped).toEqual([]);
    expect(db.sqlite.prepare('SELECT captureId,title,saveIncomplete FROM posts').all()).toEqual([{ captureId: original.captureId, title: '取得できたタイトル', saveIncomplete: 0 }]);
    const wrong = normalizePostRecord({ ...retry, captureId: '1700000000902-ac03', media: [{ url: 'https://example.com/other.jpg', file: 'image.jpg' }] });
    await writeInboxEvent(folder, buildEnvelope(wrong));
    expect(drainInbox(folder, db.sqlite).skipped).toContainEqual(expect.objectContaining({ reason: 'retry-target-mismatch' }));
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 1 });
  } finally {
    db.sqlite.close();
  }
});

test('DB 復元ではハッシュ順で先に現れた再試行を元投稿のセグメント後に適用する', () => {
  const folder = mkTempDir('hologram-retry-segment-replay-');
  const db = openDatabase(path.join(folder, 'library.db'));
  try {
    const original = normalizePostRecord({ captureId: '1700000000950-ad01', url: 'https://x.com/a/status/654321', saveIncomplete: true });
    const retry = normalizePostRecord({ captureId: '1700000000951-ad02', retryOf: original.captureId, url: original.url, title: '再試行で取得した題名', saveIncomplete: false });
    fs.mkdirSync(inboxSegmentsDir(folder), { recursive: true });
    fs.writeFileSync(path.join(inboxSegmentsDir(folder), '0-retry.jsonl'), `${JSON.stringify(buildEnvelope(retry))}\n`);
    fs.writeFileSync(path.join(inboxSegmentsDir(folder), 'f-original.jsonl'), `${JSON.stringify(buildEnvelope(original))}\n`);

    const report = drainInbox(folder, db.sqlite);

    expect(report.skipped).toEqual([]);
    expect(report.applied).toEqual([original.captureId, retry.captureId]);
    expect(db.sqlite.prepare('SELECT captureId,title,saveIncomplete FROM posts').all()).toEqual([{ captureId: original.captureId, title: '再試行で取得した題名', saveIncomplete: 0 }]);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM inbox_segments').get()).toEqual({ n: 2 });
    expect(drainInbox(folder, db.sqlite).segmentsReplayed).toEqual([]);
  } finally {
    db.sqlite.close();
  }
});

function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let saveFolder: string;
let handle: { db: any; sqlite: any };

const one = (sql: string, ...args: any[]) => handle.sqlite.prepare(sql).get(...args);
const count = (table: string) => one(`SELECT COUNT(*) AS n FROM ${table}`).n;

afterAll(() => {
  try {
    handle?.sqlite.close();
  } catch {
    /* もう閉じている */
  }
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* 片付けはできる範囲で */
    }
  }
});

async function seedEnvelope(overrides: Record<string, unknown>, mediaFiles: string[] = []) {
  const rec = normalizePostRecord({ captureId: overrides.captureId as string, url: (overrides.url as string) ?? null, image: (overrides.image as string) ?? null, ...overrides } as any);
  for (const f of mediaFiles) fs.writeFileSync(path.join(saveFolder, f), 'x');
  const envelope = buildEnvelope(rec);
  await writeInboxEvent(saveFolder, envelope);
  return envelope;
}

describe('drainInbox', () => {
  beforeAll(() => {
    saveFolder = mkTempDir('hologram-db-inbox-save-');
    handle = openDatabase(path.join(mkTempDir('hologram-db-inbox-db-'), 'test.db'));
  });

  describe('新規 event', () => {
    test('posts 行が作られ、inbox_events receipt が付く', async () => {
      const envelope = await seedEnvelope({ captureId: '1700000000000-aa01', url: 'https://x.com/u/status/1', image: '1700000000000-aa01.jpg', text: 'hello' }, ['1700000000000-aa01.jpg']);

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report).toMatchObject({ applied: [envelope.eventId], receiptOnly: [], noop: 0, skipped: [] });
      expect(one('SELECT text FROM posts WHERE captureId = ?', envelope.eventId).text).toBe('hello');
      expect(one('SELECT payloadSha256 FROM inbox_events WHERE eventId = ?', envelope.eventId).payloadSha256).toBe(envelope.payloadSha256);
    });

    test('同じ event の再 drain は no-op（行が増えない）', async () => {
      const before = count('posts');

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report).toMatchObject({ applied: [], receiptOnly: [], noop: 1, skipped: [] });
      expect(count('posts')).toBe(before);
    });

    // すでに取り込んだ loose ファイルは、受領記録だけで何もしないことになる＝中身は読まない。
    // もし読んでいれば、壊れた JSON が invalid-json として skipped に出る。出ないことが
    //「一度も開いていない」証拠になる。mtime を受領記録より前へ戻すと、「取り込んでから
    // 書き直していない」状態を再現できる（書き直されていれば、下の hash-conflict のほうが
    // 読みに行く）。
    test('取込済みの loose はファイルを開かずに no-op になる', () => {
      const captureId = '1700000000000-aa01';
      const file = path.join(inboxNewDir(saveFolder), `${captureId}.json`);
      const importedAt = Date.parse(one('SELECT importedAt FROM inbox_events WHERE eventId = ?', captureId).importedAt);
      const original = fs.readFileSync(file);
      fs.writeFileSync(file, 'this is not json');
      const old = new Date(importedAt - 60_000);
      fs.utimesSync(file, old, old);

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report).toMatchObject({ applied: [], receiptOnly: [], noop: 1, skipped: [] });
      fs.writeFileSync(file, original);
    });
  });

  describe('hash-conflict', () => {
    test('同じ eventId で違う payload は conflict として報告し、既存行を変えない', async () => {
      const captureId = '1700000000000-aa01'; // 前の段ですでに適用済み
      const rec = normalizePostRecord({ captureId, url: 'https://x.com/u/status/1', image: '1700000000000-aa01.jpg', text: 'DIFFERENT' });
      const envelope = buildEnvelope(rec);
      // eventId は同じでペイロード (text) が違うエンベロープを直に書く（同じファイルを上書きする）。
      fs.writeFileSync(path.join(inboxNewDir(saveFolder), `${captureId}.json`), JSON.stringify(envelope));

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.skipped).toEqual([expect.objectContaining({ reason: 'hash-conflict' })]);
      expect(one('SELECT text FROM posts WHERE captureId = ?', captureId).text).toBe('hello'); // 変わっていない
    });
  });

  describe('missing-media', () => {
    test('旧パスを推測せず、アプリ外で現行パスへ変換した履歴を再生する', async () => {
      const captureId = '1700000000099-aa99';
      const file = `${captureId}.jpg`;
      const envelope = await seedEnvelope({ captureId, url: 'https://x.com/u/status/199', image: file });
      const itemDir = path.join(saveFolder, 'items', captureId);
      fs.mkdirSync(itemDir, { recursive: true });
      fs.writeFileSync(path.join(itemDir, file), 'x');

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.applied).not.toContain(envelope.eventId);
      expect(one('SELECT image FROM posts WHERE captureId = ?', captureId)).toBeUndefined();
      const converted = buildEnvelope({ ...envelope.record, image: `items/${captureId}/${file}` });
      fs.writeFileSync(path.join(inboxNewDir(saveFolder), `${captureId}.json`), JSON.stringify(converted));
      expect(drainInbox(saveFolder, handle.sqlite).applied).toContain(envelope.eventId);
      expect(one('SELECT image FROM posts WHERE captureId = ?', captureId).image).toBe(`items/${captureId}/${file}`);
    });

    test('必須メディアが saveFolder に無ければ receipt を付けず、他 event は続行する', async () => {
      const missing = await seedEnvelope({ captureId: '1700000000100-bb01', url: 'https://x.com/u/status/2', image: '1700000000100-bb01.jpg' }); // 画像ファイルは書かない
      const ok = await seedEnvelope({ captureId: '1700000000100-bb02', url: 'https://x.com/u/status/3', image: '1700000000100-bb02.jpg' }, ['1700000000100-bb02.jpg']);

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.applied).toEqual([ok.eventId]);
      expect(report.skipped.find((s: any) => s.file === `${missing.eventId}.json`)).toMatchObject({ reason: 'missing-media' });
      expect(one('SELECT 1 FROM posts WHERE captureId = ?', missing.eventId)).toBeUndefined();
      expect(one('SELECT 1 FROM inbox_events WHERE eventId = ?', missing.eventId)).toBeUndefined();

      // メディアが後から届けば、次の drain が拾う（同期による復元でメディアが遅れて
      // 届く場合の、再試行の取り決め）。
      fs.writeFileSync(path.join(saveFolder, '1700000000100-bb01.jpg'), 'x');
      const report2 = drainInbox(saveFolder, handle.sqlite);
      expect(report2.applied).toEqual([missing.eventId]);
    });

    // 素の "../../evil.txt" はそもそも外へ出られない。resolveInSaveFolder は、認めた部分
    // パスの形（avatars/<file> / .trash/<file>）の外にあるものには path.basename() を掛ける
    // ので、ただの "evil.txt" になる（missing であって escape ではない）。".." を拒む意味が
    // あるのはその部分パスだけ＝規則そのものは save-folder-path.test.ts が見ている。
    test('media[].file が avatars/.. で escape を試みても saveFolder の外は読まない', async () => {
      const rec = normalizePostRecord({ captureId: '1700000000200-cc01', url: 'https://x.com/u/status/9', media: [{ file: 'avatars/..', url: '', alt: null, width: null, height: null, type: null, posterFile: null }] });
      const envelope = buildEnvelope(rec);
      await writeInboxEvent(saveFolder, envelope);

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.skipped.find((s: any) => s.file === `${rec.captureId}.json`)).toMatchObject({ reason: 'missing-media', detail: expect.stringContaining('escapes save folder') });
    });

    test('media[].file がただの相対パス表記でも basename に切り詰められる（missing 扱い・escape ではない）', async () => {
      const rec = normalizePostRecord({ captureId: '1700000000201-cc02', url: 'https://x.com/u/status/9', media: [{ file: '../../evil.txt', url: '', alt: null, width: null, height: null, type: null, posterFile: null }] });
      const envelope = buildEnvelope(rec);
      await writeInboxEvent(saveFolder, envelope);

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.skipped.find((s: any) => s.file === `${rec.captureId}.json`)).toMatchObject({ reason: 'missing-media', detail: 'missing media: ../../evil.txt' });
    });
  });

  describe('captureId が既存の posts と重なる場合', () => {
    test('URL/media が一致すれば receipt だけ足す（上書きしない）', async () => {
      const captureId = '1700000000300-dd01';
      fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), 'x');
      // 同じ captureId の投稿が「別の経路（取り込み相当）」で先に届き、すでに DB にある状況を想定する。
      handle.sqlite.prepare('INSERT INTO posts (captureId, image, url, capturedAt, updatedAt, hashtags) VALUES (?,?,?,?,?,?)').run(captureId, `${captureId}.jpg`, 'https://x.com/u/status/10', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '[]');

      const envelope = await seedEnvelope({ captureId, url: 'https://x.com/u/status/10', image: `${captureId}.jpg` });

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report).toMatchObject({ applied: [], receiptOnly: [envelope.eventId] });
      expect(report.skipped.find((s: any) => s.file === `${envelope.eventId}.json`)).toBeUndefined();
      expect(one('SELECT payloadSha256 FROM inbox_events WHERE eventId = ?', envelope.eventId)).toBeTruthy();
    });

    test('URL が食い違えば conflict として報告し、既存行を変えない', async () => {
      const captureId = '1700000000400-ee01';
      fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), 'x');
      handle.sqlite.prepare('INSERT INTO posts (captureId, image, url, capturedAt, updatedAt, hashtags) VALUES (?,?,?,?,?,?)').run(captureId, `${captureId}.jpg`, 'https://x.com/u/status/OLD', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '[]');

      await seedEnvelope({ captureId, url: 'https://x.com/u/status/NEW', image: `${captureId}.jpg` });

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.skipped.find((s: any) => s.file === `${captureId}.json`)).toMatchObject({ reason: 'post-conflict' });
      expect(one('SELECT url FROM posts WHERE captureId = ?', captureId).url).toBe('https://x.com/u/status/OLD');
    });
  });

  // #920: index.ts の drainInboxLogged が、数え上げた失敗についてはすでに謳っていた不変条件
  //（「1つの悪いファイルが残りを止めることは決してない」）を、数え上げていない失敗についても
  // 保つ。失敗の注入には BEFORE INSERT のトリガを使い、今たまたま制約に触れるレコードの形は
  // 使わない（#919 がまさにその形で、直せばこのテストは黙って役目を失う）＝試しているのは
  //「apply が例外を投げた」ことであって、その原因のどれか1つではない。
  describe('apply-failed（#920）', () => {
    const poison = '1700000000700-99a1';
    const healthy = '1700000000700-99a2'; // 毒より後ろに並ぶ＝drain が進み続けた場合にだけ着地する
    const segPoison = '1700000000800-99b1';
    const segHealthy = '1700000000800-99b2';
    const failedPath = (id: string) => path.join(inboxFailedDir(saveFolder), `${id}.json`);

    beforeAll(() => {
      handle.sqlite.exec(`CREATE TRIGGER poison_apply BEFORE INSERT ON posts WHEN NEW.captureId IN ('${poison}', '${segPoison}') BEGIN SELECT RAISE(ABORT, 'poisoned insert'); END;`);
    });
    afterAll(() => {
      try {
        handle.sqlite.exec('DROP TRIGGER IF EXISTS poison_apply');
      } catch {
        /* 順序によっては外側の afterAll が先に DB を閉じている */
      }
    });

    test('1件が例外を投げても後続は取り込まれ、毒は failed/ へ移る', async () => {
      await seedEnvelope({ captureId: poison, url: 'https://x.com/u/status/13', image: `${poison}.jpg` }, [`${poison}.jpg`]);
      const ok = await seedEnvelope({ captureId: healthy, url: 'https://x.com/u/status/14', image: `${healthy}.jpg` }, [`${healthy}.jpg`]);

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.applied).toEqual([ok.eventId]);
      expect(report.skipped.find((s: any) => s.file === `${poison}.json`)).toMatchObject({ reason: 'apply-failed', detail: expect.stringContaining('moved to failed/') });
      // 丸ごと巻き戻る。投稿も受領記録も存在しない。
      expect(one('SELECT 1 FROM posts WHERE captureId = ?', poison)).toBeUndefined();
      expect(one('SELECT 1 FROM inbox_events WHERE eventId = ?', poison)).toBeUndefined();
      // 消したのではなく移した＝診断のためにエンベロープのバイト列は読めるまま残る。
      expect(fs.existsSync(path.join(inboxNewDir(saveFolder), `${poison}.json`))).toBe(false);
      expect(JSON.parse(fs.readFileSync(failedPath(poison), 'utf8')).eventId).toBe(poison);
    });

    test('次の drain は同じ毒を読み直さない（ログが同じ行で埋まらない）', () => {
      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.skipped.find((s: any) => s.file === `${poison}.json`)).toBeUndefined();
      expect(report.applied).toEqual([]);
    });

    // DB を失ったときの再生の経路でも同じ規則。セグメントから1行だけ抜くことはできないので、
    // 落ちたエンベロープは failed/ へ複製し、セグメント自体（再生の元）はそのまま残す。
    test('セグメント再生でも1行の例外が残りの行を止めない', () => {
      for (const id of [segPoison, segHealthy]) fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), 'x');
      const lines = [buildEnvelope(normalizePostRecord({ captureId: segPoison, url: 'https://x.com/u/status/15', image: `${segPoison}.jpg` })), buildEnvelope(normalizePostRecord({ captureId: segHealthy, url: 'https://x.com/u/status/16', image: `${segHealthy}.jpg` }))].map((e) => JSON.stringify(e));
      fs.mkdirSync(inboxSegmentsDir(saveFolder), { recursive: true });
      fs.writeFileSync(path.join(inboxSegmentsDir(saveFolder), 'seg99b.jsonl'), `${lines.join('\n')}\n`);

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.segmentsReplayed).toEqual(['seg99b']);
      expect(report.applied).toEqual([segHealthy]);
      expect(report.skipped.find((s: any) => s.file === 'seg99b.jsonl')).toMatchObject({ reason: 'apply-failed', detail: expect.stringContaining('copied to failed/') });
      expect(JSON.parse(fs.readFileSync(failedPath(segPoison), 'utf8')).eventId).toBe(segPoison);
      // 悪い行があってもセグメントには受領記録が付く。だから次の drain はこれを開き直さない
      // ＝再試行できる形で残るのは隔離した複製のほう。
      expect(one('SELECT 1 FROM inbox_segments WHERE segmentId = ?', 'seg99b')).toBeTruthy();
      expect(drainInbox(saveFolder, handle.sqlite).segmentsReplayed).toEqual([]);
    });
  });
});
