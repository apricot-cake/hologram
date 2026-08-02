// Shared shapes for the timeline overlay's split modules (#399). One file so
// tracker.ts, saved-state.ts, positioning.ts, control.ts and the controller
// (overlay.ts) describe the same Anchor/UnitState without importing each
// other just to reach a type.

// What the corner is doing right now. `flash` is the moment after a save the
// user made here: the mark shows even when marks are set to "never", because
// the button they just pressed has to answer them.
export type Phase = 'idle' | 'saving' | 'flash' | 'error';
// What the corner is drawing. null = nothing there.
export type Face = 'mark' | 'save' | 'busy' | 'failed';
// How the "saved" mark is shown (options page). Default `always`: the mark
// is a status indicator, and part of its job is sparing the user the
// "did I save this?" question before it is consciously asked — which only
// a resting mark can do. Hover remains for anyone who finds that noisy (#309).
export type MarkMode = 'always' | 'hover' | 'off';

export interface Anchor {
  box: Element; // the media box whose corner this control sits on
  // 'text' (#575): box is the whole POST unit, not a picture — there isn't
  // one. The mark still needs somewhere to sit, so it borrows the unit's own
  // box (already positioned, already sized) instead of a media element's.
  // Everything that would try to treat this anchor as a save target (the
  // button face, per-picture key matching) short-circuits on this instead.
  kind: 'media' | 'text';
  el: HTMLElement | null; // <hologram-corner-control>, in the page's subtree
  root: ShadowRoot | HTMLElement | null; // what el's face is drawn inside
  control: HTMLDivElement | HTMLButtonElement | null; // the disc itself
  host: HTMLElement | null; // positioned parent that scrolls with the media
  hostInlinePosition: string | null; // restores an inline position we added
  hostInlinePriority: string; // ...and the priority it was written with
  face: Face | null; // what el currently draws (so a re-render can skip)
  phase: Phase;
  timer: ReturnType<typeof setTimeout> | null; // clears phase back to idle
}

// What the library holds for one post, as far as this side can compare it
// (#334). The bridge answers with the post's saved pictures; `keys` are the
// ones whose URL can be matched against the page's, `seqs` the positions of
// those the library kept no URL for. `whole` is the honest fallback — the
// post is in the library but its pictures cannot be told apart (a text-only
// post, a record saved before per-picture answers, a video whose page-side
// counterpart is only a poster frame) — and it marks the post exactly the
// way this overlay did before per-picture answers existed.
export interface SavedPictures {
  whole: boolean;
  keys: Set<string>;
  seqs: Set<number>;
}

export interface UnitState {
  url: string | null;
  saved: SavedPictures | null; // null = not in the library (or not asked yet)
  anchors: Map<Element, Anchor>;
}
