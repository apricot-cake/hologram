import { createRequire } from 'node:module';
const { sleep } = createRequire(import.meta.url)('../../../scripts/lib-wait.cts');
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { appActivity, createActivityGate } from './app-activity.ts';
import { readDeployment, watchAppDeployment } from './app-deployment.ts';

const turn = () => new Promise((resolve) => setImmediate(resolve));

test('すべての処理が終わるまで再起動を保留し、通知の重複をまとめる', async () => {
  const gate = createActivityGate();
  const one = gate.begin();
  const two = gate.begin();
  const restart = vi.fn();
  gate.whenIdle(restart);
  gate.whenIdle(restart);
  one();
  await turn();
  expect(restart).not.toHaveBeenCalled();
  two();
  const three = gate.begin();
  await turn();
  expect(restart).not.toHaveBeenCalled();
  three();
  await turn();
  expect(restart).toHaveBeenCalledTimes(1);
});

test('起動時の既存通知と壊れた通知は無視し、置き換えられた完了通知で一度だけ再起動する', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hologram-deployment-'));
  const marker = path.join(dir, '.deployed-build.json');
  writeFileSync(marker, JSON.stringify({ build: 'old' }));
  const end = appActivity.begin();
  const restart = vi.fn();
  const stop = watchAppDeployment(dir, restart, (error) => {
    throw error;
  });
  try {
    // biome-ignore lint/plugin: 再起動が発生しないことを観測する待機時間。
    await sleep(150);
    expect(restart).not.toHaveBeenCalled();
    writeFileSync(marker, '{');
    expect(readDeployment(marker)).toBeNull();
    // biome-ignore lint/plugin: 再起動が発生しないことを観測する待機時間。
    await sleep(150);
    writeFileSync(`${marker}.tmp`, JSON.stringify({ build: 'new' }));
    renameSync(`${marker}.tmp`, marker);
    // biome-ignore lint/plugin: 再起動が発生しないことを観測する待機時間。
    await sleep(200);
    expect(restart).not.toHaveBeenCalled();
    end();
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    writeFileSync(marker, JSON.stringify({ build: 'new' }));
    // biome-ignore lint/plugin: 再起動が発生しないことを観測する待機時間。
    await sleep(150);
    expect(restart).toHaveBeenCalledTimes(1);
  } finally {
    end();
    stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
