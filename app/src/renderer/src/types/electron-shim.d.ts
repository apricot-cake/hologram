// レンダラーの tsc プログラム専用の、最小限の 'electron' の面（tsconfig.json の paths が
// 'electron' をここへ向けている）: 本物の electron.d.ts は
// /// <reference types="node" />
// を持っていて、ブラウザだけのこのプログラムに Node のグローバルを引き込み、DOM の lib の
// setTimeout/setInterval（number）を NodeJS.Timeout で覆い隠してしまう。
//
// このプログラムから 'electron' を解決するファイルは app/src/preload/index.ts だけで、
// globals.d.ts の HologramPreload の import type 経由で引き込まれる。ここの型が弱くても、
// 本当の取り決めの破れを隠すことはない。tsconfig.node.json が同じ app/src/preload/index.ts を
// 本物の electron の型に対して型検査するし、app/src/preload/index.ts は api のメソッドを
// すべて明示的に注釈しているので、HologramPreload の形は shim に依存しない。
export const ipcRenderer: {
  invoke(channel: string, ...args: any[]): Promise<any>;
  on(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown;
  send(channel: string, ...args: any[]): void;
};
export const contextBridge: {
  exposeInMainWorld(apiKey: string, api: unknown): void;
};
// #234: 上の2つと同じく、意図して弱くしている。preload/index.ts が自身の
// getPathForFile(file: File): string を明示的に注釈しているので、このスタブの引数の型が
// そうする必要はない（DOM の File をこのファイルにも引き込まない限り、そもそもできない）。
export const webUtils: {
  getPathForFile(file: unknown): string;
};
