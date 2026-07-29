import { startBulkCapture } from './bulk-capture.ts';
import { cropScreenshot } from './crop.ts';
import { buildChoiceRow, checkDuplicate, pagePictureUrls } from './duplicate-guard.ts';
import { reportSaveTimeout } from './capture-log.ts';
import { SAVE_WATCHDOG_MS } from './deadline.ts';
import { normalizeRect } from './extractor/dom.ts';
import { getCaptureSite } from './extractor/index.ts';
import type { CaptureSite, PostRect } from './extractor/types.ts';
import { ICONS } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { createI18n } from './i18n.ts';
import type { BackgroundToContentMessage, CaptureAndSendMessage, CaptureAndSendResponse, CropImageResponse, LogCaptureMessage } from './messages.ts';

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
  // The duplicate warning was answered "replace" (#34). Kept here rather than
  // read back off the ack: the background reports what it SAVED, and the
  // retirement of the old capture is the app's later job — so the only side
  // that knows this save was a replacement is the one that asked.
  let replacing = false;
  // The deadline on waiting for the save's result, and the latch that keeps the
  // banner from being written twice when a late answer follows a timeout (#507).
  let saveWatchdog: ReturnType<typeof setTimeout> | null = null;
  let saveSettled = false;

  // === UI elements ===

  // Top banner — the `banner` face of the surface every on-page save path draws
  // with (#44 — status-surface.ts). This file used to own a private copy of the
  // state→colour→glyph table; now it decides only WHICH state it is in.
  const banner = new StatusSurface({ variant: 'banner', resting: ICONS.target });
  // Named for the test harnesses, which cannot read the localized label (the
  // banner follows the browser locale) — the same role data-hologram-choice
  // plays for the duplicate warning's answers. The state rides along on the
  // component's own data-state, so a test can assert "this save ended" without
  // matching wording.
  banner.el.setAttribute('data-hologram-capture-banner', '');

  banner.setState('active', MSG.select);
  banner.mount();
  banner.enter();

  // The selection frame: geometry over the post about to be captured, drawn in
  // the same root as the banner. `position: fixed` inside that root means these
  // are VIEWPORT coordinates — the old element lived in the page and carried
  // the scroll offset itself.
  const highlight = document.createElement('div');
  highlight.className = 'highlight';
  highlight.style.display = 'none';
  (banner.el.parentNode || document.body).appendChild(highlight);
  // Where the pointer last was, so a scroll can re-aim the frame. The frame no
  // longer rides the document, so without this it would sit still while the
  // post moved out from under it until the next mouse move.
  let lastPointer: { x: number; y: number } | null = null;

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
      } satisfies LogCaptureMessage);
    } catch {
      /* ignore — diagnostics are non-essential */
    }
  }

  // === Event handlers ===

  function onMouseMove(e: MouseEvent) {
    lastPointer = { x: e.clientX, y: e.clientY };
    aimHighlight(findPostElement(e.target));
  }

  // Viewport coordinates: the frame lives in the fixed overlay root now, so the
  // scroll offset it used to add would push it off by a screenful.
  function aimHighlight(post: Element | null) {
    if (!post) {
      highlight.style.display = 'none';
      return;
    }
    const rect = getPostRect(post);
    highlight.style.display = 'block';
    highlight.style.top = rect.top - 4 + 'px';
    highlight.style.left = rect.left - 4 + 'px';
    highlight.style.width = rect.width + 8 + 'px';
    highlight.style.height = rect.height + 8 + 'px';
  }

  // A wheel or keyboard scroll moves the posts without moving the pointer, and
  // no mousemove follows. Re-asking which post is under the pointer keeps the
  // frame on the post the user is actually aiming at — the old document-bound
  // frame got this for free by scrolling with the page.
  function onScroll() {
    if (!lastPointer) return;
    aimHighlight(findPostElement(document.elementFromPoint(lastPointer.x, lastPointer.y)));
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
      banner.setState('error', getMessage('bannerFailedReason', [getMessage('reasonNoPermalink')]));
      setTimeout(cleanup, 2800);
      return;
    }

    // Remove event listeners (capture is single-shot). Done BEFORE the
    // duplicate check so a second click cannot pick another post while the
    // question is on screen; Esc still cancels (onKeyDown stays registered).
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('contextmenu', onContextMenu, true);
    removeEventListener('scroll', onScroll, true);
    highlight.style.display = 'none';

    // #34: ask the library BEFORE shooting anything. checkDuplicate answers
    // null for every case that leaves the question open (setting off, host
    // unreachable, post not saved), and the capture then runs unchanged.
    checkDuplicate(site.platform, postUrl, pagePictureUrls(post))
      .catch(() => null)
      .then((hit) => {
        if (isCleanedUp) return; // Esc while we were asking
        if (!hit) {
          shoot(post, postUrl, null);
          return;
        }
        banner.setState('ask', getMessage('dupTitle'));
        banner.slot(
          buildChoiceRow(getMessage, (choice) => {
            if (isCleanedUp) return;
            if (choice === 'skip') {
              banner.setState('success', getMessage('dupSkipped'));
              setTimeout(cleanup, 1500);
              return;
            }
            replacing = choice === 'replace';
            shoot(post, postUrl, replacing ? hit.captureId : null);
          }),
        );
      });
  }

  // Everything from "the post is decided" onward: hide our own overlays, bring
  // the post fully into view, shoot, and hand the crop rect to the background.
  function shoot(post: Element, postUrl: string, replaces: string | null) {
    // Hide the highlight and banner before capturing
    highlight.style.display = 'none';
    banner.hide();
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

        // Back from the hide that kept it out of the screenshot. The display it
        // returns to is the stylesheet's now, so this only has to clear the
        // inline `none` — the old code had to name `flex` because that value
        // lived in the element's own cssText.
        banner.show();
        banner.setState('busy', MSG.saving);

        // From here the banner is waiting on someone else, so from here it has
        // a deadline (#507). Two ways out, and the save is over on whichever
        // arrives first:
        //
        //   the channel closes without a reply — Chrome's own signal that the
        //     service worker went away mid-save (MV3 stops it at any idle
        //     moment). Fast, and the common case.
        //   nothing at all, for SAVE_WATCHDOG_MS — the backstop, longer than
        //     everything the background is itself allowed to spend, so a slow
        //     save is never called a failure and a stuck one still ends.
        saveWatchdog = setTimeout(() => {
          saveWatchdog = null;
          endSaveUnanswered(postUrl, `save timed out — no result from the background within ${SAVE_WATCHDOG_MS}ms`);
        }, SAVE_WATCHDOG_MS);

        chrome.runtime.sendMessage(
          {
            type: 'captureAndSend',
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            postUrl,
            platform: site.platform,
            replaces,
          } satisfies CaptureAndSendMessage,
          (res?: CaptureAndSendResponse) => {
            // The RESULT arrives separately, as a notify push — this callback
            // is read only for the absence of one. A reply of either kind means
            // the background is alive and has said its piece (a failure sends
            // notify too), so the banner is left to that handler.
            if (res) return;
            const error = `save timed out — ${chrome.runtime.lastError?.message || 'the background closed the channel without answering'}`;
            endSaveUnanswered(postUrl, error);
          },
        );
      });
    });
  }

  // No result is coming. Say so, say what to do next, and leave a line behind:
  // this is the failure that used to be silent in every direction at once —
  // banner spinning, capture.log empty.
  function endSaveUnanswered(postUrl: string, error: string) {
    if (isCleanedUp || saveSettled) return;
    saveSettled = true;
    clearSaveWatchdog();
    reportSaveTimeout('capture', site.platform, postUrl, error);
    banner.setState('error', saveFailureText('timeout'));
    setTimeout(cleanup, 2800);
  }

  function clearSaveWatchdog() {
    if (saveWatchdog === null) return;
    clearTimeout(saveWatchdog);
    saveWatchdog = null;
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
  // are already gone when this runs, so the lingering element is inert. A
  // banner hidden for the screenshot has nothing to play, so it just goes.
  function dismissBanner() {
    if (banner.hidden) banner.remove();
    else banner.exit();
  }

  function cleanup() {
    if (isCleanedUp) return;
    isCleanedUp = true;
    clearSaveWatchdog(); // Esc during a save: the banner is going, the timer must too

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('contextmenu', onContextMenu, true);
    document.removeEventListener('keydown', onKeyDown, true);
    removeEventListener('scroll', onScroll, true);
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

  function onRuntimeMessage(msg: BackgroundToContentMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: CropImageResponse) => void) {
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
      // The answer came: stand the watchdog down. A notify arriving AFTER the
      // deadline is ignored — the user has already been told this save failed,
      // and flipping the banner back would be worse than being late.
      if (saveSettled) return undefined;
      saveSettled = true;
      clearSaveWatchdog();
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
        // A replacement says so INSTEAD of "grouped": the earlier record is on
        // its way to the trash, so calling it a merge would be wrong.
        text = partial ? partialSaveText(msg.metaReason) : replacing ? getMessage('dupReplaced') : msg.grouped > 0 ? getMessage('bannerSavedGrouped', [msg.grouped + 1]) : MSG.saved;
      }
      banner.setState(partial ? 'partial' : msg.success ? 'success' : 'error', text);
      // Small badge pop so the state flip reads even in peripheral vision
      // (app hologramBadgePop: .3s on the shared ease-out curve).
      if (msg.success && !partial) banner.pop();
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
  addEventListener('scroll', onScroll, { capture: true, passive: true });
}
