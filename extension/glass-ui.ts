// Shared visual vocabulary for the extension's on-page UI (capture banner in
// content.ts + drag drop-zone in drag.ts): the app's dark-glass surface
// language (design-tokens.css --glass-* / --sky-600 / --green-500 / --red-500
// / --amber-500) rebuilt for host pages. Everything here is CSP/Trusted-Types
// safe: styles go through element.style (an injected <style> would be subject
// to the host page's style-src) and icons are built with createElementNS
// (string sinks like innerHTML are rejected on Trusted Types-enforcing hosts,
// e.g. x.com).
//
// Loaded BEFORE content.js / drag.js in both injection lists (manifest
// content_scripts and background.js's executeScript) — same isolated world,
// runs first, so consumers can read window.corpusGlassUi synchronously.
(() => {
  const SVGNS = 'http://www.w3.org/2000/svg';

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
    sp.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;border:2.5px solid rgba(255,255,255,0.22);border-top-color:#5ec5ec;box-sizing:border-box;pointer-events:none;`;
    sp.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: 900, iterations: Number.POSITIVE_INFINITY });
    return sp;
  }

  window.corpusGlassUi = {
    ACCENT: '#28a8db',
    ACCENT_SOFT: 'rgba(40,168,219,0.18)', // badge tint behind an accent-colored icon
    ACCENT_TEXT: '#5ec5ec', // accent legible ON the dark glass (icons/spinner)
    OK_GREEN: '#30a46c',
    FAIL_RED: '#e5484d',
    WARN_AMBER: '#e8a13a', // saved, but post metadata was unavailable
    CARD_BG: 'rgba(23,25,30,0.78)',
    CARD_BLUR: 'blur(20px) saturate(140%)',
    CARD_BORDER: 'rgba(255,255,255,0.14)',
    CARD_SHADOW: '0 12px 36px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.10)',
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
