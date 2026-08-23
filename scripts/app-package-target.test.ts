import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '..');
const appPackage = JSON.parse(fs.readFileSync(path.join(root, 'app', 'package.json'), 'utf8'));

function targetFor(platform: string) {
  const moduleUrl = new URL('../app/dist.mjs', import.meta.url).href;
  return spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(moduleUrl)}).then(m => console.log(m.buildFlagForPlatform(${JSON.stringify(platform)})))`], {
    encoding: 'utf8',
  });
}

describe('desktop package targets', () => {
  test('Windows は NSIS、macOS は DMG だけを作る', () => {
    expect(appPackage.build.win.target).toBe('nsis');
    expect(appPackage.build.mac.target).toBe('dmg');
  });

  test.each([
    ['win32', '--win'],
    ['darwin', '--mac'],
  ])('%s を明示的な electron-builder 対象 %s にする', (platform, expected) => {
    const result = targetFor(platform);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
  });

  test('Linux の配布物は作らない', () => {
    const result = targetFor('linux');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('only built for Windows and macOS');
  });
});
