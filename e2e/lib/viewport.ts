// Where the E2E window sits relative to the layout's width breakpoint (#649).
//
// WHY THIS FILE EXISTS. The harness used to fix its content box at a width written out as a
// literal, and that literal was the breakpoint itself — layout-mode.ts's WIDE_MIN_PX, with
// the boundary on the wide side. The two numbers were equal by coincidence and written in two
// places, so moving the breakpoint up would have moved the WHOLE flow suite to the narrow
// side: every case still green, and not one of them looking at the wide layout it was written
// against. A failure that does not look like a failure.
//
// So the boundary keeps exactly one owner (layout-mode.ts), and every width the suite uses is
// computed from it here. Nothing under e2e/ may write the number down again — scripts/
// harness-viewport.test.ts enforces both halves of that.

import { WIDE_MIN_PX } from '../../app/src/renderer/src/services/layout-mode.ts';

export { WIDE_MIN_PX };

// THE BOUNDARY IS BETWEEN TWO PIXELS, and `min-width` includes the value it names: at exactly
// WIDE_MIN_PX the layout is already wide. That is easy to get backwards, so the two widths
// either side of the switch have names rather than being spelled `bp` and `bp - 1` at each
// use. justAbove is what the derivation below builds on; justBelow is the half a spec that
// wants to see the narrow form at its widest would ask for.

/** The narrowest width still on the WIDE side of `breakpoint`. */
export function justAbove(breakpoint: number): number {
  return breakpoint;
}

/** The widest width still on the NARROW side of `breakpoint`. */
export function justBelow(breakpoint: number): number {
  return breakpoint - 1;
}

// How far from the switch a case that is not ABOUT the switch should sit. Any positive
// clearance satisfies the layout, so this is not a tuned number — it is one step of a window
// size, wide enough that the scrollbar gutter and DPI rounding (which decide a pixel or two
// of the content box) cannot walk a case back onto the boundary, and small enough that the
// window still fits on an ordinary display once the breakpoint is added back.
const CLEARANCE_PX = 160;

/** A width comfortably on the wide side of `breakpoint` — for cases that want the wide layout, not the switch. */
export function wideOf(breakpoint: number): number {
  return justAbove(breakpoint) + CLEARANCE_PX;
}

/**
 * The window's content box for every case. Fixed, because the baselines are pixels — but
 * fixed RELATIVE to the breakpoint, not next to it. Height has no breakpoint to answer to.
 */
export const CONTENT_SIZE = { width: wideOf(WIDE_MIN_PX), height: 800 };
