import { afterEach, expect, test, vi } from 'vitest';
import { closeLibraryIpcAdmission, isAdmittedLibraryOperation, openLibraryIpcAdmission, runAdmittedLibraryOperation } from './lib-library-admission';
import { runLibraryBackgroundTask, waitForLibraryBackgroundIdle } from './lib-library-background-activity';

afterEach(() => openLibraryIpcAdmission());

test('開始済みのバックアップと後始末を待ち、新しい背景処理は再開後に実行する', async () => {
  let releaseBackup!: () => void;
  let releasePrune!: () => void;
  const backup = new Promise<void>((resolve) => {
    releaseBackup = resolve;
  });
  const prune = new Promise<void>((resolve) => {
    releasePrune = resolve;
  });
  const started = runLibraryBackgroundTask(async () => {
    await backup;
    expect(isAdmittedLibraryOperation()).toBe(true);
    await prune;
  });
  closeLibraryIpcAdmission();
  let idle = false;
  const waiting = waitForLibraryBackgroundIdle().then(() => {
    idle = true;
  });
  const next = vi.fn(() => true);
  const queued = runLibraryBackgroundTask(next);
  releaseBackup();
  await new Promise((resolve) => setImmediate(resolve));
  expect(idle).toBe(false);
  expect(next).not.toHaveBeenCalled();
  releasePrune();
  await started;
  await waiting;
  expect(idle).toBe(true);
  openLibraryIpcAdmission();
  await expect(queued).resolves.toBe(true);
  expect(next).toHaveBeenCalledOnce();
});

test('処理から派生した遅延callbackには完了後のDB権限を残さない', async () => {
  const later = new Promise<boolean>((resolve) => {
    runAdmittedLibraryOperation(() => {
      expect(isAdmittedLibraryOperation()).toBe(true);
      // 作成時のAsyncLocalStorageを継承する実際の非同期callback。
      setImmediate(() => resolve(isAdmittedLibraryOperation()));
    });
  });
  await expect(later).resolves.toBe(false);
  await expect(
    runLibraryBackgroundTask(() => {
      throw new Error('disk failure');
    }),
  ).rejects.toThrow('disk failure');
  await waitForLibraryBackgroundIdle();
});
