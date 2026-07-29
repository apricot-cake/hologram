// The React island's single entry point into the View Transitions API (#252).
//
// It used to be started from the vanilla density module (services/grid-density-builder.ts),
// wrapping ITS re-render — which only worked because that re-render reached React through a
// bridge that commits synchronously. #154 P3 removes that layer, so the start point moves
// to the side that owns the state.
//
// Three things this module exists to get right. All three fail SILENTLY — no throw, no
// console message, the animation simply doesn't play — which is indistinguishable from
// "it works" unless you watch the frames:
//   - The API captures only the DOM changes the callback makes BEFORE it returns, so the
//     update runs inside flushSync. React's default async batching would land the change
//     after the callback and nothing would animate.
//   - A `view-transition-name` that appears twice among rendered elements aborts the WHOLE
//     transition, not just the two elements. So the names are checked against the live DOM
//     first, and a clash costs this one animation instead of leaving a broken one in place.
//   - prefers-reduced-motion has to be honored here rather than in CSS: the global
//     reduced-motion short-circuit in globals.css targets element selectors and never
//     reaches the ::view-transition-* pseudo tree.
import { flushSync } from 'react-dom';

/** The elements to capture individually, each with the name it must carry. */
export type ViewTransitionCapture = Map<HTMLElement, string>;

const prefersReducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Whether a transition would actually play right now (API present, motion allowed). */
export function canViewTransition(): boolean {
  return typeof document.startViewTransition === 'function' && !prefersReducedMotion();
}

// Every name this module hands out is stamped as an inline style, so the inline style
// attribute is a complete index of the DYNAMIC names live in the document — including
// leftovers from a transition whose cleanup never ran, which is the case worth catching.
//
// The legacy sheet (index.html) also names five elements from CSS — post-grid,
// hologram-tabbar / -sidebar / -activebar / -backtotop — which this scan does not see.
// It does not have to: those are a fixed, hand-written set, and callers namespace their
// dynamic names by prefix (grid/density-transition.ts uses `post-card-`), so the two sets
// cannot meet. A new caller has to keep that true — pick a prefix no static name uses.
function namesInDocument(except: ViewTransitionCapture): Set<string> {
  const names = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')) {
    if (except.has(el)) continue;
    const name = el.style.viewTransitionName;
    if (name && name !== 'none') names.add(name);
  }
  return names;
}

/** True when `capture` would put one name on two elements, counting names already in the DOM. */
function hasDuplicateName(capture: ViewTransitionCapture): boolean {
  const taken = namesInDocument(capture);
  for (const name of capture.values()) {
    if (taken.has(name)) return true;
    taken.add(name);
  }
  return false;
}

/**
 * Run `update` as a View Transition when the environment allows one, and as a plain call
 * when it doesn't. `capture` (optional) supplies the elements to animate individually —
 * without it the transition is the root cross-fade the API gives by default.
 *
 * Never throws on the animation's behalf: a missing API, reduced motion, a name clash or a
 * rejected start all fall back to the same plain `update()`. The update itself is not
 * guarded — if it throws, that is a real failure and it surfaces.
 */
export function runViewTransition(update: () => void, capture?: () => ViewTransitionCapture): void {
  if (!canViewTransition()) {
    update();
    return;
  }
  const named = capture ? capture() : null;
  if (named && hasDuplicateName(named)) {
    update();
    return;
  }
  if (named) for (const [el, name] of named) el.style.viewTransitionName = name;
  const unname = () => {
    if (named) for (const el of named.keys()) el.style.removeProperty('view-transition-name');
  };
  let transition: ViewTransition;
  try {
    // Not called synchronously: the browser captures the old state first, then runs this.
    transition = document.startViewTransition(() => flushSync(update));
  } catch (_e) {
    unname();
    update();
    return;
  }
  // `finished` settles for a skipped transition too (a second one starting, the window
  // hiding) and rejects when the update callback threw — every path must still un-name, or
  // the leftovers become the duplicate that kills the NEXT transition.
  transition.finished.then(unname, unname);
}
