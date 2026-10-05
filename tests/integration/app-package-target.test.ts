import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
const appPackage = JSON.parse(fs.readFileSync(path.join(root, 'app', 'package.json'), 'utf8'));
const forgeConfig = require(path.join(root, 'app', 'forge.config.cjs'));

describe('desktop package targets', () => {
  test('Windows は Squirrel のセットアップだけを作る', () => {
    expect(appPackage.scripts._make).toBe('npm run _package && electron-forge make --from-package');
    expect(forgeConfig.makers).toHaveLength(1);
    expect(forgeConfig.makers[0]).toMatchObject({
      name: '@electron-forge/maker-squirrel',
      config: { setupExe: 'HologramSetup.exe', noMsi: true },
    });
  });

  test('配布物は asar とネイティブモジュールの展開を両立する', async () => {
    const temporary = fs.mkdtempSync(path.join(tmpdir(), 'hologram-package-asar-'));
    const source = path.join(temporary, 'app');
    const archive = path.join(temporary, 'app.asar');
    const unpacked = [
      'node_modules/sharp/dist/index.mjs',
      'node_modules/sharp/package.json',
      'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node',
      'node_modules/@img/sharp-win32-x64/lib/libvips-42.dll',
      'node_modules/@img/sharp-libvips-win32-x64/lib/libvips.dll',
      'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      '.native-cache/other.node',
    ];
    const packed = ['out/main/index.js', 'out/main/archive-import-worker.js', 'node_modules/plain/index.js', 'node_modules/sharp-other/index.js', 'node_modules/@img-other/index.js', '.native-cache/plain.js'];
    try {
      for (const filename of [...unpacked, ...packed]) {
        fs.mkdirSync(path.dirname(path.join(source, filename)), { recursive: true });
        fs.writeFileSync(path.join(source, filename), `fixture:${filename}`);
      }
      // 本番 Packager が解決する ASAR の版で、DLL を含む実際の展開結果を確かめる。
      const asarPath = require.resolve('@electron/asar', { paths: [require.resolve('@electron/packager')] });
      const { createPackageWithOptions, statFile } = await import(pathToFileURL(asarPath).href);
      await createPackageWithOptions(source, archive, forgeConfig.packagerConfig.asar);
      for (const filename of unpacked) {
        expect(statFile(archive, path.normalize(filename))).toMatchObject({ unpacked: true });
        expect(fs.readFileSync(path.join(`${archive}.unpacked`, filename), 'utf8')).toBe(`fixture:${filename}`);
      }
      for (const filename of packed) {
        expect(statFile(archive, path.normalize(filename))).not.toMatchObject({ unpacked: true });
        expect(fs.existsSync(path.join(`${archive}.unpacked`, filename))).toBe(false);
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    expect(forgeConfig.packagerConfig.extraResource).toEqual([path.join(root, 'native-host'), path.join(root, 'app', 'vendor', 'meilisearch'), path.join(root, 'app', 'vendor', 'avif')]);
  });

  test('AVIF 検査器とライセンスを asar の外の resources/avif に配布する', async () => {
    const resource = forgeConfig.packagerConfig.extraResource.find((filename: string) => filename === path.join(root, 'app', 'vendor', 'avif'));
    expect(resource).toBeDefined();
    const temporary = fs.mkdtempSync(path.join(tmpdir(), 'hologram-package-resource-'));
    const source = path.join(temporary, 'vendor', path.basename(resource));
    const stagingPath = path.join(temporary, 'package');
    const files = ['avif-validator.exe', 'build.json', 'libavif-LICENSE', 'dav1d-COPYING', 'hologram-LICENSE'];
    try {
      fs.mkdirSync(source, { recursive: true });
      for (const filename of files) fs.writeFileSync(path.join(source, filename), `fixture:${filename}`);
      // Packager 自身のリソースコピーを使い、Electron の取得・起動をせずに配布先を確認する。
      const modulePath = path.join(path.dirname(require.resolve('@electron/packager')), 'platform.js');
      const { App } = await import(pathToFileURL(modulePath).href);
      await Reflect.apply(
        App.prototype.copyExtraResources,
        {
          opts: { extraResource: [source] },
          stagingPath,
          resourcesDir: 'resources',
          commonHookArgs: {},
        },
        [],
      );
      const destination = path.join(stagingPath, 'resources', 'avif');
      expect(fs.readdirSync(destination).sort()).toEqual([...files].sort());
      for (const filename of files) expect(fs.readFileSync(path.join(destination, filename), 'utf8')).toBe(`fixture:${filename}`);
      expect(fs.existsSync(path.join(stagingPath, 'resources', 'app.asar', 'avif-validator.exe'))).toBe(false);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  test('配布版は現行 Packager を使う', () => {
    const packageScript = fs.readFileSync(path.join(root, 'scripts', 'package-app.cjs'), 'utf8');
    expect(packageScript).toContain("require('@electron/packager')");
    expect(packageScript).toContain('name: appPackage.productName || appPackage.name');
    expect(appPackage.productName).toBe('Hologram');
  });
});
