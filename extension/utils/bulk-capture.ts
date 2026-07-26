// X bookmarks bulk intake (#362) — the "chase" model.
//
// THE MACHINE NEVER SCROLLS. The user scrolls the bookmark list at their own
// pace and this follows along, capturing the posts that are not in the library
// yet. Machine-driven scrolling was rejected: X locks accounts that show
// automated behaviour (scroll cadence and input timing are among the signals it
// reads), and the account at stake is the user's. Every request X sees here is
// one the user's own scrolling already caused; the screenshots never leave the
// machine. See the Issue's decision comment for the full rationale and for why
// the export tools that DO auto-scroll are not a precedent (they are one-shot
// throwaway tools, this is a feature people re-run on an account they keep).
//
// Consequences of that constraint, all of which shape the code below:
//
//   - A post can only be captured while the user is holding it on screen, so
//     the queue is opportunistic: it takes whatever is fully visible right now,
//     in document order, and waits when nothing is.
//   - The virtual list drops rows the user scrolls past. A post that was
//     queued and then discarded is a MISS, and misses are provisional — the
//     user can scroll back, the row returns, and it is re-queued by URL.
//   - Already-saved posts are skipped without touching X at all: the answer
//     comes from the native host's index over the #54 route, so re-running the
//     mode over ground already covered costs nothing and needs no bookmark of
//     where the last run stopped.
import { cropScreenshot } from './crop';
import { glassUi } from './glass-ui';
import type { HologramI18nApi } from './i18n';
import { normalizeRect, type PostRect, type SiteConfig } from './site-detect';

// /i/bookmarks and /i/bookmarks/<folderId>. Deliberately not the search or
// "for you" timelines: the Issue's scope is the user's own curated list.
export function isXBookmarksPage(): boolean {
  return /^\/i\/bookmarks(\/|$)/.test(location.pathname);
}

type EntryState = 'unknown' | 'queued' | 'saving' | 'saved' | 'skipped' | 'missed' | 'failed';

interface Entry {
  url: string;
  el: Element | null;
  state: EntryState;
}

// One capture at a time, and no faster than this. The round trip (screenshot →
// metadata fetch → bridge write) already takes about a second on its own, so
// this is a floor rather than a throttle in practice — it exists so a fast
// machine on a short list cannot turn into a burst.
const MIN_CAPTURE_PERIOD_MS = 1000;
// x.com keeps a sticky header over the top of the column. A post whose top is
// underneath it would have the header's pixels baked into its screenshot, so it
// is not considered capturable until it clears. Same ~50px the single-shot path
// compensates for when it scrolls a post into view.
const HEADER_CLEARANCE_PX = 56;
const HARVEST_DEBOUNCE_MS = 150;
// The list is treated as finished when the page is scrolled to the bottom and
// has stopped producing new posts for this long. Reported as "looks finished",
// not asserted — X may simply be slow to load the next page.
const END_QUIET_MS = 4000;

export function startBulkCapture(site: SiteConfig, i18n: HologramI18nApi): void {
  const G = glassUi;
  const t = i18n.getMessage;

  const entries = new Map<string, Entry>();
  let savedCount = 0;
  let skippedCount = 0;
  let missedCount = 0;
  let failedCount = 0;

  let stopped = false;
  let busy = false;
  let lastCaptureStartedAt = 0;
  let lastGrowthAt = Date.now();
  let harvestTimer: ReturnType<typeof setTimeout> | null = null;
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;
  // The post currently in flight. `notify` from the background carries no post
  // identifier, which is safe to correlate this way only because exactly one
  // capture is ever in flight.
  let inFlight: Entry | null = null;
  let inFlightRect: (() => PostRect | null) | null = null;
  let settleInFlight: ((ok: boolean) => void) | null = null;
  let restoreCaptureState: (() => void) | null = null;

  // === UI ===
  //
  // The banner is mirrored from capture.ts rather than shared. overlay.ts made
  // the same call and says why: #226 leaves the inline presenters separate
  // until #44 replaces all of them with one Shadow DOM component, and adding a
  // third abstraction immediately before that migration would be work thrown
  // away. This is the third copy and the last one before #44.
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
    `border:1px solid ${G.CARD_BORDER}`,
    `background:${G.CARD_BG}`,
    `color:${G.TEXT}`,
    `font:600 13px/1.4 ${G.FONT_SANS}`,
    `box-shadow:${G.CARD_SHADOW}`,
  ].join(';');

  const badge = document.createElement('div');
  badge.style.cssText = `width:26px;height:26px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:${G.BADGE_NEUTRAL};color:${G.ACCENT_TEXT};`;
  badge.appendChild(G.makeSpinner(15));
  banner.appendChild(badge);

  const label = document.createElement('div');
  label.setAttribute('data-hologram-bulk-label', '');
  label.style.cssText = 'padding-right:4px';
  banner.appendChild(label);

  const stopButton = document.createElement('button');
  stopButton.type = 'button';
  stopButton.textContent = t('bulkStop');
  stopButton.style.cssText = ['flex:none', 'appearance:none', 'cursor:pointer', 'border-radius:999px', `border:1px solid ${G.CARD_BORDER}`, 'background:rgba(255,255,255,0.10)', `color:${G.TEXT}`, `font:600 12px/1 ${G.FONT_SANS}`, 'padding:7px 12px'].join(';');
  stopButton.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    finish(true);
  };
  banner.appendChild(stopButton);

  document.body.appendChild(banner);
  if (!G.REDUCED_MOTION) {
    banner.animate(
      [
        { opacity: 0, transform: 'translateX(-50%) translateY(-14px) scale(0.96)' },
        { opacity: 1, transform: 'translateX(-50%)' },
      ],
      { duration: G.DUR_POP, easing: G.EASE_OUT },
    );
  }

  // The resident overlay's hover controls sit ON TOP of post media, so they
  // would be baked into a screenshot taken while the pointer rests on a post.
  // Suppressed for the whole mode — during a bulk intake the per-picture save
  // button has nothing to offer anyway.
  const modeStyle = document.createElement('style');
  modeStyle.textContent = '[data-hologram-overlay]{display:none !important}';
  document.head.appendChild(modeStyle);

  function paint() {
    if (stopped) return;
    label.textContent = missedCount > 0 ? t('bulkProgressMissed', [savedCount, skippedCount, missedCount]) : t('bulkProgress', [savedCount, skippedCount]);
    banner.style.borderColor = missedCount > 0 ? 'rgba(232,161,58,0.65)' : G.CARD_BORDER;
  }
  paint();

  // === harvesting ===

  function rectOf(post: Element): PostRect {
    return normalizeRect(site.getCaptureRect?.(post) || post.getBoundingClientRect());
  }

  // Is this post positioned so that a screenshot of it would be honest? It has
  // to clear the sticky header and fit in what is left. A post TALLER than the
  // viewport can never fit, so for those the top edge alone decides (the crop
  // clamps to the viewport and saves the visible part — the same compromise the
  // single-shot path makes for an oversized post).
  function capturable(rect: PostRect): boolean {
    if (rect.width < 1 || rect.height < 1) return false;
    if (rect.top < HEADER_CLEARANCE_PX) return false;
    const usable = window.innerHeight - HEADER_CLEARANCE_PX;
    if (rect.height >= usable) return rect.top <= window.innerHeight - 200;
    return rect.bottom <= window.innerHeight;
  }

  // Re-read the list and reconcile it with what we know. Runs on every DOM
  // mutation and scroll burst, because the virtual list both ADDS rows the user
  // scrolled to and REPLACES the element behind a row it kept.
  function harvest() {
    if (stopped) return;
    const live = new Map<string, Element>();
    for (const el of document.querySelectorAll(site.postSelector || 'article')) {
      let url = '';
      try {
        url = site.getPermalink(el);
      } catch {
        url = '';
      }
      // A half-rendered row has no permalink anchor yet; it will be picked up
      // on a later pass rather than counted as anything.
      if (url && !live.has(url)) live.set(url, el);
    }

    let grew = false;
    for (const [url, el] of live) {
      const entry = entries.get(url);
      if (!entry) {
        entries.set(url, { url, el, state: 'unknown' });
        grew = true;
        continue;
      }
      entry.el = el; // the row may have been re-rendered into a new element
      // Came back into view after being scrolled past: recover it.
      if (entry.state === 'missed') {
        missedCount--;
        entry.state = 'queued';
      }
    }

    // Rows the list discarded. Anything still waiting its turn is a miss — and
    // stays recoverable, because the entry keeps its URL and is re-queued above
    // if the user scrolls back to it.
    for (const entry of entries.values()) {
      if (entry.state !== 'unknown' && entry.state !== 'queued') continue;
      if (live.has(entry.url)) continue;
      entry.el = null;
      entry.state = 'missed';
      missedCount++;
    }

    if (grew) lastGrowthAt = Date.now();
    askSaved();
    paint();
    schedulePump();
  }

  function scheduleHarvest() {
    if (harvestTimer || stopped) return;
    harvestTimer = setTimeout(() => {
      harvestTimer = null;
      harvest();
    }, HARVEST_DEBOUNCE_MS);
  }

  // === "already saved?" ===

  // Answered by the native host's index through background.js (the #54 route),
  // so this never reaches X. That is what makes re-running the mode over posts
  // already taken cheap, and why the design needs no record of where a previous
  // run stopped: covered ground simply skips past.
  let asking = false;
  function askSaved() {
    if (asking || stopped) return;
    const urls = [...entries.values()].filter((e) => e.state === 'unknown' && e.el).map((e) => e.url);
    if (!urls.length) return;
    asking = true;
    chrome.runtime.sendMessage({ type: 'checkSaved', urls }, (res: any) => {
      asking = false;
      if (chrome.runtime.lastError || !res?.ok || !res.results) return; // host unreachable: ask again next pass
      for (const url of urls) {
        const entry = entries.get(url);
        if (!entry || entry.state !== 'unknown') continue;
        if (res.results[url] != null) {
          entry.state = 'skipped';
          skippedCount++;
        } else {
          entry.state = 'queued';
        }
      }
      paint();
      schedulePump();
    });
  }

  // === capture queue ===

  // Document order, so the run follows the user down the list instead of
  // hopping around the screen.
  function pickNext(): Entry | null {
    let best: Entry | null = null;
    let bestTop = Number.POSITIVE_INFINITY;
    for (const entry of entries.values()) {
      if (entry.state !== 'queued' || !entry.el?.isConnected) continue;
      const rect = rectOf(entry.el);
      if (!capturable(rect)) continue;
      if (rect.top < bestTop) {
        bestTop = rect.top;
        best = entry;
      }
    }
    return best;
  }

  function schedulePump() {
    if (pumpTimer || busy || stopped) return;
    const wait = Math.max(0, MIN_CAPTURE_PERIOD_MS - (Date.now() - lastCaptureStartedAt));
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pump();
    }, wait);
  }

  function pump() {
    if (busy || stopped) return;
    const entry = pickNext();
    if (!entry || !entry.el) {
      checkEnd();
      return;
    }
    busy = true;
    lastCaptureStartedAt = Date.now();
    void captureOne(entry).finally(() => {
      busy = false;
      inFlight = null;
      inFlightRect = null;
      settleInFlight = null;
      restoreCaptureState?.();
      restoreCaptureState = null;
      banner.style.display = 'flex';
      paint();
      schedulePump();
    });
  }

  async function captureOne(entry: Entry): Promise<void> {
    const post = entry.el;
    if (!post?.isConnected) return;
    entry.state = 'saving';

    // Hide our own chrome, and neutralise the post's hover styling, so the
    // screenshot is of the post as it rests.
    banner.style.display = 'none';
    restoreCaptureState = site.prepareForCapture?.(post) || null;
    inFlight = entry;
    inFlightRect = () => (post.isConnected ? rectOf(post) : null);

    // Two frames so the style changes above are painted before the shot.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    if (stopped || !post.isConnected) {
      // Scrolled away in the gap: leave it queued/missed for harvest to judge.
      entry.state = 'queued';
      return;
    }

    const rect = rectOf(post);
    const ok = await new Promise<boolean>((resolve) => {
      settleInFlight = resolve;
      const timer = setTimeout(() => resolve(false), 30000);
      const done = (value: boolean) => {
        clearTimeout(timer);
        resolve(value);
      };
      settleInFlight = done;
      chrome.runtime.sendMessage({
        type: 'captureAndSend',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        postUrl: entry.url,
        platform: site.platform,
        // #362: marks the record's intake route so it can be told apart from
        // an ordinary one-at-a-time save — see native-host/post-record.mts.
        capturedVia: 'x-bookmarks',
      });
    });

    if (ok) {
      entry.state = 'saved';
      savedCount++;
    } else {
      entry.state = 'failed';
      failedCount++;
    }
  }

  // === background messages ===

  function onRuntimeMessage(msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
    if (msg.type === 'cropImage') {
      void cropScreenshot(msg.dataUrl, msg.rect, inFlightRect || undefined).then((croppedDataUrl) => {
        sendResponse(croppedDataUrl ? { croppedDataUrl } : null);
      });
      return true; // async response
    }
    if (msg.type === 'notify') {
      // A partial save (screenshot kept, post info unavailable — a protected
      // account, an age-restricted post) still put the post in the library, so
      // it counts as saved rather than as a failure. #202's world.
      if (inFlight) settleInFlight?.(Boolean(msg.success));
    }
    return undefined;
  }
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // === end of list ===

  function checkEnd() {
    if (stopped) return;
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 100;
    const quiet = Date.now() - lastGrowthAt >= END_QUIET_MS;
    const nothingLeft = ![...entries.values()].some((e) => e.state === 'unknown' || e.state === 'queued');
    if (atBottom && quiet && nothingLeft) finish(false);
  }

  // === teardown ===

  function finish(byUser: boolean) {
    if (stopped) return;
    stopped = true;
    settleInFlight?.(false);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    observer.disconnect();
    removeEventListener('scroll', onScroll, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (harvestTimer) clearTimeout(harvestTimer);
    if (pumpTimer) clearTimeout(pumpTimer);
    restoreCaptureState?.();
    modeStyle.remove();
    if (window.__snsPostSaveCleanup === stop) delete window.__snsPostSaveCleanup;
    window.__snsPostSaveActive = false;

    // The summary replaces the live counter and is left on screen long enough
    // to read. Misses are named, because the answer to them is an action the
    // user can still take: scroll back over that stretch and run again.
    banner.style.display = 'flex';
    badge.replaceChildren();
    const bad = missedCount > 0 || failedCount > 0;
    badge.style.background = bad ? G.WARN_AMBER : G.OK_GREEN;
    badge.style.color = '#fff';
    badge.appendChild(G.makeIcon(bad ? G.ICONS.warn : G.ICONS.check, 15));
    banner.style.borderColor = bad ? 'rgba(232,161,58,0.65)' : 'rgba(48,164,108,0.65)';
    label.textContent = summaryText(byUser);
    stopButton.remove();
    setTimeout(dismiss, bad ? 6000 : 3500);
  }

  function summaryText(byUser: boolean): string {
    const head = byUser ? t('bulkStopped') : t('bulkFinished');
    const parts = [t('bulkSummarySaved', [savedCount]), t('bulkSummarySkipped', [skippedCount])];
    if (missedCount > 0) parts.push(t('bulkSummaryMissed', [missedCount]));
    if (failedCount > 0) parts.push(t('bulkSummaryFailed', [failedCount]));
    return `${head} — ${parts.join(' / ')}`;
  }

  function dismiss() {
    if (G.REDUCED_MOTION || !banner.isConnected) {
      banner.remove();
      return;
    }
    const anim = banner.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(-50%) translateY(-14px) scale(0.96)' }], { duration: G.DUR_POP, easing: G.EASE_OUT });
    anim.onfinish = () => banner.remove();
    anim.oncancel = () => banner.remove();
  }

  function stop() {
    finish(true);
  }

  // === listeners ===

  function onScroll() {
    scheduleHarvest();
    schedulePump();
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') finish(true);
  }

  const observer = new MutationObserver(scheduleHarvest);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('keydown', onKeyDown, true);

  // A second Alt+S ends the mode, matching the single-shot path's toggle.
  window.__snsPostSaveActive = true;
  window.__snsPostSaveCleanup = stop;

  harvest();
}
