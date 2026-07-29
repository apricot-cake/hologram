// A grid's density switch — the post grid's gallery ⇄ list (+ info on/off) and the poster
// grid's card/tile/list — is the ONE surface in the redesign that uses a View Transition
// (#252, ADR 0014). It earns one because the cards land in different places: interpolating
// between two LAYOUTS is the thing CSS cannot express. Tabs, the sidebar, the inspector and
// the quick view all animate with CSS transitions and stay that way.
//
// Cards are named individually so each one moves to its new position, rather than the whole
// page cross-fading (the API's unnamed default, which is all the old vanilla start point
// got). Two limits on WHICH cards, both deliberate:
//   - Only the ones on screen. masonic mounts an overscan margin of cells that never paint
//     (cards are content-visibility:auto, so an offscreen one has no rendered content to
//     snapshot), and one snapshot per card stops being free once the size slider is pulled
//     back to overview zoom (#141) and hundreds fit at once.
//   - Only for the length of the transition. A live `view-transition-name` makes the element
//     a stacking context, and a grouped post card draws its "pile" with children at
//     z-index:-1/-2 — a permanent name would bury those sheets behind the card's own
//     background.
import { runViewTransition } from './view-transition.ts';
import type { ViewTransitionCapture } from './view-transition.ts';

// Both grids carry a stable per-card id on the card root as `data-key`: the post side is
// postIdKey(rep) — the group representative's captureId — and the poster side is the user
// aggregate's key (services/records.ts, services/poster-grid-builder.ts). The prefix keeps
// the two grids in separate namespaces and away from the five names the legacy sheet declares
// statically; the substitution only makes the value a valid CSS custom-ident. Two keys
// differing solely in a substituted character would collide, which is exactly what
// runViewTransition's duplicate check is there to catch.
const nameFor = (prefix: string, key: string) => `${prefix}-${key.replace(/[^\w-]/g, '_')}`;

// Both grids scroll inside #mode-post — the shared VirtualGridHost binds to that element
// directly — so there is one scroller to test visibility against either way.
function visibleCards(containerId: string, cardClass: string): ViewTransitionCapture {
  const capture: ViewTransitionCapture = new Map();
  const scroller = document.getElementById('mode-post');
  if (!scroller) return capture;
  const view = scroller.getBoundingClientRect();
  for (const card of document.querySelectorAll<HTMLElement>(`#${containerId} .${cardClass}[data-key]`)) {
    const r = card.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.bottom <= view.top || r.top >= view.bottom) continue;
    capture.set(card, nameFor(cardClass, card.dataset.key as string));
  }
  return capture;
}

/**
 * Run a density change — a hologramStore write, which the grid source turns into a
 * synchronous re-render — as a View Transition. One per grid: the two never switch
 * together (the popover shows the controls for the browse mode you are in).
 */
export function runPostDensityViewTransition(update: () => void): void {
  runViewTransition(update, () => visibleCards('postGrid', 'post-card'));
}

export function runPosterDensityViewTransition(update: () => void): void {
  runViewTransition(update, () => visibleCards('posterGrid', 'poster-card'));
}
