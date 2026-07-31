import { startBulkCapture } from './bulk-capture.ts';
import { cropScreenshot } from './crop.ts';
import { buildChoiceRow, checkDuplicate, formatDeletedAt, pagePictureUrls } from './duplicate-guard.ts';
import { logSaveEvent, newSaveId, reportSaveTimeout, type SaveStage } from './capture-log.ts';
import { noteExtensionGone } from './extension-context.ts';
import { type SaveDeadline, startSaveDeadline } from './save-deadline.ts';
import { normalizeRect } from './extractor/dom.ts';
import { readDomMeta } from './extractor/dom-meta.ts';
import { getCaptureSite } from './extractor/index.ts';
import type { CaptureSite, DomMeta, PostRect } from './extractor/types.ts';
import { ICONS } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { createI18n } from './i18n.ts';
import { userOnly } from './user-gesture.ts';
import type { BackgroundToContentMessage, CaptureAndSendMessage, CaptureAndSendResponse, CropImageResponse } from './messages.ts';

export async function startCapture(): Promise<void> {
  // --- i18n ---
  const i18n = await createI18n();
  const { getMessage, partialSaveText, saveFailureText, skewSaveText } = i18n;
  const MSG = {
    select: getMessage('bannerSelect'),
    saving: getMessage('bannerSaving'),
    saved: getMessage('bannerSaved'),
    extensionReloaded: getMessage('bannerExtensionReloaded'),
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
  let chosenUrl: string | null = null; // the post being saved, for the cancel line
  // The duplicate warning was answered "replace" (#34). Kept here rather than
  // read back off the ack: the background reports what it SAVED, and the
  // retirement of the old capture is the app's later job — so the only side
  // that knows this save was a replacement is the one that asked.
  let replacing = false;
  // What the page showed for the chosen post (#202), read once at the moment
  // it was chosen. Held here rather than re-read at send time because the two
  // are separated by a scroll-into-view, a screenshot and two animation frames,
  // and X's virtual list recycles rows across all of that — the element under
  // `post` can be a different post's row by then.
  let domMeta: DomMeta | null = null;
  // The deadline on waiting for the save's result, and the latch that keeps the
  // banner from being written twice when a late answer follows a timeout (#507).
  let saveDeadline: SaveDeadline | null = null;
  let saveSettled = false;

  // --- What this activation has done so far, for capture.log (#519) ----------
  //
  // How far this session got, so that closing it can say WHAT was abandoned
  // rather than just stopping. `null` means the session is over as far as the
  // log is concerned (it has already written its own ending), which is what
  // keeps cleanup() from adding a cancel line after a save that succeeded,
  // failed, or was answered "don't save".
  let openStage: Extract<SaveStage, 'select' | 'duplicate' | 'save'> | null = 'select';
  // Minted when a post is chosen, and from then on carried by every line this
  // save writes in any of the three processes.
  let saveId: string | null = null;
  // The stages the service worker has reported finishing (SaveProgressMessage).
  // Held here for one reason: if the worker is then killed, this side is all
  // that is left to write a line, and this is the only way that line can say
  // where the save had got to.
  let reached: SaveStage[] = [];

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
  function logCaptureFailure(stage: SaveStage, el: unknown) {
    logSaveEvent({ stage, phase: 'fail', saveId, platform: site.platform, locationHref: location.href, clickedSnap: snapEl(el) });
  }

  // The user stopped: Esc, a right-click, or a second activation. Written so
  // that abandoning a save is not the same silence as a save that hung — the
  // confusion that had this log misread twice (#519). `openStage` says WHAT was
  // abandoned, and clearing it makes this once per session at most.
  function logCancel() {
    if (!openStage) return;
    const stage = openStage;
    openStage = null;
    logSaveEvent({ stage, phase: 'cancel', saveId, reached, platform: site.platform, url: chosenUrl });
  }

  // === Event handlers ===

  // What the user DECIDED — this post, or not this session — as opposed to
  // where the pointer is. Only these three cross the page's event path into a
  // save or out of a session, so only these three require a trusted event
  // (#323 — utils/user-gesture.ts). Wrapped once here rather than at each
  // addEventListener call because removeEventListener needs this exact
  // reference back; the handlers themselves are hoisted declarations below.
  const onUserClick = userOnly(onClick);
  const onUserContextMenu = userOnly(onContextMenu);
  const onUserKeyDown = userOnly(onKeyDown);

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
    // A post has been chosen, so from here there is a save attempt to identify
    // — every line written from now on, in any of the three processes, carries
    // this id (#519).
    saveId = newSaveId();

    // Metadata is fetched from the platform API in the background from this URL.
    // The page identifies the clicked post and its permalink — and, since #202,
    // is also read as a SECOND source for the fields that API cannot answer
    // (a protected or age-restricted X post, and the counts syndication has no
    // field for). readDomMeta never throws: a broken selector must cost the
    // extra metadata, never the save.
    const postUrl = site.getPermalink(post);
    domMeta = readDomMeta(site, post);

    // Without a permalink the API metadata can't be fetched either — the save
    // would produce a platform:null record the viewer never shows. Abort here,
    // surface the reason on the banner, and log the grabbed element so the
    // cause can be pinned down quickly.
    if (!postUrl) {
      openStage = null; // this line IS the session's ending; no cancel after it
      logCaptureFailure('permalink', post);
      banner.setState('error', getMessage('bannerFailedReason', [getMessage('reasonNoPermalink')]));
      setTimeout(cleanup, 2800);
      return;
    }

    // Remove event listeners (capture is single-shot). Done BEFORE the
    // duplicate check so a second click cannot pick another post while the
    // question is on screen; Esc still cancels (onKeyDown stays registered).
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onUserClick, true);
    document.removeEventListener('contextmenu', onUserContextMenu, true);
    removeEventListener('scroll', onScroll, true);
    highlight.style.display = 'none';

    // #34: ask the library BEFORE shooting anything. checkDuplicate answers
    // null for every case that leaves the question open (setting off, host
    // unreachable, post not saved), and the capture then runs unchanged.
    chosenUrl = postUrl;
    openStage = 'duplicate';
    checkDuplicate(site.platform, postUrl, pagePictureUrls(post))
      .catch(() => null)
      .then((hit) => {
        if (isCleanedUp) return; // Esc while we were asking
        if (!hit) {
          shoot(post, postUrl, null);
          return;
        }
        // #158: the same question, for a post sitting in the trash rather than in
        // the library. Dated when the record said when, undated when it did not.
        const deletedOn = hit.trashed ? formatDeletedAt(hit.trashed.deletedAt) : '';
        banner.setState('ask', hit.trashed ? (deletedOn ? getMessage('trashedTitleOn', [deletedOn]) : getMessage('trashedTitle')) : getMessage('dupTitle'));
        banner.slot(
          buildChoiceRow(
            getMessage,
            (choice) => {
              if (isCleanedUp) return;
              if (choice === 'skip') {
                // Answering "don't save" is a decision, not a hang. Recorded as
                // `skip` rather than `cancel` because nothing was abandoned: the
                // post is already in the library, which is why we asked (#519).
                openStage = null;
                logSaveEvent({ stage: 'duplicate', phase: 'skip', saveId, platform: site.platform, url: postUrl });
                banner.setState('success', getMessage('dupSkipped'));
                setTimeout(cleanup, 1500);
                return;
              }
              replacing = choice === 'replace';
              shoot(post, postUrl, replacing ? hit.captureId : null);
            },
            hit.trashed ? 'trashed' : 'duplicate',
          ),
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
        //   the worker stops saying anything — either it never took the save or
        //     it stopped between legs (save-deadline.ts). A slow save keeps
        //     reporting stages, so it is never called a failure.
        saveDeadline = startSaveDeadline(saveId, (error) => endSaveUnanswered(postUrl, error));

        // A save is now in flight, so Esc from here abandons a save rather than
        // a selection — and the log should say which (#519).
        openStage = 'save';

        // #594: this script is injected fresh on every activation, so it is not
        // orphaned the way the resident one is — but the extension can still be
        // updated in the seconds between Alt+S and the click that picks a post,
        // and then this call throws. Without the catch the deadline armed just
        // above is the only thing left running, and the banner would blame a
        // timeout for an extension that is merely newer than this script.
        try {
          chrome.runtime.sendMessage(
            {
              type: 'captureAndSend',
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              postUrl,
              platform: site.platform,
              saveId: saveId as string,
              replaces,
              domMeta,
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
        } catch {
          endSaveOrphaned();
        }
      });
    });
  }

  // The extension was replaced under this capture (#594). Nothing to report to —
  // the log line would travel through the same severed connection — so the
  // banner is the whole of it, and it names the one repair that works. Shares
  // endSaveUnanswered's bookkeeping so an answer arriving late cannot re-open a
  // save this already closed.
  function endSaveOrphaned() {
    if (isCleanedUp || saveSettled) return;
    saveSettled = true;
    openStage = null;
    clearSaveDeadline();
    noteExtensionGone();
    banner.setState('error', MSG.extensionReloaded);
    setTimeout(cleanup, 2800);
  }

  // No result is coming. Say so, say what to do next, and leave a line behind:
  // this is the failure that used to be silent in every direction at once —
  // banner spinning, capture.log empty.
  function endSaveUnanswered(postUrl: string, error: string) {
    if (isCleanedUp || saveSettled) return;
    saveSettled = true;
    openStage = null; // the timeout line below is this session's ending
    clearSaveDeadline();
    reportSaveTimeout('capture', site.platform, postUrl, error, saveId, reached);
    banner.setState('error', saveFailureText('timeout'));
    setTimeout(cleanup, 2800);
  }

  function clearSaveDeadline() {
    saveDeadline?.settle();
    saveDeadline = null;
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
    // Before the listeners go: if this session still had something open, the
    // user is what ended it. No-op when the session already wrote its own
    // ending (saved, failed, timed out, answered "don't save").
    logCancel();
    clearSaveDeadline(); // Esc during a save: the banner is going, the timer must too

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onUserClick, true);
    document.removeEventListener('contextmenu', onUserContextMenu, true);
    document.removeEventListener('keydown', onUserKeyDown, true);
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

    // How far the save has got. Remembered, never drawn and never logged on
    // arrival: its only reader is the timeout line this side writes if the
    // service worker then goes quiet (#519 — see SaveProgressMessage).
    if (msg.type === 'saveProgress') {
      if (msg.saveId === saveId) reached = msg.reached;
      return undefined;
    }

    // Result notification
    if (msg.type === 'notify') {
      // The answer came: stand the watchdog down. A notify arriving AFTER the
      // deadline is ignored — the user has already been told this save failed,
      // and flipping the banner back would be worse than being late.
      if (saveSettled) return undefined;
      saveSettled = true;
      openStage = null; // the background/host lines are this save's ending
      clearSaveDeadline();
      // Saved but the post-info API returned nothing → amber "partial" state so
      // the user notices (rather than a plain green success). Held longer.
      const partial = msg.success && msg.metaOk === false;
      // The extension and the native host were built from different versions of
      // their shared contract (#205). Said on a SUCCESSFUL save, and said ahead
      // of every other success wording: the others describe this save, which
      // worked, while this one says the tool itself is half-updated and the next
      // save may not. Shown in the amber "needs attention" state rather than
      // green for the same reason, and held as long as a partial save.
      const skewText = msg.success ? skewSaveText(msg.hostSkew) : null;
      const attention = partial || !!skewText;
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
        text = skewText ?? (partial ? partialSaveText(msg.metaReason, msg.domFilled) : replacing ? getMessage('dupReplaced') : msg.grouped > 0 ? getMessage('bannerSavedGrouped', [msg.grouped + 1]) : MSG.saved);
      }
      banner.setState(attention ? 'partial' : msg.success ? 'success' : 'error', text);
      // Small badge pop so the state flip reads even in peripheral vision
      // (app hologramBadgePop: .3s on the shared ease-out curve).
      if (msg.success && !attention) banner.pop();
      // Hold failures (and anything needing attention) longer so it is readable.
      setTimeout(cleanup, attention || !msg.success ? 2800 : 1500);
    }
    return undefined;
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // === Listener registration ===
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onUserClick, true);
  document.addEventListener('contextmenu', onUserContextMenu, true);
  document.addEventListener('keydown', onUserKeyDown, true);
  addEventListener('scroll', onScroll, { capture: true, passive: true });
}
