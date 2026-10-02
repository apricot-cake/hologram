import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
const appPackage = JSON.parse(fs.readFileSync(path.join(root, 'app', 'package.json'), 'utf8'));
const forgeConfig = require(path.join(root, 'app', 'forge.config.cjs'));

describe('desktop package targets', () => {
  test('Windows は Squirrel のセットアップだけを作る', () => {
    expect(appPackage.scripts._make).toBe('npm run _package && electron-forge make --skip-package');
    expect(forgeConfig.makers).toHaveLength(1);
    expect(forgeConfig.makers[0]).toMatchObject({
      name: '@electron-forge/maker-squirrel',
      config: { setupExe: 'HologramSetup.exe', noMsi: true },
    });
  });

  test('配布物は asar とネイティブモジュールの展開を両立する', () => {
    expect(forgeConfig.packagerConfig.asar).toEqual({ unpack: '**/{.**,**}/**/*.node' });
    expect(forgeConfig.packagerConfig.extraResource).toEqual([path.join(root, 'native-host'), path.join(root, 'app', 'vendor', 'meilisearch')]);
  });

  test('配布版は現行 Packager を使う', () => {
    const packageScript = fs.readFileSync(path.join(root, 'scripts', 'package-app.cjs'), 'utf8');
    expect(packageScript).toContain("require('@electron/packager')");
    expect(packageScript).toContain('name: appPackage.productName || appPackage.name');
    expect(appPackage.productName).toBe('Hologram');
  });
});
