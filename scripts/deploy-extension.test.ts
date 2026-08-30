import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'deploy-extension.cts'), 'utf8');

describe('拡張機能の単一配備経路', () => {
  test('共有フォルダへリリースビルドを1回だけ生成する', () => {
    expect(source).toContain("const SHARED_OUTPUT = path.join(ROOT, 'extension', '.output', 'chrome-mv3')");
    expect(source.match(/buildExtension\('chrome', SHARED_OUTPUT\)/g)).toHaveLength(1);
    expect(source).not.toContain('cpSync');
    expect(source).not.toContain('releaseDir');
  });

  test('開発用はCDPで読み込み直し、日常用には同じビルドIDを告知する', () => {
    expect(source).toContain('await configureDevelopmentExtension(output, DEFAULT_CDP_URL)');
    expect(source).toContain('publish(buildId)');
  });
});
