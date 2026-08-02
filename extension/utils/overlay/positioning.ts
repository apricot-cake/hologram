// The corner control's ANCHOR: which container it mounts into, where its
// left/top land, and whether the pointer is still "on" the picture it
// annotates (occlusion by a modal, a fixed header, or nothing left at all).
// Split out of overlay.ts by #399 -- #310's design note on the Issue explains
// why the numbers below are written inline !important rather than through a
// stylesheet.
//
// The three functions marked "pure" take plain rects and return plain
// numbers -- no DOM, no globals -- which is what lets scripts/overlay-
// positioning.test.ts exercise the main placement branches without a
// browser. Everything else here still touches the page (getBoundingClientRect,
// getComputedStyle, elementsFromPoint) because deciding "which element is the
// containing block" or "what is on top of this point" has no meaning apart
// from a live document; the acceptance bar (#399) is the placement MATH, not
// the whole module.
import type { OverlaySite, PostMediaElement } from '../extractor/types.ts';
import { CONTROL_INSET, CONTROL_SIZE } from './constants.ts';
import type { Anchor } from './types.ts';

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function rectHoldsPointer(r: RectLike, x: number, y: number): boolean {
  return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
}
// DOMRect carries right/bottom as getters; a plain RectLike (as built by a
// unit test) has to be given them explicitly. Accept either.
function right(r: RectLike): number {
  return (r as DOMRect).right ?? r.left + r.width;
}
function bottom(r: RectLike): number {
  return (r as DOMRect).bottom ?? r.top + r.height;
}

// PURE: the media-anchor placement in positionControl. `hostRect` is null
// when the control mounts directly on the box itself (no separate containing
// block was borrowed) -- in that case the corner sits at the fixed inset from
// the box's own top-left, since box and host are the same element.
export function computeMediaOffset(hostRect: RectLike | null, boxRect: RectLike, inset: number): { left: number; top: number } {
  if (!hostRect) return { left: inset, top: inset };
  return { left: boxRect.left - hostRect.left + inset, top: boxRect.top - hostRect.top + inset };
}

// PURE: the text-anchor placement in positionTextControl (#575). The mark
// sits on the avatar's own edge, at the 135-degree point on its circle (as an
// offset from its top-left corner), then backs off half the disc so that
// point becomes the disc's centre. See overlay.ts's history for the two
// placements measured and rejected before this one.
export function computeTextOffset(hostRect: RectLike, avatarRect: RectLike, controlSize: number): { left: number; top: number } {
  const radius = (avatarRect.width + avatarRect.height) / 4;
  const offset = Math.round(radius - radius * Math.SQRT1_2 - controlSize / 2);
  return { left: avatarRect.left - hostRect.left + offset, top: avatarRect.top - hostRect.top + offset };
}

// PURE: the X photo viewer's close-button avoidance in clearXViewerCloseButton.
// Keeps the left edge tied to the picture and moves the top down only far
// enough to clear any collision, re-checking up to 4 times in case clearing
// one button's bottom edge lands on another's.
export function resolveViewerCloseButtonClearance(hostRect: RectLike, left: number, top: number, controlSize: number, buttonRects: RectLike[]): number {
  let adjustedTop = top;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controlLeft = hostRect.left + left;
    const controlTop = hostRect.top + adjustedTop;
    const collisions = buttonRects.filter((rect) => rect.width > 0 && rect.height > 0 && controlLeft < right(rect) && controlLeft + controlSize > rect.left && controlTop < bottom(rect) && controlTop + controlSize > rect.top);
    if (!collisions.length) break;
    const nextTop = Math.max(adjustedTop, ...collisions.map((rect) => bottom(rect) - hostRect.top + CONTROL_INSET));
    if (nextTop === adjustedTop) break;
    adjustedTop = nextTop;
  }
  return adjustedTop;
}

// === DOM: choosing and borrowing the containing block ("the host") ===

// A media box holds an <img> until the platform's own player takes over: X
// swaps a video or GIF post's poster <img> for a <video poster="..."> as soon
// as the player initialises, and never puts the <img> back (#450). Looking
// for the <img> alone therefore found nothing on exactly the posts that were
// on screen, which is why the button never appeared on a playing video.
export function postMediaIn(box: Element): PostMediaElement | null {
  if (box.tagName === 'IMG' || box.tagName === 'VIDEO') return box as PostMediaElement;
  return box.querySelector('img, video');
}

export function controlHost(box: Element): HTMLElement | null {
  // A box that is itself absolutely/fixed positioned (Bluesky's image-fill
  // pattern: an <img style="position:absolute;inset:0"> inside a plain,
  // unsized wrapper) is already out of flow and has a containing block
  // further up the tree. Borrowing position:relative on its immediate
  // parent -- the general case below -- would silently replace that
  // containing block: the wrapper has no height of its own (its only
  // child is out of flow), so the picture collapses to 0 height for as
  // long as the control is mounted -- the "image blinks" half of #347,
  // confirmed live on bsky.app. Walk up to the ancestor that already
  // defines it instead of creating a new one.
  const boxPosition = box instanceof HTMLElement ? getComputedStyle(box).position : null;
  if (boxPosition === 'absolute' || boxPosition === 'fixed') {
    let node = box.parentElement;
    while (node && getComputedStyle(node).position === 'static') node = node.parentElement;
    return node;
  }
  // <img> cannot contain children. Its immediate parent shares its scroll
  // transform, while the platform-specific media boxes are their own hosts.
  return box instanceof HTMLImageElement ? box.parentElement : box instanceof HTMLElement ? box : null;
}

// The one thing that CANNOT go behind the shadow boundary: the containing
// block has to be an element of the page's own, so the borrowed
// `position: relative` is written onto the page's element and stays subject
// to the page's cascade. !important because a host rule as ordinary as
// `* { all: unset !important }` would otherwise win, and then the control is
// positioned against some ancestor further up and lands nowhere near its
// picture -- a silent failure, since the control still exists and still says
// the right thing. The previous inline value AND its priority are kept so
// unmounting puts the page back exactly as it was.
export function borrowHostPosition(anchor: Anchor, host: HTMLElement): void {
  anchor.hostInlinePosition = host.style.getPropertyValue('position');
  anchor.hostInlinePriority = host.style.getPropertyPriority('position');
  host.style.setProperty('position', 'relative', 'important');
}

export function restoreControlHost(anchor: Anchor): void {
  if (anchor.host && anchor.hostInlinePosition !== null && anchor.host.style.getPropertyValue('position') === 'relative') {
    if (anchor.hostInlinePosition) anchor.host.style.setProperty('position', anchor.hostInlinePosition, anchor.hostInlinePriority);
    else anchor.host.style.removeProperty('position');
  }
  anchor.host = null;
  anchor.hostInlinePosition = null;
  anchor.hostInlinePriority = '';
}

// Mounts the corner's host element into its containing block, borrowing
// `position: relative` first if the box did not already establish one.
// Returns false when no container could be found (nothing to mount into --
// paint() skips the anchor for this pass rather than leaving a half-mounted
// control).
export function mountControl(anchor: Anchor, el: HTMLElement): boolean {
  // A text anchor's box IS the post unit (#575): already positioned,
  // already the right size, nothing to walk up to find. controlHost()'s
  // static/absolute walk is for picking a media box's containing block,
  // which does not apply here.
  const host = anchor.kind === 'text' ? (anchor.box as HTMLElement) : controlHost(anchor.box);
  if (!host) return false;
  if (anchor.host !== host) {
    restoreControlHost(anchor);
    anchor.host = host;
    if (getComputedStyle(host).position === 'static') borrowHostPosition(anchor, host);
  }
  // A text anchor's mark lies over the avatar, which every platform makes a
  // link to the author's profile. The mark is never pressable (savable()
  // says so), so letting it swallow that corner of the link would take away
  // one of the page's own controls to say something the user did not ask
  // about.
  if (anchor.kind === 'text') el.style.setProperty('pointer-events', 'none', 'important');
  host.appendChild(el);
  return true;
}

// === DOM: where the numbers land ===

// X's photo viewer sometimes lets the picture itself reach the viewport's
// top-left. The normal image-corner placement then lands on the viewer's
// close button. Keep the left edge tied to the picture, but move down only
// far enough to clear any native button intersecting that one small corner.
// This is deliberately scoped to the viewer's stable swipe wrapper: feed
// pictures keep their ordinary 6px image-corner placement (#704).
export function clearXViewerCloseButton(box: Element, hostRect: RectLike, left: number, top: number): number {
  if (!box.closest('[data-testid="swipe-to-dismiss"]')) return top;
  const buttonRects = [...document.querySelectorAll('button[aria-label]')].map((button) => button.getBoundingClientRect());
  return resolveViewerCloseButtonClearance(hostRect, left, top, CONTROL_SIZE, buttonRects);
}

// A text-only post's mark (#575) RIDES THE AVATAR, the way a picture's mark
// rides the picture -- and on the SAME CORNER, top left. See
// computeTextOffset for the number this places.
export function positionTextControl(anchor: Anchor, host: HTMLElement, site: OverlaySite, place: (left: number, top: number) => void): void {
  const hostRect = host.getBoundingClientRect();
  const avatar = site.textAnchorIn?.(anchor.box)?.getBoundingClientRect();
  if (!avatar) return;
  const { left, top } = computeTextOffset(hostRect, avatar, CONTROL_SIZE);
  place(left, top);
}

export function positionControl(anchor: Anchor, el: HTMLElement, site: OverlaySite): void {
  const host = anchor.host;
  // !important for the same reason the rest of the host element's box is
  // (control.ts's CONTROL_HOST_STYLE): these two numbers are the difference
  // between the picture's corner and the top-left of whatever is containing
  // us.
  const place = (left: number, top: number) => {
    el.style.setProperty('left', `${left}px`, 'important');
    el.style.setProperty('top', `${top}px`, 'important');
  };
  if (anchor.kind === 'text') {
    positionTextControl(anchor, host || (anchor.box as HTMLElement), site, place);
    return;
  }
  if (!host || host === anchor.box) {
    const boxRect = anchor.box.getBoundingClientRect();
    const { left, top } = computeMediaOffset(null, boxRect, CONTROL_INSET);
    place(left, clearXViewerCloseButton(anchor.box, boxRect, left, top));
    return;
  }
  const hostRect = host.getBoundingClientRect();
  const boxRect = anchor.box.getBoundingClientRect();
  const { left, top } = computeMediaOffset(hostRect, boxRect, CONTROL_INSET);
  place(left, clearXViewerCloseButton(anchor.box, hostRect, left, top));
}

// === DOM: pointer occlusion (is the pointer really "on" this picture?) ===

// Is a MODAL layered over this anchor's picture -- a lightbox that ISN'T
// this one, a compose dialog? Blanket "any modal open" was the original
// rule (#347): it protects a picture sitting BEHIND a dialog, since the
// corner control is only ever z-index:1 within its own picture's stacking
// context and would be unreachable and visually wrong there. But X's own
// photo viewer is itself `[role="dialog"][aria-modal="true"]`, so that
// blanket rule made the viewer's own picture permanently unreachable too
// (#659) -- the one thing the guard was never meant to hide. A modal that
// CONTAINS the anchor is not covering it; it IS what is being looked at.
export function modalCovers(anchor: Anchor): boolean {
  return [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"]')].some((el) => {
    if (el.contains(anchor.box)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  });
}

// Is something LAYERED OVER the picture where the pointer is -- a lightbox, a
// page's own fixed header? Probed at the POINTER, not at the control: the
// control sits in the picture's top-left corner, so probing there answered
// "is that corner under the header", and scrolling a picture's top edge past
// x.com's header took the button away from a pointer resting on the middle
// of a fully visible picture (#347).
//
// Layers are only counted until the picture itself is reached, and only
// fixed/sticky ones: a site's OWN control drawn over the media (Bluesky's ALT
// badge, pixiv's bookmark heart) is an absolutely-positioned sibling inside
// the same stack, and hovering it is still hovering the picture (#338).
export function pointerIsOccluded(anchor: Anchor, pointerPosition: { x: number; y: number } | null): boolean {
  if (!pointerPosition) return false;
  if (typeof document.elementsFromPoint !== 'function') return false;
  for (const el of document.elementsFromPoint(pointerPosition.x, pointerPosition.y)) {
    if (el === anchor.box || anchor.box.contains(el) || el.contains(anchor.box)) return false;
    if (anchor.el && (el === anchor.el || anchor.el.contains(el))) return false;
    const position = getComputedStyle(el).position;
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
}

// Which anchor the pointer is inside -- by GEOMETRY, not the DOM tree. The
// earlier ancestor-walk ("which tracked box is an ancestor of what the
// pointer physically landed on") breaks on any site that lays its OWN control
// over the picture as a SIBLING of it: on Bluesky the pointer lands on the
// ALT/overlay div that sits on top of the <img>, and the <img> -- the box --
// is that div's sibling, never its ancestor, so the walk finds nothing
// (pixiv's bookmark heart is the same shape). A rect test doesn't care what
// is stacked on top, and it also keeps the control shown while the pointer is
// on it (the control sits inside the box's own rect). `anchors` is expected
// to be scoped to the on-screen anchors only (not every one ever tracked), so
// a crossing reads a handful of rects at most.
export function anchorAtPoint(anchors: Iterable<Anchor>, x: number, y: number): Anchor | null {
  let hit: Anchor | null = null;
  let hitArea = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const r = anchor.box.getBoundingClientRect();
    if (!rectHoldsPointer(r, x, y) || modalCovers(anchor)) continue;
    // Smallest box wins where they overlap, so a picture inside a quoted
    // post is preferred over the outer post's own picture behind it.
    const area = r.width * r.height;
    if (area < hitArea) {
      hitArea = area;
      hit = anchor;
    }
  }
  return hit;
}

// THE question every clear path has to ask, and the only reason any of them
// may drop a hover: is the pointer still on this picture? Everything that can
// hide the control goes through here, so "the button stays while the cursor
// is on the picture" is a property of the code rather than something each
// path has to remember (#347).
export function pointerStillOn(anchor: Anchor | null, pointerPosition: { x: number; y: number } | null): boolean {
  if (!anchor || !pointerPosition) return false;
  if (!anchor.box.isConnected || modalCovers(anchor)) return false;
  if (!rectHoldsPointer(anchor.box.getBoundingClientRect(), pointerPosition.x, pointerPosition.y)) return false;
  return !pointerIsOccluded(anchor, pointerPosition);
}
