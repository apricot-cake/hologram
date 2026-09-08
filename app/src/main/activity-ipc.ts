import { app, ipcMain as electronIpc, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import { appActivity } from './app-activity.ts';
import { ipcInputs, type IpcChannel, type IpcParsedArgs } from '../shared/ipc-inputs.ts';
import { isTrustedIpcUrl } from './ipc-sender.ts';
import type { IpcResults } from '../shared/ipc-results.ts';

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
  handle<C extends keyof IpcResults & IpcChannel>(channel: C, listener: (event: IpcMainInvokeEvent, ...args: IpcParsedArgs<C>) => IpcResults[C] | Promise<IpcResults[C]>) {
    electronIpc.handle(channel, (event, ...args) => {
      const end = appActivity.begin();
      try {
        const result = listener(event, ...validate(channel, event, args));
        if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') return Promise.resolve(result).finally(end);
        end();
        return result;
      } catch (error) {
        end();
        throw error;
      }
    });
  },
};
