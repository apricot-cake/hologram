import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { describe, expect, test, vi } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'open-dev-profile.cts'), 'utf8');

function launcher(pid: number | null | Error, ready: boolean) {
  const spawn = vi.fn(() => {
    throw new Error('unexpected Chrome launch');
  });
  const configureDevelopmentExtension = vi.fn(async () => ({ path: 'shared-build' }));
  const module: { exports: { main?: () => Promise<void> } } = { exports: {} };
  const require = (name: string) => {
    if (name === 'node:child_process') return { spawn };
    if (name === 'node:fs') return { existsSync: () => true };
    if (name === 'node:os') return { homedir: () => 'C:\\Users\\Jane Doe' };
    if (name === 'node:path') return path;
    if (name === './lib-extension-profile.cts') return { DEFAULT_CDP_URL: 'http://127.0.0.1:9223', cdpReady: async () => ready, configureDevelopmentExtension };
    if (name === './lib-chrome-command-line.cts')
      return {
        runningChromePid: () => {
          if (pid instanceof Error) throw pid;
          return pid;
        },
      };
    if (name === './lib-wait.cts') return {};
    throw new Error(`Unexpected dependency ${name}`);
  };
  vm.runInNewContext(stripTypeScriptTypes(source), { require, module, __dirname, process: { argv: ['node', 'open-dev-profile.cts'], env: { HOLOGRAM_CHROME: 'chrome.exe' } }, console: { log: vi.fn(), error: vi.fn() } });
  return { main: module.exports.main!, spawn, configureDevelopmentExtension };
}

test('起動済みプロファイルはウィンドウを追加せず CDP で共有ビルドを読み直す', async () => {
  const run = launcher(7, true);
  await run.main();
  expect(run.spawn).not.toHaveBeenCalled();
  expect(run.configureDevelopmentExtension).toHaveBeenCalledOnce();
});

test('プロセス一覧を取得できなければ、未起動として扱わずに停止する', async () => {
  const run = launcher(new Error('CIM denied'), true);
  await expect(run.main()).rejects.toThrow('プロセス一覧を確認できません');
  expect(run.spawn).not.toHaveBeenCalled();
  expect(run.configureDevelopmentExtension).not.toHaveBeenCalled();
});

test('別のChromeが CDP ポートを使用中なら新しいウィンドウを開かない', async () => {
  const run = launcher(null, true);
  await expect(run.main()).rejects.toThrow('別のChrome');
  expect(run.spawn).not.toHaveBeenCalled();
});

describe('開発用Chromeプロファイルの CDP 起動', () => {
  test('CDP の接続先をローカル固定で定めている', () => {
    expect(source).toMatch(/const CDP_ADDRESS = '127\.0\.0\.1';/);
    expect(source).toMatch(/const CDP_PORT = 9223;/);
  });

  test('専用プロファイルと同時に CDP を起動する', () => {
    expect(source).toContain('--user-data-dir=$' + '{PROFILE}');
    expect(source).toContain('--remote-debugging-address=$' + '{CDP_ADDRESS}');
    expect(source).toContain('--remote-debugging-port=$' + '{CDP_PORT}');
  });

  test('背面でも描画とタイマーを維持する', () => {
    expect(source).toContain('--disable-backgrounding-occluded-windows');
    expect(source).toContain('--disable-background-timer-throttling');
    expect(source).toContain('--disable-renderer-backgrounding');
  });

  test('起動成功を CDP の応答で確認する', () => {
    expect(source).toContain('await cdpReady(CDP_URL)');
    expect(source).toContain('await waitFor(`開発用Chromeの CDP が $' + '{CDP_ADDRESS}:$' + '{CDP_PORT} で応答すること`');
  });

  test('日常用と同じリリースビルドを読み込み、開発用 Native Host を選ぶ', () => {
    expect(source).toContain("path.join(ROOT, 'extension', '.output', 'chrome-mv3')");
    expect(source).toContain('await configureDevelopmentExtension(OUTPUT, CDP_URL)');
  });
});
