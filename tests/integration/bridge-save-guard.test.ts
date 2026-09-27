import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { expect, test } from 'vitest';

function save(config: string, captureId: string, url: string, metadata: Record<string, unknown> = {}) {
  return new Promise<any>((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('native-host/bridge.mts')], { env: { ...process.env, HOLOGRAM_CONFIG_DIR: config }, stdio: ['pipe', 'pipe', 'pipe'] });
    const body = Buffer.from(JSON.stringify({ type: 'savePost', captureId, metaOk: true, metadata: { url, platform: 'x', text: '重複保存の検証', ...metadata } }));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    let output = Buffer.alloc(0);
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      output = Buffer.concat([output, chunk]);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 || output.length < 4) return reject(new Error(stderr));
      resolve(JSON.parse(output.subarray(4, 4 + output.readUInt32LE(0)).toString()));
    });
    child.stdin.end(Buffer.concat([header, body]));
  });
}

test('別プロセスから再保存してもDB取込前の投稿を重複作成しない', async () => {
  const config = process.env.HOLOGRAM_CONFIG_DIR!;
  const folder = path.join(config, 'saves');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({ saveFolder: folder }));
  const first = await save(config, '1789500000000-a111', 'https://x.com/oldname/status/2078680803660431843');
  const second = await save(config, '1789500000001-b222', 'https://twitter.com/newname/status/2078680803660431843/photo/1');
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
  expect(second.captureId).toBe(first.captureId);
  expect(fs.readdirSync(path.join(folder, 'items'))).toEqual([first.captureId]);
  expect(fs.readdirSync(path.join(folder, '.hologram-inbox', 'new'))).toEqual([`${first.captureId}.json`]);
});

test('画像の取得がすべて失敗しても本文を保持して一部保存を記録する', async () => {
  const config = path.join(process.env.HOLOGRAM_CONFIG_DIR!, 'partial');
  const folder = path.join(config, 'saves');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({ saveFolder: folder }));
  const result = await save(config, '1789500000002-c333', 'https://x.com/alice/status/2078680803660431844', {
    text: '取得できた本文',
    media: [{ url: 'http://127.0.0.1/blocked-image.png' }],
  });
  expect(result.ok).toBe(true);
  expect(result.mediaCount).toBe(0);
  const envelope = JSON.parse(fs.readFileSync(path.join(folder, '.hologram-inbox', 'new', `${result.captureId}.json`), 'utf8'));
  expect(envelope.record.text).toBe('取得できた本文');
  expect(envelope.record.media).toEqual([]);
  expect(envelope.record.saveIncomplete).toBe(true);
});
