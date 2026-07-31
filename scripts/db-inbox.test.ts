// app/src/main/lib-db-inbox.ts のユニットテスト＝耐久取込キューの consumer
// （#5 St6 / #299）。合成の saveFolder（.hologram-inbox/new へ本物の envelope を
// native-host/inbox.mts の buildEnvelope/writeInboxEvent で書く）を作り、本物の
// SQLite（app/src/main/lib-db.ts 経由）へ drainInbox で取り込んで、確定済み設計の
// 冪等性・競合ルールを直接見る:
//   - 新規 event は1回だけ posts 行になり、receipt が付く
//   - 同じ event の再 drain は no-op（受け入れ条件の冪等性そのもの）
//   - その no-op はファイルを開かずに済ませる（receipt より新しくない loose は読まない）
//   - eventId は同じだが hash が違えば conflict として報告し、既存行は変えない
//   - captureId は既にあるが URL/media が食い違えば conflict として報告する
//   - captureId は既にあり URL/media が一致すれば receipt だけ足す（上書きしない）
//   - 必須メディアが無ければ receipt を付けず次回に持ち越す。他 event は塞がない
//   - 上記いずれの skip でも DB に行が増えない（トランザクション境界の間接的な証拠）
//   - 封筒に載った取得原本（#292）が posts と同じトランザクションで raw_payloads へ着く

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildEnvelope, inboxNewDir, writeInboxEvent } from '../native-host/inbox.mts';
import { normalizePostRecord } from '../native-host/post-record.mts';
import { packRawPayloads, unpackRawPayload } from '../native-host/raw-payload.mts';
import { openDatabase } from '../app/src/main/lib-db';
import { drainInbox } from '../app/src/main/lib-db-inbox';

const dirs: string[] = [];
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
    /* already closed */
  }
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
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

    // 取込済みの loose は receipt だけで no-op になる＝中身を読まない。読んでいれば
    // 壊れた JSON が invalid-json として skipped に出るので、出ないことが「開いていない」
    // ことの証拠になる。mtime を receipt より古く戻すのは「取込後に書き換えられていない」
    // 状態の再現（書き換えられた場合は下の hash-conflict が読みに行く）。
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
      const captureId = '1700000000000-aa01'; // 前段で既に applied 済み
      const rec = normalizePostRecord({ captureId, url: 'https://x.com/u/status/1', image: '1700000000000-aa01.jpg', text: 'DIFFERENT' });
      const envelope = buildEnvelope(rec);
      // eventId は同じだが payload（text）が違う envelope を直接書き込む（同じファイルを上書き）。
      fs.writeFileSync(path.join(inboxNewDir(saveFolder), `${captureId}.json`), JSON.stringify(envelope));

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.skipped).toEqual([expect.objectContaining({ reason: 'hash-conflict' })]);
      expect(one('SELECT text FROM posts WHERE captureId = ?', captureId).text).toBe('hello'); // 変わっていない
    });
  });

  describe('missing-media', () => {
    test('必須メディアが saveFolder に無ければ receipt を付けず、他 event は続行する', async () => {
      const missing = await seedEnvelope({ captureId: '1700000000100-bb01', url: 'https://x.com/u/status/2', image: '1700000000100-bb01.jpg' }); // 画像ファイルは書かない
      const ok = await seedEnvelope({ captureId: '1700000000100-bb02', url: 'https://x.com/u/status/3', image: '1700000000100-bb02.jpg' }, ['1700000000100-bb02.jpg']);

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.applied).toEqual([ok.eventId]);
      expect(report.skipped.find((s: any) => s.file === `${missing.eventId}.json`)).toMatchObject({ reason: 'missing-media' });
      expect(one('SELECT 1 FROM posts WHERE captureId = ?', missing.eventId)).toBeUndefined();
      expect(one('SELECT 1 FROM inbox_events WHERE eventId = ?', missing.eventId)).toBeUndefined();

      // 後からメディアが届けば次回 drain で拾われる（同期復元でメディア到着が遅い場合の再試行契約）。
      fs.writeFileSync(path.join(saveFolder, '1700000000100-bb01.jpg'), 'x');
      const report2 = drainInbox(saveFolder, handle.sqlite);
      expect(report2.applied).toEqual([missing.eventId]);
    });

    // A bare "../../evil.txt" can't escape at all: resolveInSaveFolder takes
    // path.basename() of anything outside the sanctioned subpath shapes
    // (avatars/<file> / .trash/<file>), so it just becomes "evil.txt" (missing,
    // not escaping). Those subpaths are the one place ".." is meaningful to
    // reject — the rule itself is covered by save-folder-path.test.ts.
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
      // 先に「別経路（import 相当）」で同じ captureId の投稿が既に DB にあるとする。
      handle.sqlite.prepare('INSERT INTO posts (captureId, assetClass, image, url, capturedAt, updatedAt, hashtags) VALUES (?,?,?,?,?,?,?)').run(captureId, 'media', `${captureId}.jpg`, 'https://x.com/u/status/10', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '[]');

      const envelope = await seedEnvelope({ captureId, url: 'https://x.com/u/status/10', image: `${captureId}.jpg` });

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report).toMatchObject({ applied: [], receiptOnly: [envelope.eventId] });
      expect(report.skipped.find((s: any) => s.file === `${envelope.eventId}.json`)).toBeUndefined();
      expect(one('SELECT payloadSha256 FROM inbox_events WHERE eventId = ?', envelope.eventId)).toBeTruthy();
    });

    test('URL が食い違えば conflict として報告し、既存行を変えない', async () => {
      const captureId = '1700000000400-ee01';
      fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), 'x');
      handle.sqlite.prepare('INSERT INTO posts (captureId, assetClass, image, url, capturedAt, updatedAt, hashtags) VALUES (?,?,?,?,?,?,?)').run(captureId, 'media', `${captureId}.jpg`, 'https://x.com/u/status/OLD', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '[]');

      await seedEnvelope({ captureId, url: 'https://x.com/u/status/NEW', image: `${captureId}.jpg` });

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.skipped.find((s: any) => s.file === `${captureId}.json`)).toMatchObject({ reason: 'post-conflict' });
      expect(one('SELECT url FROM posts WHERE captureId = ?', captureId).url).toBe('https://x.com/u/status/OLD');
    });
  });

  // #292: 取得原本は投稿と同じトランザクションで確定する＝封筒に載って来た原本が
  // posts 行と一緒に着く（片方だけ着く状態を作らない）。
  describe('取得原本（raw_payloads）', () => {
    const captureId = '1700000000500-ff01';
    const body = '{"text":"hello","unknown_future_field":42}';

    test('封筒の原本が posts と同時に raw_payloads へ着く', async () => {
      const envelope = await seedEnvelope({ captureId, url: 'https://x.com/u/status/11', image: `${captureId}.jpg`, raw: packRawPayloads([{ sourceKind: 'api:x/tweet-result', contentType: 'application/json', body }]) }, [`${captureId}.jpg`]);

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.applied).toContain(envelope.eventId);
      const row = one('SELECT sourceKind, encoding, sha256, byteLength, payload FROM raw_payloads WHERE postId = ?', captureId);
      expect({ sourceKind: row.sourceKind, encoding: row.encoding, byteLength: row.byteLength }).toEqual({ sourceKind: 'api:x/tweet-result', encoding: 'gzip', byteLength: Buffer.byteLength(body, 'utf8') });
    });

    test('保存された原本は受け取った本文へそのまま戻る', () => {
      const row = one('SELECT encoding, sha256, payload FROM raw_payloads WHERE postId = ?', captureId);
      expect(unpackRawPayload(row)).toBe(body);
    });

    // 原本を持たない生成側（ZIP 取込・アプリ内取込・旧レコード）は行を作らないだけ
    test('原本の無いレコードは行を作らない', async () => {
      const other = '1700000000600-ff02';
      await seedEnvelope({ captureId: other, url: 'https://x.com/u/status/12', image: `${other}.jpg` }, [`${other}.jpg`]);

      drainInbox(saveFolder, handle.sqlite);

      expect(one('SELECT COUNT(*) AS n FROM raw_payloads WHERE postId = ?', other).n).toBe(0);
    });
  });
});
