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
// process. Permalink extraction is site-detect.js's getSiteConfig().getPermalink,
// the same function the capture path uses, so a mark can never disagree with
// what a save would record; the save button goes through media-identity.js, the
// same module drag.js saves with, for the same reason.
//
// Each control is an absolutely-positioned child of its media box (or, for an
// <img>, its immediate parent). That makes the browser move it in the same
// composited scroll as the picture. A fixed layer that copies viewport
// coordinates has to wait for JavaScript on every scroll frame and visibly
// trails smooth scrolling.
import { glassUi } from './glass-ui';
import { createI18n } from './i18n';
import { collectImageUrls, getMediaIdentitySite } from './media-identity';
import { getSiteConfig, hostnameMatches } from './site-detect';

let overlayActive = false;

export async function startOverlay(): Promise<void> {
  interface OverlaySite {
    // Every post-shaped element in the feed. Matched elements are candidates —
    // getPermalink decides whether one really identifies a post.
    unitSelector: string;
    // Every media box in the unit, in document order. The mark states a fact
    // about the POST, but the save button acts on ONE picture, so the overlay
    // tracks each box rather than only the first.
    mediaIn(unit: Element): Element[];
  }

  // What the corner is doing right now. `flash` is the moment after a save the
  // user made here: the mark shows even when marks are set to "never", because
  // the button they just pressed has to answer them.
  type Phase = 'idle' | 'saving' | 'flash' | 'error';
  // What the corner is drawing. null = nothing there.
  type Face = 'mark' | 'save' | 'busy' | 'failed';
  // How the "saved" mark is shown (options page). Default `hover`: a mark on
  // every saved post at all times is a permanent addition to someone else's
  // page, and every route to a save passes over the picture anyway, so the
  // answer is there at the moment it is needed (#309).
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

  interface UnitState {
    url: string | null;
    saved: boolean; // the bridge answers per POST, not per picture
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
  // Let the hover-only action show a little more of the media beneath it
  // without changing the shared glass treatment used by other controls.
  const SAVE_BUTTON_BG = 'rgba(20, 22, 26, 0.76)';
  const CONTROL_INSET = 6;
  const FLASH_MS = 1400; // "saved" confirmation after a press
  const ERROR_MS = 2500; // failure shown, then back to a button to retry
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
  // getSiteConfig (site-detect.js) owns permalink extraction, getMediaIdentitySite
  // (media-identity.js) owns "which post is this picture from"; both files are
  // declared before this one in the same manifest entry. Resolved once, not per post.
  const detectedCapture = getSiteConfig();
  if (!detectedCapture) return;
  // Re-bound as already-narrowed consts: TS does not carry a null-narrowing
  // into the closures below (same constraint drag.ts's DropZone works around).
  const site: OverlaySite = detected;
  const capture: NonNullable<ReturnType<typeof getSiteConfig>> = detectedCapture;
  // May be null on a page media-identity has no rules for: marks still work
  // (they only need a permalink), the save button simply never appears.
  const media = getMediaIdentitySite();
  if (overlayActive) return;
  overlayActive = true;

  const G = glassUi;

  let markMode: MarkMode = 'hover';
  let hoverSave = true;
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
  let pointerRevision = 0;
  let scrollHoverTimer: ReturnType<typeof setTimeout> | null = null;
  let saveArmed = false;
  // True from the first scroll event of a burst until it settles (or hover is
  // occluded). Suppresses hover updates from IO intersection churn below, so a
  // stationary pointer does not pick up every image that scrolls beneath it.
  let inScrollBurst = false;

  const { getMessage: t, partialSaveText } = await createI18n();

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
    const wantedMode: MarkMode = mode === 'always' || mode === 'off' ? mode : 'hover';
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
      // Skipped mid-scroll: an intersection change is layout, not pointer
      // input, and re-hitting it here is what made a stationary pointer pick
      // up every image passing beneath it (#347).
      if (!inScrollBurst) updateHoveredAtPointer();
      scheduleQuery();
    },
    { rootMargin: OBSERVER_MARGIN },
  );

  function scan() {
    if (tracked.size >= MAX_TRACKED) forgetDetached();
    for (const unit of Array.from(document.querySelectorAll(site.unitSelector))) {
      if (tracked.has(unit)) continue;
      if (tracked.size >= MAX_TRACKED) break;
      tracked.set(unit, { url: null, saved: false, anchors: new Map() });
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
    if (hovered && (childrenChanged || modalChanged) && hoveredIsOccluded()) setHovered(null);
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

    chrome.runtime.sendMessage({ type: 'checkSaved', urls: [...byUrl.keys()] }, (res: any) => {
      // A host that can't be reached answers nothing: leave the posts unmarked
      // rather than asserting "not saved". background.js already re-asks on the
      // next scroll (its negative cache never recorded these). The save button
      // still appears — offering to save is safe when the answer is unknown;
      // claiming "not saved" would not be.
      if (chrome.runtime.lastError || !res?.ok || !res.results) return;
      for (const [url, units] of byUrl) {
        const saved = res.results[url] != null;
        for (const unit of units) {
          const state = tracked.get(unit);
          if (!state) continue;
          state.saved = saved;
          if (visible.has(unit)) paint(unit, state);
        }
      }
    });
  }

  // A save made in this tab: re-mark that post without waiting for the next
  // scroll (background.js pushes this the moment the host acknowledges).
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'savedUpdate' || !message.url) return;
    for (const [unit, state] of tracked) {
      if (state.url !== message.url) continue;
      state.saved = true;
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
      pointerRevision += 1;
      updateHoveredAtPointer();
    },
    true,
  );
  document.addEventListener(
    'pointerout',
    (e) => {
      if (!(e as PointerEvent).relatedTarget) {
        pointerPosition = null;
        pointerRevision += 1;
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
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
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
    // A pointer event is deliberate input, so its save action is ready at once.
    saveArmed = next !== null;
    if (previous) repaintAnchor(previous);
    if (next) repaintAnchor(next);
  }

  // Re-read geometry only for actual pointer movement and layout changes.
  function updateHoveredAtPointer() {
    if (!pointerPosition || modalIsOpen()) {
      setHovered(null);
      return;
    }
    setHovered(anchorAtPoint(pointerPosition.x, pointerPosition.y));
    if (hoveredIsOccluded()) setHovered(null);
  }

  function modalIsOpen(): boolean {
    return [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"]')].some((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
  }

  function hoveredIsOccluded(): boolean {
    if (modalIsOpen()) return true;
    if (!hovered?.el || !hovered.host) return false;
    if (typeof document.elementsFromPoint !== 'function') return false;
    const rect = hovered.el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === hovered.el || hovered.el.contains(el) || hovered.host.contains(el)) continue;
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

  function startSave(unit: Element, state: UnitState, anchor: Anchor) {
    if (anchor.phase !== 'idle' || !media) return; // already in flight — one press, one save
    // Identity is read HERE, never cached on the anchor: a virtualized feed
    // reuses the same box element for a different post as you scroll, and a
    // cached postUrl would file the new picture under the old post.
    const img = imgIn(anchor.box);
    const identity = img && media.extractIdentity(img);
    if (!img || !identity) return;
    setPhase(anchor, 'saving', 0);
    anchor.note = null;
    paint(unit, state);
    // The same message drag.js sends on drop. A page-side button cannot use the
    // capture path at all (chrome.tabs.captureVisibleTab needs activeTab, which
    // is only granted by a toolbar or command gesture), so this is not a
    // preference — it is the one save route available here, and reusing it means
    // there is no second code path that could record something different.
    chrome.runtime.sendMessage({ type: 'imageDragged', platform: media.platform, postUrl: identity.link, imageUrls: collectImageUrls(img, media.platform) }, (res: any) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        setPhase(anchor, 'error', ERROR_MS);
        anchor.note = res?.hostMissing ? t('bannerHostMissing') : t('bannerFailed') + (res?.error ? `: ${res.error}` : '');
        paint(unit, state);
        return;
      }
      // Mark the post here rather than waiting for background.js's savedUpdate
      // push: the push is correct but arrives after the host has written its
      // journal, and the corner the user just pressed should not sit blank in
      // the meantime.
      state.saved = true;
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

  function imgIn(box: Element): HTMLImageElement | null {
    if (box.tagName === 'IMG') return box as HTMLImageElement;
    return box.querySelector('img');
  }

  function controlHost(box: Element): HTMLElement | null {
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
    const img = imgIn(anchor.box);
    if (!img || !media.isPostMedia(img)) return false;
    return media.extractIdentity(img) != null;
  }

  function faceFor(state: UnitState, anchor: Anchor, isFirst: boolean, rect: DOMRect): Face | null {
    if (anchor.phase === 'saving') return 'busy';
    if (anchor.phase === 'error') return 'failed';
    if (anchor.phase === 'flash') return 'mark';
    if (state.saved) {
      if (markMode === 'off') return null;
      // The mark answers a question about the POST, so one is enough. Shown at
      // all times it goes on the first picture; shown on hover it goes on the
      // picture being asked about.
      if (markMode === 'always') return isFirst ? 'mark' : null;
      return hovered === anchor ? 'mark' : null;
    }
    if (!hoverSave || hovered !== anchor || !saveArmed) return null;
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
    let first = true;
    for (const [, anchor] of state.anchors) {
      const isFirst = first;
      first = false;
      const rect = anchor.box.getBoundingClientRect() as DOMRect;
      // A media box with no size is a collapsed placeholder or an image that
      // has not laid out yet; there is nowhere to put a control on it.
      const tooSmall = rect.width < CONTROL_SIZE * 2 || rect.height < CONTROL_SIZE * 2;
      const face = tooSmall ? null : faceFor(state, anchor, isFirst, rect);
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
          `border:1px solid ${G.CARD_BORDER}`,
          `box-shadow:${G.CARD_SHADOW}`,
          `transition:width ${G.DUR_HOVER}ms ${G.EASE_OUT},height ${G.DUR_HOVER}ms ${G.EASE_OUT},border-radius ${G.DUR_HOVER}ms ${G.EASE_OUT},background ${G.DUR_HOVER}ms,color ${G.DUR_HOVER}ms,border-color ${G.DUR_HOVER}ms,box-shadow ${G.DUR_HOVER}ms,transform ${G.DUR_HOVER}ms ${G.EASE_OUT}`,
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
      if (born && face !== 'save' && !G.REDUCED_MOTION)
        el.animate(
          [
            { opacity: 0, transform: 'scale(0.6)' },
            { opacity: 1, transform: 'scale(1.08)', offset: 0.6 },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { duration: G.DUR_POP, easing: G.EASE_OUT },
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
    el.style.background = G.CARD_BG;
    el.style.color = G.TEXT;
    el.style.width = `${CONTROL_SIZE}px`;
    el.style.height = `${CONTROL_SIZE}px`;
    el.style.padding = '0';
    el.style.gap = '0';
    el.style.borderRadius = '50%';
    el.style.borderColor = G.CARD_BORDER;
    el.style.boxShadow = G.CARD_SHADOW;
    el.style.transform = '';
    switch (face) {
      case 'mark':
        // Monotone check (not the accent): the mark states a fact about the
        // post, it is not an action to take, so it stays out of the accent's
        // vocabulary — which is exactly what tells it apart from the button
        // that shares this corner.
        el.title = anchor.note || t('badgeSaved');
        el.appendChild(G.makeIcon(G.ICONS.check, 14));
        break;
      case 'save': {
        el.title = t('hoverSaveImage');
        // Keep the same compact, glyph-only monochrome language as the saved
        // mark. A slightly larger circle and a neutral hover lift distinguish
        // the action without adding permanent text or state color.
        el.style.width = `${SAVE_SIZE}px`;
        el.style.height = `${SAVE_SIZE}px`;
        el.style.background = SAVE_BUTTON_BG;
        el.style.color = G.TEXT;
        el.style.cursor = 'pointer';
        el.appendChild(G.makeIcon(G.ICONS.drop, 14));
        // Both handlers stop the event: the control is outside the post's
        // subtree, but x.com and bsky.app listen on the document, and a press
        // that reached them would open the lightbox behind the save.
        el.setAttribute('aria-label', t('hoverSaveImage'));
        el.tabIndex = 0;
        el.onpointerdown = stopPress;
        el.onpointerenter = () => {
          el.style.background = G.BADGE_NEUTRAL;
          el.style.borderColor = 'rgba(255,255,255,0.68)';
          el.style.boxShadow = `${G.CARD_SHADOW}, 0 0 0 2px rgba(255,255,255,0.14)`;
          el.style.transform = 'scale(1.04)';
        };
        el.onpointerleave = () => {
          el.style.background = SAVE_BUTTON_BG;
          el.style.borderColor = G.CARD_BORDER;
          el.style.boxShadow = G.CARD_SHADOW;
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
        el.appendChild(G.makeSpinner(14));
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
        el.style.background = G.FAIL_RED;
        el.style.color = '#fff';
        el.appendChild(G.makeIcon(G.ICONS.cross, 14));
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
    updateHoveredAtPointer();
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

  function settleHoverAfterScroll() {
    if (scrollHoverTimer !== null) clearTimeout(scrollHoverTimer);
    const revisionWhenScrollStopped = pointerRevision;
    scrollHoverTimer = setTimeout(() => {
      scrollHoverTimer = null;
      inScrollBurst = false;
      // A pointer event during the scroll is a deliberate new hover. Otherwise
      // the old control merely passed under the pointer, so remove it quietly.
      if (pointerRevision === revisionWhenScrollStopped) setHovered(null);
    }, SCROLL_HOVER_SETTLE_MS);
  }

  // Controls are children of their media and therefore scroll with it without
  // JavaScript. A stationary pointer must not select every image that passes
  // beneath it; after scrolling stops, clear only the old hover control.
  addEventListener(
    'scroll',
    () => {
      inScrollBurst = true;
      if (repositionFrame !== null) cancelAnimationFrame(repositionFrame);
      repositionFrame = null;
      repositionQueued = false;
      if (hoveredIsOccluded()) {
        if (scrollHoverTimer !== null) clearTimeout(scrollHoverTimer);
        scrollHoverTimer = null;
        setHovered(null);
        inScrollBurst = false;
        return;
      }
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

  // === per-platform DOM ===

  function getOverlaySite(): OverlaySite | null {
    if (hostnameMatches('x.com') || hostnameMatches('twitter.com')) {
      return {
        unitSelector: 'article[data-testid="tweet"]',
        // querySelectorAll returns document order, so the first entry is the
        // first picture of a multi-image post — where the "saved" mark belongs.
        mediaIn: (unit) => [...unit.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]')],
      };
    }
    if (hostnameMatches('bsky.app')) {
      return {
        unitSelector: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]',
        mediaIn: (unit) => [...unit.querySelectorAll('img[src*="/img/feed_thumbnail/"], img[src*="/img/feed_fullsize/"], video')],
      };
    }
    if (hostnameMatches('pixiv.net')) {
      return {
        // Two shapes, both anchors:
        //  - FEED thumbnail: a[href*="/artworks/"] — the card's own link (a card
        //    also carries a title link to the same artwork, so requiring the
        //    image keeps one control per card).
        //  - ARTWORK PAGE main illustration: a[href*="i.pximg.net"] — the
        //    full-size viewer link that wraps each page image. This is the ONE
        //    surface X and Bluesky cover for free (their post container appears on
        //    the detail page too) but pixiv did not, so the button never reached
        //    the illustration you actually came to save (#340). It reads apart
        //    from related-works thumbnails cleanly: those use /artworks/ links,
        //    the main image uses an i.pximg.net link. Manga pages are one such
        //    anchor each → one button per page; ugoira is a <canvas>, not a
        //    _p image, so isPostMedia rejects it and no button appears.
        unitSelector: 'a[href*="/artworks/"], a[href*="i.pximg.net"]',
        mediaIn: (unit) => [...unit.querySelectorAll('img')],
      };
    }
    return null;
  }
}
