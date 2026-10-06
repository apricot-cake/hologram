import { EventEmitter } from 'node:events';
import type { ForkOptions } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
const { developmentOptions, assertDevelopmentProfile, persistentLaunchOptions, launchDevelopmentContext, startDevelopmentBrowser, waitForInterrupt } = require('./lib-dev-browser.cts');
const profile = path.join(os.homedir(), '.hologram-ext-profile');
const absentFiles = { existsSync: () => false };

test('既存 Default の専用プロファイル以外を拒否する', () => {
  expect(() => developmentOptions({ HOLOGRAM_EXTENSION_DEV_PROFILE: path.join(os.homedir(), 'daily') })).toThrow('既存の専用プロファイル');
  expect(() => developmentOptions({ HOLOGRAM_EXTENSION_DEV_PROFILE_DIRECTORY: 'Profile 1' })).toThrow('既存の Default');
});

test('pipe を管理する永続 context を headless で起動し、Windows ログインの鍵保管を置き換えない', () => {
  const options = persistentLaunchOptions({ executablePath: 'chrome' });
  expect(options.headless).toBe(true);
  expect(options.chromiumSandbox).toBe(true);
  expect(options.ignoreDefaultArgs).toContain('--disable-extensions');
  expect(options.ignoreDefaultArgs).toContain('--password-store=basic');
  expect(options.args).toContain('--headless=new');
  expect(options.args).toContain('--restore-last-session');
  expect(options.args).toContain('--profile-directory=Default');
  expect(options.args.join(' ')).not.toMatch(/remote-debugging-port|remote-debugging-address/);
});

test('外部プロファイルの直接 API 呼び出しでも一覧取得や起動を行わない', async () => {
  const runningPid = vi.fn();
  await expect(launchDevelopmentContext({ profile: 'foreign' }, { runningPid })).rejects.toThrow('専用プロファイル以外');
  expect(runningPid).not.toHaveBeenCalled();
});

test('プロセス一覧の失敗や起動中の専用 Chrome では起動しない', async () => {
  const launchPersistentContext = vi.fn();
  const chromium = { launchPersistentContext };
  await expect(
    launchDevelopmentContext(
      { profile },
      {
        files: absentFiles,
        runningPid: () => {
          throw new Error('CIM denied');
        },
        chromium,
      },
    ),
  ).rejects.toThrow('CIM denied');
  await expect(launchDevelopmentContext({ profile }, { files: absentFiles, runningPid: () => 7, chromium })).rejects.toThrow('起動中');
  expect(launchPersistentContext).not.toHaveBeenCalled();
});

test('専用 Chrome が起動していない場合だけ同じプロファイルを pipe 起動する', async () => {
  const events: string[] = [];
  const runningPid = vi.fn().mockReturnValue(null);
  const context = {};
  const launchPersistentContext = vi.fn(async (dir, options) => {
    events.push('launch');
    expect(dir).toBe(profile);
    expect(options.headless).toBe(true);
    return context;
  });
  expect(await launchDevelopmentContext({ profile }, { files: absentFiles, runningPid, chromium: { launchPersistentContext } })).toBe(context);
  expect(events).toEqual(['launch']);
});

test('専用ディレクトリと Default のリンクや実パスの不一致を拒否する', () => {
  const files = { existsSync: () => true, lstatSync: () => ({ isSymbolicLink: () => true }) };
  expect(() => assertDevelopmentProfile(profile, files)).toThrow('リンクやジャンクション');
  const aliases = { existsSync: () => true, lstatSync: () => ({ isSymbolicLink: () => false }), realpathSync: { native: () => 'daily-profile' } };
  expect(() => assertDevelopmentProfile(profile, aliases)).toThrow('リンクやジャンクション');
});

test('Ctrl+C の終了待ちは signal listener を残さない', async () => {
  const before = process.listenerCount('SIGINT');
  const waiting = waitForInterrupt();
  process.emit('SIGINT');
  await waiting;
  expect(process.listenerCount('SIGINT')).toBe(before);
});

test('設定、ロールバック、ページ更新は一つの継承 IPC 所有者を使う', async () => {
  const child: any = new EventEmitter();
  child.connected = true;
  child.disconnect = vi.fn(() => {
    child.connected = false;
  });
  child.unref = vi.fn();
  const calls: any[] = [];
  child.send = (message, callback) => {
    calls.push(message);
    callback(null);
    queueMicrotask(() => child.emit('message', { id: message.id, result: message.operation }));
  };
  const fork = vi.fn((_modulePath: string, _args: string[], _options: ForkOptions) => child);
  const session = await startDevelopmentBrowser({ profile }, { fork });
  await session.configure('shared');
  await session.configure('shared');
  await session.reload('shared');
  await session.release();
  expect(fork).toHaveBeenCalledOnce();
  expect(fork.mock.calls[0][2]).toMatchObject({ windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  expect(fork.mock.calls[0][2]).not.toHaveProperty('detached');
  expect(calls.map((call) => call.operation)).toEqual(['start', 'configure', 'configure', 'reload', 'close']);
  expect(child.disconnect).toHaveBeenCalledOnce();
  await expect(session.configure('shared')).rejects.toThrow('接続は終了');
});

test('所有プロセスが異常終了したら進行中の操作を失敗させる', async () => {
  const child: any = new EventEmitter();
  child.connected = true;
  child.send = (_message, callback) => {
    callback(null);
    queueMicrotask(() => child.emit('exit', 1));
  };
  child.disconnect = vi.fn();
  child.unref = vi.fn();
  await expect(startDevelopmentBrowser({ profile }, { fork: () => child })).rejects.toThrow('終了しました');
  expect(child.disconnect).toHaveBeenCalledOnce();
});

test('長い開発用収集は指定した待機期限まで継続できる', async () => {
  vi.useFakeTimers();
  const child: any = new EventEmitter();
  child.connected = true;
  child.disconnect = vi.fn(() => {
    child.connected = false;
  });
  child.unref = vi.fn();
  let pending: any;
  child.send = (message, callback) => {
    callback(null);
    if (message.operation === 'run') pending = message;
    else queueMicrotask(() => child.emit('message', { id: message.id, result: null }));
  };
  try {
    const session = await startDevelopmentBrowser({ profile }, { fork: () => child });
    const run = session.run('probe.cts', [], 330_000);
    await vi.advanceTimersByTimeAsync(121_000);
    child.emit('message', { id: pending.id, result: 'completed' });
    await expect(run).resolves.toBe('completed');
    await session.release();
  } finally {
    vi.useRealTimers();
  }
});
