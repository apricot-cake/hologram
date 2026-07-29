// The post grid's density switch (gallery ⇄ list, info on/off) is the ONE surface in the
// redesign that uses a View Transition (#252). It earns one because the cards land in
// different places: interpolating between two LAYOUTS is the thing CSS cannot express.
// Tabs, the sidebar, the inspector and the quick view all animate with CSS transitions and
// stay that way.
//
// Cards are named individually so each one moves to its new position, rather than the whole
// page cross-fading (the API's unnamed default, which is all the old vanilla start point
// got). Two limits on WHICH cards, both deliberate:
//   - Only the ones on screen. masonic mounts an overscan margin of cells that never paint
//     (.post-card is content-visibility:auto, so an offscreen card has no rendered content
//     to snapshot), and one snapshot per card stops being free once the size slider is
//     pulled back to overview zoom (#141) and hundreds fit at once.
//   - Only for the length of the transition. A live `view-transition-name` makes the element
//     a stacking context, and a grouped card draws its "pile" with children at z-index:-1/-2
//     — a permanent name would bury those sheets behind the card's own background.
import { runViewTransition } from '../_shared/view-transition.ts';
import type { ViewTransitionCapture } from '../_shared/view-transition.ts';

// data-key is postIdKey(rep) — the group representative's captureId (services/records.ts) —
// so it is already the per-card unique id the transition needs. The prefix and the substitution
// only make it a valid CSS custom-ident; two keys that differ solely in a substituted character
// would collide, which is what runViewTransition's duplicate check is there to catch.
const nameFor = (key: string) => `post-card-${key.replace(/[^\w-]/g, '_')}`;

function visibleCards(): ViewTransitionCapture {
  const capture: ViewTransitionCapture = new Map();
  const scroller = document.getElementById('mode-post');
  if (!scroller) return capture;
  const view = scroller.getBoundingClientRect();
  for (const card of document.querySelectorAll<HTMLElement>('#postGrid .post-card[data-key]')) {
    const r = card.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.bottom <= view.top || r.top >= view.bottom) continue;
    capture.set(card, nameFor(card.dataset.key as string));
  }
  return capture;
}

/**
 * Run a post-grid density change — a hologramStore write, which the grid source turns into a
 * synchronous re-render — as a View Transition.
 */
export function runDensityViewTransition(update: () => void): void {
  runViewTransition(update, visibleCards);
}
