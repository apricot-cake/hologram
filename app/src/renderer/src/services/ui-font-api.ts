// UI font runtime — lets the user override the interface font (Settings → Appearance,
// #137). Empty string (the default) leaves the built-in --font-sans stack alone
// (design-tokens.css / globals.css's @theme copy, kept identical to each other per the
// #654 comment in both files).
//
// Applying an override never rewrites either stylesheet: it sets an INLINE `--font-sans`
// on <html>, which the cascade always prefers over any selector-based rule (including a
// stylesheet's :root), regardless of specificity — so both consumers (design-tokens.css's
// direct var(--font-sans) readers and globals.css's Tailwind `font-sans` utility) pick up
// the one write, and the two-copy stack #654 protects stays untouched.
//
// The prepended-to stack is read back from getComputedStyle ONCE, before any override is
// ever applied, and reused for every later change — so switching fonts a second time
// replaces the custom face in front of the same original stack instead of stacking a
// second custom face in front of the first.
//
// Modeled on services/theme-api.ts, minus that module's pre-paint boot pass: a font swap
// reflows text but does not invert light/dark contrast, so unlike the theme it does not
// need to land before first paint — it applies once this module loads, same as every
// other non-FOUC pref (inspectorWidth, gridSize, …).

const KEY = 'hologram-ui-font';
let family = '';
let cachedDefaultStack: string | null = null;

function defaultStack(): string {
  if (cachedDefaultStack === null) {
    try {
      cachedDefaultStack = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';
    } catch (_e) {
      cachedDefaultStack = 'sans-serif';
    }
  }
  return cachedDefaultStack;
}

// Quote + escape one <family-name> for a font-family list (CSS Syntax: backslash-escape a
// literal backslash or double quote inside a quoted string). BACKSLASH/DQUOTE are built from
// character codes rather than typed as literal escape sequences — this file is generated
// through a shell pipeline that mangles literal backslashes in transit, so the escaper
// itself has to be spelled without needing one.
const BACKSLASH = String.fromCharCode(92);
const DQUOTE = String.fromCharCode(34);
function quoteFamily(name: string): string {
  const escaped = name
    .split(BACKSLASH)
    .join(BACKSLASH + BACKSLASH)
    .split(DQUOTE)
    .join(BACKSLASH + DQUOTE);
  return DQUOTE + escaped + DQUOTE;
}

export function apply(name: string): string {
  family = typeof name === 'string' ? name.trim() : '';
  if (family) document.documentElement.style.setProperty('--font-sans', `${quoteFamily(family)}, ${defaultStack()}`);
  else document.documentElement.style.removeProperty('--font-sans');
  return family;
}
export function get(): string {
  return family;
}
export function set(name: string, persist?: boolean): string {
  apply(name);
  try {
    localStorage.setItem(KEY, family);
  } catch (_e) {
    /* ignore */
  }
  if (persist !== false && window.hologram && window.hologram.setPref) {
    try {
      window.hologram.setPref('uiFontFamily', family);
    } catch (_e) {
      /* ignore */
    }
  }
  return family;
}

// Init: apply the localStorage cache immediately (no flash back to default on reload),
// then reconcile with config.json once — same shape as theme-api.ts's boot.
let initial = '';
try {
  initial = localStorage.getItem(KEY) || '';
} catch (_e) {
  /* ignore */
}
apply(initial);

if (window.hologram && window.hologram.getPrefs) {
  window.hologram
    .getPrefs()
    .then(function (p) {
      const v = typeof p?.uiFontFamily === 'string' ? p.uiFontFamily : '';
      if (v !== family) set(v, false);
      try {
        localStorage.setItem(KEY, v);
      } catch (_e) {
        /* ignore */
      }
    })
    .catch(function () {
      /* ignore */
    });
}
