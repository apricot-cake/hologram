import { startBulkCapture } from './bulk-capture.ts';
import { cropScreenshot } from './crop.ts';
import { normalizeRect } from './extractor/dom.ts';
import { getCaptureSite } from './extractor/index.ts';
import type { CaptureSite, PostRect } from './extractor/types.ts';
import { glassUi } from './glass-ui.ts';
import { createI18n } from './i18n.ts';

export async function startCapture(): Promise<void> {
  // --- i18n ---
  const i18n = await createI18n();
  const { getMessage, partialSaveText, saveFailureText } = i18n;
  const MSG = {
    select: getMessage('bannerSelect'),
    saving: getMessage('bannerSaving'),
    saved: getMessage('bannerSaved'),
  };

  const siteConfig = getCaptureSite();
  if (!siteConfig) {
    return;
  }
  // Re-bind to a plain (never-reassigned) const: TS's null-narrowing on
  // `siteConfig` from the guard above doesn't cross into the nested `function`
  // declarations below (findPostElement, capturePost, onMouseMove, …) — the
  // same pitfall as a closure reading an outer `let`. `site` carries the
  // narrowed (non-null) type into every one of them.
  const site: CaptureSite = siteConfig;

  // Read and clear the auto-capture request before anything can return early,
  // so a flag left over from a cancelled activation can never turn a later
  // plain Alt+S into auto mode.
  const wantsAuto = window.__hologramAutoCapture === true;
  window.__hologramAutoCapture = undefined;

  // Prevent double injection — shared toggle between this single-shot mode and
  // the auto capture mode below (whichever is running, the next activation of
  // either ends it).
  if (typeof window.__snsPostSaveCleanup === 'function') {
    window.__snsPostSaveCleanup();
    return;
  }

  // #362: auto capture is a DIFFERENT gesture (Alt+Shift+S), not a mode that
  // Alt+S turns into on certain pages — Alt+S keeps meaning "save the post I
  // am about to click" everywhere, the bookmarks list included. Scoped to the
  // bookmarks list for now; anywhere else the request is simply ignored and
  // the single-shot flow below runs.
  if (wantsAuto && site.isBulkCapturePage?.()) {
    startBulkCapture(site, i18n);
    return;
  }

  window.__snsPostSaveActive = true;

  let isCleanedUp = false;
  let restoreCaptureState: (() => void) | null = null;
  let restoreOverlayState: (() => void) | null = null;
  let savedScrollPosition: { x: number; y: number } | null = null;
  let lastCapturedPost: Element | null = null; // re-measured at crop time (scroll/layout drift)

  // === UI elements ===

  // Visual language shared with the resident content script.
  // The palette is theme-independent (#136: near-opaque dark scrim + white
  // ink), so there is no async pref read to wait for. State is carried by the
  // badge fill + a tinted pill border; see glass-ui.ts for the CSP/Trusted
  // Types constraints that shape how everything is built.
  const G = glassUi;

  // Top banner — scrim-solid pill: leading icon badge + label.
  const banner = document.createElement('div');
  banner.style.cssText = [
    'position:fixed',
    'top:12px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'gap:9px',
    'padding:6px 16px 6px 7px',
    'max-width:calc(100vw - 48px)',
    'box-sizing:border-box',
    'border-radius:999px',
    `border:1px solid ${G.CARD_BORDER}`,
    `background:${G.CARD_BG}`,
    `color:${G.TEXT}`,
    `font:600 13px/1.4 ${G.FONT_SANS}`,
    `box-shadow:${G.CARD_SHADOW}`,
    'pointer-events:none',
    `transition:border-color ${G.DUR_HOVER}ms`,
  ].join(';');
  const bannerBadge = document.createElement('div');
  bannerBadge.style.cssText = `width:26px;height:26px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:${G.ACCENT_SOFT};color:${G.ACCENT_TEXT};transition:background ${G.DUR_HOVER}ms,color ${G.DUR_HOVER}ms;`;
  banner.appendChild(bannerBadge);
  const bannerLabel = document.createElement('div');
  banner.appendChild(bannerLabel);

  type BannerState = 'select' | 'busy' | 'ok' | 'partial' | 'fail';
  function setBanner(state: BannerState, text: string) {
    bannerLabel.textContent = text;
    bannerBadge.replaceChildren();
    // Reset the state-tinted border (ok/partial/fail override it below).
    banner.style.borderColor = G.CARD_BORDER;
    switch (state) {
      case 'select':
        bannerBadge.style.background = G.ACCENT_SOFT;
        bannerBadge.style.color = G.ACCENT_TEXT;
        bannerBadge.appendChild(G.makeIcon(G.ICONS.target, 15));
        break;
      case 'busy':
        bannerBadge.style.background = G.BADGE_NEUTRAL;
        bannerBadge.style.color = G.ACCENT_TEXT;
        bannerBadge.appendChild(G.makeSpinner(15));
        break;
      case 'ok':
        bannerBadge.style.background = G.OK_GREEN;
        bannerBadge.style.color = '#fff';
        bannerBadge.appendChild(G.makeIcon(G.ICONS.check, 15));
        banner.style.borderColor = 'rgba(48,164,108,0.65)';
        break;
      case 'partial':
        bannerBadge.style.background = G.WARN_AMBER;
        bannerBadge.style.color = '#fff';
        bannerBadge.appendChild(G.makeIcon(G.ICONS.warn, 15));
        banner.style.borderColor = 'rgba(232,161,58,0.65)';
        break;
      case 'fail':
        bannerBadge.style.background = G.FAIL_RED;
        bannerBadge.style.color = '#fff';
        bannerBadge.appendChild(G.makeIcon(G.ICONS.cross, 15));
        banner.style.borderColor = 'rgba(229,72,77,0.65)';
        break;
    }
  }

  setBanner('select', MSG.select);
  document.body.appendChild(banner);
  if (!G.REDUCED_MOTION) {
    // App toast entrance mirrored from the top edge: drop + slight scale settle
    // at the pop tier. transform carries the permanent translateX(-50%) — the
    // keyframes must too.
    banner.animate(
      [
        { opacity: 0, transform: 'translateX(-50%) translateY(-14px) scale(0.96)' },
        { opacity: 1, transform: 'translateX(-50%)' },
      ],
      { duration: G.DUR_POP, easing: G.EASE_OUT },
    );
  }

  // Highlight frame
  const highlight = document.createElement('div');
  highlight.style.cssText = [
    'position:absolute',
    'pointer-events:none',
    'z-index:2147483646',
    'box-sizing:border-box',
    `border:2px solid ${G.ACCENT}`,
    'border-radius:10px',
    'background:rgba(40,168,219,0.08)',
    'box-shadow:0 0 0 4px rgba(40,168,219,0.18)',
    'transition:top 0.08s, left 0.08s, width 0.08s, height 0.08s',
    'display:none',
  ].join(';');
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
      setBanner('fail', getMessage('bannerFailedReason', [getMessage('reasonNoPermalink')]));
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
    // #311: also hide the resident overlay's saved-mark / hover-save-button
    // controls — they draw over the post the same way the highlight does, and
    // would otherwise end up baked into the saved screenshot.
    restoreOverlayState = window.__hologramPrepareOverlayForCapture?.() || null;

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

        // 'flex' explicitly — display lives only in the inline cssText, so
        // resetting to '' after the display:none hide would fall back to block
        // (badge and label would stack).
        banner.style.display = 'flex';
        setBanner('busy', MSG.saving);

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

  // The pill leaves the way it arrived (rise back + settle, pop tier) — an
  // abrupt remove() reads as a glitch next to the app's toast. The listeners
  // are already gone when this runs, so the lingering element is inert.
  function dismissBanner() {
    if (G.REDUCED_MOTION || !banner.isConnected || banner.style.display === 'none') {
      banner.remove();
      return;
    }
    const anim = banner.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(-50%) translateY(-14px) scale(0.96)' }], { duration: G.DUR_POP, easing: G.EASE_OUT });
    anim.onfinish = () => banner.remove();
    anim.oncancel = () => banner.remove();
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
    restoreOverlayState?.();
    restoreOverlayState = null;
    restoreScroll();
    dismissBanner();
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
      void cropScreenshot(msg.dataUrl, msg.rect, () => (lastCapturedPost?.isConnected ? getPostRect(lastCapturedPost) : null)).then((croppedDataUrl) => {
        restoreScroll();
        sendResponse(croppedDataUrl ? { croppedDataUrl } : null);
      });
      return true; // async response
    }

    // Result notification
    if (msg.type === 'notify') {
      // Saved but the post-info API returned nothing → amber "partial" state so
      // the user notices (rather than a plain green success). Held longer.
      const partial = msg.success && msg.metaOk === false;
      let text: string;
      if (!msg.success) {
        // The background keeps the raw diagnostic detail out of the page and
        // passes only a classified reason suitable for localized recovery advice.
        text = saveFailureText(msg.errorKind);
      } else {
        // grouped > 0: this post was already saved this session — the app folds
        // same-post saves into one stacked card, so say so instead of a plain
        // success (otherwise the save looks like a silent no-op in the grid).
        text = partial ? partialSaveText(msg.metaReason) : msg.grouped > 0 ? getMessage('bannerSavedGrouped', [msg.grouped + 1]) : MSG.saved;
      }
      setBanner(partial ? 'partial' : msg.success ? 'ok' : 'fail', text);
      if (msg.success && !partial && !G.REDUCED_MOTION) {
        // Small badge pop so the state flip reads even in peripheral vision
        // (app hologramBadgePop: .3s on the shared ease-out curve).
        bannerBadge.animate([{ transform: 'scale(0.6)' }, { transform: 'scale(1.12)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 300, easing: G.EASE_OUT });
      }
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
}
