// Shared visual vocabulary for the extension's on-page UI (capture banner in
// content.ts + drag drop-zone in drag.ts): the app's floating-surface
// materials (design-tokens.css --scrim-* / --sky-* / --green-500 / --red-500 /
// --amber-500) plus its motion vocabulary (--ease-out / --dur-hover /
// --dur-pop) rebuilt for host pages, where the app's CSS custom properties
// don't exist.
//
// The card is the app's SCRIM SOLID material (#136): text over arbitrary host
// content rides a near-opaque dark veil with white ink, no backdrop blur.
// Contrast is guaranteed by the scrim itself, so the palette is
// theme-INDEPENDENT — one set of literals, no theme pref plumbing (the old
// light/dark card followed the extension theme pref; #136 removed the
// translucent card that made that necessary).
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
// re-runs it via executeScript: the guard keeps the live instance.
(() => {
  if (window.corpusGlassUi) return;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ACCENT_TEXT = '#8ad3ec'; // sky-300
  const SPINNER_TRACK = 'rgba(255,255,255,0.22)';

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
    sp.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;border:2.5px solid ${SPINNER_TRACK};border-top-color:${ACCENT_TEXT};box-sizing:border-box;pointer-events:none;`;
    // 0.9s linear — the app's spinner cadence (index.html ms-spin).
    sp.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: 900, iterations: Number.POSITIVE_INFINITY });
    return sp;
  }

  window.corpusGlassUi = {
    // Accent steps (app sky ramp). ACCENT_TEXT is --accent-text's dark-theme
    // value (sky-300): accent as FOREGROUND on the dark scrim — the fill-tuned
    // sky steps are too dark to read as text/icon color there.
    ACCENT: '#28a8db', // sky-500 — OUTLINE/GLOW step (highlight frame, hover ring); nothing rides on it
    ACCENT_FILL: '#1397cc', // sky-600 — FILL step, white icon rides on it (app --accent: sky-500 failed the white-on-fill contrast tier)
    ACCENT_SOFT: 'rgba(40,168,219,0.18)', // badge tint behind an accent-colored icon
    ACCENT_TEXT,
    OK_GREEN: '#30a46c',
    FAIL_RED: '#e5484d',
    WARN_AMBER: '#e8a13a', // saved, but post metadata was unavailable
    TEXT: 'rgba(255,255,255,0.92)', // card label/text ink (white on the scrim)
    BADGE_NEUTRAL: 'rgba(255,255,255,0.10)', // badge tint with no state color (busy)
    RING: 'rgba(255,255,255,0.30)', // dashed drop-target ring, resting
    RING_ACCENT: 'rgba(94,197,236,0.85)', // dashed ring while dragging over (sky-300 tier)
    CARD_BG: 'rgba(20, 22, 26, 0.86)', // app --scrim-bg (scrim solid, no blur)
    CARD_BORDER: 'rgba(255,255,255,0.16)',
    CARD_SHADOW: '0 12px 36px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.10)',
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
