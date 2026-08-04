'use strict';

// AI features opt-in IPC (#830, parent #98). Thin handlers over
// lib-config.ts's readAiConfig/writeAiConfig — the ONE config.json flag
// (`ai.enabled`) that lib-ml-runtime.ts's aiFeaturesEnabled() also reads, so
// main and renderer never keep two separate ideas of whether AI features are on.
import { ipcMain } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { AiConfig } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { readAiConfig, writeAiConfig } = ctx;

  ipcMain.handle('get-ai-config', (): AiConfig => readAiConfig());
  ipcMain.handle('set-ai-config', (_e, patch): AiConfig => writeAiConfig(patch));
}

export { register };
