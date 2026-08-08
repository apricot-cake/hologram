// Smoke test for the Native Messaging bridge. Frame a 'save' message and feed it
// into bridge.mts (swapping the config directory so a temp save folder is used),
// and check that the JPEG and inbox envelope (#5 St6 / #299 — the successor to
// writing sidecars directly) are written and that the ack shape is correct.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PROTOCOL_VERSION } from '../native-host/protocol.mts';
import { unpackRawPayload } from '../native-host/raw-payload.mts';

// Minimal 1x1 JPEG
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
        // The extension just passes the response body through as-is = compression/hashing/limits are on the bridge side (#292)
        rawPayloads: [{ sourceKind: 'api:x/tweet-result', acquiredAt: '2026-07-28T00:00:00.000Z', contentType: 'application/json', body: RAW_BODY }],
      },
    }),
    'utf8',
  );
  const header = Buffer.alloc(4);
  header.writeUInt32LE(msg.length, 0);

  const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'native-host', 'bridge.mts')], {
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

// #205: This number is the only thing the extension uses to judge "do the app and
// extension versions match". In isolation it's enough to look at stampProtocol, but
// whether it **actually goes out on the wire** can only be known by spinning up the
// process (the stamp lives at the reply's exit point, not in the handler).
test('ack は自分のプロトコル版を名乗る（#205）', () => {
  expect(resp.protocolVersion).toBe(PROTOCOL_VERSION);
});

// Not just success — the stamp must also ride on failure and ping replies. A host
// old enough to refuse saves is exactly the one that most wants to know the version,
// so missing this here means detection fails where it's needed most.
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

// Feed multiple frames into a single connection and read back all the returned frames.
// bridge.mts naturally exits once it finishes reading stdin, so waiting for close won't miss anything.
async function askHost(configRoot: string, messages: unknown[]): Promise<any[]> {
  const configDir = path.join(configRoot, 'Hologram');
  const frames = messages.map((m) => {
    const body = Buffer.from(JSON.stringify(m), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    return Buffer.concat([header, body]);
  });
  const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'native-host', 'bridge.mts')], {
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

// #650: "The local build currently on disk" rides on every reply = the extension
// watches this and reloads itself. Spinning up a real process to check this is for
// the same reason as the version stamp (the stamp lives at only one place, the
// reply's exit point, and reading the handler can't tell you whether it's actually
// going out). On top of that, this **switches depending on whether the file exists**,
// so saying nothing when it's absent matters even more = that's the state every user
// who has never built the extension is in.
describe('ローカルビルドの印（#650）', () => {
  test('印のファイルが無ければ、返信は何も言わない', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-nostamp-'));
    try {
      fs.mkdirSync(path.join(bare, 'Hologram'), { recursive: true });
      const [reply] = await askHost(bare, [{ type: 'ping' }]);
      expect(reply).toMatchObject({ ok: true, pong: true });
      expect(reply.extBuild).toBeUndefined();
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  test('印のファイルがあれば、成功にも失敗にも同じトークンが乗る', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-stamp-'));
    try {
      const dir = path.join(root, 'Hologram');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'extension-build.json'), JSON.stringify({ build: '1785000000000-feedface' }));
      const replies = await askHost(root, [{ type: 'ping' }, { type: 'nonsense' }]);
      expect(replies).toHaveLength(2);
      for (const reply of replies) expect(reply.extBuild).toBe('1785000000000-feedface');
      expect(replies[1]).toMatchObject({ ok: false, code: 'unknown-type' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('壊れた印（JSON でない・build が無い）は「無い」と同じ＝ホストは黙る', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-badstamp-'));
    try {
      const dir = path.join(root, 'Hologram');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'extension-build.json'), '{"build":');
      expect((await askHost(root, [{ type: 'ping' }]))[0].extBuild).toBeUndefined();
      fs.writeFileSync(path.join(dir, 'extension-build.json'), JSON.stringify({ builtAt: 'x' }));
      expect((await askHost(root, [{ type: 'ping' }]))[0].extBuild).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

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

  // #292: The response body the extension passed is compressed and hashed by the
  // bridge and placed into the envelope = arranged so it arrives at raw_payloads
  // as-is when the app later drains it.
  test('取得原本が畳まれて封筒に載る（本文へ復元できる）', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', `${captureId}.json`), 'utf8'));
    expect(envelope.record.raw).toHaveLength(1);
    expect(envelope.record.raw[0]).toMatchObject({ sourceKind: 'api:x/tweet-result', acquiredAt: '2026-07-28T00:00:00.000Z', contentType: 'application/json', encoding: 'gzip', byteLength: Buffer.byteLength(RAW_BODY, 'utf8') });
    expect(unpackRawPayload({ encoding: 'gzip', sha256: envelope.record.raw[0].sha256, payload: Buffer.from(envelope.record.raw[0].payloadBase64, 'base64') })).toBe(RAW_BODY);
  });
});

// #290: end-to-end wiring through the real bridge process — the extension's
// announced customEmojis[] (URL only) reaches handleSave, downloadCustomEmojis
// runs against it, and the envelope's record carries the result. No fetch stub:
// example.invalid (RFC 2606) never resolves, so this exercises the SAME
// best-effort failure path a dead emoji host hits in production — ok:true,
// file: null, save unaffected — without depending on a live server.
describe('customEmojis のダウンロードが往復する（#290）', () => {
  const emojiCaptureId = '1717500000000-e001';
  let emojiTmp: string;
  let emojiSaveFolder: string;
  let emojiResp: any;

  beforeAll(async () => {
    emojiTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-test-emoji-'));
    const configDir = path.join(emojiTmp, 'Hologram');
    emojiSaveFolder = path.join(emojiTmp, 'saves');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: emojiSaveFolder }));

    const msg = Buffer.from(
      JSON.stringify({
        type: 'save',
        captureId: emojiCaptureId,
        image: jpegB64,
        metadata: {
          url: 'https://misskey.io/notes/n1',
          platform: 'misskey',
          text: ':ha_to:',
          customEmojis: [{ shortcode: 'ha_to', url: 'https://emoji.example.invalid/ha_to.png' }],
        },
      }),
      'utf8',
    );
    const header = Buffer.alloc(4);
    header.writeUInt32LE(msg.length, 0);

    const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'native-host', 'bridge.mts')], {
      env: { ...process.env, APPDATA: emojiTmp, HOLOGRAM_CONFIG_DIR: configDir },
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
    emojiResp = JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString('utf8'));
  });

  afterAll(() => {
    fs.rmSync(emojiTmp, { recursive: true, force: true });
  });

  test('取得できない絵文字ホストでも保存自体は成功する（ベストエフォート）', () => {
    expect(emojiResp.ok).toBe(true);
  });

  test('封筒の record.customEmojis に shortcode/url は残り、file はダウンロード失敗で null', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(emojiSaveFolder, '.hologram-inbox', 'new', `${emojiCaptureId}.json`), 'utf8'));
    expect(envelope.record.customEmojis).toEqual([{ shortcode: 'ha_to', url: 'https://emoji.example.invalid/ha_to.png', file: null }]);
  });

  test('emoji/ 共有ストアは作られない（1件も落ちてこなかったため）', () => {
    expect(fs.existsSync(path.join(emojiSaveFolder, 'emoji'))).toBe(false);
  });
});
