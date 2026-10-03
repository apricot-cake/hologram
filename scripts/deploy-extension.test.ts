import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { replaceInPlace } = require('./deploy-extension.cts');

const source = fs.readFileSync(path.join(__dirname, 'deploy-extension.cts'), 'utf8');
const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { force: true, recursive: true });
});

describe('拡張機能の単一配備経路', () => {
  test('共有フォルダの外でリリースビルドを1回だけ生成する', () => {
    expect(source).toContain("const SHARED_OUTPUT = path.join(ROOT, 'extension', '.output', 'chrome-mv3')");
    expect(source.match(/buildExtension\('chrome', stagedOutput\)/g)).toHaveLength(1);
    expect(source).toContain('replaceInPlace(stagedOutput, SHARED_OUTPUT)');
  });

  test('共有フォルダの置き換え失敗時は以前のビルドを復元する', () => {
    expect(source).toContain('fs.cpSync(destination, backup');
    expect(source).toContain('if (existed) fs.cpSync(backup, destination');
    expect(source.indexOf('fs.cpSync(destination, backup')).toBeLessThan(source.indexOf('emptyDirectory(destination)'));
  });

  test('コピーが途中で失敗しても共有フォルダを変更しない', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-extension-deploy-'));
    temporaryDirectories.push(root);
    const staged = path.join(root, 'staged');
    const shared = path.join(root, 'shared');
    fs.mkdirSync(staged);
    fs.mkdirSync(shared);
    fs.writeFileSync(path.join(staged, 'manifest.json'), 'new');
    fs.writeFileSync(path.join(shared, 'manifest.json'), 'old');
    fs.writeFileSync(path.join(shared, 'background.js'), 'old worker');

    const copy = fs.cpSync.bind(fs);
    vi.spyOn(fs, 'cpSync').mockImplementation((from, to, options) => {
      if (from === staged && to === shared) {
        fs.writeFileSync(path.join(shared, 'manifest.json'), 'partial');
        throw new Error('disk full');
      }
      copy(from, to, options);
    });

    expect(() => replaceInPlace(staged, shared)).toThrow('disk full');
    expect(fs.readFileSync(path.join(shared, 'manifest.json'), 'utf8')).toBe('old');
    expect(fs.readFileSync(path.join(shared, 'background.js'), 'utf8')).toBe('old worker');
  });

  test('開発用はCDPで読み込み直し、日常用には同じビルドIDを告知する', () => {
    expect(source).toContain('await configureDevelopmentExtension(output, DEFAULT_CDP_URL)');
    expect(source).toContain('publish(buildId)');
  });
});
