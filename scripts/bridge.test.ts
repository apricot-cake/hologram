// Native Messaging ブリッジのスモークテスト。'save' メッセージをフレーミングして
// bridge.cts へ流し込み（設定ディレクトリを差し替えて一時保存フォルダを使わせる）、
// JPEG と inbox エンベロープ（#5 St6 / #299 — sidecar 直書きの後継）が書かれ、
// ack の形が正しいことを見る。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PROTOCOL_VERSION } from '../native-host/protocol.mts';
import { unpackRawPayload } from '../native-host/raw-payload.mts';

// 最小の 1x1 JPEG
const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

const captureId = '1717500000000-abcd';
const RAW_BODY = '{"text":"hi","unknown_future_field":42}';

let tmp: string;
let saveFolder: string;
let resp: any;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-test-'));
  const configDir = path.join(tmp, 'Hologram');
  saveFolder = path.join(tmp, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  const msg = Buffer.from(
    JSON.stringify({
      type: 'save',
      captureId,
      image: jpegB64,
      metadata: {
        url: 'https://x.com/u/status/1',
        platform: 'x',
        text: 'hi',
        tags: ['t'],
        // 拡張は受け取った本文をそのまま渡すだけ＝圧縮・ハッシュ・上限はブリッジ側（#292）
        rawPayloads: [{ sourceKind: 'api:x/tweet-result', acquiredAt: '2026-07-28T00:00:00.000Z', contentType: 'application/json', body: RAW_BODY }],
      },
    }),
    'utf8',
  );
  const header = Buffer.alloc(4);
  header.writeUInt32LE(msg.length, 0);

  const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'native-host', 'bridge.cts')], {
    env: { ...process.env, APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir },
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  let out = Buffer.alloc(0);
  child.stdout.on('data', (d) => {
    out = Buffer.concat([out, d]);
  });
  const closed = new Promise((r) => child.on('close', r));

  child.stdin.write(Buffer.concat([header, msg]));
  child.stdin.end();
  await closed;

  resp = JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString('utf8'));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('ack が ok で返る', () => {
  expect(resp.ok).toBe(true);
});

// #205: 拡張はこの数字だけで「アプリと拡張の版が合っているか」を判断する。
// 単体では stampProtocol を見れば済むが、それが**実際に線へ出ている**ことは
// プロセスを起こしてみないと分からない（刻印はハンドラではなく返信の出口にある）。
test('ack は自分のプロトコル版を名乗る（#205）', () => {
  expect(resp.protocolVersion).toBe(PROTOCOL_VERSION);
});

// 成功だけでなく、失敗と ping の返信にも刻印が乗ること。保存を断るほど古い
// ホストこそ版が知りたい相手なので、ここが抜けると検知が一番要る場面で効かない。
describe('返信は種類を問わず版を名乗る（#205）', () => {
  let replies: any[];

  beforeAll(async () => {
    replies = await askHost(tmp, [{ type: 'ping' }, { type: 'nonsense' }, { type: 'log', entry: { stage: 'select', phase: 'fail' } }]);
  });

  test('3件とも返り、すべてに版が乗る', () => {
    expect(replies).toHaveLength(3);
    for (const reply of replies) expect(reply.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  test('未知の type は失敗として返る＝版だけ乗せて黙る形にはしない', () => {
    expect(replies[1]).toMatchObject({ ok: false, code: 'unknown-type' });
  });
});

// 1本のコネクションへ複数フレームを流し込み、返ってきたフレームを全部読む。
// bridge.cts は stdin を読み切ると自然に終わるので、close を待てば取りこぼさない。
async function askHost(configRoot: string, messages: unknown[]): Promise<any[]> {
  const configDir = path.join(configRoot, 'Hologram');
  const frames = messages.map((m) => {
    const body = Buffer.from(JSON.stringify(m), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    return Buffer.concat([header, body]);
  });
  const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'native-host', 'bridge.cts')], {
    env: { ...process.env, APPDATA: configRoot, HOLOGRAM_CONFIG_DIR: configDir },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let out = Buffer.alloc(0);
  child.stdout.on('data', (d) => {
    out = Buffer.concat([out, d]);
  });
  const closed = new Promise((r) => child.on('close', r));
  child.stdin.write(Buffer.concat(frames));
  child.stdin.end();
  await closed;

  const parsed: any[] = [];
  let offset = 0;
  while (offset + 4 <= out.length) {
    const len = out.readUInt32LE(offset);
    if (offset + 4 + len > out.length) break;
    parsed.push(JSON.parse(out.subarray(offset + 4, offset + 4 + len).toString('utf8')));
    offset += 4 + len;
  }
  return parsed;
}

describe('保存されたもの', () => {
  test('JPEG と inbox エンベロープが書かれる（sidecar は書かれない）', () => {
    expect(fs.existsSync(path.join(saveFolder, `${captureId}.jpg`))).toBe(true);
    expect(fs.existsSync(path.join(saveFolder, `${captureId}.json`))).toBe(false);
    expect(fs.existsSync(path.join(saveFolder, '.hologram-inbox', 'new', `${captureId}.json`))).toBe(true);
  });

  test('エンベロープの record が captureId / image / url を持つ', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', `${captureId}.json`), 'utf8'));
    expect(envelope).toMatchObject({ format: 'hologram-inbox', version: 1, eventId: captureId, kind: 'post.capture' });
    expect(envelope.record).toMatchObject({ captureId, image: `${captureId}.jpg`, url: 'https://x.com/u/status/1' });
  });

  // #292: 拡張が渡した応答本文は、ブリッジで圧縮・ハッシュされて封筒に載る＝
  // アプリが後で drain した時に raw_payloads へそのまま着く形になっている。
  test('取得原本が畳まれて封筒に載る（本文へ復元できる）', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', `${captureId}.json`), 'utf8'));
    expect(envelope.record.raw).toHaveLength(1);
    expect(envelope.record.raw[0]).toMatchObject({ sourceKind: 'api:x/tweet-result', acquiredAt: '2026-07-28T00:00:00.000Z', contentType: 'application/json', encoding: 'gzip', byteLength: Buffer.byteLength(RAW_BODY, 'utf8') });
    expect(unpackRawPayload({ encoding: 'gzip', sha256: envelope.record.raw[0].sha256, payload: Buffer.from(envelope.record.raw[0].payloadBase64, 'base64') })).toBe(RAW_BODY);
  });
});
