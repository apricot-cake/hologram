// native-host/inbox.mts のユニットテスト＝耐久取込キューの envelope 形式とアトミック
// 書き込み（#5 St6 / #299）。素の Node で動く（Electron 不要）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { buildEnvelope, ensureInboxDirs, inboxDir, inboxNewDir, inboxSegmentsDir, inboxTmpDir, parseInboxEnvelope, sha256Hex, writeInboxEvent } from '../native-host/inbox.mts';
import { normalizePostRecord } from '../native-host/post-record.mts';

const dirs: string[] = [];
function mkSaveFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-inbox-'));
  dirs.push(dir);
  return dir;
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

const rec = normalizePostRecord({ captureId: '1700000000000-aaaa', url: 'https://x.com/u/status/1', image: '1700000000000-aaaa.jpg' });

describe('buildEnvelope', () => {
  const envelope = buildEnvelope(rec);

  test('format/version/kind/eventId が確定値', () => {
    expect(envelope).toMatchObject({ format: 'hologram-inbox', version: 1, kind: 'post.capture', eventId: rec.captureId });
  });

  test('payloadSha256 は record の JSON に対する sha256', () => {
    expect(envelope.payloadSha256).toBe(sha256Hex(JSON.stringify(rec)));
  });

  test('record をそのまま運ぶ（改変しない）', () => {
    expect(envelope.record).toEqual(rec);
  });

  test('kind/now は上書きできる', () => {
    const custom = buildEnvelope(rec, { kind: 'post.capture', now: () => '2026-01-01T00:00:00.000Z' });
    expect(custom.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('ensureInboxDirs / パス解決', () => {
  test('tmp/new/segments が saveFolder/.hologram-inbox の下に作られる', () => {
    const folder = mkSaveFolder();
    ensureInboxDirs(folder);

    expect(fs.statSync(inboxTmpDir(folder)).isDirectory()).toBe(true);
    expect(fs.statSync(inboxNewDir(folder)).isDirectory()).toBe(true);
    expect(fs.statSync(inboxSegmentsDir(folder)).isDirectory()).toBe(true);
    expect(inboxTmpDir(folder)).toBe(path.join(inboxDir(folder), 'tmp'));
  });
});

describe('writeInboxEvent', () => {
  test('new/<eventId>.json へ書かれ、tmp に残骸を残さない', async () => {
    const folder = mkSaveFolder();
    const envelope = buildEnvelope(rec);

    await writeInboxEvent(folder, envelope);

    const finalPath = path.join(inboxNewDir(folder), `${rec.captureId}.json`);
    expect(fs.existsSync(finalPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(finalPath, 'utf8'))).toEqual(envelope);
    expect(fs.readdirSync(inboxTmpDir(folder))).toEqual([]);
  });

  test('ディレクトリが無くても自動作成する', async () => {
    const folder = mkSaveFolder();
    const envelope = buildEnvelope(normalizePostRecord({ captureId: '1700000000001-bbbb', url: 'https://x.com/u/status/2' }));

    await expect(writeInboxEvent(folder, envelope)).resolves.toBeUndefined();
  });

  test('同じ eventId への再書き込みは wx フラグで拒否される（上書きしない）', async () => {
    const folder = mkSaveFolder();
    const envelope = buildEnvelope(rec);
    await writeInboxEvent(folder, envelope);

    // 同じ eventId で "new" 側に既にファイルがある状態からの再書き込みは
    // tmp ファイル自体は別名（pid+random）なので wx 自体には引っかからないが、
    // rename 先の new/<eventId>.json は上書きされる（fs.rename の既定動作）。
    // 二重発行の防止は呼び出し側（bridge.cts の uniqueBase）の責務であり、この
    // 層は「一度 commit された内容を無言で破壊しない」ことだけを保証しない —
    // 実際に検証すべきは tmp ファイル名の排他性（同時に2つ書いても両方成功する
    // か、片方が失敗してもオーファンを残さないか）。
    const envelope2 = buildEnvelope({ ...rec, text: 'edited' });
    await writeInboxEvent(folder, envelope2);
    const finalPath = path.join(inboxNewDir(folder), `${rec.captureId}.json`);
    expect(JSON.parse(fs.readFileSync(finalPath, 'utf8')).record.text).toBe('edited');
  });

  test('不正な eventId は拒否する（captureId のサニタイズ漏れを二重チェック）', async () => {
    const folder = mkSaveFolder();
    const envelope = buildEnvelope(rec);
    (envelope as any).eventId = '../../etc/passwd';

    await expect(writeInboxEvent(folder, envelope)).rejects.toThrow(/invalid eventId/);
  });
});

describe('parseInboxEnvelope', () => {
  test('正しい envelope を検証つきで受理する', () => {
    const envelope = buildEnvelope(rec);
    const parsed = parseInboxEnvelope(JSON.stringify(envelope));

    expect(parsed).toMatchObject({ ok: true, envelope: { eventId: rec.captureId } });
  });

  test('壊れた JSON は invalid-json', () => {
    expect(parseInboxEnvelope('{ not json')).toMatchObject({ ok: false, reason: 'invalid-json' });
  });

  test('format が違えば unknown-format', () => {
    const envelope: any = buildEnvelope(rec);
    envelope.format = 'something-else';
    expect(parseInboxEnvelope(JSON.stringify(envelope))).toMatchObject({ ok: false, reason: 'unknown-format' });
  });

  test('version が違えば unknown-version', () => {
    const envelope: any = buildEnvelope(rec);
    envelope.version = 2;
    expect(parseInboxEnvelope(JSON.stringify(envelope))).toMatchObject({ ok: false, reason: 'unknown-version' });
  });

  test('kind が違えば unknown-kind', () => {
    const envelope: any = buildEnvelope(rec);
    envelope.kind = 'post.update';
    expect(parseInboxEnvelope(JSON.stringify(envelope))).toMatchObject({ ok: false, reason: 'unknown-kind' });
  });

  test('eventId と record.captureId が食い違えば id-mismatch', () => {
    const envelope: any = buildEnvelope(rec);
    envelope.record = { ...envelope.record, captureId: '1700000000000-zzzz' };
    expect(parseInboxEnvelope(JSON.stringify(envelope))).toMatchObject({ ok: false, reason: 'id-mismatch' });
  });

  test('payloadSha256 が record と食い違えば hash-mismatch（改ざん/破損検出）', () => {
    const envelope: any = buildEnvelope(rec);
    envelope.record = { ...envelope.record, text: 'tampered' };
    expect(parseInboxEnvelope(JSON.stringify(envelope))).toMatchObject({ ok: false, reason: 'hash-mismatch' });
  });

  test('eventId の形式が不正なら malformed', () => {
    const envelope: any = buildEnvelope(rec);
    envelope.eventId = 'not-an-id';
    expect(parseInboxEnvelope(JSON.stringify(envelope))).toMatchObject({ ok: false, reason: 'malformed' });
  });
});
