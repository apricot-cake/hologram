// GENERATED FILE — do not edit.
//
// Written by scripts/gen-extension-tokens.cts. The colour half of the design
// tokens is delivered as CSS custom properties (tokens.generated.css) so a theme
// switch reaches UI already on screen; this file exists only for the values that
// CANNOT be read as a custom property — Web Animations takes a number of
// milliseconds for `duration`, not a var(), and the toolbar badge is painted by
// the browser from a resolved colour string.
//
// Exported under distinct names and re-exported as `motion` / `actionBadge` from
// tokens.ts: CRXJS/Vite bundles only imported modules, and two of them exporting
// the same symbol makes it warn on every build about which one it dropped.
export const generatedMotion = {
  durationBase: 180, // --hologram-duration-base
  durationFast: 120, // --hologram-duration-fast
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)', // --hologram-ease-out
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)', // --hologram-ease-in
} as const;

// The alert badge on the toolbar icon (#269). LIGHT ROW ONLY — a service
// worker has no way to ask which colour scheme the browser is wearing, so
// there is no branch to feed a second value to. The pill is opaque and
// carries its own ink, so the toolbar behind it never enters the contrast.
export const generatedActionBadge = {
  background: '#e7000b', // --hologram-danger
  text: '#ffffff', // --hologram-on-danger
} as const;
