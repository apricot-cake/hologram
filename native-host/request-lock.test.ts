import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { acquireExactRequestLock } from './request-lock.mts';

test('同じ要求は待機せず拒否し、別要求は独立して取得できる', async () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const folder = fs.mkdtempSync(path.join(process.env.HOLOGRAM_CONFIG_DIR!, 'exact-lock-'));
  const owner = await acquireExactRequestLock(folder, '1789600000000-abcd');
  let other: Awaited<ReturnType<typeof acquireExactRequestLock>> = null;
  try {
    await expect(acquireExactRequestLock(folder, '1789600000000-abcd')).rejects.toMatchObject({ code: 'request-in-progress' });
    other = await acquireExactRequestLock(folder, '1789600000000-beef');
    expect(other).not.toBeNull();
    expect(fs.readdirSync(folder)).toEqual([]);
  } finally {
    await other?.close();
    await owner?.close();
  }
  const successor = await acquireExactRequestLock(folder, '1789600000000-abcd');
  await successor?.close();
});

test('Windows のパス・要求IDの別表記で同じ排他を共有する', async () => {
  if (process.platform !== 'win32') return;
  const folder = fs.mkdtempSync(path.join(process.env.HOLOGRAM_CONFIG_DIR!, 'exact-lock-alias-'));
  const owner = await acquireExactRequestLock(folder, '1789600000000-abcd');
  try {
    await expect(acquireExactRequestLock(folder.replaceAll('\\', '/') + '/./', '1789600000000-ABCD')).rejects.toMatchObject({ code: 'request-in-progress' });
  } finally {
    await owner?.close();
  }
});

test('NODE_PENDING_PIPE_INSTANCES を継承しても競合を拒否し、設定値を保持する', async () => {
  if (process.platform !== 'win32') return;
  const folder = fs.mkdtempSync(path.join(process.env.HOLOGRAM_CONFIG_DIR!, 'exact-lock-pending-'));
  const previous = process.env.NODE_PENDING_PIPE_INSTANCES;
  process.env.NODE_PENDING_PIPE_INSTANCES = '32';
  let owner: Awaited<ReturnType<typeof acquireExactRequestLock>> = null;
  try {
    owner = await acquireExactRequestLock(folder, '1789600000000-cafe');
    await expect(acquireExactRequestLock(folder, '1789600000000-cafe')).rejects.toMatchObject({ code: 'request-in-progress' });
    expect(process.env.NODE_PENDING_PIPE_INSTANCES).toBe('32');
  } finally {
    await owner?.close();
    if (previous === undefined) delete process.env.NODE_PENDING_PIPE_INSTANCES;
    else process.env.NODE_PENDING_PIPE_INSTANCES = previous;
  }
});

test('別プロセスの所有者が終了するまで再取得せず、強制終了後は残留ファイルなしで回収する', async () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const folder = fs.mkdtempSync(path.join(process.env.HOLOGRAM_CONFIG_DIR!, 'exact-lock-process-'));
  const moduleUrl = pathToFileURL(path.resolve('native-host/request-lock.mts')).href;
  const setup = `import { acquireExactRequestLock } from ${JSON.stringify(moduleUrl)}; const folder = ${JSON.stringify(folder)};`;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', `${setup} await acquireExactRequestLock(folder, '1789600000000-cafe'); process.send('owned');`], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, NODE_PENDING_PIPE_INSTANCES: '32' } });
  const exited = once(owner, 'close');
  try {
    expect((await once(owner, 'message'))[0]).toBe('owned');
    const contender = spawn(process.execPath, ['--input-type=module', '-e', `${setup} try { const lock = await acquireExactRequestLock(folder, '1789600000000-cafe'); await lock.close(); process.exitCode = 1; } catch (error) { console.log(error.code); }`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_PENDING_PIPE_INSTANCES: '32' },
    });
    let output = '';
    contender.stdout.on('data', (chunk) => {
      output += chunk;
    });
    expect((await once(contender, 'close'))[0]).toBe(0);
    expect(output.trim()).toBe('request-in-progress');
    expect(owner.exitCode).toBeNull();
    owner.kill('SIGKILL');
    await exited;
    const recovered = await acquireExactRequestLock(folder, '1789600000000-cafe');
    await recovered?.close();
    expect(fs.readdirSync(folder)).toEqual([]);
  } finally {
    if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL');
    await exited;
  }
}, 10_000);
