// The glyphs the on-page UI is drawn with (was glass-ui.ts, whose "glass" name
// stopped describing anything when #136 made the surface solid and #270 made it
// themed; the colours it also carried are now tokens.ts).
//
// Built with createElementNS, not markup: string sinks like innerHTML are
// rejected outright on hosts that enforce Trusted Types (x.com does), and the
// DOM-building path is not a sink at all.
import { token } from './tokens.ts';

const SVGNS = 'http://www.w3.org/2000/svg';

// Stroke colour comes from `currentColor`, so a glyph is coloured by setting the
// ink on whatever holds it — which is also what makes forced-colors mode work:
// the browser substitutes its own system colour for the text and the glyph
// follows it instead of staying a fixed hue nobody chose.
export function makeIcon(paths: readonly string[], size = 22): SVGSVGElement {
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

// 0.9s linear — the app's spinner cadence. Left running under reduced motion,
// the same way it always has been: this one reports that work is in flight, and
// a frozen ring would say the save had stalled.
const SPIN_MS = 900;

export function makeSpinner(size = 22): HTMLDivElement {
  const sp = document.createElement('div');
  sp.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;border:2.5px solid ${token.badgeNeutral};border-top-color:currentColor;box-sizing:border-box;pointer-events:none;`;
  sp.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: SPIN_MS, iterations: Number.POSITIVE_INFINITY });
  return sp;
}

export const ICONS = {
  drop: ['M12 4v9', 'm8.5 9.5 3.5 3.5 3.5-3.5', 'M4.5 15.5v2a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-2'],
  check: ['m6 12.5 4.2 4.2L18 8'],
  cross: ['M7 7l10 10', 'M17 7 7 17'],
  warn: ['M12 6.5v6.5', 'M12 17.2v.05'],
  target: ['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17', 'M12 11.9v.2'],
};
