// Sizing shared between positioning.ts (where the corner's box has to be
// placed relative to) and control.ts (how big the circle inside it is drawn).
// One file so neither module has to import the other just to agree on a
// number.

// ONE size for every face this corner can wear. The faces used to differ (22px
// for the mark, the spinner and retry; 28px for the save button), which made
// the corner shrink at the exact moment it was reporting something: press the
// 28px button and the 22px spinner replaces it, then the 22px mark (user,
// 2026-07-29). 24px is the smallest that keeps the two PRESSABLE faces at
// WCAG 2.5.8's target minimum, and it is within 2px of the mark the design
// wanted to stay quiet — so nothing has to grow to hold the corner still.
// Retry was 22px before this, i.e. under that minimum: a real gap, not just a
// mismatch.
export const CONTROL_SIZE = 24;
export const CONTROL_INSET = 6;
