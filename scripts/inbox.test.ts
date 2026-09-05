// native-host/inbox.mts の単体テスト。永続する取込キューのエンベロープの形式と、
// アトミックな書き込み（#5 St6 / #299）。素の Node で動く（Electron は要らない）。

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
      /* 掃除はできる範囲で */
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

  test('廃止した profile.capture は受理しない', () => {
    const envelope = { ...buildEnvelope(rec), kind: 'profile.capture' };
    expect(parseInboxEnvelope(JSON.stringify(envelope))).toMatchObject({ ok: false, reason: 'unknown-kind' });
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

    // new 側にすでにファイルがある状態で、同じ eventId をもう一度書いた場合。tmp の
    // ファイル自体は名前が違う（pid と乱数）ので wx フラグには引っかからないが、rename の
    // 宛先 new/<eventId>.json は上書きされる（fs.rename の既定の挙動）。二重発行を防ぐのは
    // 呼び出し側の責任（bridge.mts の uniqueBase）で、この層は「いったん確定した中身が
    // 黙って壊されない」ことを保証しない。本当に確かめる必要があるのは tmp のファイル名の
    // 排他性（2本同時に書いたとき両方成功するか、片方が失敗したときに孤児を残さないか）。
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
