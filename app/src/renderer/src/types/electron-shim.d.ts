// Minimal 'electron' surface for the RENDERER tsc program only (tsconfig.json
// paths maps 'electron' here): the real electron.d.ts carries
// /// <reference types="node" />,
// which would pull Node's globals into this browser-only program and shadow the
// DOM lib's setTimeout/setInterval (number) with NodeJS.Timeout.
//
// The only file that resolves 'electron' from this program is app/src/preload/index.ts,
// pulled in via the HologramPreload import type in globals.d.ts. Weak types here
// cannot hide a real contract break: tsconfig.node.json type-checks the same
// app/src/preload/index.ts against the REAL electron types, and app/src/preload/index.ts annotates every
// api method explicitly, so the HologramPreload shape does not depend on the shim.
export const ipcRenderer: {
  invoke(channel: string, ...args: any[]): Promise<any>;
  on(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown;
  send(channel: string, ...args: any[]): void;
};
export const contextBridge: {
  exposeInMainWorld(apiKey: string, api: unknown): void;
};
// #234: weak on purpose, same as the two above — preload/index.ts annotates its
// own getPathForFile(file: File): string explicitly, so this stub's param type
// does not need to (and cannot, without pulling DOM's File into this file too).
export const webUtils: {
  getPathForFile(file: unknown): string;
};
