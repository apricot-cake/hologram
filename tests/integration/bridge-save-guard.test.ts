import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { expect, test } from 'vitest';

function save(config: string, captureId: string, url: string) {
  return new Promise<any>((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('native-host/bridge.mts')], { env: { ...process.env, HOLOGRAM_CONFIG_DIR: config }, stdio: ['pipe', 'pipe', 'pipe'] });
    const body = Buffer.from(JSON.stringify({ type: 'savePost', captureId, metaOk: true, metadata: { url, platform: 'x', text: '重複保存の検証' } }));
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
