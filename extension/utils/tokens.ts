// The extension's design tokens at runtime (#270).
//
// The values themselves are generated from the app's own tokens — see
// scripts/gen-extension-tokens.cts. This module is how the extension's code gets
// at them, and it deliberately hands out `var(--hologram-…)` REFERENCES rather
// than resolved colours: the reference re-resolves whenever the browser's theme
// changes, so a light/dark switch reaches UI that is already on screen without
// anything in JavaScript noticing or repainting.
//
// HOW THE VALUES REACH THE PAGE — a constructed stylesheet adopted onto the
// document, never an injected <style>. Measured on a page serving
// `style-src 'none'` (2026-07-29):
//
//   <style> from the isolated world   BLOCKED  (CSP report + no effect)
//   <style> inside a shadow root      BLOCKED  (same)
//   document.adoptedStyleSheets       APPLIES
//   element.style.setProperty         APPLIES
//
// So the long-standing note in the old glass-ui.ts — "an injected <style> would
// be subject to the host page's style-src" — was right, and stays right: sites
// like x.com ship exactly that policy. What it did not know is that a
// CONSTRUCTED stylesheet is not a CSP-guarded sink (there is no source to check),
// and neither is CSSOM. Those two are what this module and its callers use, so
// the extension can have real CSS custom properties on a page that forbids
// stylesheets outright.
//
// Trusted Types is unaffected either way: `replaceSync` and `element.style` are
// not script sinks. String sinks like innerHTML still are — see icons.ts.
import tokensCss from './tokens.generated.css?inline';
import { generatedActionBadge, generatedMotion } from './tokens.generated.ts';

// The motion values as numbers/strings, for the entrance and exit pops that go
// through Web Animations (whose `duration` cannot be a custom property).
export const motion = generatedMotion;

// The toolbar badge the service worker raises when it could not inject the UI
// at all (#269). The one surface in this file that is NOT drawn by us: Chrome
// paints the pill from a resolved colour, so this is a value rather than a
// var() reference and cannot follow a theme switch. See the generated file.
export const actionBadge = generatedActionBadge;

// One reference per token. Anything drawing on-page UI goes through here, which
// is what keeps colour literals out of the rest of the extension (enforced by
// scripts/extension-tokens.test.ts).
export const token = {
  // the floating surface itself
  surface: 'var(--hologram-surface)',
  ink: 'var(--hologram-ink)',
  inkMuted: 'var(--hologram-ink-muted)',
  overlayBorder: 'var(--hologram-overlay-border)',
  overlayShadow: 'var(--hologram-overlay-shadow)',
  radius: 'var(--hologram-radius)',
  // state
  accent: 'var(--hologram-accent)',
  accentSoft: 'var(--hologram-accent-soft)',
  onAccent: 'var(--hologram-on-accent)',
  success: 'var(--hologram-success)',
  onSuccess: 'var(--hologram-on-success)',
  warning: 'var(--hologram-warning)',
  onWarning: 'var(--hologram-on-warning)',
  danger: 'var(--hologram-danger)',
  onDanger: 'var(--hologram-on-danger)',
  badgeNeutral: 'var(--hologram-badge-neutral)',
  ring: 'var(--hologram-ring)',
  hover: 'var(--hologram-hover)',
  // compact controls that sit on a picture rather than on the card. The rim is
  // the card's; the FILL is the translucent disc below for every face except
  // retry, which takes the opaque `danger` because its fill is its state (#526;
  // the reasoning and the bound on the alpha are argued in tokens.source.css).
  controlSurface: 'var(--hologram-control-surface)',
  controlSurfaceHover: 'var(--hologram-control-surface-hover)',
  controlHoverGlow: 'var(--hologram-control-hover-glow)',
  // Its own shadow, not the card's (#310): a 36px blur offset 12px down is
  // wider than a 24px disc and hangs half its height below it — tokens.source.css
  // argues why that reads as elevation rather than as a mark.
  controlShadow: 'var(--hologram-control-shadow)',
  // type + motion
  fontSans: 'var(--hologram-font-sans)',
  durationBase: 'var(--hologram-duration-base)',
  durationFast: 'var(--hologram-duration-fast)',
  easeOut: 'var(--hologram-ease-out)',
} as const;

let sheet: CSSStyleSheet | null = null;
let sheetFailed = false;

// The constructed sheet itself, for callers that need to adopt it somewhere
// other than the document — the page-level ShadowRoot (#44) adopts this exact
// object, which is why the generated file targets `:root, :host` rather than
// just `:root`. Built at most once per module instance; null where constructed
// sheets do not exist (jsdom in the offline unit suites).
export function tokensSheet(): CSSStyleSheet | null {
  if (sheet || sheetFailed) return sheet;
  try {
    const created = new CSSStyleSheet();
    created.replaceSync(tokensCss);
    sheet = created;
  } catch {
    sheetFailed = true;
  }
  return sheet;
}

// Idempotent: every on-page entry point calls this before it builds anything.
// The resident content script and the on-demand Alt+S script share one isolated
// world per document, so the module state above is shared too and the second
// caller is free.
export function ensureTokens(): void {
  const created = tokensSheet();
  if (!created) return;
  try {
    // Guarded rather than assumed: a document without adoptedStyleSheets at all
    // is the same "no styling here" case the constructor failure above is, and
    // a throw on this line would kill every line after the call in the caller
    // (memory: dead-dom-throw-kills-next-line). An unstyled control still saves
    // the picture, which is the part that must not depend on any of this.
    const current = document.adoptedStyleSheets;
    if (!current || current.includes(created)) return;
    document.adoptedStyleSheets = [...current, created];
  } catch {
    /* same reason */
  }
}

// Read live, never cached. The old glass-ui.ts evaluated this once at module
// import, so a user who turned reduced motion on mid-session kept the
// animations until the tab was reloaded. Colour, type and transitions follow
// the media queries in the generated sheet; only Web Animations has to ask,
// because its `duration` is a number rather than a custom property.
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
