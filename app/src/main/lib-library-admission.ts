import { AsyncLocalStorage } from 'node:async_hooks';

let closed = false;
const waiting = new Set<() => void>();
const context = new AsyncLocalStorage<{ active: boolean }>();

export function closeLibraryIpcAdmission() {
  closed = true;
}

export function openLibraryIpcAdmission() {
  closed = false;
  for (const action of [...waiting]) {
    waiting.delete(action);
    setImmediate(() => runWhenLibraryAdmissionOpen(action));
  }
}

export function isLibraryAdmissionClosed() {
  return closed;
}

export function runWhenLibraryAdmissionOpen(action: () => void) {
  if (closed) waiting.add(action);
  else action();
}

export function isAdmittedLibraryOperation() {
  return context.getStore()?.active === true;
}

// 開始済みの処理だけが停止中も接続を使える。処理から派生したタイマーへ権限を残さない。
export function runAdmittedLibraryOperation<T>(action: () => T): T {
  const admission = { active: true };
  return context.run(admission, () => {
    try {
      const result = action();
      if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
        return Promise.resolve(result).finally(() => {
          admission.active = false;
        }) as T;
      }
      admission.active = false;
      return result;
    } catch (error) {
      admission.active = false;
      throw error;
    }
  });
}
