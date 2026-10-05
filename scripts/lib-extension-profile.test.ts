import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
const { configureDevelopmentExtension, selectDevelopmentPages, reloadDevelopmentPages, EXPECTED_EXTENSION_ID, NATIVE_HOST_PROFILE_KEY } = require('./lib-extension-profile.cts');

test('再読み込みは常駐対象ページだけを選ぶ', () => {
  const urls = ['https://x.com/i/history', 'https://bsky.app/saved', 'https://www.pixiv.net/users/1/bookmarks/artworks', 'https://example.com/', 'https://x.com.example.com/', 'http://x.com/', 'chrome://extensions', 'not-a-url'];
  const pages = urls.map((url) => ({ url: () => url }));
  expect(selectDevelopmentPages(pages, ['https://x.com/*', 'https://bsky.app/*', 'https://www.pixiv.net/*'])).toEqual(pages.slice(0, 3));
  expect(selectDevelopmentPages(pages, [])).toEqual([]);
});

test('共有ビルドを二度読み込み、worker の chrome.storage.local で設定と読み返しを行う', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-profile-test-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  const saved: Record<string, unknown> = {};
  const scope = globalThis as any;
  const oldChrome = scope.chrome;
  scope.chrome = { storage: { local: { get: async (key: string) => ({ [key]: saved[key] }), set: async (data: any) => Object.assign(saved, data) } } };
  const worker = { url: () => `chrome-extension://${EXPECTED_EXTENSION_ID}/background.js`, evaluate: vi.fn((fn, args) => fn(args)) };
  const send = vi.fn(async (method) => (method === 'Extensions.getExtensions' ? { extensions: [{ id: EXPECTED_EXTENSION_ID, path: dir, enabled: true }] } : { id: EXPECTED_EXTENSION_ID }));
  const detach = vi.fn();
  const context = { serviceWorkers: () => [worker], browser: () => ({ newBrowserCDPSession: async () => ({ send, detach }) }) };
  try {
    expect(await configureDevelopmentExtension(dir, context)).toEqual({ id: EXPECTED_EXTENSION_ID, path: dir });
    expect(saved).toEqual({ [NATIVE_HOST_PROFILE_KEY]: 'development' });
    expect(send.mock.calls.filter(([method]) => method === 'Extensions.loadUnpacked')).toHaveLength(2);
    expect(detach).toHaveBeenCalledOnce();
  } finally {
    scope.chrome = oldChrome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ロード先 ID が違えば storage を変更せず CDP セッションを解放する', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-profile-test-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  const workers = vi.fn();
  const detach = vi.fn();
  const context = { serviceWorkers: workers, browser: () => ({ newBrowserCDPSession: async () => ({ send: async () => ({ id: 'foreign' }), detach }) }) };
  try {
    await expect(configureDevelopmentExtension(dir, context)).rejects.toThrow('ID が違います');
    expect(workers).not.toHaveBeenCalled();
    expect(detach).toHaveBeenCalledOnce();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('対象ページだけを背面で再読み込みし、部分失敗を呼び出し側へ返す', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-profile-test-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ content_scripts: [{ matches: ['https://x.com/*'] }] }));
  const reload = vi.fn(async () => {
    throw new Error('navigation failed');
  });
  const foreign = vi.fn();
  const context = {
    pages: () => [
      { url: () => 'https://x.com/', reload },
      { url: () => 'https://example.com/', reload: foreign },
    ],
  };
  try {
    await expect(reloadDevelopmentPages(dir, context)).rejects.toThrow('1 件失敗');
    expect(reload).toHaveBeenCalledWith({ waitUntil: 'load', timeout: 15_000 });
    expect(foreign).not.toHaveBeenCalled();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
