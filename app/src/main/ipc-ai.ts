'use strict';

// AI 機能のオプトイン IPC（#830、親 #98）。lib-config.ts の readAiConfig/
// writeAiConfig の薄いハンドラ——config.json の唯一のフラグ（`ai.enabled`）で、
// lib-ml-runtime.ts の aiFeaturesEnabled() もこれを読むので、main とレンダラーが
// AI 機能が有効かどうかについて別々の考えを持つことは無い。
import { ipcMain } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { AiConfig } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { readAiConfig, writeAiConfig } = ctx;

  ipcMain.handle('get-ai-config', (): AiConfig => readAiConfig());
  ipcMain.handle('set-ai-config', (_e, patch): AiConfig => writeAiConfig(patch));
}

export { register };
