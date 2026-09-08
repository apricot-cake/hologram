import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { test as base, expect } from '@playwright/test';

// 起動・再起動・終了コードを検証するケースは、Node の子プロセスで隔離する。
// 並列数、タイムアウト、絞り込み、シャード、結果の集計は Playwright に任せる。
const test = base.extend<{ runHarness: (file: string) => Promise<void> }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright は依存フィクスチャを分割代入から読み取る。
  runHarness: async ({}, use, testInfo) => {
    let child: ChildProcess | undefined;
    let output = '';
    try {
      await use(async (file) => {
        child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        child.stdout?.on('data', (data) => {
          output += data.toString();
        });
        child.stderr?.on('data', (data) => {
          output += data.toString();
        });
        const code = await new Promise<number | null>((resolve, reject) => {
          child?.once('error', reject);
          child?.once('close', resolve);
        });
        expect(code, output).toBe(0);
      });
    } finally {
      if (child?.pid && child.exitCode === null) {
        if (process.platform === 'win32') {
          await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
        } else {
          child.kill('SIGKILL');
        }
      }
      await testInfo.attach('harness.log', { body: output, contentType: 'text/plain' });
    }
  },
});

const casesDir = path.join(__dirname, 'cases');
for (const file of fs
  .readdirSync(casesDir)
  .filter((file) => /^test-app-.*\.cts$/.test(file))
  .sort()) {
  test(file.replace(/^test-app-/, '').replace(/\.cts$/, ''), async ({ runHarness }) => {
    await runHarness(path.join(casesDir, file));
  });
}
