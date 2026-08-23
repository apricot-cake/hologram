import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const scripts: Record<string, string> = packageJson.scripts;
const invokesReleaseBuild = (command: string): boolean => /npm run build:ext(?=\s|$|&&)|node scripts[\\/]build-extension\.cts/.test(command);

describe('通常検証とリリース操作の境界', () => {
  test('リリースビルドを呼ぶ npm script は明示的なリリース検証だけ', () => {
    expect(
      Object.entries(scripts)
        .filter(([name, command]) => name !== 'build:ext' && invokesReleaseBuild(command))
        .map(([name]) => name),
    ).toEqual(['check:release']);
  });

  test('通常の Vitest 設定はバンドル依存テストを除外し、自動ビルドを持たない', () => {
    const config = fs.readFileSync(path.join(ROOT, 'vitest.config.ts'), 'utf8');
    expect(config).toContain("exclude: ['scripts/**/*.extension-bundle.test.ts']");
    expect(config).not.toContain('globalSetup');
    expect(config).not.toContain('build:ext');
  });

  test('初期セットアップはリリース成果物を作らない', () => {
    const setup = fs.readFileSync(path.join(ROOT, 'scripts', 'setup.cts'), 'utf8');
    expect(invokesReleaseBuild(setup)).toBe(false);
  });
});
