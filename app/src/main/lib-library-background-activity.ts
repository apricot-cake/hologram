import { createActivityGate } from './app-activity.ts';
import { isAdmittedLibraryOperation, runAdmittedLibraryOperation, runWhenLibraryAdmissionOpen } from './lib-library-admission.ts';

// IPC の外（watcher debounce / startup timer）で始まる DB・ファイル変更を、relocation の
// close/copy より先に完了させるための活動門。
export const libraryBackgroundActivity = createActivityGate();

export function waitForLibraryBackgroundIdle(): Promise<void> {
  return new Promise((resolve) => libraryBackgroundActivity.whenIdle(resolve));
}

export function runLibraryBackgroundTask<T>(action: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const execute = () => {
      const end = libraryBackgroundActivity.begin();
      try {
        Promise.resolve(runAdmittedLibraryOperation(action)).then(resolve, reject).finally(end);
      } catch (error) {
        end();
        reject(error);
      }
    };
    // pause 前に開始済みの IPC から呼ばれた処理は、その IPC と一緒に完了させる。
    if (isAdmittedLibraryOperation()) execute();
    else runWhenLibraryAdmissionOpen(execute);
  });
}
