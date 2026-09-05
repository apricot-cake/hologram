import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'lib-extension-profile.cts'), 'utf8');
const { selectDevelopmentPages } = createRequire(import.meta.url)('./lib-extension-profile.cts');

test('再読み込みは常駐対象のページだけを選び、別ホスト・内部ページ・workerを除外する', () => {
  const urls = ['https://x.com/i/history', 'https://bsky.app/saved', 'https://www.pixiv.net/users/1/bookmarks/artworks', 'https://example.com/', 'https://x.com.example.com/', 'http://x.com/', 'chrome://extensions', 'not-a-url'];
  const targets = urls.map((url, id) => ({ id, type: 'page', url, webSocketDebuggerUrl: `ws://localhost/${id}` }));
  targets.push({ id: 8, type: 'service_worker', url: 'https://x.com/sw.js', webSocketDebuggerUrl: 'ws://localhost/8' });
  const selected = selectDevelopmentPages(targets, ['https://x.com/*', 'https://bsky.app/*', 'https://www.pixiv.net/*']);
  expect(selected.map((target: { id: number }) => target.id)).toEqual([0, 1, 2]);
  expect(selectDevelopmentPages(targets, [])).toEqual([]);
});

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
