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
//
// A text-only post has no picture to be that child of (#575's "saved" mark,
// #363's save button stays out of scope). Its unit becomes its own host —
// already positioned, already sized — and the mark sits just under the
// post's own avatar rather than the picture's corner: X's ⋯ menu already
// owns the opposite corner and the action row shares the text column's left
// edge, so that is the one strip neither platform draws anything into. Same
// vocabulary, a different landmark to sit beside.
//
// Staying in the page's subtree used to mean staying in the page's CASCADE
// too: a host rule as ordinary as `button { all: unset !important }` beats an
// inline style, so the corner was one stylesheet away from having no box at
// all. #310 closes that without moving anything — what is inserted into the
// subtree is a <hologram-corner-control> host element with its OWN small shadow
// root, and the disc lives inside it. Host CSS cannot select into a shadow tree,
// so the only surface left exposed is the host element's own box, and that is
// written as inline !important (the top of the author cascade, the same trick
// ui-root.ts uses for the fixed layer's host). Scroll following and stacking
// order are untouched: the host element is still an ordinary absolutely
// positioned child of the picture.
import { newSaveId, reportSaveTimeout } from './capture-log.ts';
import { extensionAlive, noteExtensionGone, onExtensionGone } from './extension-context.ts';
import { startSaveDeadline } from './save-deadline.ts';
import { collectImageUrls, getCaptureSite, getMediaIdentitySite, getOverlaySite, mediaKeyOf, mediaKeysOf } from './extractor/index.ts';
import type { CaptureSite, OverlaySite, PostMediaElement } from './extractor/types.ts';
import { ICONS, makeIcon, makeSpinner } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { ensureTokens, motion, prefersReducedMotion, token } from './tokens.ts';
import { createI18n } from './i18n.ts';
import { userOnly } from './user-gesture.ts';
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
  // ONE size for every face this corner can wear. The faces used to differ (22px
  // for the mark, the spinner and retry; 28px for the save button), which made
  // the corner shrink at the exact moment it was reporting something: press the
  // 28px button and the 22px spinner replaces it, then the 22px mark (user,
  // 2026-07-29). 24px is the smallest that keeps the two PRESSABLE faces at
  // WCAG 2.5.8's target minimum, and it is within 2px of the mark the design
  // wanted to stay quiet — so nothing has to grow to hold the corner still.
  // Retry was 22px before this, i.e. under that minimum: a real gap, not just a
  // mismatch.
  const CONTROL_SIZE = 24;
  const CONTROL_INSET = 6;
  // The shadow host. A hyphenated name is what makes attachShadow legal on an
  // element the HTML parser has never heard of, and it is the name a host page
  // would have to write to target us at all.
  const CONTROL_TAG = 'hologram-corner-control';
  // The host element's own box — the only part of this control the page's
  // cascade can still reach, so every declaration is inline !important (nothing
  // an author stylesheet can write outranks that). `all: initial` comes first
  // and is the reason the rest follows: it drops the inherited font, colour,
  // line-height and text rendering the page would otherwise push through the
  // shadow boundary. It does NOT reset custom properties, which is exactly why
  // the --hologram-* tokens still arrive inside.
  const CONTROL_HOST_STYLE: Array<[string, string]> = [
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
  // follows from "this one can be pressed" — the native <button> element, the
  // accessible name, the tab stop, the pointer cursor — is decided from this
  // one predicate, so a face cannot be pressable and yet miss part of what
  // being pressable requires. Retry used to (#536): the per-face code restored
  // the name and the tab stop for `save` only, leaving retry a nameless button
  // at tabIndex -1, i.e. the recovery from a failed save was reachable by
  // pointer alone.
  const isPressable = (face: Face) => face === 'save' || face === 'failed';
  const FLASH_MS = 1400; // "saved" confirmation after a press
  const ERROR_MS = 2500; // failure shown, then back to a button to retry
  const SAVE_BANNER_MS = 2800; // same readable dwell as the Alt+S failure banner
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
    // Priority is carried, not just the value: the host element writes its own
    // `display` as !important (CONTROL_HOST_STYLE), so a plain assignment would
    // lose to it and the corner would be photographed after all.
    const previousDisplay = controls.map((el) => [el.style.getPropertyValue('display'), el.style.getPropertyPriority('display')] as const);
    controls.forEach((el) => el.style.setProperty('display', 'none', 'important'));
    return () => {
      controls.forEach((el, i) => {
        const [value, priority] = previousDisplay[i] ?? ['', ''];
        if (value) el.style.setProperty('display', value, priority);
        else el.style.removeProperty('display');
      });
    };
  };

  // The palette is generated from the app's design tokens and follows the
  // browser's light/dark setting (#270 — see tokens.ts).
  ensureTokens();

  let markMode: MarkMode = 'always';
  let hoverSave = true;
  let saveBanner: StatusSurface | null = null;
  let saveBannerTimer: ReturnType<typeof setTimeout> | null = null;
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

  const { getMessage: t, partialSaveText, saveFailureText, skewSaveText } = await createI18n();

  // === settings ===

  // Wrapped because chrome.storage THROWS on an invalidated context rather than
  // reporting through lastError (#594). A content script cannot start in a dead
  // context, but it can be awaiting createI18n above when the extension is
  // reloaded, and losing the whole overlay to that would be a worse outcome than
  // running on the defaults.
  try {
    chrome.storage.local.get([MARK_MODE_KEY, HOVER_SAVE_KEY], (got) => {
      if (chrome.runtime.lastError) return; // storage unavailable — stay on the defaults
      applySettings(got[MARK_MODE_KEY], got[HOVER_SAVE_KEY]);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes[MARK_MODE_KEY] && !changes[HOVER_SAVE_KEY]) return;
      applySettings(changes[MARK_MODE_KEY] ? changes[MARK_MODE_KEY].newValue : markMode, changes[HOVER_SAVE_KEY] ? changes[HOVER_SAVE_KEY].newValue : hoverSave);
    });
  } catch {
    noteExtensionGone();
  }

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

  const mo = new MutationObserver((records) => {
    const childrenChanged = records.some((record) => record.type === 'childList');
    const modalChanged = records.some((record) => record.type === 'attributes' && record.target instanceof Element && record.target.matches('dialog, [role="dialog"], [aria-modal]'));
    if (hovered && (childrenChanged || modalChanged)) {
      if (!hovered.box.isConnected) rehomeHover(hovered);
      else if (!pointerStillOn(hovered)) setHovered(null);
    }
    if (childrenChanged) scheduleScan();
  });
  mo.observe(document.documentElement, {
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
    // The PASSIVE half of #594. This runs whenever a post scrolls into view, so
    // on an orphaned tab it is what notices — and what takes the stale marks and
    // buttons off the page — the moment the user starts using the tab again.
    // Nothing is said: scrolling is not a request, and a toast on every open
    // timeline after an auto-update is exactly the noise #154's charter 2 keeps
    // out. The user's own request has its own path, in startSave below.
    if (!queriesWanted() || !extensionAlive()) {
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
    // A text anchor has no picture to compare a per-picture key against —
    // `whole` above is the only way a text-only post's record can say "yes"
    // (#365: it carries no media rows for readSavedPictures to key on).
    if (anchor.kind === 'text') return false;
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
  //
  // Deliberately NOT a liveness check (#594), unlike the query flush: the save
  // button only exists while the pointer is on the picture, so tearing down here
  // would remove the button in the same gesture that reveals it, and the user's
  // press — the one event that has something to tell them — could never happen.
  const onPointerMove = (e: Event) => {
    const pe = e as PointerEvent;
    pointerPosition = { x: pe.clientX, y: pe.clientY };
    updateHoveredAtPointer(true);
  };
  const onPointerOut = (e: Event) => {
    if (!(e as PointerEvent).relatedTarget) {
      pointerPosition = null;
      setHovered(null); // pointer left the document
    }
  };
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerout', onPointerOut, true);

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
    if (!anchor.box.isConnected || modalCovers(anchor)) return false;
    if (!rectHoldsPointer(anchor.box.getBoundingClientRect(), pointerPosition.x, pointerPosition.y)) return false;
    return !pointerIsOccluded(anchor);
  }

  // `adopt` false = the picture under the pointer changed because LAYOUT moved
  // (a scroll, an intersection, a late image load), not because the user did.
  // Then the picture already hovered keeps its control for as long as the
  // pointer is on it, and a different one may not take it over.
  function updateHoveredAtPointer(adopt: boolean) {
    if (!pointerPosition) {
      setHovered(null);
      return;
    }
    const next = anchorAtPoint(pointerPosition.x, pointerPosition.y);
    if (next && modalCovers(next)) {
      setHovered(null);
      return;
    }
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

  // Is a MODAL layered over this anchor's picture — a lightbox that ISN'T
  // this one, a compose dialog? Blanket "any modal open" was the original
  // rule (#347): it protects a picture sitting BEHIND a dialog, since the
  // corner control is only ever z-index:1 within its own picture's stacking
  // context and would be unreachable and visually wrong there. But X's own
  // photo viewer is itself `[role="dialog"][aria-modal="true"]`, so that
  // blanket rule made the viewer's own picture permanently unreachable too
  // (#659) — the one thing the guard was never meant to hide. A modal that
  // CONTAINS the anchor is not covering it; it IS what is being looked at.
  function modalCovers(anchor: Anchor): boolean {
    return [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"]')].some((el) => {
      if (el.contains(anchor.box)) return false;
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

  // THE place a hover save says anything in words. The corner itself says none
  // (#310): a 24px circle cannot hold "open the diagnostics page from the
  // extension settings", and putting it in a `title` only meant the sentence
  // existed somewhere nobody with a keyboard or a phone would ever reach. So
  // the sentence comes here, to the same banner Alt+S uses — which already has
  // the width, the state colours and the `alert` role for it.
  //
  // Only the outcomes the user could not have predicted get one. A plain
  // success stays silent (the mark appearing IS the answer), whereas `partial`
  // — saved, but the post's own text and author are missing — is a fact about
  // this save that nothing on screen would otherwise state (#367). The same banner
  // also carries the #205 protocol-skew notice (drag.ts and capture.ts already
  // did; hover save was the one save route still silent about it, #576) — the
  // save still succeeded, so it rides the amber `partial` state rather than a
  // fourth face of its own.
  function showSaveBanner(state: 'error' | 'partial', text: string) {
    if (saveBannerTimer) clearTimeout(saveBannerTimer);
    saveBannerTimer = null;
    saveBanner?.remove();

    // The same component the Alt+S banner is (#44 — status-surface.ts). This
    // used to be a hand-copied pill kept "separate until #44 replaces them",
    // which is what let it drift: it never grew the outline tint the other
    // banners had. Now there is one banner and this is a state of it.
    //
    // Two tiers, and the difference is not only the colour (#367): a failure is
    // an `alert`, which interrupts, and a caveat is a `status`, which waits its
    // turn. That split is also why they are filled differently. Unlike the
    // Alt+S banner and the drop zone — both of which are already on screen when
    // their outcome arrives, so the outcome is a CHANGE to a region assistive
    // tech has long since registered — this banner is created for the message
    // it carries. A `status` inserted with its sentence already in it changes
    // nothing after anyone was listening and is announced by no one, so the
    // caveat enters empty and is spoken a moment later (see announce). An
    // `alert` is exempt by documented browser behaviour and stays untouched,
    // which is also what #367 asks for: failures do not change.
    const isFailure = state === 'error';
    const banner = new StatusSurface({ variant: 'banner', resting: ICONS.cross, role: isFailure ? 'alert' : 'status' });
    banner.el.setAttribute('data-hologram-save-banner', '');
    banner.setState(state, isFailure ? text : undefined);
    banner.mount();
    banner.enter();
    if (!isFailure) banner.announce(text);
    saveBanner = banner;

    saveBannerTimer = setTimeout(() => {
      saveBannerTimer = null;
      if (saveBanner === banner) saveBanner = null;
      banner.exit();
    }, SAVE_BANNER_MS);
  }

  // Put a save's failure on the button and in the page banner. Shared by the
  // reported failures and the deadline, so the two cannot present differently.
  function failSave(unit: Element, state: UnitState, anchor: Anchor, failureText: string) {
    setPhase(anchor, 'error', ERROR_MS);
    showSaveBanner('error', failureText);
    paint(unit, state);
  }

  // The ACTIVE half of #594: the user asked for a save and this tab cannot make
  // one. Said on the banner rather than swallowed, because until this existed
  // the press produced an uncaught "Extension context invalidated.", a spinner,
  // and then — ten seconds later, from the deadline that was all that survived
  // the throw — "the save timed out, restart Chrome", which is a healthy
  // extension being blamed and the one repair that works (reload THIS page)
  // never mentioned. Shown once: the teardown that runs with it takes the
  // button away, so there is nothing left to press a second time.
  function reportOrphaned() {
    noteExtensionGone();
    showSaveBanner('error', t('bannerExtensionReloaded'));
  }

  function startSave(unit: Element, state: UnitState, anchor: Anchor) {
    if (anchor.phase !== 'idle' || !media) return; // already in flight — one press, one save
    if (!extensionAlive()) {
      reportOrphaned();
      return;
    }
    // Identity is read HERE, never cached on the anchor: a virtualized feed
    // reuses the same box element for a different post as you scroll, and a
    // cached postUrl would file the new picture under the old post.
    const el = postMediaIn(anchor.box);
    const identity = el && media.extractIdentity(el);
    if (!el || !identity) return;
    setPhase(anchor, 'saving', 0);
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
    // Groups this press's lines across the three processes (#519).
    const saveId = newSaveId();
    const deadline = startSaveDeadline(saveId, (error) => {
      // Recorded, not just shown. This is the surface the hang in #507 was
      // actually reported from, and it is the one with no service-worker line
      // to fall back on: the resident script logs nothing on its own, so
      // without this the timeout leaves capture.log exactly as empty as the
      // silent spinner did.
      reportSaveTimeout('hover-save', media.platform, identity.link, error, saveId);
      failSave(unit, state, anchor, saveFailureText('timeout'));
    });
    // Named rather than written inline at the call, so the call itself is the
    // one statement inside the try/catch below.
    const onAnswer = (res?: SaveResponse) => {
      if (!deadline.settle()) return; // a late answer to a press already given up on
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
      // "Saved, but the post's own information is missing" is worth a sentence,
      // and the corner has nowhere to put one. It used to live in the mark's
      // `title`, i.e. behind a one-second hover on a 24px circle; it is now the
      // banner's amber state, said once, at the moment it is true (#310, #367).
      //
      // Amber, not the neutral tint #367 first sketched: #202 lands post text
      // and author read off the PAGE in these records, and page-read counts are
      // approximations where the API's are exact. Amber is what keeps that
      // difference visible, so the caveat shares `partial` with every other
      // "saved, with something to know about it" outcome instead of inventing
      // an eighth state.
      //
      // Same priority as drag.ts's done(): the skew notice wins over the
      // partial-save one when a save somehow manages to be both, because a skew
      // is about the NEXT save (#205), which outranks a fact about this one.
      // null when the two halves match or no host has answered yet (#576).
      const skewText = skewSaveText(res.hostSkew);
      if (skewText) showSaveBanner('partial', skewText);
      // No domFilled argument, and that is not an omission: #202 reads the page
      // on the Alt+S route only, so on this one nothing was ever filled from the
      // page and "post info read from the page" would be a false claim. Whoever
      // teaches THIS route to send domMeta has to carry domFilled back on
      // SaveResponse and pass it here in the same change, or the caveat will go
      // on blaming a private account for a record the page already rescued.
      else if (res.metaOk === false) showSaveBanner('partial', partialSaveText(res.metaReason));
      paint(unit, state);
    };
    // try/catch as well as the probe at the top (#594): sendMessage is the ONE
    // call on this side that throws on an invalidated context, and the deadline
    // is already armed by the time it does — so an unguarded throw leaves the
    // timer as the only thing still running, which is precisely how a dead tab
    // used to report a timeout instead of an update. The window between the
    // probe and this line is small, not nonexistent.
    try {
      chrome.runtime.sendMessage({ type: 'imageDragged', platform: media.platform, postUrl: identity.link, imageUrls: collectImageUrls(el, media.platform), saveId } satisfies ImageDraggedMessage, onAnswer);
    } catch {
      deadline.settle();
      setPhase(anchor, 'idle', 0);
      reportOrphaned();
    }
  }

  function setPhase(anchor: Anchor, phase: Phase, ms: number) {
    if (anchor.timer) clearTimeout(anchor.timer);
    anchor.timer = null;
    anchor.phase = phase;
    if (!ms) return;
    anchor.timer = setTimeout(() => {
      anchor.timer = null;
      anchor.phase = 'idle';
      repaintAnchor(anchor);
    }, ms);
  }

  // === drawing ===

  // Which media boxes this unit currently has. Re-read rather than remembered:
  // a feed adds pictures to a post after it first renders (lazy images, quote
  // previews resolving), and the same unit element gets recycled for another
  // post entirely.
  function syncAnchors(unit: Element, state: UnitState) {
    const mediaBoxes = site.mediaIn(unit);
    // A text-only post (#575) has no picture to key off, so the unit itself
    // becomes the one synthetic anchor — but only when the site can point to
    // an avatar to place it near; otherwise it stays unmarked, the same as
    // before this existed.
    const textAnchor = mediaBoxes.length ? null : (site.textAnchorIn?.(unit) ?? null);
    const boxes: Element[] = mediaBoxes.length ? mediaBoxes : textAnchor ? [unit] : [];
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
      const kind: Anchor['kind'] = mediaBoxes.length ? 'media' : 'text';
      const anchor: Anchor = { box, kind, el: null, root: null, control: null, host: null, hostInlinePosition: null, hostInlinePriority: '', face: null, phase: 'idle', timer: null };
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

  // The one thing that CANNOT go behind the shadow boundary: the containing
  // block has to be an element of the page's own, so the borrowed
  // `position: relative` is written onto the page's element and stays subject
  // to the page's cascade. !important because a host rule as ordinary as
  // `* { all: unset !important }` would otherwise win, and then the control is
  // positioned against some ancestor further up and lands nowhere near its
  // picture — a silent failure, since the control still exists and still says
  // the right thing. The previous inline value AND its priority are kept so
  // unmounting puts the page back exactly as it was.
  function borrowHostPosition(anchor: Anchor, host: HTMLElement): void {
    anchor.hostInlinePosition = host.style.getPropertyValue('position');
    anchor.hostInlinePriority = host.style.getPropertyPriority('position');
    host.style.setProperty('position', 'relative', 'important');
  }

  function mountControl(anchor: Anchor, el: HTMLElement): boolean {
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
    // link to the author's profile. The mark is never pressable (savable() says
    // so), so letting it swallow that corner of the link would take away one of
    // the page's own controls to say something the user did not ask about.
    if (anchor.kind === 'text') el.style.setProperty('pointer-events', 'none', 'important');
    host.appendChild(el);
    return true;
  }

  function positionControl(anchor: Anchor, el: HTMLElement): void {
    const host = anchor.host;
    // !important for the same reason the rest of the host element's box is
    // (CONTROL_HOST_STYLE): these two numbers are the difference between the
    // picture's corner and the top-left of whatever is containing us.
    const place = (left: number, top: number) => {
      el.style.setProperty('left', `${left}px`, 'important');
      el.style.setProperty('top', `${top}px`, 'important');
    };
    if (anchor.kind === 'text') {
      positionTextControl(anchor, host || (anchor.box as HTMLElement), place);
      return;
    }
    if (!host || host === anchor.box) {
      place(CONTROL_INSET, CONTROL_INSET);
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const boxRect = anchor.box.getBoundingClientRect();
    place(boxRect.left - hostRect.left + CONTROL_INSET, boxRect.top - hostRect.top + CONTROL_INSET);
  }

  // A text-only post's mark (#575) RIDES THE AVATAR, the way a picture's mark
  // rides the picture — and on the SAME CORNER, top left. Its centre sits on
  // the avatar's edge there, so half the disc covers the image and half hangs
  // off into the post's own padding. For the 40–42px avatars x.com and bsky.app
  // draw, the offset works out to −CONTROL_INSET: the picture's +6px turned
  // inside out. A picture is big enough to hold the disc inside its corner; a
  // 40px avatar would be swallowed by it.
  //
  // Two placements were measured and rejected before this one:
  //   the empty strip beside the avatar — free on every layout, but it read as
  //   floating loose in the margin rather than marking the post, because a mark
  //   needs a surface to be ON and the avatar is the only surface a post
  //   without pictures has (user, 2026-07-30);
  //
  //   the gap after the timestamp, where both platforms put their own per-post
  //   metadata glyphs — 163–342px wide on ordinary posts, but x.com truncates a
  //   long display name only as far as it must to keep the time visible, so the
  //   gap collapses to 8px and cannot hold a 24px disc.
  //
  // This point clears the text column, the ⋯ menu and the thread connector on
  // all four shapes those two sites use (feed row and focused-post layouts,
  // which differ in where the post's text starts).
  function positionTextControl(anchor: Anchor, host: HTMLElement, place: (left: number, top: number) => void): void {
    const hostRect = host.getBoundingClientRect();
    const avatar = site.textAnchorIn?.(anchor.box)?.getBoundingClientRect();
    if (!avatar) return;
    // The 135° point on the avatar's circle, as an offset from its top-left
    // corner; then back off half the disc so that point is the disc's centre.
    // Rounded because a disc has no detail that a subpixel offset could place
    // more accurately, and whole numbers are what a reader can check by eye.
    const radius = (avatar.width + avatar.height) / 4;
    const offset = Math.round(radius - radius * Math.SQRT1_2 - CONTROL_SIZE / 2);
    place(avatar.left - hostRect.left + offset, avatar.top - hostRect.top + offset);
  }

  function restoreControlHost(anchor: Anchor): void {
    if (anchor.host && anchor.hostInlinePosition !== null && anchor.host.style.getPropertyValue('position') === 'relative') {
      if (anchor.hostInlinePosition) anchor.host.style.setProperty('position', anchor.hostInlinePosition, anchor.hostInlinePriority);
      else anchor.host.style.removeProperty('position');
    }
    anchor.host = null;
    anchor.hostInlinePosition = null;
    anchor.hostInlinePriority = '';
  }

  // Would a save here produce an honest record? Src pattern (media-identity's
  // per-platform rule), a resolvable post, and a picture big enough to be the
  // point of the post — all three, or no button.
  function savable(anchor: Anchor, rect: DOMRect): boolean {
    // The save button stays out of scope for a text-only post (#575 covers
    // the mark only — #122's right-click menu is the save route there).
    if (anchor.kind === 'text') return false;
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
      // has not laid out yet; there is nowhere to put a control on it. For a
      // text anchor the box is the whole post (always sized) and it is the
      // AVATAR the mark is placed against, so that is what has to have laid out
      // — a lazy avatar of 0×0 would otherwise put the disc outside the post.
      const placedOn = anchor.kind === 'text' ? (site.textAnchorIn?.(anchor.box)?.getBoundingClientRect() ?? null) : rect;
      const tooSmall = !placedOn || placedOn.width < CONTROL_SIZE || placedOn.height < CONTROL_SIZE || (anchor.kind === 'media' && (rect.width < CONTROL_SIZE * 2 || rect.height < CONTROL_SIZE * 2));
      const face = tooSmall ? null : faceFor(state, anchor, index, rect);
      if (!face) {
        removeControl(anchor);
        continue;
      }
      // The HOST element outlives a change of face: it carries no look of its
      // own, only the box, so keeping it means the corner does not leave and
      // re-enter the page's DOM every time the face changes (one fewer thing
      // for the flicker timeline to record, and one fewer reason for the corner
      // to move at the moment it is reporting something).
      const born = !anchor.el;
      if (born) {
        const made = makeControlHost();
        if (!mountControl(anchor, made.el)) continue;
        anchor.el = made.el;
        anchor.root = made.root;
      }
      const el = anchor.el;
      if (!el) continue;
      if (born || anchor.face !== face) {
        drawFace(anchor, face, unit, state);
        anchor.face = face;
        // Named for the tests, which cannot read the localized name (the corner
        // follows the browser locale) — the same role data-hologram-choice
        // plays for the duplicate warning's buttons.
        el.setAttribute('data-hologram-face', face);
      }
      positionControl(anchor, el);
      // A hover save control is routinely created for the image newly under the
      // pointer while scrolling. Keep it still so that normal scrolling does
      // not turn into a repeated pop animation.
      if (born && face !== 'save' && !prefersReducedMotion())
        anchor.control?.animate(
          [
            { opacity: 0, transform: 'scale(0.6)' },
            { opacity: 1, transform: 'scale(1.08)', offset: 0.6 },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { duration: motion.durationBase, easing: motion.easeOut },
        );
    }
  }

  // The page-side host element plus the place its face is drawn. The shadow
  // root is the isolation; the fallback to the host element itself is the same
  // "an unstyled control still saves the picture" rule the rest of this file
  // follows — attachShadow only fails on a document that could not take one,
  // and losing the save there would be a far worse trade than losing the
  // boundary.
  function makeControlHost(): { el: HTMLElement; root: ShadowRoot | HTMLElement } {
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
  // inside a shadow root — #270 measured it), and inside a shadow tree there is
  // no host cascade left to beat, so the usual reason to prefer classes is gone.
  function makeControl(anchor: Anchor, pressable: boolean): HTMLDivElement | HTMLButtonElement {
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
      // Its own shadow, not the card's (#310 — tokens.source.css).
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

  function drawFace(anchor: Anchor, face: Face, unit: Element, state: UnitState) {
    // What being pressable brings with it, in one place rather than per face:
    // the element type, the tab stop, the cursor, and the accessible name below
    // (it needs the face's own sentence, which the switch writes).
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
    // disc, because this thing sits on the user's own picture. The mark is the
    // binding case — it rides every saved picture, permanently, when nobody
    // asked for anything — and #526 put the save button on the same disc rather
    // than an opaque one, since it appears exactly where the user is looking.
    // Only `failed` below trades it away, for the danger fill. tokens.source.css
    // carries the reasoning and the bound on the alpha.
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
    // The sentence this face carries. It is an accessible NAME and nothing
    // else: no face of this corner shows words, and none of them used to
    // either — what they had was a `title`, i.e. the BROWSER's tooltip, which
    // is a different UI system from every other surface this extension draws
    // (those are its own elements with `role="status"` / `role="alert"`, appear
    // at once and where the extension put them, while a `title` waits about a
    // second, lands wherever the OS decides, and never appears at all for a
    // keyboard or touch user). #310 settles that by removing the tooltip rather
    // than reimplementing it:
    //
    //   the mark states a fact and is not something to operate — an explanation
    //   attached to it would be hover affordance on a non-control, which is the
    //   one signal that must stay free for the button sharing this corner
    //   (#125 has still to decide whether it becomes one);
    //
    //   the two pressable faces DO owe the user a sentence, but the place for
    //   it is the name, not a floating chip: a chip would open right where the
    //   pointer already is, on top of the picture being looked at, to repeat
    //   what a 24px glyph under the cursor has already said. What genuinely
    //   needs words — why a save failed, what to do about it — goes to the
    //   banner (showSaveBanner), which has room for a sentence.
    //
    // A `title` was never a substitute for this: support for falling back to it
    // varies by assistive technology, and it is never announced to someone who
    // arrived by keyboard.
    let name: string;
    switch (face) {
      case 'mark':
        // Monotone check (not the accent): the mark states a fact about the
        // post, it is not an action to take, so it stays out of the accent's
        // vocabulary — which is exactly what tells it apart from the button
        // that shares this corner.
        name = t('cornerSaved');
        el.appendChild(makeIcon(ICONS.check, 14));
        break;
      case 'save': {
        name = t('cornerSave');
        // Keep the same compact, glyph-only monochrome language as the saved
        // mark — same size, same translucency. This control also sits on the
        // user's picture, and the disc is the only thing between them and it
        // (user, 2026-07-29). What tells the action apart is the glyph and the
        // hover lift, not a bigger circle or a state colour: it appears only
        // where the pointer is, which is already the strongest signal there is.
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
        // A trusted press only (#323). This control is a child of the picture it
        // annotates — in the page's own subtree, by design (ui-root.ts) — so the
        // page can find it and click it, and this route saves without any
        // further confirmation.
        el.onclick = userOnly<MouseEvent>((e) => {
          stopPress(e);
          startSave(unit, state, anchor);
        });
        break;
      }
      case 'busy':
        name = t('cornerSaving');
        el.appendChild(makeSpinner(14));
        break;
      case 'failed':
        // A failure is not a dead end: pressing it again retries straight away,
        // and it returns to a plain button on its own. The name says exactly
        // that — the old one was the failure REASON, so the single control whose
        // press recovers the save was the one place "retry" was never said.
        name = t('cornerRetry');
        el.onpointerdown = stopPress;
        el.onclick = userOnly<MouseEvent>((e) => {
          stopPress(e);
          setPhase(anchor, 'idle', 0);
          startSave(unit, state, anchor);
        });
        el.style.background = token.danger;
        el.style.color = token.onDanger;
        el.appendChild(makeIcon(ICONS.cross, 14));
        break;
    }
    el.setAttribute('aria-label', name);
  }

  function stopPress(e: Event) {
    e.preventDefault();
    e.stopPropagation();
  }

  function removeControl(anchor: Anchor) {
    anchor.el?.remove();
    anchor.el = null;
    anchor.root = null;
    anchor.control = null;
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
  const onScroll = () => {
    inScrollBurst = true;
    if (repositionFrame !== null) cancelAnimationFrame(repositionFrame);
    repositionFrame = null;
    repositionQueued = false;
    if (hovered && !pointerStillOn(hovered)) setHovered(null);
    settleHoverAfterScroll();
  };
  const onResize = () => scheduleReposition(true);
  addEventListener('scroll', onScroll, { capture: true, passive: true });
  addEventListener('resize', onResize, { passive: true });
  // A post can be answered BEFORE its picture has a size: the observer's margin
  // deliberately reaches past the viewport, and a feed's images are lazy. Such a
  // media box measures 0×0 and paint skips it (verified on a live x.com
  // timeline), so the control would wait for the next scroll. An image's own load
  // event is exactly when the box gains its size — on `document` in the capture
  // phase, since load does not bubble.
  const onMediaLoad = () => scheduleReposition(true);
  document.addEventListener('load', onMediaLoad, { capture: true, passive: true });

  // === the extension went away under this tab (#594) ===

  // Put the page back the way it was found, as far as this script is concerned:
  // every corner control removed (removeControl restores the inline `position`
  // it borrowed from the page's own element), every observer disconnected, every
  // listener and timer this module installed taken back off.
  //
  // What is deliberately LEFT: the shared <hologram-extension-ui> host element.
  // It is an empty, inert, pointer-events:none fixed layer — ui-root.ts already
  // keeps it around between activations for that reason — and Alt+S still works
  // in this tab (the worker injects a FRESH capture.js, which is not orphaned),
  // so emptying the layer it may be drawing in would be taking away a live
  // script's banner. The failure banner this module may have just put there is
  // left alone for the same reason: it fades itself out on its own dwell.
  onExtensionGone(() => {
    io.disconnect();
    mo.disconnect();
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('load', onMediaLoad, { capture: true });
    removeEventListener('scroll', onScroll, { capture: true });
    removeEventListener('resize', onResize);
    if (queryTimer) clearTimeout(queryTimer);
    if (scanTimer) clearTimeout(scanTimer);
    if (scrollHoverTimer !== null) clearTimeout(scrollHoverTimer);
    if (repositionFrame !== null) cancelAnimationFrame(repositionFrame);
    queryTimer = scanTimer = scrollHoverTimer = null;
    repositionFrame = null;
    repositionQueued = false;
    hovered = null;
    for (const [, state] of tracked) {
      for (const [, anchor] of state.anchors) {
        // Cleared here rather than in removeControl: elsewhere a phase timer
        // outliving its control is what brings the corner back after a flash,
        // and only this path wants it gone for good.
        if (anchor.timer) clearTimeout(anchor.timer);
        anchor.timer = null;
      }
      clearControls(state);
      state.anchors.clear();
    }
    tracked.clear();
    anchorOf.clear();
    visible.clear();
    pending.clear();
    // capture.ts calls this hook optionally; with no controls left there is
    // nothing for it to hide, and leaving a closure over a dead world behind
    // would be leaving one more thing on the page than was found.
    delete window.__hologramPrepareOverlayForCapture;
  });
}
