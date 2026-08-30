import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'lib-extension-profile.cts'), 'utf8');

describe('開発用Chromeへの共有ビルド設定', () => {
  test('CDPの拡張機能APIで同じunpacked出力を読み込む', () => {
    expect(source.match(/Extensions\.loadUnpacked/g)).toHaveLength(2);
    expect(source).toContain("const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh'");
  });

  test('プロファイル固有のstorage.localだけを開発用に設定する', () => {
    expect(source).toContain("const NATIVE_HOST_PROFILE_KEY = 'nativeHost.profile.v1'");
    expect(source).toContain("const DEVELOPMENT_NATIVE_HOST_PROFILE = 'development'");
    expect(source).toContain("worker.send('Extensions.setStorageItems'");
    expect(source).toContain("storageArea: 'local'");
  });

  test('読み込み先と設定値をCDPから読み返して検証する', () => {
    expect(source).toContain("cdp.send('Extensions.getExtensions')");
    expect(source).toContain("verifyWorker.send('Extensions.getStorageItems'");
  });
});
