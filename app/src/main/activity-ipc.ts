import { ipcMain as electronIpc } from 'electron';
import { appActivity } from './app-activity.ts';

// 非同期の取り込み、書き出し、ダイアログも、応答するまで更新を待たせる。
export const ipcMain = {
  on: (...args: Parameters<typeof electronIpc.on>) => electronIpc.on(...args),
  handle(channel: string, listener: Parameters<typeof electronIpc.handle>[1]) {
    electronIpc.handle(channel, (event, ...args) => {
      const end = appActivity.begin();
      try {
        const result = listener(event, ...args);
        if (result && typeof result.then === 'function') return Promise.resolve(result).finally(end);
        end();
        return result;
      } catch (error) {
        end();
        throw error;
      }
    });
  },
};
