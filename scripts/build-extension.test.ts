import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const { verifyOutput } = require('./build-extension.cts');

const ROOT = path.join(import.meta.dirname, '..');
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function releaseOutput(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-release-guard-'));
  directories.push(directory);
  const config = fs.readFileSync(path.join(ROOT, 'extension', 'wxt.config.ts'), 'utf8');
  const key = config.match(/key: '([^']+)'/)?.[1];
  if (!key) throw new Error('拡張機能の署名鍵を取得できません');
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ manifest_version: 3, key, permissions: ['nativeMessaging'], background: { service_worker: 'background.js' } }));
  fs.mkdirSync(path.join(directory, 'content-scripts'));
  for (const file of ['bulk.js', 'content-scripts/resident.js', 'diag.html']) fs.writeFileSync(path.join(directory, file), 'release resource');
  fs.writeFileSync(path.join(directory, 'background.js'), 'com.hologram.host com.hologram.host.dev nativeHost.profile.v1');
  return directory;
}

describe('開発専用の応答収集とリリース出力の境界', () => {
  test('収集ツールを含まない完全な出力は通る', () => {
    const directory = releaseOutput();
    expect(verifyOutput('chrome', undefined, directory)).toBe(directory);
  });

  test.each(['background.js', 'content-scripts/resident.js', 'diag.html', 'chunks/developer.js'])('%s へ収集ツールが混入したらリリースを拒否する', (relative) => {
    const directory = releaseOutput();
    const file = path.join(directory, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, '\nHOLOGRAM_DEV_API_RESPONSE_CAPTURE_V1');
    expect(() => verifyOutput('chrome', undefined, directory)).toThrow('HOLOGRAM_DEV_API_RESPONSE_CAPTURE_V1');
  });
});
