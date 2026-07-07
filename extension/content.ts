// Platform detection (getSiteConfig) and the PostRect/SiteConfig types it
// returns live in site-detect.ts (loaded before this file — see background.ts's
// executeScript files list and tsconfig.json's global-script header comment).

(async () => {
  // --- i18n ---
  // i18n.js is injected alongside this script (see background.js → executeScript).
  const { getMessage } = await window.corpusI18n;
  const MSG = {
    select: getMessage('bannerSelect'),
    saving: getMessage('bannerSaving'),
    saved: getMessage('bannerSaved'),
    savedNoMeta: getMessage('bannerSavedNoMeta'),
    failed: getMessage('bannerFailed'),
  };

  const siteConfig = getSiteConfig();
  if (!siteConfig) {
    return;
  }
  // Re-bind to a plain (never-reassigned) const: TS's null-narrowing on
  // `siteConfig` from the guard above doesn't cross into the nested `function`
  // declarations below (findPostElement, capturePost, onMouseMove, …) — the
  // same pitfall as a closure reading an outer `let`. `site` carries the
  // narrowed (non-null) type into every one of them.
  const site: SiteConfig = siteConfig;

  // Prevent double injection
  if (typeof window.__snsPostSaveCleanup === 'function') {
    window.__snsPostSaveCleanup();
    return;
  }
  window.__snsPostSaveActive = true;

  let isCleanedUp = false;
  let restoreCaptureState: (() => void) | null = null;
  let savedScrollPosition: { x: number; y: number } | null = null;
  let lastCapturedPost: Element | null = null; // re-measured at crop time (scroll/layout drift)

  // === UI elements ===

  // Top banner
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    background: #1d9bf0; color: #fff; padding: 8px 20px; border-radius: 24px;
    font: 600 14px/1.4 -apple-system, sans-serif; z-index: 2147483647;
    pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    transition: opacity 0.2s;
  `;
  banner.textContent = MSG.select;
  document.body.appendChild(banner);

  // Highlight frame
  const highlight = document.createElement('div');
  highlight.style.cssText = `
    position: absolute; pointer-events: none; z-index: 2147483646;
    box-sizing: border-box;
    border: 3px solid #1d9bf0; border-radius: 4px;
    background: rgba(29, 155, 240, 0.06);
    transition: top 0.08s, left 0.08s, width 0.08s, height 0.08s;
    display: none;
  `;
  document.body.appendChild(highlight);

  let captureStyle: HTMLStyleElement | null = null;
  if (site.captureStyleText) {
    captureStyle = document.createElement('style');
    captureStyle.textContent = site.captureStyleText;
    document.head.appendChild(captureStyle);
  }

  // === Post detection ===

  function findPostElement(target: EventTarget | null): Element | null {
    if (typeof site.findPostElement === 'function') {
      return site.findPostElement(target);
    }

    let el: Element | null = target instanceof Element ? target : ((target as Node | null)?.parentElement ?? null);
    while (el) {
      if (site.postSelector && el.matches?.(site.postSelector)) {
        if (!site.isPostElement || site.isPostElement(el)) {
          return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function getPostRect(post: Element): PostRect {
    return normalizeRect(site.getCaptureRect?.(post) || post.getBoundingClientRect());
  }

  // === Diagnostic logging ===

  // A small, PII-light snapshot of the clicked element so a broken selector can
  // be diagnosed from capture.log without a repro. outerHTML is truncated (the
  // tag / data-testid / nearest anchor href is what identifies a selector break).
  function snapEl(el: unknown) {
    if (!(el instanceof Element)) return null;
    const anchor = el.closest('a[href]') || (el.querySelector ? el.querySelector('a[href]') : null);
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : null,
      testid: el.getAttribute ? el.getAttribute('data-testid') : null,
      role: el.getAttribute ? el.getAttribute('role') : null,
      closestAnchorHref: anchor ? anchor.getAttribute('href') : null,
      outerHTML: (el.outerHTML || '').slice(0, 400),
    };
  }

  // Report a pre-bridge failure (no post element / no permalink) to the
  // background, which relays it to the host's capture.log. Best-effort.
  function logCaptureFailure(stage: string, el: unknown) {
    try {
      chrome.runtime.sendMessage({
        type: 'logCapture',
        entry: { stage, phase: 'fail', platform: site.platform, locationHref: location.href, clickedSnap: snapEl(el) },
      });
    } catch {
      /* ignore — diagnostics are non-essential */
    }
  }

  // === Event handlers ===

  function onMouseMove(e: MouseEvent) {
    const post = findPostElement(e.target);
    if (post) {
      const rect = getPostRect(post);
      highlight.style.display = 'block';
      highlight.style.top = rect.top + window.scrollY - 4 + 'px';
      highlight.style.left = rect.left + window.scrollX - 4 + 'px';
      highlight.style.width = rect.width + 8 + 'px';
      highlight.style.height = rect.height + 8 + 'px';
    } else {
      highlight.style.display = 'none';
    }
  }

  function capturePost(post: Element) {
    // Metadata is fetched from the platform API in the background from this URL.
    // The page is only used to identify the clicked post and its permalink.
    const postUrl = site.getPermalink(post);

    // Without a permalink the API metadata can't be fetched either — the save
    // would produce a platform:null record the viewer never shows. Abort here,
    // surface the reason on the banner, and log the grabbed element so the
    // cause can be pinned down quickly.
    if (!postUrl) {
      logCaptureFailure('permalink', post);
      banner.textContent = getMessage('bannerFailedReason', [getMessage('reasonNoPermalink')]);
      banner.style.background = '#f4212e';
      setTimeout(cleanup, 2800);
      return;
    }

    // Remove event listeners (capture is single-shot)
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('contextmenu', onContextMenu, true);

    // Hide the highlight and banner before capturing
    highlight.style.display = 'none';
    banner.style.display = 'none';
    restoreCaptureState = site.prepareForCapture?.(post) || null;

    // If the post is cut off, scroll it fully into the viewport
    const preRect = getPostRect(post);
    if (preRect.top < 0 || preRect.bottom > window.innerHeight) {
      savedScrollPosition = { x: window.scrollX, y: window.scrollY };
      post.scrollIntoView({ block: 'start', behavior: 'instant' });
      // X/Bluesky overlay a sticky header (~50px) at the top of the column —
      // block:'start' would pin the author row underneath it.
      window.scrollBy(0, -64);
    }

    // Wait for a repaint before capturing
    lastCapturedPost = post;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const rect = getPostRect(post);

        banner.style.display = '';
        banner.textContent = MSG.saving;
        banner.style.background = '#536471';

        chrome.runtime.sendMessage({
          type: 'captureAndSend',
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          postUrl,
          platform: site.platform,
        });
      });
    });
  }

  function onClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const post = findPostElement(e.target);
    if (!post) {
      // Keep waiting (retry-friendly — a stray click shouldn't end the session),
      // but record what was clicked so a broken postSelector is diagnosable from
      // capture.log without a repro.
      logCaptureFailure('select', e.target);
      return;
    }
    capturePost(post);
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    cleanup();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') cleanup();
  }

  // === Cleanup ===

  // Restore the scroll position (idempotent: runs once whichever path gets here
  // first — success, failure, or cancel — and a second call is a no-op).
  function restoreScroll() {
    if (savedScrollPosition) {
      window.scrollTo({ left: savedScrollPosition.x, top: savedScrollPosition.y, behavior: 'instant' });
      savedScrollPosition = null;
    }
  }

  function cleanup() {
    if (isCleanedUp) return;
    isCleanedUp = true;

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('contextmenu', onContextMenu, true);
    document.removeEventListener('keydown', onKeyDown, true);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    restoreCaptureState?.();
    restoreCaptureState = null;
    restoreScroll();
    banner.remove();
    highlight.remove();
    captureStyle?.remove();
    window.__snsPostSaveActive = false;

    if (window.__snsPostSaveCleanup === cleanup) {
      delete window.__snsPostSaveCleanup;
    }
  }

  window.__snsPostSaveCleanup = cleanup;

  // === Message listener ===

  function onRuntimeMessage(msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
    // Crop request
    if (msg.type === 'cropImage') {
      const { dataUrl } = msg;
      const dpr = window.devicePixelRatio || 1;

      // Re-measure the post NOW (the screenshot was taken moments ago, not at
      // click time — inertial scroll / lazy-image relayout can shift it), then
      // clamp to the viewport: captureVisibleTab only has visible pixels, and
      // an overflowing rect would encode the missing area as black bands.
      let rect = msg.rect;
      if (lastCapturedPost && lastCapturedPost.isConnected) {
        try {
          rect = getPostRect(lastCapturedPost);
        } catch {
          rect = msg.rect;
        }
      }
      const cx = Math.max(0, rect.x);
      const cy = Math.max(0, rect.y);
      const cw = Math.max(1, Math.min(rect.x + rect.width, window.innerWidth) - cx);
      const ch = Math.max(1, Math.min(rect.y + rect.height, window.innerHeight) - cy);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const w = Math.round(cw * dpr);
        const h = Math.round(ch * dpr);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.drawImage(img, Math.round(cx * dpr), Math.round(cy * dpr), w, h, 0, 0, w, h);
        sendResponse({ croppedDataUrl: canvas.toDataURL('image/jpeg', 0.92) });
        restoreScroll();
      };
      img.onerror = () => {
        restoreScroll();
        sendResponse(null);
      };
      img.src = dataUrl;
      return true; // async response
    }

    // Result notification
    if (msg.type === 'notify') {
      // Saved but the post-info API returned nothing → amber "partial" state so
      // the user notices (rather than a plain green success). Held longer.
      const partial = msg.success && msg.metaOk === false;
      if (!msg.success) {
        // Show WHY it failed (the background passes the stage error), so a broken
        // save is actionable instead of a bare "failed". A missing native host gets
        // a specific "restart Chrome" hint (the registry is read at startup).
        banner.textContent = msg.hostMissing ? getMessage('bannerHostMissing') : msg.error ? getMessage('bannerFailedReason', [msg.error]) : MSG.failed;
      } else {
        // grouped > 0: this post was already saved this session — the app folds
        // same-post saves into one stacked card, so say so instead of a plain
        // success (otherwise the save looks like a silent no-op in the grid).
        banner.textContent = partial ? MSG.savedNoMeta : msg.grouped > 0 ? getMessage('bannerSavedGrouped', [msg.grouped + 1]) : MSG.saved;
      }
      banner.style.background = partial ? '#f59e0b' : msg.success ? '#00ba7c' : '#f4212e';
      // Hold failures (and partials) longer so the reason is readable.
      setTimeout(cleanup, partial || !msg.success ? 2800 : 1500);
    }
    return undefined;
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // === Listener registration ===
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('keydown', onKeyDown, true);
})();
