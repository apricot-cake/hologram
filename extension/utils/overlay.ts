// Persistent content script (manifest content_scripts for x / bsky / pixiv).
// The extension's timeline overlay: one control in the corner of a post's
// picture that both ANSWERS and ACTS —
//
//   already in the library → a "saved" mark (#54)
//   not in the library yet → a save button on hover (#94)
//
// They are one system, not two features: the state decides which face the
// corner shows, so the user learns a single place to look.
//
// The answer comes from the native host via background.js (see queryBridge
// there): the host reads the library's own index, so this works with the desktop
// app closed. Nothing about the page is sent anywhere — the only thing that
// leaves the tab is a permalink the page itself published, and it goes to a local
// process. Permalink extraction is the extractor's capture phase, the same
// function the Alt+S capture path uses, so a mark can never disagree with what
// a save would record; the save button goes through the same extractor's media
// identity, which is what drag.ts saves with, for the same reason.
//
// Hover is DERIVED, never accumulated: the control is shown on the picture the
// pointer is geometrically inside, and the only thing that may take it away is
// that same geometry saying the pointer is no longer on it (or something
// fixed/sticky being layered over the pointer). Scrolling, an intersection
// change, a re-render of the page's own markup — none of those decide anything
// by themselves; they only move pictures, after which geometry is asked again.
// Every path goes through pointerStillOn(), so "the button stays while the
// cursor is on the picture" holds by construction rather than by each path
// remembering to check (#347).
//
// Each control is an absolutely-positioned child of its media box (or, for an
// <img>, its immediate parent). That makes the browser move it in the same
// composited scroll as the picture. A fixed layer that copies viewport
// coordinates has to wait for JavaScript on every scroll frame and visibly
// trails smooth scrolling.
import { SAVE_WATCHDOG_MS } from './deadline.ts';
import { collectImageUrls, getCaptureSite, getMediaIdentitySite, getOverlaySite, mediaKeyOf, mediaKeysOf } from './extractor/index.ts';
import type { CaptureSite, OverlaySite, PostMediaElement } from './extractor/types.ts';
import { ICONS, makeIcon, makeSpinner } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { ensureTokens, motion, prefersReducedMotion, token } from './tokens.ts';
import { createI18n } from './i18n.ts';
import type { BackgroundToContentMessage, CheckSavedMessage, CheckSavedResponse, ImageDraggedMessage, SavedEntry, SaveResponse } from './messages.ts';

let overlayActive = false;

export async function startOverlay(): Promise<void> {
  // What the corner is doing right now. `flash` is the moment after a save the
  // user made here: the mark shows even when marks are set to "never", because
  // the button they just pressed has to answer them.
  type Phase = 'idle' | 'saving' | 'flash' | 'error';
  // What the corner is drawing. null = nothing there.
  type Face = 'mark' | 'save' | 'busy' | 'failed';
  // How the "saved" mark is shown (options page). Default `always`: the mark
  // is a status indicator, and part of its job is sparing the user the
  // "did I save this?" question before it is consciously asked — which only
  // a resting mark can do. Hover remains for anyone who finds that noisy (#309).
  type MarkMode = 'always' | 'hover' | 'off';

  interface Anchor {
    box: Element; // the media box whose corner this control sits on
    el: HTMLDivElement | HTMLButtonElement | null;
    host: HTMLElement | null; // positioned parent that scrolls with the media
    hostInlinePosition: string | null; // restores an inline position we added
    face: Face | null; // what el currently draws (so a re-render can skip)
    phase: Phase;
    timer: ReturnType<typeof setTimeout> | null; // clears phase back to idle
    // Tooltip override from the last save attempt (why it failed; that the post
    // info was missing). Lives on the anchor, not on the element: the element is
    // rebuilt every time the corner changes face, and a title written straight
    // onto it would either be lost or outlive what it described.
    note: string | null;
  }

  // What the library holds for one post, as far as this side can compare it
  // (#334). The bridge answers with the post's saved pictures; `keys` are the
  // ones whose URL can be matched against the page's, `seqs` the positions of
  // those the library kept no URL for. `whole` is the honest fallback — the
  // post is in the library but its pictures cannot be told apart (a text-only
  // post, a record saved before per-picture answers, a video whose page-side
  // counterpart is only a poster frame) — and it marks the post exactly the way
  // this overlay did before per-picture answers existed.
  interface SavedPictures {
    whole: boolean;
    keys: Set<string>;
    seqs: Set<number>;
  }

  interface UnitState {
    url: string | null;
    saved: SavedPictures | null; // null = not in the library (or not asked yet)
    anchors: Map<Element, Anchor>;
  }

  const MARK_MODE_KEY = 'savedBadgeMode'; // chrome.storage.local, 'always' | 'hover' | 'off'
  const HOVER_SAVE_KEY = 'hoverSaveButton'; // chrome.storage.local, boolean
  const QUERY_DEBOUNCE_MS = 300; // one batch per scroll burst, not per post
  // Ends a scroll burst before clearing the control that scrolled out from
  // under a stationary pointer. This never delays a real pointer hover.
  const SCROLL_HOVER_SETTLE_MS = 100;
  const SCAN_DEBOUNCE_MS = 250; // feed mutations arrive in floods
  const CONTROL_SIZE = 22;
  // This remains visually close to the 22px saved mark, while the actual
  // pointer target meets WCAG's 24px minimum for an icon-only control.
  const SAVE_SIZE = 28;
  const CONTROL_INSET = 6;
  const FLASH_MS = 1400; // "saved" confirmation after a press
  const ERROR_MS = 2500; // failure shown, then back to a button to retry
  const ERROR_BANNER_MS = 2800; // same readable dwell as the Alt+S failure banner
  // A picture too small to be the point of the post: a quote-preview thumbnail,
  // an avatar-sized decoration. Saving those is almost never meant.
  const MIN_SAVE_PX = 100;
  // Enter/leave the query set well before a post is on screen, so a mark is
  // already decided by the time the user can see the post.
  const OBSERVER_MARGIN = '200px';
  // A whole feed's worth of units is capped so a runaway page (infinite scroll
  // that never unmounts) cannot grow this map without bound.
  const MAX_TRACKED = 600;

  const detected = getOverlaySite();
  if (!detected) return;
  // The extractor's capture phase owns permalink extraction and its media
  // identity owns "which post is this picture from"; both come from the same
  // site module as the overlay shape above. Resolved once, not per post.
  const detectedCapture = getCaptureSite();
  if (!detectedCapture) return;
  // Re-bound as already-narrowed consts: TS does not carry a null-narrowing
  // into the closures below (same constraint drag.ts's DropZone works around).
  const site: OverlaySite = detected;
  const capture: CaptureSite = detectedCapture;
  // May be null on a page media-identity has no rules for: marks still work
  // (they only need a permalink), the save button simply never appears.
  const media = getMediaIdentitySite();
  if (overlayActive) return;
  overlayActive = true;

  // #311: capture.ts (a separate, on-demand content script sharing this same
  // isolated world — see __hologramAutoCapture/__snsPostSaveCleanup for the
  // established pattern) screenshots the tab with chrome.tabs.captureVisibleTab,
  // which shoots whatever is drawn on screen, this overlay's corner included.
  // Every control carries the same data attribute, so one query finds them
  // all — no per-control tracking needed. Only the pointer being still (which
  // it is, mid-capture) keeps new ones from appearing in the couple of
  // repaint frames this stays in effect, same as the highlight/banner hide
  // right next to this call in capture.ts.
  window.__hologramPrepareOverlayForCapture = () => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-hologram-overlay]'));
    const previousDisplay = controls.map((el) => el.style.display);
    controls.forEach((el) => {
      el.style.display = 'none';
    });
    return () => {
      controls.forEach((el, i) => {
        el.style.display = previousDisplay[i] ?? '';
      });
    };
  };

  // The palette is generated from the app's design tokens and follows the
  // browser's light/dark setting (#270 — see tokens.ts).
  ensureTokens();

  let markMode: MarkMode = 'always';
  let hoverSave = true;
  let failureBanner: StatusSurface | null = null;
  let failureBannerTimer: ReturnType<typeof setTimeout> | null = null;
  const tracked = new Map<Element, UnitState>();
  const anchorOf = new Map<Element, { unit: Element; anchor: Anchor }>(); // media box -> its anchor
  const visible = new Set<Element>();
  const pending = new Set<Element>();
  let queryTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let repositionQueued = false;
  let repositionFrame: number | null = null;
  let repositionFull = false;
  let hovered: Anchor | null = null;
  let pointerPosition: { x: number; y: number } | null = null;
  let scrollHoverTimer: ReturnType<typeof setTimeout> | null = null;
  // True from the first scroll event of a burst until it settles. While it is
  // set, layout moving under a resting pointer may CLEAR a hover but never
  // hand it to another picture, so a stationary pointer does not pick up every
  // image that scrolls beneath it (#347).
  let inScrollBurst = false;

  const { getMessage: t, partialSaveText, saveFailureText } = await createI18n();

  // === settings ===

  chrome.storage.local.get([MARK_MODE_KEY, HOVER_SAVE_KEY], (got) => {
    if (chrome.runtime.lastError) return; // storage unavailable — stay on the defaults
    applySettings(got[MARK_MODE_KEY], got[HOVER_SAVE_KEY]);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes[MARK_MODE_KEY] && !changes[HOVER_SAVE_KEY]) return;
    applySettings(changes[MARK_MODE_KEY] ? changes[MARK_MODE_KEY].newValue : markMode, changes[HOVER_SAVE_KEY] ? changes[HOVER_SAVE_KEY].newValue : hoverSave);
  });

  function applySettings(mode: unknown, save: unknown) {
    const wantedMode: MarkMode = mode === 'hover' || mode === 'off' ? mode : 'always';
    const wantedSave = save !== false;
    if (wantedMode === markMode && wantedSave === hoverSave) return;
    const wasAsking = queriesWanted();
    markMode = wantedMode;
    hoverSave = wantedSave;
    paintAll();
    // Both faces off means there is nothing to answer, so the overlay stops
    // asking the host anything at all; turning either back on re-asks for what
    // is on screen right now.
    if (!wasAsking && queriesWanted()) {
      for (const unit of visible) pending.add(unit);
      scheduleQuery();
    }
  }

  function queriesWanted(): boolean {
    return markMode !== 'off' || hoverSave;
  }

  // === discovery ===

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.add(entry.target);
          const state = tracked.get(entry.target);
          // Painted even while the answer is unknown: that is what registers
          // the post's pictures as hover targets, and the save button is
          // offered on anything not known to be saved.
          if (state) paint(entry.target, state);
          if (!state?.saved) pending.add(entry.target);
        } else {
          visible.delete(entry.target);
          pending.delete(entry.target);
          const state = tracked.get(entry.target);
          // Off-screen posts keep their ANSWER (scrolling back is free) but drop
          // their controls, so the layer only ever holds what's on screen.
          if (state) clearControls(state);
        }
      }
      // An intersection change is layout, not pointer input: mid-scroll it may
      // not hand the hover to another picture, which is what made a stationary
      // pointer pick up every image passing beneath it (#347).
      updateHoveredAtPointer(!inScrollBurst);
      scheduleQuery();
    },
    { rootMargin: OBSERVER_MARGIN },
  );

  function scan() {
    if (tracked.size >= MAX_TRACKED) forgetDetached();
    for (const unit of Array.from(document.querySelectorAll(site.unitSelector))) {
      if (tracked.has(unit)) continue;
      if (tracked.size >= MAX_TRACKED) break;
      tracked.set(unit, { url: null, saved: null, anchors: new Map() });
      io.observe(unit);
    }
  }

  // Units the page has unmounted (SPA navigation, feed recycling). Dropped
  // lazily rather than watched: a removal observer on x.com's feed fires
  // constantly for nodes we don't track.
  function forgetDetached() {
    for (const [unit, state] of tracked) {
      if (unit.isConnected) continue;
      io.unobserve(unit);
      visible.delete(unit);
      pending.delete(unit);
      clearControls(state);
      for (const box of state.anchors.keys()) anchorOf.delete(box);
      state.anchors.clear();
      tracked.delete(unit);
    }
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, SCAN_DEBOUNCE_MS);
  }

  new MutationObserver((records) => {
    const childrenChanged = records.some((record) => record.type === 'childList');
    const modalChanged = records.some((record) => record.type === 'attributes' && record.target instanceof Element && record.target.matches('dialog, [role="dialog"], [aria-modal]'));
    if (hovered && (childrenChanged || modalChanged)) {
      if (!hovered.box.isConnected) rehomeHover(hovered);
      else if (!pointerStillOn(hovered)) setHovered(null);
    }
    if (childrenChanged) scheduleScan();
  }).observe(document.documentElement, {
    childList: true,
    attributes: true,
    attributeFilter: ['aria-modal', 'class', 'hidden', 'open', 'style'],
    subtree: true,
  });
  scan();

  // === asking ===

  function scheduleQuery() {
    if (queryTimer || !pending.size) return;
    queryTimer = setTimeout(() => {
      queryTimer = null;
      flushQuery();
    }, QUERY_DEBOUNCE_MS);
  }

  function flushQuery() {
    if (!queriesWanted() || !chrome.runtime?.id) {
      pending.clear();
      return;
    }
    // url -> the units showing that post. One permalink can appear twice on a
    // page (a post and its own quote-preview), and both should light up.
    const byUrl = new Map<string, Element[]>();
    for (const unit of pending) {
      const state = tracked.get(unit);
      if (!state) continue;
      if (state.url === null) state.url = permalinkOf(unit);
      if (!state.url) continue; // not a post after all (a header, an ad, a suggestion)
      const list = byUrl.get(state.url);
      if (list) list.push(unit);
      else byUrl.set(state.url, [unit]);
    }
    pending.clear();
    if (!byUrl.size) return;

    chrome.runtime.sendMessage({ type: 'checkSaved', urls: [...byUrl.keys()] } satisfies CheckSavedMessage, (res?: CheckSavedResponse) => {
      // A host that can't be reached answers nothing: leave the posts unmarked
      // rather than asserting "not saved". background.js already re-asks on the
      // next scroll (its negative cache never recorded these). The save button
      // still appears — offering to save is safe when the answer is unknown;
      // claiming "not saved" would not be.
      if (chrome.runtime.lastError || !res?.ok || !res.results) return;
      for (const [url, units] of byUrl) {
        const saved = readSavedPictures(res.results[url]);
        for (const unit of units) {
          const state = tracked.get(unit);
          if (!state) continue;
          state.saved = saved;
          if (visible.has(unit)) paint(unit, state);
        }
      }
    });
  }

  // The host's answer for one post, turned into what this side can compare.
  // A saved picture whose URL yields no identity key drops the WHOLE post back
  // to `whole`: leaving it out would put a save button on a picture that is
  // already in the library, and saving it again is the one outcome the badge
  // exists to prevent.
  function readSavedPictures(entry: SavedEntry | null | undefined): SavedPictures | null {
    if (!entry) return null;
    const urls: Array<string | null> = Array.isArray(entry.media) ? entry.media : [];
    const saved: SavedPictures = { whole: !urls.length, keys: new Set(), seqs: new Set() };
    urls.forEach((url, seq) => {
      if (typeof url !== 'string' || !url) {
        saved.seqs.add(seq); // recorded without a URL — its place in the post is all there is
        return;
      }
      const key = media ? mediaKeyOf(media.platform, url) : null;
      if (key) saved.keys.add(key);
      else saved.whole = true;
    });
    return saved;
  }

  // Fold a just-completed save into what is known about the post. An empty list
  // means the save reported no pictures of its own, which is the same "saved,
  // pictures unknown" the host answers with.
  function addSavedPictures(prev: SavedPictures | null, urls: Array<string | null>): SavedPictures {
    const next: SavedPictures = prev || { whole: false, keys: new Set(), seqs: new Set() };
    if (!urls.length) {
      next.whole = true;
      return next;
    }
    for (const url of urls) {
      const key = typeof url === 'string' && url && media ? mediaKeyOf(media.platform, url) : null;
      if (key) next.keys.add(key);
      else next.whole = true;
    }
    return next;
  }

  // Is THIS picture one of the post's saved ones? The mark and the save button
  // are two faces of this single question (#334): a multi-image post whose
  // second picture was saved must keep offering the button on the first.
  function anchorSaved(state: UnitState, anchor: Anchor, index: number): boolean {
    const saved = state.saved;
    if (!saved) return false;
    if (saved.whole) return true;
    const el = media ? postMediaIn(anchor.box) : null;
    const keys = el && media ? mediaKeysOf(el, media.platform) : [];
    if (keys.some((key) => saved.keys.has(key))) return true;
    // No comparable URL on the page either — then position is the only handle
    // left, and it only answers for pictures the library recorded without one.
    return !keys.length && saved.seqs.has(index);
  }

  // A save made in this tab: re-mark that post without waiting for the next
  // scroll (background.js pushes this the moment the host acknowledges).
  chrome.runtime.onMessage.addListener((message: BackgroundToContentMessage) => {
    if (message?.type !== 'savedUpdate' || !message.url) return;
    const urls: Array<string | null> = Array.isArray(message.media) ? message.media : [];
    for (const [unit, state] of tracked) {
      if (state.url !== message.url) continue;
      state.saved = addSavedPictures(state.saved, urls);
      if (visible.has(unit)) paint(unit, state);
    }
  });

  // null (not '') when nothing resolved, so the unit stays unanswered and is
  // re-read the next time it scrolls into view — a feed unit is routinely
  // half-rendered on its first intersection.
  function permalinkOf(unit: Element): string | null {
    try {
      return capture.getPermalink(unit) || null;
    } catch {
      return null;
    }
  }

  // === hover ===

  // One delegated listener rather than per-image handlers: the feed replaces its
  // nodes constantly, and a listener attached to an image would have to be
  // re-attached on every re-render (and would be a change to the host's DOM).
  // `pointerover` is not user input: the browser also emits it when layout
  // moves a new element under a stationary pointer (including while scrolling),
  // and may delay that boundary event. `pointermove` fires only when the user
  // actually moves the pointing device, so it cannot make the control trail a
  // scrolling picture.
  document.addEventListener(
    'pointermove',
    (e) => {
      const pe = e as PointerEvent;
      pointerPosition = { x: pe.clientX, y: pe.clientY };
      updateHoveredAtPointer(true);
    },
    true,
  );
  document.addEventListener(
    'pointerout',
    (e) => {
      if (!(e as PointerEvent).relatedTarget) {
        pointerPosition = null;
        setHovered(null); // pointer left the document
      }
    },
    true,
  );

  // Which media box the pointer is inside — by GEOMETRY, not the DOM tree. The
  // earlier ancestor-walk ("which tracked box is an ancestor of what the pointer
  // physically landed on") breaks on any site that lays its OWN control over the
  // picture as a SIBLING of it: on Bluesky the pointer lands on the ALT/overlay
  // div that sits on top of the <img>, and the <img> — the box — is that div's
  // sibling, never its ancestor, so the walk finds nothing (pixiv's bookmark
  // heart is the same shape). A rect test doesn't care what is stacked on top,
  // and it also keeps the control shown while the pointer is on it (the control
  // sits inside the box's own rect). Only the ON-SCREEN units are scanned (not
  // every box ever tracked), so a crossing reads a handful of rects at most.
  function anchorAtPoint(x: number, y: number): Anchor | null {
    let hit: Anchor | null = null;
    let hitArea = Number.POSITIVE_INFINITY;
    for (const unit of visible) {
      const state = tracked.get(unit);
      if (!state) continue;
      for (const [box, anchor] of state.anchors) {
        const r = box.getBoundingClientRect();
        if (!rectHoldsPointer(r, x, y)) continue;
        // Smallest box wins where they overlap, so a picture inside a quoted
        // post is preferred over the outer post's own picture behind it.
        const area = r.width * r.height;
        if (area < hitArea) {
          hitArea = area;
          hit = anchor;
        }
      }
    }
    return hit;
  }

  function setHovered(next: Anchor | null) {
    if (next === hovered) return;
    const previous = hovered;
    hovered = next;
    if (previous) repaintAnchor(previous);
    if (next) repaintAnchor(next);
  }

  function rectHoldsPointer(r: DOMRect, x: number, y: number): boolean {
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  // THE question every clear path has to ask, and the only reason any of them
  // may drop a hover: is the pointer still on this picture? Everything that can
  // hide the control goes through here, so "the button stays while the cursor
  // is on the picture" is a property of the code rather than something each
  // path has to remember (#347).
  function pointerStillOn(anchor: Anchor | null): boolean {
    if (!anchor || !pointerPosition) return false;
    if (!anchor.box.isConnected || modalIsOpen()) return false;
    if (!rectHoldsPointer(anchor.box.getBoundingClientRect(), pointerPosition.x, pointerPosition.y)) return false;
    return !pointerIsOccluded(anchor);
  }

  // `adopt` false = the picture under the pointer changed because LAYOUT moved
  // (a scroll, an intersection, a late image load), not because the user did.
  // Then the picture already hovered keeps its control for as long as the
  // pointer is on it, and a different one may not take it over.
  function updateHoveredAtPointer(adopt: boolean) {
    if (!pointerPosition || modalIsOpen()) {
      setHovered(null);
      return;
    }
    const next = anchorAtPoint(pointerPosition.x, pointerPosition.y);
    if (!adopt && next !== hovered) {
      if (!pointerStillOn(hovered)) setHovered(null);
      return;
    }
    setHovered(next);
    if (hovered && pointerIsOccluded(hovered)) setHovered(null);
  }

  // The page REPLACED the hovered picture's element instead of moving it — a
  // virtualized timeline re-renders its posts as you scroll, and x.com does
  // this under a resting pointer. The picture is still on screen, still under
  // the pointer; only the node is new. Re-read the unit's media boxes and take
  // the hover straight to the new element, because dropping it here left the
  // pointer sitting on a picture with no button until the user jiggled the
  // mouse (#347).
  function rehomeHover(anchor: Anchor) {
    const found = anchorOf.get(anchor.box);
    setHovered(null);
    // The POST went away too (the feed recycled it, not re-rendered it): what
    // is under the pointer now is a different post's picture, and handing the
    // button to that would be the very thing the scroll rule forbids. Leave it
    // to the next pointer move.
    if (!found || !found.unit.isConnected) return;
    const state = tracked.get(found.unit);
    if (state) paint(found.unit, state); // syncAnchors picks up the new box
    updateHoveredAtPointer(true);
  }

  function modalIsOpen(): boolean {
    return [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"]')].some((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
  }

  // Is something LAYERED OVER the picture where the pointer is — a lightbox, a
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
  function pointerIsOccluded(anchor: Anchor): boolean {
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

  function repaintAnchor(anchor: Anchor) {
    const found = anchorOf.get(anchor.box);
    if (!found) return;
    const state = tracked.get(found.unit);
    if (state) paint(found.unit, state);
  }

  // === saving ===

  function showFailureBanner(text: string) {
    if (failureBannerTimer) clearTimeout(failureBannerTimer);
    failureBannerTimer = null;
    failureBanner?.remove();

    // The same component the Alt+S banner is (#44 — status-surface.ts). This
    // used to be a hand-copied pill kept "separate until #44 replaces them",
    // which is what let it drift: it never grew the outline tint the other
    // banners had. Now there is one banner and this is a state of it.
    const banner = new StatusSurface({ variant: 'banner', resting: ICONS.cross, role: 'alert' });
    banner.el.setAttribute('data-hologram-save-banner', '');
    banner.setState('error', text);
    banner.mount();
    banner.enter();
    failureBanner = banner;

    failureBannerTimer = setTimeout(() => {
      failureBannerTimer = null;
      if (failureBanner === banner) failureBanner = null;
      banner.exit();
    }, ERROR_BANNER_MS);
  }

  // Put a save's failure on the button and in the page banner. Shared by the
  // reported failures and the deadline, so the two cannot present differently.
  function failSave(unit: Element, state: UnitState, anchor: Anchor, failureText: string) {
    setPhase(anchor, 'error', ERROR_MS);
    anchor.note = failureText;
    showFailureBanner(failureText);
    paint(unit, state);
  }

  function startSave(unit: Element, state: UnitState, anchor: Anchor) {
    if (anchor.phase !== 'idle' || !media) return; // already in flight — one press, one save
    // Identity is read HERE, never cached on the anchor: a virtualized feed
    // reuses the same box element for a different post as you scroll, and a
    // cached postUrl would file the new picture under the old post.
    const el = postMediaIn(anchor.box);
    const identity = el && media.extractIdentity(el);
    if (!el || !identity) return;
    setPhase(anchor, 'saving', 0);
    anchor.note = null;
    paint(unit, state);
    // The same message drag.js sends on drop. A page-side button cannot use the
    // capture path at all (chrome.tabs.captureVisibleTab needs activeTab, which
    // is only granted by a toolbar or command gesture), so this is not a
    // preference — it is the one save route available here, and reusing it means
    // there is no second code path that could record something different.
    // The button holds its "saving" spinner until this answers, and one press
    // is all the user gets (startSave returns early while a save is in flight),
    // so an answer that never comes would leave that picture unsaveable for as
    // long as the page lives (#507). The deadline releases the button and says
    // why, exactly like a reported failure.
    let settled = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      failSave(unit, state, anchor, saveFailureText('timeout'));
    }, SAVE_WATCHDOG_MS);
    chrome.runtime.sendMessage({ type: 'imageDragged', platform: media.platform, postUrl: identity.link, imageUrls: collectImageUrls(el, media.platform) } satisfies ImageDraggedMessage, (res?: SaveResponse) => {
      if (settled) return; // a late answer to a press already given up on
      settled = true;
      clearTimeout(watchdog);
      if (chrome.runtime.lastError || !res || !res.ok) {
        failSave(unit, state, anchor, saveFailureText(res && !res.ok ? res.errorKind : undefined, res && !res.ok ? res.metaReason : undefined));
        return;
      }
      // Mark the PICTURE here rather than waiting for background.js's
      // savedUpdate push: the push is correct but arrives after the host has
      // written its journal, and the corner the user just pressed should not
      // sit blank in the meantime. Only this picture — the post's others are
      // still unsaved, and that is the whole point of #334. The host reports
      // what it recorded; the page's own URLs for this picture are the fallback
      // (they key to the same picture, which is what mediaKeyOf guarantees).
      state.saved = addSavedPictures(state.saved, Array.isArray(res.media) && res.media.length ? res.media : collectImageUrls(el, media.platform));
      setPhase(anchor, 'flash', FLASH_MS);
      // A partial save stays worth saying for as long as the mark is there: the
      // picture is in the library but the post's text and author are not.
      anchor.note = res.metaOk === false ? partialSaveText(res.metaReason) : null;
      paint(unit, state);
    });
  }

  function setPhase(anchor: Anchor, phase: Phase, ms: number) {
    if (anchor.timer) clearTimeout(anchor.timer);
    anchor.timer = null;
    anchor.phase = phase;
    if (!ms) return;
    anchor.timer = setTimeout(() => {
      anchor.timer = null;
      anchor.phase = 'idle';
      // The failure text described that attempt only. Left behind, it would
      // resurface as the tooltip of the "saved" mark this corner shows next.
      if (phase === 'error') anchor.note = null;
      repaintAnchor(anchor);
    }, ms);
  }

  // === drawing ===

  // Which media boxes this unit currently has. Re-read rather than remembered:
  // a feed adds pictures to a post after it first renders (lazy images, quote
  // previews resolving), and the same unit element gets recycled for another
  // post entirely.
  function syncAnchors(unit: Element, state: UnitState) {
    const boxes = site.mediaIn(unit);
    const live = new Set(boxes);
    for (const [box, anchor] of state.anchors) {
      if (live.has(box) && box.isConnected) continue;
      removeControl(anchor);
      if (hovered === anchor) hovered = null;
      anchorOf.delete(box);
      state.anchors.delete(box);
    }
    for (const box of boxes) {
      if (state.anchors.has(box)) continue;
      const anchor: Anchor = { box, el: null, host: null, hostInlinePosition: null, face: null, phase: 'idle', timer: null, note: null };
      state.anchors.set(box, anchor);
      anchorOf.set(box, { unit, anchor });
    }
  }

  // A media box holds an <img> until the platform's own player takes over: X
  // swaps a video or GIF post's poster <img> for a <video poster="…"> as soon as
  // the player initialises, and never puts the <img> back (#450). Looking for
  // the <img> alone therefore found nothing on exactly the posts that were on
  // screen, which is why the button never appeared on a playing video.
  function postMediaIn(box: Element): PostMediaElement | null {
    if (box.tagName === 'IMG' || box.tagName === 'VIDEO') return box as PostMediaElement;
    return box.querySelector('img, video');
  }

  function controlHost(box: Element): HTMLElement | null {
    // A box that is itself absolutely/fixed positioned (Bluesky's image-fill
    // pattern: an <img style="position:absolute;inset:0"> inside a plain,
    // unsized wrapper) is already out of flow and has a containing block
    // further up the tree. Borrowing position:relative on its immediate
    // parent — the general case below — would silently replace that
    // containing block: the wrapper has no height of its own (its only
    // child is out of flow), so the picture collapses to 0 height for as
    // long as the control is mounted — the "image blinks" half of #347,
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

  function mountControl(anchor: Anchor, el: HTMLDivElement | HTMLButtonElement): boolean {
    const host = controlHost(anchor.box);
    if (!host) return false;
    if (anchor.host !== host) {
      restoreControlHost(anchor);
      anchor.host = host;
      if (getComputedStyle(host).position === 'static') {
        anchor.hostInlinePosition = host.style.position;
        host.style.position = 'relative';
      }
    }
    host.appendChild(el);
    return true;
  }

  function positionControl(anchor: Anchor, el: HTMLDivElement | HTMLButtonElement): void {
    const host = anchor.host;
    if (!host || host === anchor.box) {
      el.style.left = `${CONTROL_INSET}px`;
      el.style.top = `${CONTROL_INSET}px`;
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const boxRect = anchor.box.getBoundingClientRect();
    el.style.left = `${boxRect.left - hostRect.left + CONTROL_INSET}px`;
    el.style.top = `${boxRect.top - hostRect.top + CONTROL_INSET}px`;
  }

  function restoreControlHost(anchor: Anchor): void {
    if (anchor.host && anchor.hostInlinePosition !== null && anchor.host.style.position === 'relative') anchor.host.style.position = anchor.hostInlinePosition;
    anchor.host = null;
    anchor.hostInlinePosition = null;
  }

  // Would a save here produce an honest record? Src pattern (media-identity's
  // per-platform rule), a resolvable post, and a picture big enough to be the
  // point of the post — all three, or no button.
  function savable(anchor: Anchor, rect: DOMRect): boolean {
    if (!media) return false;
    if (rect.width < MIN_SAVE_PX || rect.height < MIN_SAVE_PX) return false;
    const el = postMediaIn(anchor.box);
    if (!el || !media.isPostMedia(el)) return false;
    return media.extractIdentity(el) != null;
  }

  function faceFor(state: UnitState, anchor: Anchor, index: number, rect: DOMRect): Face | null {
    if (anchor.phase === 'saving') return 'busy';
    if (anchor.phase === 'error') return 'failed';
    if (anchor.phase === 'flash') return 'mark';
    if (anchorSaved(state, anchor, index)) {
      if (markMode === 'off') return null;
      // Shown at all times, the mark goes on every picture it can answer for:
      // that is what tells a partly-saved post apart from a fully-saved one
      // (#334). When all that is known is that the POST is saved, one mark on
      // the first picture is the whole of the answer, and claiming more would
      // say something about pictures nobody asked the library about.
      if (markMode === 'always') return !state.saved?.whole || index === 0 ? 'mark' : null;
      // Shown on hover it goes on the picture being asked about.
      return hovered === anchor ? 'mark' : null;
    }
    if (!hoverSave || hovered !== anchor) return null;
    return savable(anchor, rect) ? 'save' : null;
  }

  function paintAll() {
    for (const unit of visible) {
      const state = tracked.get(unit);
      if (state) paint(unit, state);
    }
  }

  function paint(unit: Element, state: UnitState) {
    if (!unit.isConnected) return;
    syncAnchors(unit, state);
    // The box's position in the unit, which is the media row's seq the library
    // recorded for it — the fallback identity for a picture no URL can name.
    let index = -1;
    for (const [, anchor] of state.anchors) {
      index += 1;
      const rect = anchor.box.getBoundingClientRect() as DOMRect;
      // A media box with no size is a collapsed placeholder or an image that
      // has not laid out yet; there is nowhere to put a control on it.
      const tooSmall = rect.width < CONTROL_SIZE * 2 || rect.height < CONTROL_SIZE * 2;
      const face = tooSmall ? null : faceFor(state, anchor, index, rect);
      if (!face) {
        removeControl(anchor);
        continue;
      }
      let el = anchor.el;
      const interactive = face === 'save' || face === 'failed';
      // The saved/busy faces are status indicators, whereas save/retry are
      // actual actions. Recreate on that boundary so an icon-only action keeps
      // the browser's native button semantics instead of imitating them.
      if (el && el instanceof HTMLButtonElement !== interactive) {
        el.remove();
        anchor.el = null;
        el = null;
      }
      const born = !el;
      if (!el) {
        el = document.createElement(interactive ? 'button' : 'div');
        if (el instanceof HTMLButtonElement) el.type = 'button';
        el.style.cssText = [
          'position:absolute',
          `width:${CONTROL_SIZE}px`,
          `height:${CONTROL_SIZE}px`,
          'border-radius:50%',
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'box-sizing:border-box',
          `border:1px solid ${token.overlayBorder}`,
          `box-shadow:${token.overlayShadow}`,
          `transition:width ${token.durationBase} ${token.easeOut},height ${token.durationBase} ${token.easeOut},border-radius ${token.durationBase} ${token.easeOut},background ${token.durationBase},color ${token.durationBase},border-color ${token.durationBase},box-shadow ${token.durationBase},transform ${token.durationBase} ${token.easeOut}`,
          'appearance:none',
          'font:inherit',
        ].join(';');
        el.setAttribute('data-hologram-overlay', '');
        if (!mountControl(anchor, el)) continue;
        anchor.el = el;
      }
      if (born || anchor.face !== face) {
        drawFace(el, face, anchor, unit, state);
        anchor.face = face;
      }
      positionControl(anchor, el);
      // A hover save control is routinely created for the image newly under the
      // pointer while scrolling. Keep it still so that normal scrolling does
      // not turn into a repeated pop animation.
      if (born && face !== 'save' && !prefersReducedMotion())
        el.animate(
          [
            { opacity: 0, transform: 'scale(0.6)' },
            { opacity: 1, transform: 'scale(1.08)', offset: 0.6 },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { duration: motion.durationBase, easing: motion.easeOut },
        );
    }
  }

  function drawFace(el: HTMLDivElement | HTMLButtonElement, face: Face, anchor: Anchor, unit: Element, state: UnitState) {
    el.replaceChildren();
    el.onclick = null;
    el.onpointerdown = null;
    el.onpointerenter = null;
    el.onpointerleave = null;
    el.removeAttribute('aria-label');
    el.tabIndex = -1;
    el.style.cursor = '';
    // The STATUS default. A face that merely reports something — the saved
    // mark, the in-flight spinner — rides a translucent disc, because the mark
    // is the one thing this extension puts on screen when nobody asked for
    // anything: it sits on every saved picture, permanently, over the user's own
    // content. The two ACTION faces below opt back into the opaque surface. The
    // split is by what the face SAYS, not by how big it is; tokens.source.css
    // carries the reasoning and the bound on the alpha.
    el.style.background = token.controlSurface;
    el.style.color = token.ink;
    el.style.width = `${CONTROL_SIZE}px`;
    el.style.height = `${CONTROL_SIZE}px`;
    el.style.padding = '0';
    el.style.gap = '0';
    el.style.borderRadius = '50%';
    el.style.borderColor = token.overlayBorder;
    el.style.boxShadow = token.overlayShadow;
    el.style.transform = '';
    switch (face) {
      case 'mark':
        // Monotone check (not the accent): the mark states a fact about the
        // post, it is not an action to take, so it stays out of the accent's
        // vocabulary — which is exactly what tells it apart from the button
        // that shares this corner.
        el.title = anchor.note || t('badgeSaved');
        el.appendChild(makeIcon(ICONS.check, 14));
        break;
      case 'save': {
        el.title = t('hoverSaveImage');
        // Keep the same compact, glyph-only monochrome language as the saved
        // mark — including its translucency: this control also sits on the
        // user's picture, and the disc is the only thing between them and it
        // (user, 2026-07-29). A slightly larger circle and a hover lift
        // distinguish the action without adding permanent text or state colour.
        el.style.width = `${SAVE_SIZE}px`;
        el.style.height = `${SAVE_SIZE}px`;
        el.style.color = token.ink;
        el.style.cursor = 'pointer';
        el.appendChild(makeIcon(ICONS.drop, 14));
        // Both handlers stop the event: the control is outside the post's
        // subtree, but x.com and bsky.app listen on the document, and a press
        // that reached them would open the lightbox behind the save.
        el.setAttribute('aria-label', t('hoverSaveImage'));
        el.tabIndex = 0;
        el.onpointerdown = stopPress;
        el.onpointerenter = () => {
          // The hover lift changes the disc's COLOUR, not its opacity: going
          // solid on hover would undo the translucency exactly where the
          // pointer is, which is where the picture is being looked at.
          el.style.background = token.controlSurfaceHover;
          el.style.boxShadow = `${token.overlayShadow}, 0 0 0 2px ${token.controlHoverGlow}`;
          el.style.transform = 'scale(1.04)';
        };
        el.onpointerleave = () => {
          el.style.background = token.controlSurface;
          el.style.borderColor = token.overlayBorder;
          el.style.boxShadow = token.overlayShadow;
          el.style.transform = '';
        };
        el.onclick = (e) => {
          stopPress(e);
          startSave(unit, state, anchor);
        };
        break;
      }
      case 'busy':
        el.title = t('bannerSaving');
        el.appendChild(makeSpinner(14));
        break;
      case 'failed':
        // The note says WHY. A failure is not a dead end: pressing it again
        // retries straight away, and it returns to a plain button on its own.
        el.title = anchor.note || t('bannerFailed');
        el.style.cursor = 'pointer';
        el.onpointerdown = stopPress;
        el.onclick = (e) => {
          stopPress(e);
          setPhase(anchor, 'idle', 0);
          anchor.note = null;
          startSave(unit, state, anchor);
        };
        el.style.background = token.danger;
        el.style.color = token.onDanger;
        el.appendChild(makeIcon(ICONS.cross, 14));
        break;
    }
  }

  function stopPress(e: Event) {
    e.preventDefault();
    e.stopPropagation();
  }

  function removeControl(anchor: Anchor) {
    anchor.el?.remove();
    anchor.el = null;
    anchor.face = null;
    restoreControlHost(anchor);
  }

  function clearControls(state: UnitState) {
    for (const [, anchor] of state.anchors) removeControl(anchor);
  }

  function reposition() {
    repositionFrame = null;
    repositionQueued = false;
    const full = repositionFull;
    repositionFull = false;
    updateHoveredAtPointer(!inScrollBurst);
    if (!full) return;
    let detached = false;
    for (const unit of visible) {
      const state = tracked.get(unit);
      if (!state) continue;
      if (!unit.isConnected) {
        detached = true;
        continue;
      }
      paint(unit, state);
    }
    if (detached) forgetDetached();
  }

  // Full repainting is for layout changes such as resize and image load.
  function scheduleReposition(full: boolean) {
    if (full) repositionFull = true;
    if (repositionQueued) return;
    repositionQueued = true;
    repositionFrame = requestAnimationFrame(reposition);
  }

  // Ends the burst — the point from which layout may hand the hover to another
  // picture again. The last scroll event is not that point: momentum and
  // smooth scrolling keep moving the page after it, so the geometry is asked
  // once more here.
  function settleHoverAfterScroll() {
    if (scrollHoverTimer !== null) clearTimeout(scrollHoverTimer);
    scrollHoverTimer = setTimeout(() => {
      scrollHoverTimer = null;
      inScrollBurst = false;
      if (hovered && !pointerStillOn(hovered)) setHovered(null);
    }, SCROLL_HOVER_SETTLE_MS);
  }

  // Controls are children of their media and therefore scroll with it without
  // JavaScript. Scrolling itself decides nothing about hover: it only moves the
  // picture, and geometry says whether the pointer is still on it. Scrolling a
  // picture OUT from under the pointer clears the control here; scrolling
  // WITHIN one (the wheel jiggle that reads a long post) leaves it alone.
  addEventListener(
    'scroll',
    () => {
      inScrollBurst = true;
      if (repositionFrame !== null) cancelAnimationFrame(repositionFrame);
      repositionFrame = null;
      repositionQueued = false;
      if (hovered && !pointerStillOn(hovered)) setHovered(null);
      settleHoverAfterScroll();
    },
    { capture: true, passive: true },
  );
  addEventListener('resize', () => scheduleReposition(true), { passive: true });
  // A post can be answered BEFORE its picture has a size: the observer's margin
  // deliberately reaches past the viewport, and a feed's images are lazy. Such a
  // media box measures 0×0 and paint skips it (verified on a live x.com
  // timeline), so the control would wait for the next scroll. An image's own load
  // event is exactly when the box gains its size — on `document` in the capture
  // phase, since load does not bubble.
  document.addEventListener('load', () => scheduleReposition(true), { capture: true, passive: true });
}
