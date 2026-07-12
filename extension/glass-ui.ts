// Shared visual vocabulary for the extension's on-page UI (capture banner in
// content.ts + drag drop-zone in drag.ts): the app's glass surface language
// (design-tokens.css --glass-* / --sky-* / --green-500 / --red-500 /
// --amber-500) plus its motion vocabulary (--ease-out / --dur-hover /
// --dur-pop) rebuilt for host pages, where the app's CSS custom properties
// don't exist. Both the LIGHT and DARK theme values are ported as literals;
// which palette is live follows the extension's theme pref (chrome.storage
// .local 'theme': 'light' | 'dark', anything else = follow the OS via
// prefers-color-scheme — same auto/light/dark model as the app's config
// theme, which this origin cannot read).
//
// Color tokens are exposed as GETTERS so consumers always read the palette
// that is current at call time: the storage read below is async, and the
// pref may also change mid-session (options page / OS switch). Consumers
// build their UI lazily (banner on activation, drop zone on dragstart) and
// re-apply colors on every state transition; `ready` covers the build-time
// gap (don't paint before the initial pref read lands) and onThemeChange
// covers a flip while UI is already showing (the banner's 'select' state can
// sit on screen indefinitely).
//
// Everything here is CSP/Trusted-Types safe: styles go through element.style
// (an injected <style> would be subject to the host page's style-src) and
// icons are built with createElementNS (string sinks like innerHTML are
// rejected on Trusted Types-enforcing hosts, e.g. x.com).
//
// Loaded BEFORE content.js / drag.js in both injection lists (manifest
// content_scripts and background.js's executeScript) — same isolated world,
// runs first, so consumers can read window.corpusGlassUi synchronously.
// On sites where the manifest already injected this file, every activation
// re-runs it via executeScript: keep the live instance (its pref read landed
// long ago and its storage listener keeps it current) instead of resetting
// to the OS palette and re-racing the async read.
(() => {
  if (window.corpusGlassUi) return;
  const SVGNS = 'http://www.w3.org/2000/svg';

  // App DARK theme literals (design-tokens.css [data-theme="dark"] block).
  // ACCENT_TEXT is --accent-text (sky-300): accent as FOREGROUND on the dark
  // glass — the fill-tuned sky steps are too dark to read as text/icon color.
  const DARK = {
    ACCENT: '#28a8db', // sky-500 — OUTLINE/GLOW step (highlight frame, hover ring); nothing rides on it
    ACCENT_FILL: '#1397cc', // sky-600 — FILL step, white icon rides on it (app --accent: sky-500 failed the white-on-fill contrast tier)
    ACCENT_SOFT: 'rgba(40,168,219,0.18)', // badge tint behind an accent-colored icon
    ACCENT_TEXT: '#8ad3ec', // sky-300
    OK_GREEN: '#30a46c',
    FAIL_RED: '#e5484d',
    WARN_AMBER: '#e8a13a', // saved, but post metadata was unavailable
    TEXT: 'rgba(255,255,255,0.92)', // card label/text ink
    BADGE_NEUTRAL: 'rgba(255,255,255,0.10)', // badge tint with no state color (busy)
    RING: 'rgba(255,255,255,0.30)', // dashed drop-target ring, resting
    RING_ACCENT: 'rgba(94,197,236,0.85)', // dashed ring while dragging over (sky-300 tier)
    SPINNER_TRACK: 'rgba(255,255,255,0.22)',
    CARD_BG: 'rgba(22,23,26,0.78)', // app dark --glass-bg (= --surface #16171a at 78%)
    CARD_BLUR: 'blur(24px) saturate(140%)', // app dark --glass-filter
    CARD_BORDER: 'rgba(255,255,255,0.16)', // app dark --glass-rim
    // App dark --glass-drop + the toast's bright top-edge inset (the main "glass" cue on dark).
    CARD_SHADOW: '0 12px 36px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.10)',
  };

  // App LIGHT theme literals (design-tokens.css :root block). Status fills
  // (green/red/amber) and the sky outline/fill steps hold their contrast on
  // the white glass, so only the surface + foreground tokens diverge.
  const LIGHT = {
    ACCENT: DARK.ACCENT,
    ACCENT_FILL: DARK.ACCENT_FILL,
    ACCENT_SOFT: 'rgba(40,168,219,0.15)',
    ACCENT_TEXT: '#0a6e96', // app light --accent-text (sky-800)
    OK_GREEN: DARK.OK_GREEN,
    FAIL_RED: DARK.FAIL_RED,
    WARN_AMBER: DARK.WARN_AMBER,
    TEXT: 'rgba(20,24,31,0.92)', // app light --text (gray-800) tier
    BADGE_NEUTRAL: 'rgba(0,0,0,0.06)',
    RING: 'rgba(0,0,0,0.22)',
    RING_ACCENT: 'rgba(19,151,204,0.85)', // sky-600 (the sky-300 tier washes out on white)
    SPINNER_TRACK: 'rgba(0,0,0,0.15)',
    CARD_BG: 'rgba(255,255,255,0.72)', // app light --glass-bg (= --surface #ffffff at 72%)
    CARD_BLUR: 'blur(24px) saturate(180%)', // app light --glass-filter
    CARD_BORDER: 'rgba(0,0,0,0.10)', // app light --glass-rim
    CARD_SHADOW: '0 12px 32px -8px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.6)', // --glass-drop + --glass-edge
  };

  // Theme resolution. Before the async storage read lands, matchMedia alone
  // decides — for the default 'auto' pref that is already the final answer.
  // Consumers that build UI right at injection time (the capture banner)
  // await `ready` so a forced pref never loses the race to the read.
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  let pref: 'auto' | 'light' | 'dark' = 'auto';
  let palette = DARK;
  const themeListeners = new Set<() => void>();
  function recompute() {
    // No matchMedia (shouldn't happen in Chrome) → keep dark, the historical default.
    const dark = pref === 'dark' || (pref === 'auto' && (!mq || mq.matches));
    const next = dark ? DARK : LIGHT;
    if (next === palette) return;
    palette = next;
    for (const cb of themeListeners) cb();
  }
  function cleanPref(v: unknown): 'auto' | 'light' | 'dark' {
    return v === 'light' || v === 'dark' ? v : 'auto';
  }
  recompute();
  if (mq) {
    mq.addEventListener('change', recompute);
  }
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  try {
    chrome.storage.local.get('theme', (r) => {
      pref = cleanPref(r && r.theme);
      recompute();
      readyResolve();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.theme) {
        pref = cleanPref(changes.theme.newValue);
        recompute();
      }
    });
  } catch {
    /* storage unavailable — stay on the OS-driven palette */
    readyResolve();
  }

  function makeIcon(paths: readonly string[], size = 22): SVGSVGElement {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of paths) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    svg.style.pointerEvents = 'none';
    return svg;
  }

  function makeSpinner(size = 22): HTMLDivElement {
    const sp = document.createElement('div');
    sp.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;border:2.5px solid ${palette.SPINNER_TRACK};border-top-color:${palette.ACCENT_TEXT};box-sizing:border-box;pointer-events:none;`;
    // 0.9s linear — the app's spinner cadence (index.html ms-spin).
    sp.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: 900, iterations: Number.POSITIVE_INFINITY });
    return sp;
  }

  window.corpusGlassUi = {
    ready,
    onThemeChange(cb: () => void) {
      themeListeners.add(cb);
      return () => {
        themeListeners.delete(cb);
      };
    },
    get ACCENT() {
      return palette.ACCENT;
    },
    get ACCENT_FILL() {
      return palette.ACCENT_FILL;
    },
    get ACCENT_SOFT() {
      return palette.ACCENT_SOFT;
    },
    get ACCENT_TEXT() {
      return palette.ACCENT_TEXT;
    },
    get OK_GREEN() {
      return palette.OK_GREEN;
    },
    get FAIL_RED() {
      return palette.FAIL_RED;
    },
    get WARN_AMBER() {
      return palette.WARN_AMBER;
    },
    get TEXT() {
      return palette.TEXT;
    },
    get BADGE_NEUTRAL() {
      return palette.BADGE_NEUTRAL;
    },
    get RING() {
      return palette.RING;
    },
    get RING_ACCENT() {
      return palette.RING_ACCENT;
    },
    get CARD_BG() {
      return palette.CARD_BG;
    },
    get CARD_BLUR() {
      return palette.CARD_BLUR;
    },
    get CARD_BORDER() {
      return palette.CARD_BORDER;
    },
    get CARD_SHADOW() {
      return palette.CARD_SHADOW;
    },
    // App --font-sans: system stack with Japanese fallbacks (banner strings are
    // Japanese-primary; the host page's own font must not leak in).
    FONT_SANS: "-apple-system,'Segoe UI','Hiragino Kaku Gothic ProN','Yu Gothic UI','Noto Sans JP',system-ui,sans-serif",
    // Motion vocabulary (app design-tokens --ease-out / --dur-hover / --dur-pop):
    // one crisp system on the same curve; hover tier for state/color transitions,
    // pop tier for toast-style entrances/exits.
    EASE_OUT: 'cubic-bezier(0.22, 1, 0.36, 1)',
    DUR_HOVER: 180,
    DUR_POP: 200,
    REDUCED_MOTION: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    ICONS: {
      drop: ['M12 4v9', 'm8.5 9.5 3.5 3.5 3.5-3.5', 'M4.5 15.5v2a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-2'],
      check: ['m6 12.5 4.2 4.2L18 8'],
      cross: ['M7 7l10 10', 'M17 7 7 17'],
      warn: ['M12 6.5v6.5', 'M12 17.2v.05'],
      target: ['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17', 'M12 11.9v.2'],
    },
    makeIcon,
    makeSpinner,
  };
})();
