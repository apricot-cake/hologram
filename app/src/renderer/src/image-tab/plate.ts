// The tone of the image view's floating controls (P2⑫) — prev/next, the slide counter,
// the inspector toggle, the ugoira play button. One translucent, blurred plate for all
// of them, so a stage that fills the window does not end up with four different ideas of
// what a control looks like. Before this they were .itv-nav / .itv-counter / .icon-btn:
// three hand-mixed color-mix fills and a 28px "‹" text glyph standing in for an icon.
//
// The BORDER is not decoration. A translucent surface tinted from --background has no
// edge of its own against an image whose corner happens to be that same color, and a
// white artwork is the common case here — measured in the sandbox, the plate simply
// vanished and left the chevron floating. Every viewer these are modelled on (Windows
// Photos / Eagle / IrfanView) gives the control a definite boundary for the same reason.
//
// Its own module rather than an export off ImageTab.tsx: UgoiraPlayer is ImageTab's
// child, so importing back up would be a cycle.
export const PLATE_SURFACE = 'border-border bg-background/80 shadow-xs backdrop-blur-sm';
export const PLATE = `${PLATE_SURFACE} text-muted-foreground hover:bg-background hover:text-foreground`;
