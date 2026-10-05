import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { expect, test, vi } from 'vitest';

function launcher(running: boolean) {
  const child = { unref: vi.fn(), on: vi.fn() };
  const spawn = vi.fn((_executable: string, _args: string[], _options: unknown) => child);
  const existsSync = vi.fn(() => true);
  const fetch = vi.fn().mockResolvedValueOnce({ ok: running }).mockResolvedValue({ ok: true });
  const exports: { main?: (action: string) => Promise<void> } = {};
  const module = { exports };
  const env = {
    PATH: 'normal-path',
    HOLOGRAM_CONFIG_DIR: 'sandbox-config',
    HOLOGRAM_START_INACTIVE: '1',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_RENDERER_URL: 'sandbox-renderer',
    NODE_OPTIONS: '--inspect',
  };
  const require = (name: string) => {
    if (name === 'node:fs') return { existsSync };
    if (name === 'node:path') return path;
    if (name === 'node:child_process') return { spawn };
    if (name === './lib-electron-path.cts') return { electronPath: () => 'electron.exe' };
    if (name === './lib-wait.cts')
      return {
        waitFor: async (_label: string, condition: () => Promise<boolean>) => {
          if (!(await condition())) throw new Error('not ready');
        },
      };
    throw new Error(`Unexpected dependency ${name}`);
  };
  // Run the real CLI code with process and spawn substitutes; no app starts.
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, 'local-app.cts'), 'utf8')), {
    require,
    module,
    __dirname,
    process: { platform: 'win32', env },
    fetch,
    AbortSignal,
    console: { log: vi.fn() },
  });
  return { main: module.exports.main!, spawn, child };
}

test('検証起動は CLI の背面指定を付け普段のライブラリを使う', async () => {
  const { main, spawn, child } = launcher(false);
  await main('verify');
  expect(spawn).toHaveBeenCalledOnce();
  expect(spawn.mock.calls[0][1]).toEqual([path.resolve(__dirname, '../app'), '--remote-debugging-port=9222', '--hologram-background']);
  expect(spawn.mock.calls[0][2]).toEqual({ env: { PATH: 'normal-path' }, detached: true, windowsHide: true, stdio: 'ignore' });
  expect(child.unref).toHaveBeenCalledOnce();
});

test('検証で起動済みアプリを見つけても前面要求を送らない', async () => {
  const { main, spawn } = launcher(true);
  await main('verify');
  expect(spawn).not.toHaveBeenCalled();
});

test('通常起動は起動済みアプリへ表示要求を送る', async () => {
  const { main, spawn } = launcher(true);
  await main('launch');
  expect(spawn.mock.calls[0][1]).toEqual([path.resolve(__dirname, '../app'), '--hologram-activate-existing']);
});

test('通常の新規起動へ背面指定を付けない', async () => {
  const { main, spawn } = launcher(false);
  await main('launch');
  expect(spawn.mock.calls[0][1]).toEqual([path.resolve(__dirname, '../app'), '--remote-debugging-port=9222']);
});
