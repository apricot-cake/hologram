// Minimal 'electron' surface for the RENDERER tsc program only (tsconfig.json
// paths maps 'electron' here — the same device as the jszip shim, and for the
// same reason): the real electron.d.ts carries /// <reference types="node" />,
// which would pull Node's globals into this browser-only program and shadow the
// DOM lib's setTimeout/setInterval (number) with NodeJS.Timeout.
//
// The only file that resolves 'electron' from this program is app/preload.cts,
// pulled in via the CorpusPreload import type in globals.d.ts. Weak types here
// cannot hide a real contract break: tsconfig.main.json type-checks the same
// preload.cts against the REAL electron types, and preload.cts annotates every
// api method explicitly, so the CorpusPreload shape does not depend on the shim.
export const ipcRenderer: {
  invoke(channel: string, ...args: any[]): Promise<any>;
  on(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown;
};
export const contextBridge: {
  exposeInMainWorld(apiKey: string, api: unknown): void;
};
