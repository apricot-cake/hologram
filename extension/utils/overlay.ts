// Persistent content script (manifest content_scripts for x / bsky / pixiv).
// The extension's timeline overlay: one control in the corner of a post's
// picture that both ANSWERS and ACTS --
//
//   already in the library -> a "saved" mark (#54)
//   not in the library yet -> a save button on hover (#94)
//
// They are one system, not two features: the state decides which face the
// corner shows, so the user learns a single place to look.
//
// The answer comes from the native host via background.js (see queryBridge
// there): the host reads the library's own index, so this works with the desktop
// app closed. Nothing about the page is sent anywhere -- the only thing that
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
// change, a re-render of the page's own markup -- none of those decide anything
// by themselves; they only move pictures, after which geometry is asked again.
// Every path goes through pointerStillOn() (overlay/positioning.ts), so "the
// button stays while the cursor is on the picture" holds by construction
// rather than by each path remembering to check (#347).
//
// Each control is an absolutely-positioned child of its media box (or, for an
// <img>, its immediate parent). That makes the browser move it in the same
// composited scroll as the picture. A fixed layer that copies viewport
// coordinates has to wait for JavaScript on every scroll frame and visibly
// trails smooth scrolling.
//
// A text-only post has no picture to be that child of (#575's "saved" mark,
// #363's save button stays out of scope). Its unit becomes its own host --
// already positioned, already sized -- and the mark sits just under the
// post's own avatar rather than the picture's corner: X's more-options menu
// already owns the opposite corner and the action row shares the text
// column's left edge, so that is the one strip neither platform draws
// anything into. Same vocabulary, a different landmark to sit beside.
//
// Staying in the page's subtree used to mean staying in the page's CASCADE
// too: a host rule as ordinary as `button { all: unset !important }` beats an
// inline style, so the corner was one stylesheet away from having no box at
// all. #310 closes that without moving anything -- what is inserted into the
// subtree is a <hologram-corner-control> host element with its OWN small shadow
// root, and the disc lives inside it (overlay/control.ts). Host CSS cannot
// select into a shadow tree, so the only surface left exposed is the host
// element's own box, and that is written as inline !important (the top of
// the author cascade, the same trick ui-root.ts uses for the fixed layer's
// host). Scroll following and stacking order are untouched: the host element
// is still an ordinary absolutely positioned child of the picture.
//
// #399 split what used to be one closure into modules by why-it-changes:
// overlay/tracker.ts (which posts exist and are on screen), overlay/saved-
// state.ts (batching "is this saved?" and caching the answer),
// overlay/positioning.ts (where the corner's host mounts and whether the
// pointer is still on it), overlay/control.ts (the host + disc + which face
// to draw). This file is the controller: it assembles them, owns the
// settings and the save flow, and is the one place that reaches into more
// than one of them at once.
import { newSaveId, reportSaveTimeout } from './capture-log.ts';
import { extensionAlive, noteExtensionGone, onExtensionGone } from './extension-context.ts';
import { startSaveDeadline } from './save-deadline.ts';
import { collectImageUrls, getCaptureSite, getMediaIdentitySite, getOverlaySite } from './extractor/index.ts';
import type { CaptureSite, OverlaySite } from './extractor/types.ts';
import { ICONS } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { ensureTokens, motion, prefersReducedMotion } from './tokens.ts';
import { createI18n } from './i18n.ts';
import type { ImageDraggedMessage, SaveResponse } from './messages.ts';
import { CONTROL_SIZE } from './overlay/constants.ts';
import { clearControls, drawFace, faceFor, makeControlHost, removeControl } from './overlay/control.ts';
import * as positioning from './overlay/positioning.ts';
import { addSavedPictures, createSavedQuery, permalinkOf } from './overlay/saved-state.ts';
import { createTracker } from './overlay/tracker.ts';
import type { Anchor, MarkMode, Phase, UnitState } from './overlay/types.ts';

let overlayActive = false;

export async function startOverlay(): Promise<() => void> {
  const MARK_MODE_KEY = 'savedBadgeMode'; // chrome.storage.local, 'always' | 'hover' | 'off'
  const HOVER_SAVE_KEY = 'hoverSaveButton'; // chrome.storage.local, boolean
  const QUERY_DEBOUNCE_MS = 300; // one batch per scroll burst, not per post
  // Ends a scroll burst before clearing the control that scrolled out from
  // under a stationary pointer. This never delays a real pointer hover.
  const SCROLL_HOVER_SETTLE_MS = 100;
  const SCAN_DEBOUNCE_MS = 250; // feed mutations arrive in floods
  const FLASH_MS = 1400; // "saved" confirmation after a press
  const ERROR_MS = 2500; // failure shown, then back to a button to retry
  const SAVE_BANNER_MS = 2800; // same readable dwell as the Alt+S failure banner
  // Enter/leave the query set well before a post is on screen, so a mark is
  // already decided by the time the user can see the post.
  const OBSERVER_MARGIN = '200px';
  // A whole feed's worth of units is capped so a runaway page (infinite scroll
  // that never unmounts) cannot grow this map without bound.
  const MAX_TRACKED = 600;

  const detected = getOverlaySite();
  if (!detected) return () => undefined;
  // The extractor's capture phase owns permalink extraction and its media
  // identity owns "which post is this picture from"; both come from the same
  // site module as the overlay shape above. Resolved once, not per post.
  const detectedCapture = getCaptureSite();
  if (!detectedCapture) return () => undefined;
  // Re-bound as already-narrowed consts: TS does not carry a null-narrowing
  // into the closures below (same constraint drag.ts's DropZone works around).
  const site: OverlaySite = detected;
  const capture: CaptureSite = detectedCapture;
  // May be null on a page media-identity has no rules for: marks still work
  // (they only need a permalink), the save button simply never appears.
  const media = getMediaIdentitySite();
  if (overlayActive) return () => undefined;
  overlayActive = true;

  // #311: capture.ts (a separate, on-demand content script sharing this same
  // isolated world -- see __hologramAutoCapture/__snsPostSaveCleanup for the
  // established pattern) screenshots the tab with chrome.tabs.captureVisibleTab,
  // which shoots whatever is drawn on screen, this overlay's corner included.
  // Every control carries the same data attribute, so one query finds them
  // all -- no per-control tracking needed. Only the pointer being still (which
  // it is, mid-capture) keeps new ones from appearing in the couple of
  // repaint frames this stays in effect, same as the highlight/banner hide
  // right next to this call in capture.ts.
  window.__hologramPrepareOverlayForCapture = () => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-hologram-overlay]'));
    // Priority is carried, not just the value: the host element writes its own
    // `display` as !important (control.ts's CONTROL_HOST_STYLE), so a plain
    // assignment would lose to it and the corner would be photographed after
    // all.
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
  // browser's light/dark setting (#270 -- see tokens.ts).
  ensureTokens();

  let markMode: MarkMode = 'always';
  let hoverSave = true;
  let saveBanner: StatusSurface | null = null;
  let saveBannerTimer: ReturnType<typeof setTimeout> | null = null;
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
      if (chrome.runtime.lastError) return; // storage unavailable -- stay on the defaults
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
      for (const unit of tracker.visible) savedQuery.add(unit);
      savedQuery.scheduleQuery();
    }
  }

  function queriesWanted(): boolean {
    return markMode !== 'off' || hoverSave;
  }

  // === discovery + asking ===
  //
  // tracker.ts owns which units exist/are on screen; saved-state.ts owns
  // batching "is this saved?" and the cache. Wired together here because an
  // intersection change decides BOTH "paint what's known" and "go find out
  // what isn't" (#334), and neither module should have to import the other
  // just to say so.

  const tracker = createTracker(
    site,
    { maxTracked: MAX_TRACKED, scanDebounceMs: SCAN_DEBOUNCE_MS, observerMargin: OBSERVER_MARGIN },
    {
      onAnchorRemoved(anchor) {
        removeControl(anchor);
        if (hovered === anchor) hovered = null;
      },
      onEnter(unit, state) {
        // Painted even while the answer is unknown: that is what registers
        // the post's pictures as hover targets, and the save button is
        // offered on anything not known to be saved.
        paint(unit, state);
        if (!state.saved) savedQuery.add(unit);
      },
      onLeave(unit, state) {
        // Off-screen posts keep their ANSWER (scrolling back is free) but drop
        // their controls, so the layer only ever holds what's on screen.
        savedQuery.forget(unit);
        clearControls(state);
      },
      onIntersectionSettled() {
        // An intersection change is layout, not pointer input: mid-scroll it may
        // not hand the hover to another picture, which is what made a stationary
        // pointer pick up every image passing beneath it (#347).
        updateHoveredAtPointer(!inScrollBurst);
        savedQuery.scheduleQuery();
      },
      onMutation(childrenChanged, modalChanged) {
        if (hovered && (childrenChanged || modalChanged)) {
          if (!hovered.box.isConnected) rehomeHover(hovered);
          else if (!positioning.pointerStillOn(hovered, pointerPosition)) setHovered(null);
        }
      },
    },
  );

  const savedQuery = createSavedQuery({
    debounceMs: QUERY_DEBOUNCE_MS,
    tracked: tracker.tracked,
    isVisible: (unit) => tracker.visible.has(unit),
    isWanted: queriesWanted,
    isAlive: extensionAlive,
    getPermalink: (unit) => permalinkOf(capture, unit),
    getMedia: () => media,
    onResolved: (unit, state) => paint(unit, state),
  });

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
  // press -- the one event that has something to tell them -- could never happen.
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

  // Every visible unit's anchors, flattened -- the scope anchorAtPoint reads
  // (only the on-screen ones, not every one ever tracked).
  function* visibleAnchors(): Generator<Anchor> {
    for (const unit of tracker.visible) {
      const state = tracker.tracked.get(unit);
      if (!state) continue;
      yield* state.anchors.values();
    }
  }

  function setHovered(next: Anchor | null) {
    if (next === hovered) return;
    const previous = hovered;
    hovered = next;
    if (previous) repaintAnchor(previous);
    if (next) repaintAnchor(next);
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
    const next = positioning.anchorAtPoint(visibleAnchors(), pointerPosition.x, pointerPosition.y);
    if (next && positioning.modalCovers(next)) {
      setHovered(null);
      return;
    }
    if (!adopt && next !== hovered) {
      if (!positioning.pointerStillOn(hovered, pointerPosition)) setHovered(null);
      return;
    }
    setHovered(next);
    if (hovered && positioning.pointerIsOccluded(hovered, pointerPosition)) setHovered(null);
  }

  // The page REPLACED the hovered picture's element instead of moving it -- a
  // virtualized timeline re-renders its posts as you scroll, and x.com does
  // this under a resting pointer. The picture is still on screen, still under
  // the pointer; only the node is new. Re-read the unit's media boxes and take
  // the hover straight to the new element, because dropping it here left the
  // pointer sitting on a picture with no button until the user jiggled the
  // mouse (#347).
  function rehomeHover(anchor: Anchor) {
    const found = tracker.anchorOf.get(anchor.box);
    setHovered(null);
    // The POST went away too (the feed recycled it, not re-rendered it): what
    // is under the pointer now is a different post's picture, and handing the
    // button to that would be the very thing the scroll rule forbids. Leave it
    // to the next pointer move.
    if (!found || !found.unit.isConnected) return;
    const state = tracker.tracked.get(found.unit);
    if (state) paint(found.unit, state); // syncAnchors picks up the new box
    updateHoveredAtPointer(true);
  }

  function repaintAnchor(anchor: Anchor) {
    const found = tracker.anchorOf.get(anchor.box);
    if (!found) return;
    const state = tracker.tracked.get(found.unit);
    if (state) paint(found.unit, state);
  }

  // === saving ===

  // THE place a hover save says anything in words. The corner itself says none
  // (#310): a 24px circle cannot hold "open the diagnostics page from the
  // extension settings", and putting it in a `title` only meant the sentence
  // existed somewhere nobody with a keyboard or a phone would ever reach. So
  // the sentence comes here, to the same banner Alt+S uses -- which already has
  // the width, the state colours and the `alert` role for it.
  //
  // Only the outcomes the user could not have predicted get one. A plain
  // success stays silent (the mark appearing IS the answer), whereas `partial`
  // -- saved, but the post's own text and author are missing -- is a fact about
  // this save that nothing on screen would otherwise state (#367). The same banner
  // also carries the #205 protocol-skew notice (drag.ts and capture.ts already
  // did; hover save was the one save route still silent about it, #576) -- the
  // save still succeeded, so it rides the amber `partial` state rather than a
  // fourth face of its own.
  function showSaveBanner(state: 'error' | 'partial', text: string) {
    if (saveBannerTimer) clearTimeout(saveBannerTimer);
    saveBannerTimer = null;
    saveBanner?.remove();

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
  // and then -- ten seconds later, from the deadline that was all that survived
  // the throw -- "the save didn't finish so it was cancelled (restart Chrome if
  // this repeats)", which is a healthy extension being blamed and the one
  // repair that works (reload THIS page) never mentioned. Shown once: the
  // teardown that runs with it takes the button away, so there is nothing left
  // to press a second time.
  function reportOrphaned() {
    noteExtensionGone();
    showSaveBanner('error', t('bannerExtensionReloaded'));
  }

  function startSave(unit: Element, state: UnitState, anchor: Anchor) {
    if (anchor.phase !== 'idle' || !media) return; // already in flight -- one press, one save
    if (!extensionAlive()) {
      reportOrphaned();
      return;
    }
    // Identity is read HERE, never cached on the anchor: a virtualized feed
    // reuses the same box element for a different post as you scroll, and a
    // cached postUrl would file the new picture under the old post.
    const el = positioning.postMediaIn(anchor.box);
    const identity = el && media.extractIdentity(el);
    if (!el || !identity) return;
    setPhase(anchor, 'saving', 0);
    paint(unit, state);
    // The same message drag.js sends on drop. A page-side button cannot use the
    // capture path at all (chrome.tabs.captureVisibleTab needs activeTab, which
    // is only granted by a toolbar or command gesture), so this is not a
    // preference -- it is the one save route available here, and reusing it means
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
        failSave(unit, state, anchor, saveFailureText(res && !res.ok ? res.errorKind : undefined, res && !res.ok ? res.metaReason : undefined, res && !res.ok ? res.queued : undefined));
        return;
      }
      // Mark the PICTURE here rather than waiting for background.js's
      // savedUpdate push: the push is correct but arrives after the host has
      // written its journal, and the corner the user just pressed should not
      // sit blank in the meantime. Only this picture -- the post's others are
      // still unsaved, and that is the whole point of #334. The host reports
      // what it recorded; the page's own URLs for this picture are the fallback
      // (they key to the same picture, which is what mediaKeyOf guarantees).
      state.saved = addSavedPictures(state.saved, Array.isArray(res.media) && res.media.length ? res.media : collectImageUrls(el, media.platform), media);
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
    // is already armed by the time it does -- so an unguarded throw leaves the
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

  function paintAll() {
    for (const unit of tracker.visible) {
      const state = tracker.tracked.get(unit);
      if (state) paint(unit, state);
    }
  }

  function paint(unit: Element, state: UnitState) {
    if (!unit.isConnected) return;
    tracker.syncAnchors(unit, state);
    // The box's position in the unit, which is the media row's seq the library
    // recorded for it -- the fallback identity for a picture no URL can name.
    let index = -1;
    for (const [, anchor] of state.anchors) {
      index += 1;
      const rect = anchor.box.getBoundingClientRect() as DOMRect;
      // A media box with no size is a collapsed placeholder or an image that
      // has not laid out yet; there is nowhere to put a control on it. For a
      // text anchor the box is the whole post (always sized) and it is the
      // AVATAR the mark is placed against, so that is what has to have laid out
      // -- a lazy avatar of 0x0 would otherwise put the disc outside the post.
      const placedOn = anchor.kind === 'text' ? (site.textAnchorIn?.(anchor.box)?.getBoundingClientRect() ?? null) : rect;
      const tooSmall = !placedOn || placedOn.width < CONTROL_SIZE || placedOn.height < CONTROL_SIZE || (anchor.kind === 'media' && (rect.width < CONTROL_SIZE * 2 || rect.height < CONTROL_SIZE * 2));
      const face = tooSmall ? null : faceFor({ state, anchor, index, rect, markMode, hoverSave, hoveredAnchor: hovered, media });
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
        if (!positioning.mountControl(anchor, made.el)) continue;
        anchor.el = made.el;
        anchor.root = made.root;
      }
      const el = anchor.el;
      if (!el) continue;
      if (born || anchor.face !== face) {
        drawFace(anchor, face, t, {
          onSave: () => startSave(unit, state, anchor),
          onRetry: () => {
            setPhase(anchor, 'idle', 0);
            startSave(unit, state, anchor);
          },
        });
        anchor.face = face;
        // Named for the tests, which cannot read the localized name (the corner
        // follows the browser locale) -- the same role data-hologram-choice
        // plays for the duplicate warning's buttons.
        el.setAttribute('data-hologram-face', face);
      }
      positioning.positionControl(anchor, el, site);
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

  function reposition() {
    repositionFrame = null;
    repositionQueued = false;
    const full = repositionFull;
    repositionFull = false;
    updateHoveredAtPointer(!inScrollBurst);
    if (!full) return;
    let detached = false;
    for (const unit of tracker.visible) {
      const state = tracker.tracked.get(unit);
      if (!state) continue;
      if (!unit.isConnected) {
        detached = true;
        continue;
      }
      paint(unit, state);
    }
    if (detached) tracker.forgetDetached();
  }

  // Full repainting is for layout changes such as resize and image load.
  function scheduleReposition(full: boolean) {
    if (full) repositionFull = true;
    if (repositionQueued) return;
    repositionQueued = true;
    repositionFrame = requestAnimationFrame(reposition);
  }

  // Ends the burst -- the point from which layout may hand the hover to another
  // picture again. The last scroll event is not that point: momentum and
  // smooth scrolling keep moving the page after it, so the geometry is asked
  // once more here.
  function settleHoverAfterScroll() {
    if (scrollHoverTimer !== null) clearTimeout(scrollHoverTimer);
    scrollHoverTimer = setTimeout(() => {
      scrollHoverTimer = null;
      inScrollBurst = false;
      if (hovered && !positioning.pointerStillOn(hovered, pointerPosition)) setHovered(null);
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
    if (hovered && !positioning.pointerStillOn(hovered, pointerPosition)) setHovered(null);
    settleHoverAfterScroll();
  };
  const onResize = () => scheduleReposition(true);
  addEventListener('scroll', onScroll, { capture: true, passive: true });
  addEventListener('resize', onResize, { passive: true });
  // A post can be answered BEFORE its picture has a size: the observer's margin
  // deliberately reaches past the viewport, and a feed's images are lazy. Such a
  // media box measures 0x0 and paint skips it (verified on a live x.com
  // timeline), so the control would wait for the next scroll. An image's own load
  // event is exactly when the box gains its size -- on `document` in the capture
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
  // It is an empty, inert, pointer-events:none fixed layer -- ui-root.ts already
  // keeps it around between activations for that reason -- and Alt+S still works
  // in this tab (the worker injects a FRESH capture.js, which is not orphaned),
  // so emptying the layer it may be drawing in would be taking away a live
  // script's banner. The failure banner this module may have just put there is
  // left alone for the same reason: it fades itself out on its own dwell.
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('load', onMediaLoad, { capture: true });
    removeEventListener('scroll', onScroll, { capture: true });
    removeEventListener('resize', onResize);
    if (scrollHoverTimer !== null) clearTimeout(scrollHoverTimer);
    if (repositionFrame !== null) cancelAnimationFrame(repositionFrame);
    scrollHoverTimer = null;
    repositionFrame = null;
    repositionQueued = false;
    hovered = null;
    for (const [, state] of tracker.tracked) {
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
    tracker.dispose();
    savedQuery.dispose();
    // capture.ts calls this hook optionally; with no controls left there is
    // nothing for it to hide, and leaving a closure over a dead world behind
    // would be leaving one more thing on the page than was found.
    delete window.__hologramPrepareOverlayForCapture;
    overlayActive = false;
  };
  const stopWatchingContext = onExtensionGone(cleanup);
  return () => {
    stopWatchingContext();
    cleanup();
  };
}
