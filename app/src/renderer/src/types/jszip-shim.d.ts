// Minimal type shim for the 'jszip' import in the browser bundle (UgoiraPlayer.tsx's
// うごイラ archive, legacy-zip-import.ts's pre-#300 export path — the complete-format
// import moved to main/yauzl in #485), redirected here via tsconfig.json's `paths`
// (2026-07-11). jszip's own DefinitelyTyped .d.ts carries `/// <reference types="node" />`,
// which pulls Node's globals into this browser-only TS program and shadows the DOM lib's
// setTimeout/setInterval (number) with NodeJS.Timeout — breaking unrelated renderer code
// that assigns a timer id to a `number`-typed local. Only the surface actually used here
// (loadAsync + reading the loaded archive's file list) needs a type; the runtime import
// still resolves to the real npm package (Vite/Node module resolution ignores `paths`,
// it's TypeScript-only).
declare module 'jszip' {
  interface JSZipObject {
    async(type: 'string' | 'base64' | 'arraybuffer' | 'uint8array' | 'blob'): Promise<any>;
  }
  export default class JSZip {
    static loadAsync(data: Uint8Array | ArrayBuffer): Promise<JSZip>;
    files: Record<string, unknown>;
    file(name: string): JSZipObject | null;
  }
}
