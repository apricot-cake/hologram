// Ambient contracts shared across the extension's global-script files (no
// import/export — see tsconfig.json's module:"none" rationale). Mirrors the
// app/islands/types/globals.d.ts pattern: fields the OTHER files read/write on
// `window`, typed once here instead of at each call site.

interface CorpusI18nApi {
  lang: string;
  resolved: string;
  getMessage: (key: string, subs?: ReadonlyArray<unknown>) => string;
  // Partial-save banner/toast wording, reason-specific when metaReason is set.
  partialSaveText: (reason?: string | null) => string;
}

// Shared scrim-solid visual vocabulary for on-page UI (see glass-ui.ts).
// Theme-independent (#136): one static palette, no pref plumbing.
interface CorpusGlassUiApi {
  ACCENT: string;
  ACCENT_FILL: string;
  ACCENT_SOFT: string;
  ACCENT_TEXT: string;
  OK_GREEN: string;
  FAIL_RED: string;
  WARN_AMBER: string;
  TEXT: string;
  BADGE_NEUTRAL: string;
  RING: string;
  RING_ACCENT: string;
  CARD_BG: string;
  CARD_BORDER: string;
  CARD_SHADOW: string;
  FONT_SANS: string;
  EASE_OUT: string;
  DUR_HOVER: number;
  DUR_POP: number;
  REDUCED_MOTION: boolean;
  ICONS: {
    drop: readonly string[];
    check: readonly string[];
    cross: readonly string[];
    warn: readonly string[];
    target: readonly string[];
  };
  makeIcon: (paths: readonly string[], size?: number) => SVGSVGElement;
  makeSpinner: (size?: number) => HTMLDivElement;
}

interface Window {
  // Set by i18n.js (content_scripts, injected before content.js/drag.js in the
  // same manifest entry — same isolated world, runs first).
  corpusI18n: Promise<CorpusI18nApi>;
  // Set by glass-ui.js (injected before content.js/drag.js in both lists —
  // synchronous, unlike corpusI18n).
  corpusGlassUi: CorpusGlassUiApi;
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
