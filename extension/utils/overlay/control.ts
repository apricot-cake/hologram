// The corner's FACE: the host element's own shadow-isolated box (#310), the
// disc drawn inside it, and which of the four faces (mark/save/busy/failed)
// a given moment calls for. Split out of overlay.ts by #399. Knows nothing
// about scrolling, saved-state batching, or the save network call itself --
// callers hand it what to show and a couple of callbacks for the two
// pressable faces.
import { ICONS, makeIcon, makeSpinner } from '../icons.ts';
import type { MediaIdentitySite } from '../extractor/types.ts';
import { userOnly } from '../user-gesture.ts';
import { token } from '../tokens.ts';
import { restoreControlHost, postMediaIn } from './positioning.ts';
import { anchorSaved } from './saved-state.ts';
import type { Anchor, Face, MarkMode, UnitState } from './types.ts';
import { CONTROL_SIZE } from './constants.ts';

// The shadow host. A hyphenated name is what makes attachShadow legal on an
// element the HTML parser has never heard of, and it is the name a host page
// would have to write to target us at all.
export const CONTROL_TAG = 'hologram-corner-control';
// The host element's own box -- the only part of this control the page's
// cascade can still reach, so every declaration is inline !important (nothing
// an author stylesheet can write outranks that). `all: initial` comes first
// and is the reason the rest follows: it drops the inherited font, colour,
// line-height and text rendering the page would otherwise push through the
// shadow boundary. It does NOT reset custom properties, which is exactly why
// the --hologram-* tokens still arrive inside.
export const CONTROL_HOST_STYLE: Array<[string, string]> = [
  ['all', 'initial'],
  ['position', 'absolute'],
  ['display', 'block'],
  ['width', `${CONTROL_SIZE}px`],
  ['height', `${CONTROL_SIZE}px`],
  ['pointer-events', 'auto'],
  // Above the picture, below anything the page raises on purpose: this is an
  // annotation on someone else's content, not a layer over it.
  ['z-index', '1'],
];
// The two faces that are an ACTION rather than a report. Everything that
// follows from "this one can be pressed" -- the native <button> element, the
// accessible name, the tab stop, the pointer cursor -- is decided from this
// one predicate, so a face cannot be pressable and yet miss part of what
// being pressable requires. Retry used to (#536): the per-face code restored
// the name and the tab stop for `save` only, leaving retry a nameless button
// at tabIndex -1, i.e. the recovery from a failed save was reachable by
// pointer alone.
export const isPressable = (face: Face) => face === 'save' || face === 'failed';
// A picture too small to be the point of the post: a quote-preview thumbnail,
// an avatar-sized decoration. Saving those is almost never meant.
export const MIN_SAVE_PX = 100;

// Would a save here produce an honest record? Src pattern (media-identity's
// per-platform rule), a resolvable post, and a picture big enough to be the
// point of the post -- all three, or no button.
export function savable(anchor: Anchor, rect: DOMRect, media: MediaIdentitySite | null): boolean {
  // The save button stays out of scope for a text-only post (#575 covers
  // the mark only -- #122's right-click menu is the save route there).
  if (anchor.kind === 'text') return false;
  if (!media) return false;
  if (rect.width < MIN_SAVE_PX || rect.height < MIN_SAVE_PX) return false;
  const el = postMediaIn(anchor.box);
  if (!el || !media.isPostMedia(el)) return false;
  return media.extractIdentity(el) != null;
}

export interface FaceContext {
  state: UnitState;
  anchor: Anchor;
  index: number;
  rect: DOMRect;
  markMode: MarkMode;
  hoverSave: boolean;
  hoveredAnchor: Anchor | null;
  media: MediaIdentitySite | null;
}

export function faceFor(ctx: FaceContext): Face | null {
  const { state, anchor, index, rect, markMode, hoverSave, hoveredAnchor, media } = ctx;
  if (anchor.phase === 'saving') return 'busy';
  if (anchor.phase === 'error') return 'failed';
  if (anchor.phase === 'flash') return 'mark';
  if (anchorSaved(state, anchor, index, media)) {
    if (markMode === 'off') return null;
    // Shown at all times, the mark goes on every picture it can answer for:
    // that is what tells a partly-saved post apart from a fully-saved one
    // (#334). When all that is known is that the POST is saved, one mark on
    // the first picture is the whole of the answer, and claiming more would
    // say something about pictures nobody asked the library about.
    if (markMode === 'always') return !state.saved?.whole || index === 0 ? 'mark' : null;
    // Shown on hover it goes on the picture being asked about.
    return hoveredAnchor === anchor ? 'mark' : null;
  }
  if (!hoverSave || hoveredAnchor !== anchor) return null;
  return savable(anchor, rect, media) ? 'save' : null;
}

// The page-side host element plus the place its face is drawn. The shadow
// root is the isolation; the fallback to the host element itself is the same
// "an unstyled control still saves the picture" rule the rest of this file
// follows -- attachShadow only fails on a document that could not take one,
// and losing the save there would be a far worse trade than losing the
// boundary.
export function makeControlHost(): { el: HTMLElement; root: ShadowRoot | HTMLElement } {
  const el = document.createElement(CONTROL_TAG);
  for (const [property, value] of CONTROL_HOST_STYLE) el.style.setProperty(property, value, 'important');
  el.setAttribute('data-hologram-overlay', '');
  let root: ShadowRoot | HTMLElement = el;
  try {
    root = el.attachShadow({ mode: 'open' });
  } catch {
    /* see above */
  }
  return { el, root };
}

// The disc itself, inside the shadow root. Styled inline rather than through
// a stylesheet: inline needs no CSSStyleSheet constructor (jsdom has none)
// and no <style> element (a host serving `style-src 'none'` kills those even
// inside a shadow root -- #270 measured it), and inside a shadow tree there is
// no host cascade left to beat, so the usual reason to prefer classes is gone.
export function makeControl(anchor: Anchor, pressable: boolean): HTMLDivElement | HTMLButtonElement {
  const el = document.createElement(pressable ? 'button' : 'div');
  if (el instanceof HTMLButtonElement) el.type = 'button';
  el.style.cssText = [
    `width:${CONTROL_SIZE}px`,
    `height:${CONTROL_SIZE}px`,
    'border-radius:50%',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'box-sizing:border-box',
    'margin:0',
    `border:1px solid ${token.overlayBorder}`,
    // Its own shadow, not the card's (#310 -- tokens.source.css).
    `box-shadow:${token.controlShadow}`,
    // No width/height/border-radius here: #531 gave all four faces the
    // same 24px circle, so those can no longer differ between faces and
    // an animation on them has nothing left to animate.
    `transition:background ${token.durationBase},color ${token.durationBase},border-color ${token.durationBase},box-shadow ${token.durationBase},transform ${token.durationBase} ${token.easeOut}`,
    'appearance:none',
    `font-family:${token.fontSans}`,
  ].join(';');
  anchor.root?.replaceChildren(el);
  anchor.control = el;
  return el;
}

export function stopPress(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}

export interface DrawFaceCallbacks {
  onSave(): void;
  onRetry(): void;
}

// What being pressable brings with it, in one place rather than per face:
// the element type, the tab stop, the cursor, and the accessible name below
// (it needs the face's own sentence, which the switch writes).
//
// A `title` was never a substitute for the accessible name: support for
// falling back to it varies by assistive technology, and it is never
// announced to someone who arrived by keyboard. #310 removes the tooltip
// rather than reimplementing it -- see overlay.ts's history for the full
// reasoning (the mark states a fact and is not something to operate; the
// two pressable faces owe the user a sentence, but the place for it is the
// name, or the save banner for the longer story).
export function drawFace(anchor: Anchor, face: Face, t: (key: string) => string, callbacks: DrawFaceCallbacks): void {
  const pressable = isPressable(face);
  // The saved/busy faces are status indicators, whereas save/retry are
  // actual actions. Recreate on that boundary so an icon-only action keeps
  // the browser's native button semantics instead of imitating them.
  let el = anchor.control;
  if (!el || el instanceof HTMLButtonElement !== pressable) el = makeControl(anchor, pressable);
  el.replaceChildren();
  el.onclick = null;
  el.onpointerdown = null;
  el.onpointerenter = null;
  el.onpointerleave = null;
  el.tabIndex = pressable ? 0 : -1;
  el.style.cursor = pressable ? 'pointer' : '';
  // A status face is a graphic that states a fact; `img` is what makes it one
  // object with one name rather than an empty <div> assistive tech skips. A
  // pressable face is already a <button> and must not be told it is anything
  // else.
  if (pressable) el.removeAttribute('role');
  else el.setAttribute('role', 'img');
  // The default fill for the corner, whatever it is saying: a translucent
  // disc, because this thing sits on the user's own picture. Only `failed`
  // below trades it away, for the danger fill.
  el.style.background = token.controlSurface;
  el.style.color = token.ink;
  el.style.width = `${CONTROL_SIZE}px`;
  el.style.height = `${CONTROL_SIZE}px`;
  el.style.padding = '0';
  el.style.gap = '0';
  el.style.borderRadius = '50%';
  el.style.borderColor = token.overlayBorder;
  el.style.boxShadow = token.controlShadow;
  el.style.transform = '';
  let name: string;
  switch (face) {
    case 'mark':
      // Monotone check (not the accent): the mark states a fact about the
      // post, it is not an action to take, so it stays out of the accent's
      // vocabulary -- which is exactly what tells it apart from the button
      // that shares this corner.
      name = t('cornerSaved');
      el.appendChild(makeIcon(ICONS.check, 14));
      break;
    case 'save': {
      name = t('cornerSave');
      el.style.color = token.ink;
      el.appendChild(makeIcon(ICONS.drop, 14));
      // Both handlers stop the event: the control is outside the post's
      // subtree, but x.com and bsky.app listen on the document, and a press
      // that reached them would open the lightbox behind the save.
      el.onpointerdown = stopPress;
      el.onpointerenter = () => {
        // The hover lift changes the disc's COLOUR, not its opacity: going
        // solid on hover would undo the translucency exactly where the
        // pointer is, which is where the picture is being looked at.
        el.style.background = token.controlSurfaceHover;
        el.style.boxShadow = `${token.controlShadow}, 0 0 0 2px ${token.controlHoverGlow}`;
        el.style.transform = 'scale(1.04)';
      };
      el.onpointerleave = () => {
        el.style.background = token.controlSurface;
        el.style.borderColor = token.overlayBorder;
        el.style.boxShadow = token.controlShadow;
        el.style.transform = '';
      };
      // A trusted press only (#323). This control is a child of the picture
      // it annotates, so the page can find it and click it, and this route
      // saves without any further confirmation.
      el.onclick = userOnly<MouseEvent>((e) => {
        stopPress(e);
        callbacks.onSave();
      });
      break;
    }
    case 'busy':
      name = t('cornerSaving');
      el.appendChild(makeSpinner(14));
      break;
    case 'failed':
      // A failure is not a dead end: pressing it again retries straight
      // away, and it returns to a plain button on its own.
      name = t('cornerRetry');
      el.onpointerdown = stopPress;
      el.onclick = userOnly<MouseEvent>((e) => {
        stopPress(e);
        callbacks.onRetry();
      });
      el.style.background = token.danger;
      el.style.color = token.onDanger;
      el.appendChild(makeIcon(ICONS.cross, 14));
      break;
  }
  el.setAttribute('aria-label', name);
}

export function removeControl(anchor: Anchor): void {
  anchor.el?.remove();
  anchor.el = null;
  anchor.root = null;
  anchor.control = null;
  anchor.face = null;
  restoreControlHost(anchor);
}

export function clearControls(state: UnitState): void {
  for (const [, anchor] of state.anchors) removeControl(anchor);
}
