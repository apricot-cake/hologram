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
import { SAVE_WATCHDOG_MS, SAVED_QUERY_TIMEOUT_MS } from './deadline.ts';
import type { CaptureSite } from './extractor/types.ts';
import { isXBookmarksPage } from './extractor/x.ts';
import { ICONS, makeIcon, makeSpinner } from './icons.ts';
import { ensureTokens, motion, prefersReducedMotion, token } from './tokens.ts';
import type { HologramI18nApi } from './i18n.ts';
import type { CheckSavedMessage, CheckSavedResponse, SavePostMessage, SaveResponse } from './messages.ts';

type EntryState = 'unknown' | 'queued' | 'saving' | 'saved' | 'skipped' | 'deferred' | 'unavailable' | 'ageRestricted' | 'failed';

// One save at a time, and no faster than this. The metadata fetch and the media
// download are the only things X sees, and this keeps them at a human cadence.
const MIN_SAVE_PERIOD_MS = 1000;
const END_QUIET_MS = 4000;

export function startBulkCapture(site: CaptureSite, i18n: HologramI18nApi): void {
  ensureTokens();
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
  // The banner is mirrored from capture.ts rather than shared. overlay.ts made
  // the same call and says why: #226 leaves the inline presenters separate
  // until #44 replaces all of them with one Shadow DOM component.
  const banner = document.createElement('div');
  banner.setAttribute('data-hologram-bulk-banner', '');
  banner.setAttribute('role', 'status');
  banner.style.cssText = [
    'position:fixed',
    'top:12px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'gap:9px',
    'padding:6px 8px 6px 7px',
    'max-width:calc(100vw - 48px)',
    'box-sizing:border-box',
    'border-radius:999px',
    `border:1px solid ${token.overlayBorder}`,
    `background:${token.surface}`,
    `color:${token.ink}`,
    `font:600 13px/1.4 ${token.fontSans}`,
    `box-shadow:${token.overlayShadow}`,
  ].join(';');

  const badge = document.createElement('div');
  badge.style.cssText = `width:26px;height:26px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:${token.badgeNeutral};color:${token.accent};`;
  badge.appendChild(makeSpinner(15));
  banner.appendChild(badge);

  const label = document.createElement('div');
  label.setAttribute('data-hologram-bulk-label', '');
  label.style.cssText = 'padding-right:4px';
  banner.appendChild(label);

  const stopButton = document.createElement('button');
  stopButton.type = 'button';
  stopButton.textContent = t('bulkStop');
  stopButton.style.cssText = ['flex:none', 'appearance:none', 'cursor:pointer', 'border-radius:999px', `border:1px solid ${token.overlayBorder}`, `background:${token.badgeNeutral}`, `color:${token.ink}`, `font:600 12px/1 ${token.fontSans}`, 'padding:7px 12px'].join(';');
  stopButton.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    finish(true);
  };
  banner.appendChild(stopButton);

  document.body.appendChild(banner);
  if (!prefersReducedMotion()) {
    banner.animate(
      [
        { opacity: 0, transform: 'translateX(-50%) translateY(-14px) scale(0.96)' },
        { opacity: 1, transform: 'translateX(-50%)' },
      ],
      { duration: motion.durationBase, easing: motion.easeOut },
    );
  }

  function paint() {
    if (stopped) return;
    label.textContent = t('bulkProgress', [savedCount, skippedCount]);
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
    chrome.runtime.sendMessage({ type: 'checkSaved', urls } satisfies CheckSavedMessage, (res?: CheckSavedResponse) => {
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
    });
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
    busy = true;
    lastSaveStartedAt = Date.now();
    entries.set(url, 'saving');
    // The queue is serial, so one unanswered save stops the whole intake: `busy`
    // never clears and every remaining bookmark waits behind it, under a banner
    // that keeps saying the run is in progress (#507). The deadline gives up on
    // that ONE post — counted as failed, which is what the summary is for — and
    // lets the queue move on.
    let settled = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (stopped) return; // the run already ended and printed its summary
      busy = false;
      entries.set(url, 'failed');
      failedCount++;
      paint();
      schedulePump();
    }, SAVE_WATCHDOG_MS);
    chrome.runtime.sendMessage(
      {
        type: 'savePost',
        postUrl: url,
        platform: site.platform,
        // Marks the record's intake route so a bulk-imported post can be told
        // apart from an ordinary one-at-a-time save (native-host/post-record).
        capturedVia: 'x-bookmarks',
      } satisfies SavePostMessage,
      (res?: SaveResponse) => {
        if (settled) return; // a late answer to a post already given up on
        settled = true;
        clearTimeout(watchdog);
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
      },
    );
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

  function finish(byUser: boolean) {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    removeEventListener('scroll', onScroll, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (pumpTimer) clearTimeout(pumpTimer);
    if (window.__snsPostSaveCleanup === stop) delete window.__snsPostSaveCleanup;
    window.__snsPostSaveActive = false;

    badge.replaceChildren();
    const bad = failedCount > 0;
    badge.style.background = bad ? token.warning : token.success;
    badge.style.color = bad ? token.onWarning : token.onSuccess;
    badge.appendChild(makeIcon(bad ? ICONS.warn : ICONS.check, 15));
    banner.style.borderColor = bad ? token.warning : token.success;
    label.textContent = summaryText(byUser);
    stopButton.remove();
    setTimeout(dismiss, bad || deferredCount || unavailableCount || ageRestrictedCount ? 6000 : 3500);
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
    if (prefersReducedMotion() || !banner.isConnected) {
      banner.remove();
      return;
    }
    const anim = banner.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(-50%) translateY(-14px) scale(0.96)' }], { duration: motion.durationFast, easing: motion.easeIn });
    anim.onfinish = () => banner.remove();
    anim.oncancel = () => banner.remove();
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
  document.addEventListener('keydown', onKeyDown, true);

  // A second activation ends the mode, matching the single-shot path's toggle.
  window.__snsPostSaveActive = true;
  window.__snsPostSaveCleanup = stop;

  harvestFrom(document);
}
