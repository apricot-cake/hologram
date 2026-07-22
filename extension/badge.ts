// Persistent content script (manifest content_scripts for x / bsky / pixiv).
// Marks timeline posts that are ALREADY in the Hologram library, so "did I save
// this one?" is answerable without leaving the feed (#54).
//
// The answer comes from the native host via background.js (see queryBridge
// there): the host reads the library's own index, so this works with the desktop
// app closed. Nothing about the page is sent anywhere — the only thing that
// leaves the tab is a permalink the page itself published, and it goes to a local
// process. Permalink extraction is site-detect.js's getSiteConfig().getPermalink,
// the same function the capture path uses, so a badge can never disagree with
// what a save would record.
//
// The badges live in ONE fixed-position overlay layer appended to <body>, not
// inside the posts. Injecting nodes into the host page's own subtree means
// fighting its framework (x.com and bsky.app both re-render their feed
// constantly, and an unexpected child is a real crash risk for React's DOM
// reconciliation) and mutating its layout; an overlay costs one rect read per
// visible badge per scroll frame instead, and touches nothing.
(() => {
  interface BadgeSite {
    // Every post-shaped element in the feed. Matched elements are candidates —
    // getPermalink decides whether one really identifies a post.
    unitSelector: string;
    // The post's media (what the badge sits on the corner of). null = this unit
    // shows no media, so it gets no badge: the mark reads as "this picture is in
    // your library", and there is nowhere honest to put it otherwise.
    mediaOf(unit: Element): Element | null;
  }

  interface UnitState {
    url: string | null;
    saved: boolean;
    badge: HTMLDivElement | null;
  }

  const SETTING_KEY = 'savedBadge'; // chrome.storage.local; default ON (see #54)
  const QUERY_DEBOUNCE_MS = 300; // one batch per scroll burst, not per post
  const SCAN_DEBOUNCE_MS = 250; // feed mutations arrive in floods
  const BADGE_SIZE = 22;
  const BADGE_INSET = 6;
  // Enter/leave the query set well before a post is on screen, so a badge is
  // already decided by the time the user can see the post.
  const OBSERVER_MARGIN = '200px';
  // A whole feed's worth of units is capped so a runaway page (infinite scroll
  // that never unmounts) cannot grow this map without bound.
  const MAX_TRACKED = 600;

  const detected = getBadgeSite();
  if (!detected) return;
  // getSiteConfig (site-detect.js — declared before this file in the same
  // manifest entry) owns permalink extraction; resolved once, not per post.
  const detectedCapture = getSiteConfig();
  if (!detectedCapture) return;
  // Re-bound as already-narrowed consts: TS does not carry a null-narrowing
  // into the closures below (same constraint drag.ts's DropZone works around).
  const site: BadgeSite = detected;
  const capture: NonNullable<ReturnType<typeof getSiteConfig>> = detectedCapture;
  if (window.__hologramSavedBadgeActive) return; // avoid double-binding on re-injection
  window.__hologramSavedBadgeActive = true;

  // Shared scrim-solid vocabulary (glass-ui.js — declared before this file in the
  // same manifest entry, so it is a synchronous global by now).
  const G = window.hologramGlassUi;

  let enabled = true;
  let layer: HTMLDivElement | null = null;
  const tracked = new Map<Element, UnitState>();
  const visible = new Set<Element>();
  const pending = new Set<Element>();
  let queryTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let repositionQueued = false;

  let tooltip = 'Hologram に保存済み';
  if (window.hologramI18n && typeof window.hologramI18n.then === 'function') {
    window.hologramI18n.then((api) => {
      if (api && api.getMessage) tooltip = api.getMessage('badgeSaved');
      for (const [, state] of tracked) if (state.badge) state.badge.title = tooltip;
    });
  }

  // === settings ===

  chrome.storage.local.get(SETTING_KEY, (got) => {
    if (chrome.runtime.lastError) return; // storage unavailable — stay on (the default)
    setEnabled(got[SETTING_KEY] !== false);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTING_KEY]) return;
    setEnabled(changes[SETTING_KEY].newValue !== false);
  });

  function setEnabled(next: boolean) {
    if (next === enabled) return;
    enabled = next;
    if (!enabled) {
      for (const [, state] of tracked) removeBadge(state);
      return;
    }
    for (const unit of visible) pending.add(unit);
    scheduleQuery();
  }

  // === discovery ===

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.add(entry.target);
          const state = tracked.get(entry.target);
          if (state?.saved) placeBadge(entry.target, state);
          else pending.add(entry.target);
        } else {
          visible.delete(entry.target);
          pending.delete(entry.target);
          const state = tracked.get(entry.target);
          // Off-screen posts keep their ANSWER (scrolling back is free) but drop
          // their badge element, so the layer only ever holds what's on screen.
          if (state) removeBadge(state);
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
      tracked.set(unit, { url: null, saved: false, badge: null });
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
      removeBadge(state);
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
    if (!enabled || !chrome.runtime?.id) {
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
      // next scroll (its negative cache never recorded these).
      if (chrome.runtime.lastError || !res?.ok || !res.results) return;
      for (const [url, units] of byUrl) {
        const saved = res.results[url] != null;
        for (const unit of units) {
          const state = tracked.get(unit);
          if (!state) continue;
          state.saved = saved;
          if (saved && visible.has(unit)) placeBadge(unit, state);
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
      if (visible.has(unit)) placeBadge(unit, state);
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

  // === drawing ===

  function ensureLayer(): HTMLDivElement {
    if (layer?.isConnected) return layer;
    const el = document.createElement('div');
    el.id = '__hologramSavedLayer';
    // Fixed and viewport-sized, so a badge's absolute coordinates ARE its
    // anchor's getBoundingClientRect() — no scroll offset math, and no
    // dependence on the host page's positioning context.
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    document.body.appendChild(el);
    layer = el;
    return el;
  }

  function makeBadge(): HTMLDivElement {
    const el = document.createElement('div');
    // pointer-events:auto only on the badge itself (the layer stays inert), so
    // the tooltip works without the mark eating clicks meant for the post.
    el.style.cssText = [
      'position:absolute',
      `width:${BADGE_SIZE}px`,
      `height:${BADGE_SIZE}px`,
      'border-radius:50%',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'box-sizing:border-box',
      `background:${G.CARD_BG}`,
      `color:${G.TEXT}`,
      `border:1px solid ${G.CARD_BORDER}`,
      `box-shadow:${G.CARD_SHADOW}`,
      'pointer-events:auto',
    ].join(';');
    el.title = tooltip;
    // Monotone check (not the accent): the mark states a fact about the post,
    // it is not an action to take, so it stays out of the accent's vocabulary.
    el.appendChild(G.makeIcon(G.ICONS.check, 14));
    return el;
  }

  function placeBadge(unit: Element, state: UnitState) {
    if (!enabled || !state.saved) return;
    const media = site.mediaOf(unit);
    if (!media) return; // nothing to mark — see BadgeSite.mediaOf
    const rect = media.getBoundingClientRect();
    // Skip a media box too small to carry the mark without covering the picture
    // (a collapsed placeholder, a still-loading thumbnail).
    if (rect.width < BADGE_SIZE * 2 || rect.height < BADGE_SIZE * 2) return;
    let el = state.badge;
    if (!el) {
      el = makeBadge();
      state.badge = el;
      ensureLayer().appendChild(el);
      if (!G.REDUCED_MOTION)
        el.animate(
          [
            { opacity: 0, transform: 'scale(0.6)' },
            { opacity: 1, transform: 'scale(1.08)', offset: 0.6 },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { duration: G.DUR_POP, easing: G.EASE_OUT },
        );
    }
    // Top-left corner: the one corner all three platforms leave empty (X and
    // Bluesky put their ALT/GIF chips bottom-left, pixiv its page count top-right
    // and its bookmark heart bottom-right).
    el.style.left = `${rect.left + BADGE_INSET}px`;
    el.style.top = `${rect.top + BADGE_INSET}px`;
    // Media scrolled out from under a still-visible unit (tall posts): hide
    // rather than park the mark at the viewport edge.
    el.style.display = rect.bottom < 0 || rect.top > window.innerHeight ? 'none' : 'flex';
  }

  function removeBadge(state: UnitState) {
    state.badge?.remove();
    state.badge = null;
  }

  function reposition() {
    repositionQueued = false;
    let detached = false;
    for (const unit of visible) {
      const state = tracked.get(unit);
      if (!state) continue;
      if (!unit.isConnected) {
        detached = true;
        continue;
      }
      if (state.saved) placeBadge(unit, state);
    }
    if (detached) forgetDetached();
  }

  function scheduleReposition() {
    if (repositionQueued) return;
    repositionQueued = true;
    requestAnimationFrame(reposition);
  }

  addEventListener('scroll', scheduleReposition, { capture: true, passive: true });
  addEventListener('resize', scheduleReposition, { passive: true });

  // === per-platform DOM ===

  function getBadgeSite(): BadgeSite | null {
    if (hostnameMatches('x.com') || hostnameMatches('twitter.com')) {
      return {
        unitSelector: 'article[data-testid="tweet"]',
        // querySelector returns document order, not selector order: a post with
        // several photos has one tweetPhoto box each, so this is the FIRST
        // image's box — where the badge belongs on a multi-image post.
        mediaOf: (unit) => unit.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]'),
      };
    }
    if (hostnameMatches('bsky.app')) {
      return {
        unitSelector: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]',
        mediaOf: (unit) => unit.querySelector('img[src*="/img/feed_thumbnail/"], img[src*="/img/feed_fullsize/"], video'),
      };
    }
    if (hostnameMatches('pixiv.net')) {
      return {
        // pixiv's feed unit IS the thumbnail link; a card also carries a title
        // link to the same artwork, so require the image to keep one badge per
        // card (getPermalink resolves both to the same URL either way).
        unitSelector: 'a[href*="/artworks/"]',
        mediaOf: (unit) => unit.querySelector('img'),
      };
    }
    return null;
  }
})();
