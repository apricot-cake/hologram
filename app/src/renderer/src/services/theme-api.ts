// Theme runtime API — apply/get/set/resolve, the module the React
// Appearance section (Settings → 外観) drives. Bundled into app.js via the App.tsx /
// settings-ipc imports; it owns the LIVE pref state after load: it follows OS theme
// changes while in 'auto' and reconciles once with config.json over IPC.
//
// The pre-paint FOUC pass — set [data-theme] before first paint — is a separate tiny
// standalone script (services/theme.ts → theme.js, loaded in <head>; see the load-order
// comment in index.html). That must run before app.js can, so it stays its own build;
// this module re-derives the same initial pref on load, so the two agree.
//
// Theme model: we store the PREF (auto/light/dark); the APPLIED value (light/dark) is
// resolved from it — 'auto' tracks the OS via prefers-color-scheme.

const KEY = 'hologram-theme';
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

// The window-control buttons are app-drawn (shell/WindowControls.tsx), so nothing here has to
// mirror the theme into an OS-drawn strip or track modal state to keep the two in step — the
// buttons are page pixels that the modal scrim covers like any other. This module is back to
// owning the theme pref alone.

export function apply(p: string): string {
  pref = cleanPref(p);
  if (resolvePref(pref) === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
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
  if (persist !== false && window.hologram && window.hologram.setPref) {
    try {
      window.hologram.setPref('theme', pref);
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
// touches). Preload's window.hologram exists before any page script runs, so no readiness
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
if (window.hologram && window.hologram.getPrefs) {
  window.hologram
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
