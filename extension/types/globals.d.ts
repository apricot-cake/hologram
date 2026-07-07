// Ambient contracts shared across the extension's global-script files (no
// import/export — see tsconfig.json's module:"none" rationale). Mirrors the
// app/islands/types/globals.d.ts pattern: fields the OTHER files read/write on
// `window`, typed once here instead of at each call site.

interface CorpusI18nApi {
  lang: string;
  resolved: string;
  getMessage: (key: string, subs?: ReadonlyArray<unknown>) => string;
}

interface Window {
  // Set by i18n.js (content_scripts, injected before content.js/drag.js in the
  // same manifest entry — same isolated world, runs first).
  corpusI18n: Promise<CorpusI18nApi>;
  // Re-injection guards (content.js).
  __snsPostSaveActive?: boolean;
  __snsPostSaveCleanup?: () => void;
  // Re-injection guard (drag.js).
  __corpusDragActive?: boolean;
  // Set by diag.js — readable via the diagnostics page's own console.
  __corpusDiag?: Record<string, unknown>;
}

// background.js's classic (non-module) service worker loads metadata.js via
// importScripts — a WorkerGlobalScope method not in the DOM lib (this project
// uses the DOM lib for content.js/drag.js/diag.js's document/window access,
// so WebWorker lib isn't pulled in — the two conflict on `self`).
declare function importScripts(...urls: string[]): void;
