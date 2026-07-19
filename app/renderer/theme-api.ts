// Theme runtime API — apply/get/set/resolve/applyTitleBar, the module the React
// Appearance section (Settings → 外観) drives. Bundled into app.js via the App.tsx /
// settings-ipc imports; it owns the LIVE pref state after load: it follows OS theme
// changes while in 'auto' and reconciles once with config.json over IPC.
//
// The pre-paint FOUC pass — set [data-theme] before first paint — is a separate tiny
// standalone script (renderer/theme.ts → theme.js, loaded in <head>; see the load-order
// comment in index.html). That must run before app.js can, so it stays its own build;
// this module re-derives the same initial pref on load, so the two agree.
//
// Theme model: we store the PREF (auto/light/dark); the APPLIED value (light/dark) is
// resolved from it — 'auto' tracks the OS via prefers-color-scheme.

const KEY = 'corpus-theme';
let mql: MediaQueryList | null = null;
try {
  mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
} catch (e) {
  mql = null;
}
let pref = 'auto'; // auto | light | dark

function cleanPref(t: string): string {
  return t === 'light' || t === 'dark' ? t : 'auto';
}
function systemDark() {
  return !!(mql && mql.matches);
}
function resolvePref(p: string): string {
  p = cleanPref(p);
  return p === 'auto' ? (systemDark() ? 'dark' : 'light') : p;
}

// Native titlebar overlay (Windows). The OS draws the window-control buttons (WCO /
// titleBarOverlay) OVER the web layer, so a modal's page-wide scrim can't cover them — left
// alone they'd stay bright and "float" above the dimmed page. Electron has no transparent
// WCO (electron#33567), so the only fix is to recolor the strip to the dimmed tone while a
// modal is up. VS Code does exactly this (windowImpl.ts updateWindowControls → dimColor =
// base × (1 − scrim opacity), matching its rgba(0,0,0,.5) modal overlay).
//
// Two things kept the earlier recolor from looking clean, neither a law of nature:
//  - repeated repaints: setTitleBarOverlay repaints the caption on EVERY call, and ModalChrome
//    recolored on every MutationObserver fire → flicker. setBar() dedupes (skips no-op recolors).
//  - lag: the recolor is instant + async-over-IPC, so if it fires AFTER the page paints its dim
//    (post-paint useEffect) OR the scrim FADES in, the strip visibly trails the page ("色合わせが
//    追いつかない"). So it's fired pre-paint (ModalChrome useLayoutEffect) against an instant
//    (un-faded) scrim, landing with the page dim. VS Code drives it from one main source the same way.
let modalDim = false;
const DIM = 0.5; // 1 − the modal scrim opacity (bg-black/50, the common real-product value, in dialog/alert-dialog/sheet)
function dimHex(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * DIM);
  const g = Math.round(((n >> 8) & 255) * DIM);
  const b = Math.round((n & 255) * DIM);
  return `rgb(${r}, ${g}, ${b})`;
}
function barColors() {
  const d = resolvePref(pref) === 'dark';
  const color = d ? '#0e0f11' : '#eceef2';
  const symbol = d ? '#9aa3af' : '#5b6470';
  return { color: modalDim ? dimHex(color) : color, symbolColor: modalDim ? dimHex(symbol) : symbol, height: 37 };
}
let lastBar = '';
function setBar() {
  if (!(window.corpus && window.corpus.setTitleBarOverlay)) return;
  const next = barColors();
  const key = JSON.stringify(next);
  if (key === lastBar) return; // dedupe: each setTitleBarOverlay repaints the caption = flicker if spammed
  lastBar = key;
  try {
    window.corpus.setTitleBarOverlay(next);
  } catch (e) {}
}
// Recolor the WCO strip to the dimmed tone (or back) when a modal scrim goes up/down.
// App.tsx ModalChrome is the single caller, driven by the union of modal-open states.
//
// Deferred to AFTER the page paints, on purpose. The two surfaces travel different pipelines
// — the scrim is a compositor frame, the strip is an IPC hop to main + an OS caption repaint
// — and the IPC hop is the faster of the two. Dispatching pre-paint therefore made the strip
// LEAD the scrim by 1-2 frames whenever the renderer was busy enough to miss a frame (rapid
// open/close: measured max 33ms lead, always strip-first). Firing post-paint instead puts the
// recolor a bare IPC latency BEHIND the scrim, which is the smaller of the two errors. rAF +
// setTimeout(0) is the post-paint idiom: the rAF callback still runs before the frame is
// painted, the timeout lands after it.
let pendingDim = false;
let flushQueued = false;
export function applyTitleBar(modal: boolean): void {
  pendingDim = !!modal;
  if (flushQueued) return; // coalesce: a burst of toggles only ever applies its final state
  flushQueued = true;
  requestAnimationFrame(() => {
    setTimeout(() => {
      flushQueued = false;
      modalDim = pendingDim;
      setBar();
    }, 0);
  });
}

export function apply(p: string): string {
  pref = cleanPref(p);
  if (resolvePref(pref) === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  setBar(); // set the titlebar overlay to the resolved theme color
  return pref;
}
export function get(): string {
  return pref;
}
export function set(p: string, persist?: boolean): string {
  apply(p);
  try {
    localStorage.setItem(KEY, pref);
  } catch (e) {
    /* ignore */
  }
  if (persist !== false && window.corpus && window.corpus.setPref) {
    try {
      window.corpus.setPref('theme', pref);
    } catch (e) {
      /* ignore */
    }
  }
  return pref;
}
export function resolve(): string {
  return resolvePref(pref);
}

// Init (runs once on first import, during app.js eval). Re-derive the initial pref from
// the same sources the pre-paint boot used — main passes config's theme as ?theme=;
// fall back to the localStorage cache; else 'auto' — then apply (idempotent with the
// boot's [data-theme] pass; also sets the titlebar overlay, which the boot no longer
// touches). Preload's window.corpus exists before any page script runs, so no readiness
// gate is needed for the config reconcile.
let initial: string | null = null;
try {
  initial = new URLSearchParams(location.search).get('theme');
} catch (e) {
  /* ignore */
}
if (!initial) {
  try {
    initial = localStorage.getItem(KEY);
  } catch (e) {
    /* ignore */
  }
}
apply(initial || 'auto');
try {
  localStorage.setItem(KEY, pref);
} catch (e) {
  /* ignore */
}

// While in 'auto', follow live OS theme changes.
if (mql) {
  const onSys = function () {
    if (pref === 'auto') apply('auto');
  };
  if (mql.addEventListener) mql.addEventListener('change', onSys);
  else if (mql.addListener) mql.addListener(onSys);
}

// Reconcile with config.json once. The old DOMContentLoaded wait existed only for the
// legacy #themeSelect wiring (removed: the React Appearance section owns the control).
if (window.corpus && window.corpus.getPrefs) {
  window.corpus
    .getPrefs()
    .then(function (p) {
      if (!p || !p.theme) return;
      if (cleanPref(p.theme) !== pref) set(p.theme, false);
      try {
        localStorage.setItem(KEY, cleanPref(p.theme));
      } catch (e) {
        /* ignore */
      }
    })
    .catch(function () {
      /* ignore */
    });
}
