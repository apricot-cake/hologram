import { app, ipcMain as electronIpc, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import { appActivity } from './app-activity.ts';
import { createActivityGate } from './app-activity.ts';
import { isAdmittedLibraryOperation, isLibraryAdmissionClosed, runAdmittedLibraryOperation, runWhenLibraryAdmissionOpen } from './lib-library-admission.ts';
export { closeLibraryIpcAdmission, openLibraryIpcAdmission, runWhenLibraryAdmissionOpen } from './lib-library-admission.ts';
import { ipcInputs, type IpcChannel, type IpcParsedArgs } from '../shared/ipc-inputs.ts';
import { isTrustedIpcUrl } from './ipc-sender.ts';
import type { IpcResults } from '../shared/ipc-results.ts';

// ライブラリ移動自身を除く、開始済み IPC の静止を待つための門。移動フラグを立てた後は
// DB の共有入口が新しい処理を遮断し、ここが idle になれば生きた接続を安全に閉じられる。
export const libraryIpcActivity = createActivityGate();
export function isAdmittedLibraryIpc() {
  return isAdmittedLibraryOperation();
}

function isRelocationEntry(channel: IpcChannel) {
  // pick-save-folder は cloud 警告が無ければ同じ IPC の中で moveLibraryTo まで進む。
  return channel === 'import-complete' || channel === 'export-complete' || channel === 'move-save-folder' || channel === 'pick-save-folder' || channel === 'apply-repoint';
}

const LIBRARY_INDEPENDENT_CHANNELS = ['open-external', 'copy-text', 'window-control', 'set-titlebar-symbol-dim', 'take-post-link', 'app-info', 'get-extension-contact', 'get-prefs', 'set-pref'] as const satisfies readonly IpcChannel[];
const DEFERRED_LIBRARY_READ_CHANNELS = [
  'get-classified-assignments',
  'get-config',
  'get-export-reminder',
  'get-folders',
  'get-integrity-status',
  'get-library-status',
  'get-manual-groups',
  'get-poster-tags',
  'get-prefs',
  'get-tabs',
  'get-tag-groups',
  'get-tag-vocab',
  'get-ungrouped',
  'list-posts',
  'list-posts-delta',
  'list-trash',
  'query-history',
  'search-candidates',
  'search-full-text',
] as const satisfies readonly IpcChannel[];
const isListed = <T extends string>(values: readonly T[], value: string): value is T => values.includes(value as T);

function waitForLibraryAdmission(event: IpcMainInvokeEvent, retainAfterDestroy = false): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const destroyed = () => {
      if (settled) return;
      settled = true;
      reject(new Error('IPC sender was destroyed while waiting for library relocation'));
    };
    if (!retainAfterDestroy) event.sender.once('destroyed', destroyed);
    runWhenLibraryAdmissionOpen(() => {
      if (settled) return;
      settled = true;
      if (!retainAfterDestroy) event.sender.removeListener('destroyed', destroyed);
      resolve();
    });
  });
}

function validate<C extends IpcChannel>(channel: C, event: IpcMainInvokeEvent | IpcMainEvent, args: unknown[]): IpcParsedArgs<C> {
  if (!event?.senderFrame || event.senderFrame !== event.sender.mainFrame || !isTrustedIpcUrl(event.senderFrame.url, process.env.ELECTRON_RENDERER_URL, app.isPackaged)) {
    console.warn('IPC sender rejected', { channel });
    throw new Error('Untrusted IPC sender');
  }
  const parsed = ipcInputs[channel].safeParse(args);
  if (!parsed.success) {
    console.warn('IPC input rejected', { channel, issues: parsed.error.issues.map(({ code, path }) => ({ code, path })) });
    throw new Error(`Invalid IPC input: ${channel}`);
  }
  return parsed.data as IpcParsedArgs<C>;
}

// 非同期の取り込み、書き出し、ダイアログも、応答するまで更新を待たせる。
export const ipcMain = {
  on<C extends IpcChannel>(channel: C, listener: (event: IpcMainEvent, ...args: IpcParsedArgs<C>) => void) {
    electronIpc.on(channel, (event, ...args) => {
      try {
        listener(event, ...validate(channel, event, args));
      } catch (error) {
        console.warn('IPC event rejected', { channel, error: error instanceof Error ? error.message : 'unknown' });
      }
    });
  },
  handle<C extends keyof IpcResults & IpcChannel>(channel: C, listener: (event: IpcMainInvokeEvent, ...args: IpcParsedArgs<C>) => IpcResults[C] | Promise<IpcResults[C]>, options?: { retainAfterSenderDestroyed(event: IpcMainInvokeEvent): boolean }) {
    let latestPersistenceRequest = 0;
    electronIpc.handle(channel, (event, ...args) => {
      const parsed = validate(channel, event, args);
      const relocationEntry = isRelocationEntry(channel) && !(channel === 'export-complete' && parsed[0] === 'images');
      const libraryDependent = !relocationEntry && !isListed(LIBRARY_INDEPENDENT_CHANNELS, channel);
      const retained = channel === 'set-tabs' && options?.retainAfterSenderDestroyed(event) === true;
      const persistenceRequest = retained ? ++latestPersistenceRequest : 0;
      const execute = () => {
        // 再開直後に届いた新しい snapshot を、setImmediate で保留した古い保存で戻さない。
        if (persistenceRequest && persistenceRequest !== latestPersistenceRequest) return { ok: false } as IpcResults[C];
        const end = appActivity.begin();
        const endLibrary = libraryDependent ? libraryIpcActivity.begin() : () => {};
        try {
          // AsyncLocalStorage により、pause より前に admit 済みの async IPC は await をまたいでも
          // DB 入口を最後まで利用できる。pause 後の新規 IPC は上で listener 自体を開始しない。
          const result = libraryDependent ? runAdmittedLibraryOperation(() => listener(event, ...parsed)) : listener(event, ...parsed);
          if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function')
            return Promise.resolve(result).finally(() => {
              endLibrary();
              end();
            });
          endLibrary();
          end();
          return result;
        } catch (error) {
          endLibrary();
          end();
          throw error;
        }
      };
      if (libraryDependent && isLibraryAdmissionClosed()) {
        // 閉じる直前のタブ保存は、入力検証と主ウィンドウ認可を受領時に済ませて保持する。
        if (retained || isListed(DEFERRED_LIBRARY_READ_CHANNELS, channel)) {
          return (async () => {
            do {
              await waitForLibraryAdmission(event, retained);
            } while (isLibraryAdmissionClosed());
            return execute();
          })();
        }
        throw new Error('library relocation is in progress');
      }
      return execute();
    });
  },
};
