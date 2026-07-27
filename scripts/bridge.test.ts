// Native Messaging ブリッジのスモークテスト。'save' メッセージをフレーミングして
// bridge.cts へ流し込み（設定ディレクトリを差し替えて一時保存フォルダを使わせる）、
// JPEG と sidecar が書かれ、ack の形が正しいことを見る。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

// 最小の 1x1 JPEG
const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

const captureId = '1717500000000-abcd';

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
      metadata: { url: 'https://x.com/u/status/1', platform: 'x', text: 'hi', tags: ['t'] },
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

describe('保存されたもの', () => {
  test('JPEG と sidecar JSON が書かれる', () => {
    expect(fs.existsSync(path.join(saveFolder, `${captureId}.jpg`))).toBe(true);
    expect(fs.existsSync(path.join(saveFolder, `${captureId}.json`))).toBe(true);
  });

  test('sidecar が captureId / image / url を持つ', () => {
    const rec = JSON.parse(fs.readFileSync(path.join(saveFolder, `${captureId}.json`), 'utf8'));
    expect(rec).toMatchObject({ captureId, image: `${captureId}.jpg`, url: 'https://x.com/u/status/1' });
  });
});
