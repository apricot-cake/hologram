// The window size a harness run gets (HOLOGRAM_SMOKE=1).
//
// WHY IT IS NOT THE ORDINARY DEFAULT. The harness scripts (scripts/test-app-*.cts) drive the
// real renderer and read the DOM the virtual grid actually rendered, so they are written
// against the WIDE layout — the same premise e2e/lib/viewport.ts spells out for the Playwright
// suite (#649). They had been inheriting the ordinary 1100px default, which is on the NARROW
// side of layout-mode.ts's breakpoint. That went unnoticed for as long as narrow only changed
// how the inspector was presented: an overlay left the grid at full width, so the cards landed
// where the cases expected. #975 docks the panel at every width, so narrow now means a grid
// that is 320px narrower, fewer cards inside the virtual window, and DOM indices that stop
// lining up with what the cases assert.
//
// The value is a literal rather than derived, because main must not import renderer modules to
// reach layout-mode.ts. scripts/harness-viewport.test.ts is what keeps the two from drifting:
// it fails if this width ever falls to the narrow side of the breakpoint.
export const SMOKE_WINDOW = { width: 1440, height: 900 };
