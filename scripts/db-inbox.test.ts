// Unit test for app/src/main/lib-db-inbox.ts, the durable intake queue's
// consumer (#5 St6 / #299). Builds a synthetic saveFolder (writing real
// envelopes into .hologram-inbox/new via native-host/inbox.mts's
// buildEnvelope/writeInboxEvent), intakes them into a real SQLite (via
// app/src/main/lib-db.ts) with drainInbox, and directly checks the finalized
// design's idempotency and conflict rules:
//   - a new event becomes a posts row exactly once and gets a receipt
//   - re-draining the same event is a no-op (the acceptance criterion's idempotency, directly)
//   - that no-op happens without opening the file (a loose file no newer than its receipt is never read)
//   - if the eventId matches but the hash differs, it's reported as a conflict and the existing row is untouched
//   - if the captureId already exists but URL/media disagree, it's reported as a conflict
//   - if the captureId already exists and URL/media agree, only the receipt is added (no overwrite)
//   - if required media is missing, no receipt is attached and it's carried
//     over to next time; other events aren't blocked by it
//   - none of the skips above add a row to the DB (indirect evidence of the transaction boundary)
//   - an acquired original (#292) carried in the envelope lands in raw_payloads in the same transaction as posts

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

    // A loose file that's already been intaken becomes a no-op purely from its
    // receipt = its content is never read. If it were read, the broken JSON
    // would show up in skipped as invalid-json, so its absence is evidence that
    // it was "never opened". Setting mtime back to before the receipt
    // reproduces the state of "not rewritten since intake" (if it had been rewritten, hash-conflict below is what would go read it).
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
      const captureId = '1700000000000-aa01'; // already applied in the earlier stage
      const rec = normalizePostRecord({ captureId, url: 'https://x.com/u/status/1', image: '1700000000000-aa01.jpg', text: 'DIFFERENT' });
      const envelope = buildEnvelope(rec);
      // Writes an envelope directly whose eventId is the same but whose payload (text) differs (overwriting the same file).
      fs.writeFileSync(path.join(inboxNewDir(saveFolder), `${captureId}.json`), JSON.stringify(envelope));

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.skipped).toEqual([expect.objectContaining({ reason: 'hash-conflict' })]);
      expect(one('SELECT text FROM posts WHERE captureId = ?', captureId).text).toBe('hello'); // unchanged
    });
  });

  describe('missing-media', () => {
    test('必須メディアが saveFolder に無ければ receipt を付けず、他 event は続行する', async () => {
      const missing = await seedEnvelope({ captureId: '1700000000100-bb01', url: 'https://x.com/u/status/2', image: '1700000000100-bb01.jpg' }); // don't write the image file
      const ok = await seedEnvelope({ captureId: '1700000000100-bb02', url: 'https://x.com/u/status/3', image: '1700000000100-bb02.jpg' }, ['1700000000100-bb02.jpg']);

      const report = drainInbox(saveFolder, handle.sqlite);

      expect(report.applied).toEqual([ok.eventId]);
      expect(report.skipped.find((s: any) => s.file === `${missing.eventId}.json`)).toMatchObject({ reason: 'missing-media' });
      expect(one('SELECT 1 FROM posts WHERE captureId = ?', missing.eventId)).toBeUndefined();
      expect(one('SELECT 1 FROM inbox_events WHERE eventId = ?', missing.eventId)).toBeUndefined();

      // If the media arrives later, the next drain picks it up (the retry
      // contract for when media arrives late during sync restore).
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
      // Assumes a post with the same captureId already exists in the DB, arriving earlier via "a different path (equivalent to an import)".
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

  // #292: the acquired original is committed in the same transaction as the
  // post = the original carried in the envelope arrives together with the
  // posts row (never a state where only one of them arrives).
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

    // A producer with no original (ZIP import, in-app intake, an old record) simply doesn't create a row
    test('原本の無いレコードは行を作らない', async () => {
      const other = '1700000000600-ff02';
      await seedEnvelope({ captureId: other, url: 'https://x.com/u/status/12', image: `${other}.jpg` }, [`${other}.jpg`]);

      drainInbox(saveFolder, handle.sqlite);

      expect(one('SELECT COUNT(*) AS n FROM raw_payloads WHERE postId = ?', other).n).toBe(0);
    });
  });
});
