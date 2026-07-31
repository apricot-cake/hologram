// X bookmarks auto capture (#362).
//
// THE MACHINE NEVER SCROLLS. The user scrolls the bookmark list at their own
// pace and this follows along, saving the posts that are not in the library
// yet. Machine-driven scrolling was rejected: X locks accounts that show
// automated behaviour (scroll cadence and input timing are among the signals it
// reads), and the account at stake is the user's. Every request X sees here is
// one the user's own scrolling already caused.
//
// NO SCREENSHOT IS TAKEN. An earlier version shot the viewport and cropped to
// the post, and the crop kept slipping off it — a virtual list re-lays out
// between measuring, shooting and cropping, so the three never agree. Dropping
// the shot cost nothing: the platform API's originals were always downloaded
// alongside it, so the record keeps the artwork at full resolution and loses
// only "how the page looked". What it removed is most of this file — the
// viewport arithmetic, the "is it framed yet" wait, the banner and overlay
// blanking, and the whole missed/recovered dance that existed because a post
// had to still be ON SCREEN when its turn came.
//
// What remains: read each post's permalink as its row appears, ask the library
// whether it is already saved (that answer comes from the native host's index —
// it never touches X, which is why re-running over covered ground is free), and
// save the rest one at a time. Because a permalink is read the instant a row
// mounts, nothing is lost to fast scrolling: the row's own arrival is the
// event, not its position.
// The bookmarks-list check lives with the rest of X's page knowledge (#212);
// this module is the intake FLOW, which is X-specific only because X is the
// one site with such a list so far.
import { logSaveEvent, newSaveId, reportSaveTimeout } from './capture-log.ts';
import { SAVED_QUERY_TIMEOUT_MS } from './deadline.ts';
import { extensionAlive, noteExtensionGone, onExtensionGone } from './extension-context.ts';
import { startSaveDeadline } from './save-deadline.ts';
import type { CaptureSite } from './extractor/types.ts';
import { isXBookmarksPage } from './extractor/x.ts';
import { ICONS } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { userOnly } from './user-gesture.ts';
import type { HologramI18nApi } from './i18n.ts';
import type { CheckSavedMessage, CheckSavedResponse, SavePostMessage, SaveResponse } from './messages.ts';

type EntryState = 'unknown' | 'queued' | 'saving' | 'saved' | 'skipped' | 'deferred' | 'unavailable' | 'ageRestricted' | 'failed';

// One save at a time, and no faster than this. The metadata fetch and the media
// download are the only things X sees, and this keeps them at a human cadence.
const MIN_SAVE_PERIOD_MS = 1000;
const END_QUIET_MS = 4000;

export function startBulkCapture(site: CaptureSite, i18n: HologramI18nApi): void {
  const t = i18n.getMessage;

  // url -> state. The element is never kept: once a permalink is read the post
  // can be saved from the URL alone, so a row being recycled mid-run is not an
  // event this has to react to.
  const entries = new Map<string, EntryState>();
  let savedCount = 0;
  let skippedCount = 0;
  let deferredCount = 0;
  let unavailableCount = 0;
  let ageRestrictedCount = 0;
  let failedCount = 0;

  let stopped = false;
  let busy = false;
  let lastSaveStartedAt = 0;
  let lastGrowthAt = Date.now();
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;

  // === UI ===
  //
  // The same banner the Alt+S capture shows (#44 — status-surface.ts). This was
  // the fourth hand-kept copy of that pill, and the one that had drifted
  // furthest: it never tinted its outline on the way out, so a run that ended
  // with failures looked the same as one that did not.
  const banner = new StatusSurface({ variant: 'banner', resting: ICONS.drop });
  banner.el.setAttribute('data-hologram-bulk-banner', '');
  banner.label.setAttribute('data-hologram-bulk-label', '');
  banner.setState('busy', '');

  // The one control on any of these surfaces: a run the user started needs a
  // way to be stopped, so this banner alone takes input.
  const stopButton = document.createElement('button');
  stopButton.type = 'button';
  stopButton.className = 'action';
  stopButton.textContent = t('bulkStop');
  // Trusted only (#323): stopping is the user's decision about their own run,
  // and this button is inside the shared shadow root the page can reach into.
  stopButton.onclick = userOnly<MouseEvent>((e) => {
    e.preventDefault();
    e.stopPropagation();
    finish(true);
  });
  banner.el.style.pointerEvents = 'auto';
  banner.slot(stopButton);

  banner.mount();
  banner.enter();

  function paint() {
    if (stopped) return;
    banner.setState('busy', t('bulkProgress', [savedCount, skippedCount]));
    banner.slot(stopButton);
  }
  paint();

  // === harvesting ===

  // Permalinks only, and only from rows as they MOUNT. The virtual list drops
  // rows the user scrolls past, but a row cannot be dropped before it is added,
  // so reading on arrival cannot miss one however fast the page moves.
  function harvestFrom(root: ParentNode) {
    const selector = site.postSelector || 'article';
    const posts: Element[] = [];
    if (root instanceof Element && root.matches?.(selector)) posts.push(root);
    for (const el of root.querySelectorAll?.(selector) || []) posts.push(el);

    let grew = false;
    for (const el of posts) {
      let url = '';
      try {
        url = site.getPermalink(el);
      } catch {
        url = '';
      }
      // A half-rendered row has no permalink anchor yet. It will mount its
      // anchor as a further mutation, which brings us back here.
      if (!url || entries.has(url)) continue;
      entries.set(url, 'unknown');
      grew = true;
    }
    if (!grew) return;
    lastGrowthAt = Date.now();
    askSaved();
  }

  // === "already saved?" ===

  // Answered by the native host's index through background.js (the #54 route),
  // so this never reaches X. That is what makes re-running the mode over posts
  // already taken cheap, and why the design needs no record of where a previous
  // run stopped: covered ground simply skips past.
  let asking = false;
  function askSaved() {
    if (asking || stopped) return;
    const urls = [...entries].filter(([, state]) => state === 'unknown').map(([url]) => url);
    if (!urls.length) return;
    // #594: the extension may have been replaced under this run. A run lasts
    // minutes, which makes this the path most likely to be standing here when
    // Chrome updates the extension on its own — and this call is reached on
    // every batch of rows the user scrolls into view, so it is what notices.
    // The probe announces, and the handler registered below ends the run.
    if (!extensionAlive()) return;
    asking = true;
    // A question that is never answered would leave `asking` stuck true and no
    // further batch would ever be sent — the run would look alive and take
    // nothing (#507). Timing out just clears the flag: the next mounted row
    // brings us back here and asks again.
    let answered = false;
    const askTimer = setTimeout(() => {
      if (answered) return;
      answered = true;
      asking = false;
    }, SAVED_QUERY_TIMEOUT_MS);
    const onAnswer = (res?: CheckSavedResponse) => {
      if (answered) return;
      answered = true;
      clearTimeout(askTimer);
      asking = false;
      if (chrome.runtime.lastError || !res?.ok || !res.results) return; // host unreachable: ask again next pass
      for (const url of urls) {
        if (entries.get(url) !== 'unknown') continue;
        if (res.results[url] != null) {
          entries.set(url, 'skipped');
          skippedCount++;
        } else {
          entries.set(url, 'queued');
        }
      }
      paint();
      schedulePump();
      askSaved(); // rows that mounted while this batch was in flight
    };
    // try/catch as well as the probe above (#594): the window between asking
    // and calling is small, not nonexistent, and an unguarded throw here comes
    // out of the MutationObserver callback that mounted the row — taking the
    // rest of the harvest with it and leaving `asking` stuck true, so the run
    // would sit under a banner that still says it is working.
    try {
      chrome.runtime.sendMessage({ type: 'checkSaved', urls } satisfies CheckSavedMessage, onAnswer);
    } catch {
      answered = true;
      clearTimeout(askTimer);
      asking = false;
      noteExtensionGone();
    }
  }

  // === save queue ===

  function nextQueued(): string | null {
    for (const [url, state] of entries) if (state === 'queued') return url;
    return null;
  }

  function schedulePump() {
    if (pumpTimer || busy || stopped) return;
    const wait = Math.max(0, MIN_SAVE_PERIOD_MS - (Date.now() - lastSaveStartedAt));
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pump();
    }, wait);
  }

  function pump() {
    if (busy || stopped) return;
    const url = nextQueued();
    if (!url) {
      checkEnd();
      return;
    }
    // #594, before anything is marked as in flight and before the deadline is
    // armed: a save started into a severed connection leaves that timer as the
    // only thing still running, which is exactly how this used to end in "the
    // save timed out" — a healthy extension blamed for having been updated.
    if (!extensionAlive()) return;
    busy = true;
    lastSaveStartedAt = Date.now();
    entries.set(url, 'saving');
    // Each post in a run is its own save attempt with its own id, so a run's
    // lines can be read post by post rather than as one undifferentiated
    // block (#519).
    const saveId = newSaveId();
    // The queue is serial, so one unanswered save stops the whole intake: `busy`
    // never clears and every remaining bookmark waits behind it, under a banner
    // that keeps saying the run is in progress (#507). The deadline gives up on
    // that ONE post — counted as failed, which is what the summary is for — and
    // lets the queue move on.
    const deadline = startSaveDeadline(saveId, (error) => {
      // Logged before the `stopped` bail: an abandoned post is worth a line
      // whether or not the run is still on screen to count it. The run's own
      // summary is transient; this is what a later reader has.
      reportSaveTimeout('bulk-intake', site.platform, url, error, saveId);
      if (stopped) return; // the run already ended and printed its summary
      busy = false;
      entries.set(url, 'failed');
      failedCount++;
      paint();
      schedulePump();
    });
    // Named rather than written inline at the call, so the call itself is the
    // one statement inside the try/catch below (#594).
    const onAnswer = (res?: SaveResponse) => {
      if (!deadline.settle()) return; // a late answer to a post already given up on
      busy = false;
      // Narrowed here rather than inside the branch below: that condition is
      // a disjunction (the port itself may have failed), so it tells TypeScript
      // nothing about `res` — and SaveResponse's success arm carries no
      // errorKind to read. #492 and #225 landed within minutes of each other
      // and neither PR's CI saw the combination, which is what left main red.
      const failure = res && !res.ok ? res : null;
      if (chrome.runtime.lastError || !res?.ok) {
        // The post itself could not be obtained (#492) — deleted, suspended,
        // protected, age gated. Nothing was written and nothing is broken, so
        // it is counted apart from real failures: a bookmark list can hold a
        // handful of dead posts forever, and every run would otherwise report
        // them as breakage the user is meant to go and fix.
        //
        // Age-restricted posts are split off again (#505): those are ALIVE —
        // X simply serves no post info to an anonymous embed request, which is
        // the only kind we can make. Folding them into "deleted or private"
        // would tell the user the post is gone when it is still there, and
        // would hide that re-running the intake can never change the outcome.
        if (failure?.errorKind === 'post-unavailable' && failure.metaReason === 'ageRestricted') {
          entries.set(url, 'ageRestricted');
          ageRestrictedCount++;
        } else if (failure?.errorKind === 'post-unavailable') {
          entries.set(url, 'unavailable');
          unavailableCount++;
        } else {
          entries.set(url, 'failed');
          failedCount++;
        }
      } else if (res.deferred) {
        // Written to disk, but the library cannot show it until #365 — count
        // it apart so the summary never claims it is visible.
        entries.set(url, 'deferred');
        deferredCount++;
      } else {
        entries.set(url, 'saved');
        savedCount++;
      }
      paint();
      schedulePump();
    };
    try {
      chrome.runtime.sendMessage(
        {
          type: 'savePost',
          postUrl: url,
          platform: site.platform,
          saveId,
          // Marks the record's intake route so a bulk-imported post can be told
          // apart from an ordinary one-at-a-time save (native-host/post-record).
          capturedVia: 'x-bookmarks',
        } satisfies SavePostMessage,
        onAnswer,
      );
    } catch {
      // Invalidated between the probe above and this line (#594). The deadline
      // is armed by now, so it is settled here rather than left to fire: this
      // post is not a failure the run should count, because there is no run
      // left to count it — the handler below ends it.
      deadline.settle();
      busy = false;
      noteExtensionGone();
    }
  }

  // === end of list ===

  function checkEnd() {
    if (stopped) return;
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 100;
    const quiet = Date.now() - lastGrowthAt >= END_QUIET_MS;
    const nothingLeft = ![...entries.values()].some((s) => s === 'unknown' || s === 'queued');
    if (atBottom && quiet && nothingLeft) finish(false);
  }

  // === teardown ===

  // Everything the run leaves running, taken back off. Shared with the orphaned
  // ending below, which has no summary to print and no line it could write.
  function teardown() {
    stopped = true;
    observer.disconnect();
    removeEventListener('scroll', onScroll, true);
    document.removeEventListener('keydown', onUserKeyDown, true);
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = null;
    if (window.__snsPostSaveCleanup === stop) delete window.__snsPostSaveCleanup;
    window.__snsPostSaveActive = false;
    banner.el.style.pointerEvents = 'none';
  }

  function finish(byUser: boolean) {
    if (stopped) return;
    // How the run ended, and with what. `cancel` is the point: the stop button,
    // Esc, and navigating away from the bookmarks list are all the user deciding
    // to stop, and telling that apart from a run that died mid-way is what this
    // log could not do (#519). No saveId — a run holds many saves, each with
    // its own.
    logSaveEvent({
      stage: 'bulk',
      phase: byUser ? 'cancel' : 'ok',
      platform: site.platform,
      seen: entries.size,
      saved: savedCount,
      skipped: skippedCount,
      deferred: deferredCount,
      unavailable: unavailableCount,
      ageRestricted: ageRestrictedCount,
      failed: failedCount,
    });
    teardown();

    // A run that hit real failures ends amber, not green — the summary says so
    // in words, and the surface now says it in colour too (setState drops the
    // stop button along with the state that owned it).
    const bad = failedCount > 0;
    banner.setState(bad ? 'partial' : 'success', summaryText(byUser));
    setTimeout(dismiss, bad || deferredCount || unavailableCount || ageRestrictedCount ? 6000 : 3500);
  }

  // The extension was replaced under this run (#594). A run lasts minutes, so
  // of every path in the extension this is the one most likely to be standing
  // here when Chrome updates it on its own — and until this existed the intake
  // simply threw "Extension context invalidated." out of whichever callback
  // reached the severed connection, then went on showing a progress banner for
  // a run that could no longer take anything.
  //
  // The user asked for this run, so it is told: the notice goes into the error
  // state of the banner the run has been drawing all along, which is #594's
  // rule for a request that failed (the silent half is for tabs nobody asked
  // anything of). No summary — the counts describe a run that ended, and this
  // one was cut off mid-way with an instruction that has to be read instead.
  // Nothing is logged either: that line would travel through the same severed
  // connection.
  function finishOrphaned() {
    if (stopped) return;
    teardown();
    // The long dwell, as for a run that ended with something to read: this is
    // an instruction, not a result, and it is the only place it is said.
    banner.setState('error', t('bannerExtensionReloaded'));
    setTimeout(dismiss, 6000);
  }

  function summaryText(byUser: boolean): string {
    const head = byUser ? t('bulkStopped') : t('bulkFinished');
    const parts = [t('bulkSummarySaved', [savedCount]), t('bulkSummarySkipped', [skippedCount])];
    if (deferredCount > 0) parts.push(t('bulkSummaryDeferred', [deferredCount]));
    if (unavailableCount > 0) parts.push(t('bulkSummaryUnavailable', [unavailableCount]));
    if (ageRestrictedCount > 0) parts.push(t('bulkSummaryAgeRestricted', [ageRestrictedCount]));
    if (failedCount > 0) parts.push(t('bulkSummaryFailed', [failedCount]));
    return `${head} — ${parts.join(' / ')}`;
  }

  function dismiss() {
    banner.exit();
  }

  function stop() {
    finish(true);
  }

  // === listeners ===

  function onScroll() {
    schedulePump();
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') finish(true);
  }
  // Esc is the user's, the same way the stop button is (#323).
  const onUserKeyDown = userOnly(onKeyDown);

  const observer = new MutationObserver((records) => {
    // x.com is an SPA: leaving the bookmarks list swaps the feed in place and
    // fires no unload, so nothing else would ever tear this mode down.
    if (!isXBookmarksPage()) {
      finish(true);
      return;
    }
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) harvestFrom(node as Element);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('keydown', onUserKeyDown, true);

  // A second activation ends the mode, matching the single-shot path's toggle.
  window.__snsPostSaveActive = true;
  window.__snsPostSaveCleanup = stop;

  // Registered AFTER the observer and the listeners exist, because a context
  // already known to be gone runs this handler on the spot — and teardown()
  // would then be reaching for an observer that has not been created yet.
  // Whichever of the two calls above notices first ends the run through here,
  // so there is one ending rather than one per call site.
  onExtensionGone(finishOrphaned);

  // A run has started. Paired with the `bulk` line finish() writes, so a run
  // that is cut short by the page going away leaves a beginning with no end
  // rather than nothing at all (#519).
  logSaveEvent({ stage: 'bulk', phase: 'begin', platform: site.platform, url: location.href });

  harvestFrom(document);
}
