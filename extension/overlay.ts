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
// The controls live in ONE fixed-position overlay layer appended to <body>, not
// inside the posts. Injecting nodes into the host page's own subtree means
// fighting its framework (x.com and bsky.app both re-render their feed
// constantly, and an unexpected child is a real crash risk for React's DOM
// reconciliation) and mutating its layout; an overlay costs one rect read per
// visible control per scroll frame instead, and touches nothing. A control in
// the layer can still be clicked: the layer is inert, each control is not.
(() => {
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
    el: HTMLDivElement | null;
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
  const SCAN_DEBOUNCE_MS = 250; // feed mutations arrive in floods
  const CONTROL_SIZE = 22;
  const SAVE_WIDTH = 68;
  const SAVE_HEIGHT = 28;
  const CONTROL_INSET = 6;
  // The save button waits out a pass-through, so scrolling with the pointer
  // over the feed doesn't strobe buttons. The mark does NOT wait: it answers a
  // question the user already has, and a delay reads as lag.
  const SAVE_ARM_MS = 100;
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
  if (window.__hologramOverlayActive) return; // avoid double-binding on re-injection
  window.__hologramOverlayActive = true;

  // Shared scrim-solid vocabulary (glass-ui.js — declared before this file in the
  // same manifest entry, so it is a synchronous global by now).
  const G = window.hologramGlassUi;

  let markMode: MarkMode = 'hover';
  let hoverSave = true;
  let layer: HTMLDivElement | null = null;
  const tracked = new Map<Element, UnitState>();
  const anchorOf = new Map<Element, { unit: Element; anchor: Anchor }>(); // media box -> its anchor
  const visible = new Set<Element>();
  const pending = new Set<Element>();
  let queryTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let repositionQueued = false;
  let repositionFull = false;
  let hovered: Anchor | null = null;
  let saveArmed = false; // the hovered anchor has outlived SAVE_ARM_MS
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  let t: (key: string, subs?: ReadonlyArray<unknown>) => string = (key) => key;
  let partialSaveText: (reason?: string | null) => string = () => t('bannerSavedNoMeta');
  if (window.hologramI18n && typeof window.hologramI18n.then === 'function') {
    window.hologramI18n.then((api) => {
      if (api && api.getMessage) t = api.getMessage;
      if (api && api.partialSaveText) partialSaveText = api.partialSaveText;
      paintAll(); // re-title controls already on screen
    });
  }

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

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
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
  document.addEventListener(
    'pointerover',
    (e) => {
      const pe = e as PointerEvent;
      setHovered(anchorAtPoint(pe.clientX, pe.clientY));
    },
    true,
  );
  document.addEventListener(
    'pointerout',
    (e) => {
      if (!(e as PointerEvent).relatedTarget) setHovered(null); // pointer left the document
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
    saveArmed = false;
    if (armTimer) clearTimeout(armTimer);
    armTimer = null;
    if (next) {
      armTimer = setTimeout(() => {
        armTimer = null;
        saveArmed = true;
        repaintAnchor(next);
      }, SAVE_ARM_MS);
    }
    if (previous) repaintAnchor(previous);
    if (next) repaintAnchor(next);
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

  function ensureLayer(): HTMLDivElement {
    if (layer?.isConnected) return layer;
    const el = document.createElement('div');
    el.id = '__hologramSavedLayer';
    // Fixed and viewport-sized, so a control's absolute coordinates ARE its
    // anchor's getBoundingClientRect() — no scroll offset math, and no
    // dependence on the host page's positioning context.
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    document.body.appendChild(el);
    layer = el;
    return el;
  }

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
      const anchor: Anchor = { box, el: null, face: null, phase: 'idle', timer: null, note: null };
      state.anchors.set(box, anchor);
      anchorOf.set(box, { unit, anchor });
    }
  }

  function imgIn(box: Element): HTMLImageElement | null {
    if (box.tagName === 'IMG') return box as HTMLImageElement;
    return box.querySelector('img');
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
      const born = !el;
      if (!el) {
        el = document.createElement('div');
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
          `transition:width ${G.DUR_HOVER}ms ${G.EASE_OUT},height ${G.DUR_HOVER}ms ${G.EASE_OUT},border-radius ${G.DUR_HOVER}ms ${G.EASE_OUT},background ${G.DUR_HOVER}ms,color ${G.DUR_HOVER}ms,box-shadow ${G.DUR_HOVER}ms`,
          'pointer-events:auto',
        ].join(';');
        anchor.el = el;
        ensureLayer().appendChild(el);
      }
      if (anchor.face !== face) {
        drawFace(el, face, anchor, unit, state);
        anchor.face = face;
      }
      el.style.left = `${rect.left + CONTROL_INSET}px`;
      el.style.top = `${rect.top + CONTROL_INSET}px`;
      // Media scrolled out from under a still-visible unit (tall posts): hide
      // rather than park the control at the viewport edge.
      el.style.display = rect.bottom < 0 || rect.top > window.innerHeight ? 'none' : 'flex';
      if (born && !G.REDUCED_MOTION)
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

  function drawFace(el: HTMLDivElement, face: Face, anchor: Anchor, unit: Element, state: UnitState) {
    el.replaceChildren();
    el.onclick = null;
    el.onpointerdown = null;
    el.onkeydown = null;
    el.removeAttribute('role');
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
        // A text-bearing button makes the one action here unambiguous. The
        // saved mark stays a small circle; only the actionable state expands.
        el.style.width = `${SAVE_WIDTH}px`;
        el.style.height = `${SAVE_HEIGHT}px`;
        el.style.padding = '0 9px';
        el.style.gap = '5px';
        el.style.borderRadius = '8px';
        el.style.background = G.ACCENT_FILL;
        el.style.borderColor = 'rgba(255,255,255,0.56)';
        el.style.boxShadow = '0 7px 18px -6px rgba(0,0,0,0.68), inset 0 1px 0 rgba(255,255,255,0.20)';
        el.style.color = '#fff';
        el.style.cursor = 'pointer';
        el.appendChild(G.makeIcon(G.ICONS.drop, 14));
        const label = document.createElement('span');
        label.textContent = t('hoverSave');
        label.style.cssText = `font:600 12px/1 ${G.FONT_SANS};letter-spacing:0;white-space:nowrap;pointer-events:none;`;
        el.appendChild(label);
        // Both handlers stop the event: the control is outside the post's
        // subtree, but x.com and bsky.app listen on the document, and a press
        // that reached them would open the lightbox behind the save.
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', t('hoverSaveImage'));
        el.tabIndex = 0;
        el.onpointerdown = stopPress;
        el.onclick = (e) => {
          stopPress(e);
          startSave(unit, state, anchor);
        };
        el.onkeydown = (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
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
  }

  function clearControls(state: UnitState) {
    for (const [, anchor] of state.anchors) removeControl(anchor);
  }

  function reposition() {
    repositionQueued = false;
    const full = repositionFull;
    repositionFull = false;
    let detached = false;
    for (const unit of visible) {
      const state = tracked.get(unit);
      if (!state) continue;
      if (!unit.isConnected) {
        detached = true;
        continue;
      }
      // Scrolling only moves what is already drawn. Re-deciding every visible
      // post would mean a querySelectorAll and a forced layout per post per
      // frame, most of them for posts showing nothing at all.
      if (!full && !showing(state)) continue;
      paint(unit, state);
    }
    if (detached) forgetDetached();
  }

  function showing(state: UnitState): boolean {
    for (const [, anchor] of state.anchors) if (anchor.el) return true;
    return false;
  }

  // full = re-decide what every visible post shows, not just move what's drawn.
  function scheduleReposition(full: boolean) {
    if (full) repositionFull = true;
    if (repositionQueued) return;
    repositionQueued = true;
    requestAnimationFrame(reposition);
  }

  addEventListener('scroll', () => scheduleReposition(false), { capture: true, passive: true });
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
})();
