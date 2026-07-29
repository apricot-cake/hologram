// Which sites exist, and everything platform-specific about them, comes from
// the extractor registry (utils/extractor/) — this file holds no per-platform
// branch of its own (#212).
import { CROP_TIMEOUT_MS, NATIVE_HOST_TIMEOUT_MS, SAVED_QUERY_TIMEOUT_MS, withDeadline } from './deadline.ts';
import { extractorFor, fetchPostMetadata, getHostname, highResUrlOf, isAllowedSender, mediaKeyOf } from './extractor/index.ts';
import type { PostRecord } from './extractor/types.ts';
import type { BridgeAck, CaptureAndSendResponse, CheckSavedResponse, ContentToBackgroundMessage, CropImageMessage, CropImageResponse, DumpLogsResponse, LogCaptureResponse, NotifyMessage, SavedEntry, SavedResults, SavedUpdateMessage, SaveProgressMessage, SaveResponse } from './messages.ts';
import { classifySaveFailure } from './native-error.ts';
import type { SaveLogEntry, SaveStage } from './save-log.ts';

export function startBackground(): void {
  const NATIVE_HOST = 'com.hologram.host';

  // --- Capture diagnostics ------------------------------------------------------
  // Fallback ring buffer for log entries that couldn't reach the native host's
  // capture.log (the host failing to launch is exactly the failure we most want
  // recorded). See logCapture / stashLogLocally / the dumpLogs handler.
  const DIAG_PREFIX = 'diaglog_';
  const DIAG_KEEP = 50;

  interface StageError extends Error {
    stage: SaveStage;
    metaReason?: string | null;
    // Filled in by SaveTrace.fail so the single catch per route can write a
    // line that ties the failure to the rest of the save and says how far it
    // got, without knowing anything about the route (#519).
    saveId?: string | null;
    captureId?: string | null;
    reached?: SaveStage[];
  }

  // Tag an error with the pipeline stage it failed at, so the single catch in the
  // message handler can log WHICH stage broke. select/permalink are reported by
  // content.js; capture/crop/metadata/bridge are tagged here.
  //
  // metaReason rides along for the one failure the user is not meant to repair:
  // the host refuses a save that obtained nothing (#492), and WHY the post info
  // was missing is the difference between "deleted, gone for good" and
  // "age-restricted, alive but out of this route's reach" (#505). Without it
  // the banner can only name the whole family.
  function stageError(stage: SaveStage, message: string, metaReason: string | null = null): StageError {
    const err = new Error(message) as StageError;
    err.stage = stage;
    err.metaReason = metaReason;
    return err;
  }

  interface SaveTrace {
    passed(stage: SaveStage): void;
    fail(stage: SaveStage, message: string, metaReason?: string | null): StageError;
  }

  // Open one save's thread in capture.log and hand back the two ways to write on
  // it (#519).
  //
  // The `save`/`begin` line is the point of this: it is on disk before any of
  // the waits below it can stall, so a save that never finishes is no longer
  // indistinguishable from one that never started. It costs one extra native
  // connection — Chrome spawns a host process per connection — which during a
  // bookmark-intake run means two per save instead of one. Deliberate: the
  // intake is precisely where a single stuck save used to stop everything
  // behind it (#507), so it is the last route that should keep the blind spot.
  //
  // Never awaited. The line is stamped with its own `ts` when it is created, so
  // a slow host can land it after the save's own terminal line without making
  // the order unreadable — sort by `ts`, not by position.
  function beginSave(type: 'save' | 'savePost' | 'saveDragged', ctx: { saveId: string | null; captureId: string; platform: string | null; url: string | null; tabId: number | null }): SaveTrace {
    const reached: SaveStage[] = [];
    void logCapture({ stage: 'save', phase: 'begin', saveId: ctx.saveId, captureId: ctx.captureId, type, platform: ctx.platform, url: ctx.url });
    return {
      // A stage finished. Kept here for the terminal line, and pushed to the
      // page because the page is the only side still able to write a line when
      // this worker is what disappears (see SaveProgressMessage).
      passed(stage: SaveStage) {
        reached.push(stage);
        if (ctx.tabId == null || !ctx.saveId) return;
        chrome.tabs.sendMessage(ctx.tabId, { type: 'saveProgress', saveId: ctx.saveId, reached: [...reached] } satisfies SaveProgressMessage).catch(() => {});
      },
      fail(stage: SaveStage, message: string, metaReason: string | null = null) {
        const err = stageError(stage, message, metaReason);
        err.saveId = ctx.saveId;
        err.captureId = ctx.captureId;
        err.reached = [...reached];
        return err;
      },
    };
  }

  // The capture.log line for a save that ended in a throw. Written from the one
  // catch each route has, so every route reports the same fields: which stage
  // broke, which save it was, and which stages it had already cleared (#519 —
  // before this, a failure line named the stage and nothing else, so it could
  // not be tied to the save's own `begin` line except by timestamp).
  function logSaveFailure(error: StageError | undefined, ctx: { saveId: string | null; platform: string | null; host: string | null; url: string | null }) {
    void logCapture(
      {
        stage: error?.stage || 'unknown',
        phase: 'fail',
        saveId: error?.saveId ?? ctx.saveId,
        captureId: error?.captureId ?? null,
        reached: error?.reached ?? [],
        platform: ctx.platform,
        host: ctx.host,
        url: ctx.url,
        error: error?.message,
      },
      true,
    );
  }

  async function activateOnTab(tab, auto = false) {
    // Log the attempt (and the silent non-http bail) to capture.log: an icon
    // click that "does nothing" is otherwise diagnosable only from the SW
    // DevTools console, which nobody has open when it happens.
    //
    // NO saveId, on purpose. Injecting the UI starts no save, and the two being
    // separately identifiable is the whole distinction this log was missing: an
    // `activate` line with no `save`/`begin` after it means the user opened the
    // UI and stopped (#519).
    if (!tab.id || !/^https?:/i.test(tab.url || '')) {
      void logCapture({ stage: 'activate', phase: 'skip', url: tab.url || '(no url)' });
      return;
    }
    void logCapture({ stage: 'activate', phase: 'ok', host: getHostname(tab.url), url: tab.url, auto });
    try {
      // Auto capture (#362) is asked for by its OWN gesture, so the choice
      // rides in as a page-side flag rather than being inferred from the URL —
      // Alt+S has to keep meaning single-shot capture on every page, the
      // bookmarks list included. Set in a separate injection because the
      // unlisted capture entrypoint is a file, not a function: both run under
      // the same activeTab grant, in order.
      if (auto) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            window.__hologramAutoCapture = true;
          },
        });
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        // WXT emits the unlisted capture entrypoint with this stable filename.
        // It bundles its ESM dependencies, so activeTab injection remains one
        // script without relying on execution order between global files.
        files: ['capture.js'],
      });
    } catch (error) {
      console.error('Failed to inject content script:', error);
      void logCapture({ stage: 'activate', phase: 'fail', host: getHostname(tab.url), url: tab.url, error: (error as Error)?.message });
    }
  }

  chrome.action.onClicked.addListener((tab) => activateOnTab(tab));

  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'activate' && command !== 'activate-auto') return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) activateOnTab(tab, command === 'activate-auto');
  });

  // Bulk intake (#362): save a post from its permalink alone — no screenshot,
  // no DOM image needed. The platform API already carries the originals, so the
  // page only has to say WHICH post; the host downloads the media and makes the
  // first one the record's image. Answers with the outcome (the caller paces
  // itself on it) rather than pushing a notify like the capture path does.
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type !== 'savePost') return false;
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: 'Missing tab context' } satisfies SaveResponse);
      return false;
    }
    if (!isAllowedSender(sender.tab.url, message.platform)) {
      sendResponse({ ok: false, error: 'Sender origin does not match platform' } satisfies SaveResponse);
      return false;
    }
    const senderHost = getHostname(sender.tab.url);
    savePostByUrl(sender.tab, message.platform, message.postUrl, message.capturedVia || null, message.saveId)
      .then((result) => sendResponse({ ok: true, ...result } satisfies SaveResponse))
      .catch((error) => {
        console.error(error);
        const errorKind = classifySaveFailure(error?.message);
        logSaveFailure(error, { saveId: message.saveId, platform: message.platform, host: senderHost, url: message.postUrl });
        sendResponse({ ok: false, errorKind, metaReason: error?.metaReason || null, error: error?.message } satisfies SaveResponse);
      });
    return true; // async response
  });

  async function savePostByUrl(tab, sendPlatform, postUrl, capturedVia, saveId: string | null = null) {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('savePost', { saveId, captureId, platform: sendPlatform, url: postUrl, tabId: tab.id ?? null });

    let meta: PostRecord;
    try {
      meta = await fetchPostMetadata(postUrl, { expectedHost: getHostname(tab.url) });
    } catch (err) {
      throw trace.fail('metadata', err?.message || 'metadata fetch threw');
    }
    trace.passed('metadata');

    // A post with no media is still saved — the host writes its sidecar and the
    // library shows it once #365 lands (see handleSavePost). Losing it instead
    // would be permanent: X has no bookmark export to go back to.
    const record = buildRecord(meta, {
      captureId,
      capturedAt,
      postUrl,
      sendPlatform,
      extra: { mediaType: meta.mediaType, media: meta.media, capturedVia },
    });

    const metaOk = metaFetched(meta);
    let ack: BridgeAck;
    try {
      ack = await sendPostToBridge(captureId, record, metaOk, meta.metaError || null, saveId);
    } catch (err) {
      throw trace.fail('bridge', err?.message || 'bridge save failed', meta.metaError || null);
    }
    trace.passed('bridge');
    markSaved([record.url, postUrl], ack?.captureId || captureId, savedMediaUrls(ack), tab.id);
    const grouped = await bumpRecentSave(record.url);
    return { ...ack, metaOk, metaReason: meta.metaError || null, grouped };
  }

  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type !== 'captureAndSend') return false;

    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: 'Missing tab context' } satisfies CaptureAndSendResponse);
      return false;
    }

    if (!isAllowedSender(sender.tab.url, message.platform)) {
      sendResponse({ ok: false, error: 'Sender origin does not match platform' } satisfies CaptureAndSendResponse);
      return false;
    }

    const tabId = sender.tab.id;
    const senderHost = getHostname(sender.tab.url);
    // captureAndSend never carries a capturedVia (only the intake routes —
    // savePost / imageDragged — do): captureAndSave keeps its default (null).
    captureAndSave(sender.tab, message.rect, message.postUrl, message.platform, null, message.replaces || null, message.saveId)
      // captureAndSave has no return value (it notifies the content script
      // directly via notify() instead) — content.js's capturePost() never reads
      // this sendResponse either, so `ok:true` is the whole payload.
      .then(() => sendResponse({ ok: true } satisfies CaptureAndSendResponse))
      .catch((error) => {
        console.error(error);
        const errorKind = classifySaveFailure(error?.message);
        logSaveFailure(error, { saveId: message.saveId, platform: message.platform, host: senderHost, url: message.postUrl });
        chrome.tabs.sendMessage(tabId, { type: 'notify', success: false, errorKind } satisfies NotifyMessage).catch(() => {});
        sendResponse({ ok: false, errorKind } satisfies CaptureAndSendResponse);
      });

    return true;
  });

  async function captureAndSave(tab, rect, postUrl, sendPlatform, capturedVia: string | null = null, replaces: string | null = null, saveId: string | null = null) {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('save', { saveId, captureId, platform: sendPlatform, url: postUrl, tabId: tab.id ?? null });

    // captureVisibleTab shoots the window's ACTIVE tab, not the sender — if the
    // user switched tabs in the click→capture gap, a different page would be
    // saved under this post's metadata. Verify and bail instead.
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (!active || active.id !== tab.id) throw trace.fail('capture', 'Tab changed before capture');

    let dataUrl: string;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 92 });
    } catch (err) {
      throw trace.fail('capture', err?.message || 'captureVisibleTab failed');
    }
    trace.passed('capture');

    // Bounded (#507): the answer comes from the page, and a page that navigated
    // away, froze, or tore its listener down mid-capture never sends one — this
    // await had no end, and neither did the banner still spinning over there.
    let response: CropImageResponse;
    try {
      response = await withDeadline<CropImageResponse>(chrome.tabs.sendMessage(tab.id, { type: 'cropImage', dataUrl, rect } satisfies CropImageMessage), CROP_TIMEOUT_MS, 'crop');
    } catch (err) {
      throw trace.fail('crop', err?.message || 'cropImage failed');
    }
    if (!response?.croppedDataUrl) throw trace.fail('crop', 'Cropping failed');
    trace.passed('crop');
    const jpegBase64 = response.croppedDataUrl.split(',')[1];

    // Metadata comes from the platform's API (no DOM scraping).
    // fetchPostMetadata is defined in metadata.js (imported at the top).
    // expectedHost pins the Misskey/Mastodon instance fetch to the sender tab's
    // host (SSRF guard — a hostile page can't aim the fetch at another host).
    let meta: PostRecord;
    try {
      meta = await fetchPostMetadata(postUrl, { expectedHost: getHostname(tab.url) });
    } catch (err) {
      throw trace.fail('metadata', err?.message || 'metadata fetch threw');
    }
    trace.passed('metadata');

    const record = buildRecord(meta, {
      captureId,
      capturedAt,
      postUrl,
      sendPlatform,
      replaces,
      // The screenshot is the primary image; media[] (API original URLs) is what the
      // bridge downloads, then overwrites with the saved filenames.
      extra: { image: `${captureId}.jpg`, mediaType: meta.mediaType, media: meta.media || [], capturedVia },
    });

    const metaOk = metaFetched(meta);
    let ack: BridgeAck;
    try {
      ack = await sendToBridge(captureId, jpegBase64, record, metaOk, meta.metaError || null, saveId);
    } catch (err) {
      throw trace.fail('bridge', err?.message || 'bridge save failed');
    }
    trace.passed('bridge');
    markSaved([record.url, postUrl], ack?.captureId || captureId, savedMediaUrls(ack), tab.id); // light this post's TL badge now
    // grouped = prior saves of this post this session → the banner says the save
    // merged with them (the app folds same-URL records into one card).
    const grouped = await bumpRecentSave(record.url);
    chrome.tabs.sendMessage(tab.id, { type: 'notify', success: true, metaOk, metaReason: meta.metaError || null, grouped } satisfies NotifyMessage).catch(() => {});
  }

  // Send a message to the native messaging host (which writes the sidecar + image
  // into the user's save folder) and resolve with its ack. The host is short-lived:
  // Chrome spawns it per connection, so this works even when the desktop app is not
  // running.
  function bridgeSend(message: unknown): Promise<BridgeAck> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let port: chrome.runtime.Port | null = null;

      function finish(error: Error | null, result?: any) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          port?.disconnect();
        } catch {
          /* already disconnected */
        }
        if (error) reject(error);
        else resolve(result);
      }

      try {
        port = chrome.runtime.connectNative(NATIVE_HOST);
      } catch (error: any) {
        reject(new Error(`Native host unavailable: ${error?.message || error}`));
        return;
      }

      timer = setTimeout(() => finish(new Error('Native host timed out')), NATIVE_HOST_TIMEOUT_MS);

      port.onMessage.addListener((msg) => {
        if (msg?.ok) finish(null, msg);
        else finish(new Error(msg?.error || 'Native host returned an error'));
      });

      port.onDisconnect.addListener(() => {
        finish(new Error(chrome.runtime.lastError?.message || 'Native host disconnected (is it installed?)'));
      });

      port.postMessage(message);
    });
  }

  // Post-click save: screenshot (base64 JPEG) + metadata. metaOk (whether the post
  // API returned info) rides along so the host's capture.log records partial saves,
  // and metaReason with it — WHY the info is missing is what tells a deleted or
  // protected post apart from a broken fetch when reading the log afterwards.
  // saveId rides along too, on every route: the host writes its own capture.log
  // lines, and without the id those lines could not be tied to the extension's
  // (#519).
  function sendToBridge(captureId, jpegBase64, record, metaOk, metaReason, saveId: string | null) {
    return bridgeSend({ type: 'save', captureId, saveId, image: jpegBase64, metadata: record, metaOk, metaReason });
  }

  // Bulk-intake save (#362): metadata only, no screenshot — the host downloads
  // the post's own media and the first one becomes the record's image.
  function sendPostToBridge(captureId, record, metaOk, metaReason, saveId: string | null) {
    return bridgeSend({ type: 'savePost', captureId, saveId, metadata: record, metaOk, metaReason });
  }

  // Image-drag save: the host downloads the dragged image itself (no screenshot).
  function sendDraggedToBridge(captureId, imageUrl, imageReferer, record, metaOk, metaReason, saveId: string | null) {
    return bridgeSend({ type: 'saveDragged', captureId, saveId, imageUrl, imageReferer, metadata: record, metaOk, metaReason });
  }

  // The pictures the host says it actually recorded for a save (positional, see
  // markSaved). Announced-but-undownloaded media is deliberately NOT counted:
  // the badge must agree with what a later query will answer, and the host
  // answers from what it wrote.
  function savedMediaUrls(ack: BridgeAck | undefined): Array<string | null> {
    return Array.isArray(ack?.media) ? ack.media.map((u: unknown) => (typeof u === 'string' && u ? u : null)) : [];
  }

  // --- "Already saved?" lookups (TL badge, #54) ---------------------------------
  // badge.js asks whether the permalinks it can see are already in the library.
  // The answer comes from the native host (which reads the library's index — it
  // works with the desktop app closed), through a port that STAYS OPEN: a timeline
  // scroll asks a few times a second, and connectNative spawns a fresh host process
  // per connection, so the per-save one-shot shape would fork a process per query.
  //
  // One port, many in-flight requests: each carries an id the host echoes back.
  // The service worker can be killed at any idle moment, taking the port with it —
  // that is fine, the next query reconnects (and a killed SW has no badges to keep
  // current anyway).
  let queryPort: chrome.runtime.Port | null = null;
  let nextQueryId = 1;
  const pendingQueries = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  function failAllPending(message: string) {
    for (const [, p] of pendingQueries) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    pendingQueries.clear();
  }

  function getQueryPort(): chrome.runtime.Port {
    if (queryPort) return queryPort;
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    queryPort = port;
    port.onMessage.addListener((msg: any) => {
      const p = msg && msg.id != null ? pendingQueries.get(msg.id) : null;
      if (!p) return; // late reply to a timed-out request — nothing to settle
      pendingQueries.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve(msg);
    });
    port.onDisconnect.addListener(() => {
      if (queryPort === port) queryPort = null;
      failAllPending(chrome.runtime.lastError?.message || 'Native host disconnected');
    });
    return port;
  }

  // Ask the host about a batch of URLs. Rejects (rather than answering "not
  // saved") when the host can't be reached, so a missing host shows NO badges
  // instead of asserting that a saved post isn't saved.
  function queryBridge(urls: string[]): Promise<SavedResults> {
    return new Promise((resolve, reject) => {
      let port: chrome.runtime.Port;
      try {
        port = getQueryPort();
      } catch (error: any) {
        reject(new Error(`Native host unavailable: ${error?.message || error}`));
        return;
      }
      const id = nextQueryId++;
      const timer = setTimeout(() => {
        pendingQueries.delete(id);
        reject(new Error('Native host timed out'));
      }, SAVED_QUERY_TIMEOUT_MS);
      pendingQueries.set(id, { resolve: (msg) => resolve((msg && msg.results) || {}), reject, timer });
      try {
        port.postMessage({ type: 'query', id, urls });
      } catch (error: any) {
        pendingQueries.delete(id);
        clearTimeout(timer);
        queryPort = null;
        reject(new Error(`Native host unavailable: ${error?.message || error}`));
      }
    });
  }

  // Answers already known, so scrolling back over a post costs nothing.
  // BOTH answers expire. A "not saved" goes stale the moment the user saves that
  // post (a save made HERE updates the entry directly — see markSaved), and a
  // "saved" goes stale when they delete it in the desktop app, which this side
  // never sees. Positives used to be kept for the life of the worker, so a
  // deleted post kept its badge until the service worker restarted — and worse,
  // the bulk intake asks through this same cache, so it would SKIP a post the
  // user had just deleted and meant to take again. Re-asking is cheap: the host
  // answers from an index it keeps in memory, invalidated by the save folder's
  // own mtimes, so it already sees the delete.
  const SAVED_TTL_MS = 60_000;
  const SAVED_CACHE_MAX = 2000;
  const savedCache = new Map<string, { entry: SavedEntry | null; until: number }>();

  function cacheGet(url: string): { entry: SavedEntry | null } | undefined {
    const hit = savedCache.get(url);
    if (!hit) return undefined;
    if (hit.until && hit.until < Date.now()) {
      savedCache.delete(url);
      return undefined;
    }
    return hit;
  }

  function cacheSet(url: string, entry: SavedEntry | null) {
    savedCache.delete(url); // re-insert so Map iteration order is LRU-ish
    savedCache.set(url, { entry, until: Date.now() + SAVED_TTL_MS });
    if (savedCache.size > SAVED_CACHE_MAX) {
      for (const k of [...savedCache.keys()].slice(0, savedCache.size - SAVED_CACHE_MAX)) savedCache.delete(k);
    }
  }

  // A save just landed: the badge for that post must appear now, not after the
  // negative entry expires. Told to the saving tab directly — other tabs pick it
  // up when their own negatives expire.
  //
  // `media` is what the host REPORTS it recorded, not what was announced: after
  // saving one picture of a multi-image post, the other pictures must keep
  // offering their save button (#334). Cached as "the whole post" — the shape
  // that hides every button — would undo that for a minute. Merged with any
  // entry already cached, because the earlier save of the same post recorded a
  // different picture.
  //
  // BOTH url forms are marked: the record's url comes from the platform API and
  // the page's permalink from the DOM, and the two can differ in spelling for the
  // same post (the host normalizes them to one key, this side deliberately does
  // not — see native-host/post-key.mts). Caching only one form would leave the
  // other's negative entry to expire on its own, and the badge would lag a minute
  // behind the save that just happened in front of the user.
  // captureId, NOT the ack's `file`: the two differ (the bulk-intake path's file
  // is a media filename that carries no id at all), and since #34 this value is
  // read as an identifier — a "replace" answer names the capture it retires.
  function markSaved(urls: Array<string | null | undefined>, captureId: string | null, media: Array<string | null>, tabId?: number) {
    const seen = new Set<string>();
    for (const url of urls) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const known = cacheGet(url)?.entry;
      const merged: SavedEntry = known ? { id: known.id || captureId || '', media: known.media.slice(), owners: (known.owners || known.media.map(() => known.id || null)).slice() } : { id: captureId || '', media: [] as Array<string | null>, owners: [] as Array<string | null> };
      // An entry that already answered "whole post" stays that way: adding one
      // picture to an empty list would claim the rest are NOT saved.
      if (!known || known.media.length) {
        for (const u of media) {
          if (!u || merged.media.includes(u)) continue;
          merged.media.push(u);
          merged.owners?.push(captureId || null); // this save wrote this picture
        }
      }
      cacheSet(url, merged);
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'savedUpdate', url, media } satisfies SavedUpdateMessage).catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, _sender, sendResponse) => {
    if (message.type !== 'checkSaved') return false;
    const urls: string[] = Array.isArray(message.urls) ? message.urls.filter((u) => typeof u === 'string' && u) : [];
    const results: SavedResults = {};
    const ask: string[] = [];
    for (const u of urls) {
      const hit = cacheGet(u);
      if (hit) results[u] = hit.entry;
      else ask.push(u);
    }
    if (!ask.length) {
      sendResponse({ ok: true, results } satisfies CheckSavedResponse);
      return false;
    }
    queryBridge(ask)
      .then((fresh) => {
        for (const u of ask) {
          const entry = (Object.hasOwn(fresh, u) ? fresh[u] : null) || null;
          cacheSet(u, entry);
          results[u] = entry;
        }
        sendResponse({ ok: true, results } satisfies CheckSavedResponse);
      })
      // Unreachable host → report the failure instead of a page full of
      // "not saved": badge.js leaves those posts unmarked and retries later.
      .catch((error) => sendResponse({ ok: false, error: error?.message, results } satisfies CheckSavedResponse));
    return true; // async response
  });

  // --- Duplicate-save warning (#34) ---------------------------------------------
  // Asked by the content scripts BEFORE they start a save, so the answer can be
  // a choice (copy / replace / skip) rather than an after-the-fact notice: the
  // extension writes through the native host, so a save made with the desktop
  // app closed has no in-app surface to resolve later.
  //
  // Read-only and fail-open. Anything that leaves the question unanswered — no
  // permalink, an unreachable host, a thrown lookup — answers `ok:false`, and
  // the caller saves as it always did. A missed warning costs one extra record;
  // a blocked save costs the post.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'checkDuplicate') return false;
    duplicateOf(message.url, message.platform, Array.isArray(message.imageUrls) ? message.imageUrls : [])
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true; // async response
  });

  interface DuplicateAnswer {
    ok: boolean;
    duplicate?: boolean;
    captureId?: string | null;
  }

  // Two axes, in the order they can be decided (#34's confirmed design):
  //   1. the post URL (postKeyOf, host-side) — is this post in the library at all?
  //   2. the pictures — does what is about to be saved OVERLAP what is saved?
  // Axis 2 is what keeps a manga's next page from being called a duplicate: same
  // post URL, a picture the library does not have, so nothing is re-saved. When
  // the pictures cannot be compared at all (a text-only post, a record saved
  // before per-picture answers existed, a page whose platform has no picture
  // identity rule) axis 1 stands alone and warns — a false warning is answered
  // with "copy" and costs nothing, while a missed one is a silent duplicate.
  async function duplicateOf(url: unknown, platform: string, imageUrls: string[]): Promise<DuplicateAnswer> {
    if (typeof url !== 'string' || !url) return { ok: true, duplicate: false };
    const hit = cacheGet(url);
    let entry: SavedEntry | null;
    if (hit) {
      entry = hit.entry;
    } else {
      const fresh = await queryBridge([url]);
      entry = (Object.hasOwn(fresh, url) ? fresh[url] : null) || null;
      cacheSet(url, entry);
    }
    if (!entry) return { ok: true, duplicate: false };

    const wanted = imageUrls.map((u) => mediaKeyOf(platform, u)).filter((k): k is string => !!k);
    const saved = entry.media.map((u, i) => ({ key: u ? mediaKeyOf(platform, u) : null, owner: (entry?.owners && entry.owners[i]) || entry?.id || null }));
    const comparable = saved.filter((s) => s.key);
    if (!comparable.length || !wanted.length) return { ok: true, duplicate: true, captureId: entry.id || null };
    const overlap = comparable.find((s) => s.key && wanted.includes(s.key));
    return overlap ? { ok: true, duplicate: true, captureId: overlap.owner } : { ok: true, duplicate: false };
  }

  // --- Recent-save memory (per post URL) ------------------------------------------
  // Consecutive saves of the SAME post (multi-page manga, re-grabs) merge into one
  // card in the app, so the save toast should say so — otherwise the second save
  // looks like a no-op (nothing new appears; the card face doesn't change).
  // The count lives in chrome.storage.session: survives service-worker restarts,
  // clears when the browser closes ("recent" ≈ this browsing session). Keyed by the
  // record's canonical post URL (both save paths build it from the same metadata).
  // Returns how many saves of this URL happened BEFORE this one (0 = first).
  const RECENT_SAVES_KEY = 'recentSaves.v1';
  const RECENT_SAVES_MAX = 200; // prune oldest beyond this many distinct posts
  async function bumpRecentSave(url) {
    if (!url) return 0;
    try {
      const got = await chrome.storage.session.get(RECENT_SAVES_KEY);
      const map = got[RECENT_SAVES_KEY] || {};
      const prev = map[url] ? map[url].n : 0;
      map[url] = { n: prev + 1, t: Date.now() };
      const keys = Object.keys(map);
      if (keys.length > RECENT_SAVES_MAX) {
        keys.sort((a, b) => map[a].t - map[b].t);
        for (const k of keys.slice(0, keys.length - RECENT_SAVES_MAX)) delete map[k];
      }
      await chrome.storage.session.set({ [RECENT_SAVES_KEY]: map });
      return prev;
    } catch {
      return 0; // memory is best-effort; never fail or delay a save over it
    }
  }

  // Best-effort diagnostics: append one capture event to the native host's
  // capture.log so a broken save can be diagnosed from disk later. Opens its OWN
  // short-lived native connection — not piggybacked on the save (bridgeSend
  // finishes on its first reply), and pre-bridge failures have no save connection
  // at all. NEVER throws and never blocks the save: if the host can't be reached
  // (e.g. it isn't registered — itself worth recording) the entry falls back to a
  // chrome.storage ring buffer that {type:'dumpLogs'} can read back.
  function logCapture(entry: SaveLogEntry, keepLocal = false): Promise<void> {
    const full = Object.assign({ ts: new Date().toISOString() }, entry);
    if (keepLocal) stashLogLocally(full);
    return new Promise((resolve) => {
      let settled = false;
      let port: chrome.runtime.Port | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = (viaHost: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          port?.disconnect();
        } catch {
          /* already gone */
        }
        if (!viaHost && !keepLocal) stashLogLocally(full);
        resolve();
      };
      timer = setTimeout(() => done(false), 4000);
      try {
        port = chrome.runtime.connectNative(NATIVE_HOST);
      } catch {
        done(false);
        return;
      }
      port.onMessage.addListener(() => done(true));
      port.onDisconnect.addListener(() => done(false));
      try {
        port.postMessage({ type: 'log', entry: full });
      } catch {
        done(false);
      }
    });
  }

  // Ring buffer for entries that couldn't reach the host. One key per entry
  // (append-only — no read-modify-write race between concurrent captures); ISO ts
  // in the key makes lexical sort == chronological, so trimming drops the oldest.
  function stashLogLocally(entry) {
    try {
      const key = `${DIAG_PREFIX}${entry.ts}_${Math.floor(Math.random() * 1e6)}`;
      chrome.storage.local.set({ [key]: entry }, () => {
        void chrome.runtime.lastError; // ignore quota / other set errors
        chrome.storage.local.get(null, (all) => {
          if (chrome.runtime.lastError) return;
          const keys = Object.keys(all)
            .filter((k) => k.startsWith(DIAG_PREFIX))
            .sort();
          if (keys.length > DIAG_KEEP) chrome.storage.local.remove(keys.slice(0, keys.length - DIAG_KEEP));
        });
      });
    } catch {
      /* ignore — diagnostics are non-essential */
    }
  }

  // A metadata fetch "succeeded" if the platform API returned any identifying
  // field. An empty record (fetch failed / API down / unparseable URL) has null
  // author/date/text and no media — the screenshot still saved, but the user
  // should be told the post info is missing rather than seeing a plain success.
  // metaError is authoritative when set: screenName is parsed from the URL and
  // date can be decoded from an X snowflake id, so both can be present on a
  // record whose API fetch returned nothing (a protected X account looked like
  // a full success via its URL-derived screenName — 2026-07-12).
  // Media a platform serves as a file the page can only preview. The still frame
  // shown in its place is never the record's content, so these posts are saved
  // by downloading what the platform announces rather than what the page shows.
  function isPlayableMedia(mediaType) {
    return mediaType === 'video' || mediaType === 'gif';
  }

  function metaFetched(meta) {
    if (!meta || meta.metaError) return false;
    return !!(meta.displayName || meta.userId || meta.text || meta.date || (Array.isArray(meta.media) && meta.media.length));
  }

  // --- Image-drag save (drag.js → here) ---
  // Same metadata as a post-click save, but no screenshot: the dragged image
  // itself becomes the record's primary image (the bridge downloads it). Produces
  // the "illustration record" shape (image = the art, media: []).
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type !== 'imageDragged') return false;
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: 'Missing tab context' } satisfies SaveResponse);
      return false;
    }
    if (!isAllowedSender(sender.tab.url, message.platform)) {
      sendResponse({ ok: false, error: 'Sender origin does not match platform' } satisfies SaveResponse);
      return false;
    }
    const senderHost = getHostname(sender.tab.url);
    captureAndSaveDragged(sender.tab, message.platform, message.postUrl, message.imageUrls || [], message.replaces || null, message.saveId)
      .then((result) => sendResponse({ ok: true, ...result } satisfies SaveResponse))
      .catch((error) => {
        console.error(error);
        const errorKind = classifySaveFailure(error?.message);
        logSaveFailure(error, { saveId: message.saveId, platform: message.platform, host: senderHost, url: message.postUrl });
        sendResponse({ ok: false, errorKind, metaReason: error?.metaReason || null } satisfies SaveResponse);
      });
    return true; // async response
  });

  // Diagnostics relays. content.js reports pre-bridge stage failures (select /
  // permalink) here; {type:'dumpLogs'} reads back the local fallback ring buffer
  // (entries that never reached the host's capture.log).
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type === 'logCapture') {
      const entry = Object.assign({ host: getHostname(sender.tab?.url) }, message.entry || {});
      void logCapture(entry, entry.phase === 'fail');
      sendResponse({ ok: true } satisfies LogCaptureResponse);
      return false;
    }
    if (message.type === 'dumpLogs') {
      chrome.storage.local.get(null, (all) => {
        const entries = Object.keys(all)
          .filter((k) => k.startsWith(DIAG_PREFIX))
          .sort()
          .map((k) => all[k]);
        sendResponse({ ok: true, entries } satisfies DumpLogsResponse);
      });
      return true; // async
    }
    return false;
  });

  async function captureAndSaveDragged(tab, sendPlatform, postUrl, imageUrls, replaces: string | null = null, saveId: string | null = null) {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('saveDragged', { saveId, captureId, platform: sendPlatform, url: postUrl, tabId: tab.id ?? null });

    // expectedHost pins Misskey/Mastodon instance fetches to the sender tab's host
    // (SSRF guard). Drag is x/bsky/pixiv only today, but keep it consistent.
    let meta: PostRecord;
    try {
      meta = await fetchPostMetadata(postUrl, { expectedHost: getHostname(tab.url) });
    } catch (err) {
      throw trace.fail('metadata', err?.message || 'metadata fetch threw');
    }
    trace.passed('metadata');
    const metaOk = metaFetched(meta);

    // What the page can hand over for a video or GIF post is the poster frame,
    // and a poster on its own is not worth a library entry — the content is the
    // video file (#450). The post-save path already downloads the originals a
    // platform announces, video bodies included since #119 stage 1, so send
    // those posts down it rather than teaching this path to fetch video too.
    // Everything else keeps the illustration-record shape, where the picture
    // that was pointed at IS what the user asked to save.
    let record: any;
    let send: () => Promise<BridgeAck>;
    if (isPlayableMedia(meta.mediaType)) {
      // capturedVia stays null — an ordinary save, not an intake route (#362).
      record = buildRecord(meta, { captureId, capturedAt, postUrl, sendPlatform, replaces, extra: { mediaType: meta.mediaType, media: meta.media, capturedVia: null } });
      send = () => sendPostToBridge(captureId, record, metaOk, meta.metaError || null, saveId);
    } else {
      const primary = pickPrimaryImage(meta.platform || sendPlatform, imageUrls, meta);
      if (!primary || !primary.url) throw trace.fail('image', 'Could not resolve a dragged image URL');
      trace.passed('image');
      record = buildRecord(meta, {
        captureId,
        capturedAt,
        postUrl,
        sendPlatform,
        replaces,
        extra: {
          mediaType: 'image',
          // Which image of a multi-image post this is (1-based) + the total. Only
          // recorded for multi-image posts; imageIndex is null when undeterminable.
          imageCount: (meta.media || []).length > 1 ? meta.media.length : null,
          imageIndex: (meta.media || []).length > 1 && primary.index >= 0 ? primary.index + 1 : null,
          // image + media[] are set by the bridge (image = downloaded original, media = [])
        },
      });
      send = () => sendDraggedToBridge(captureId, primary.url, primary.referer, record, metaOk, meta.metaError || null, saveId);
    }

    let ack: BridgeAck;
    try {
      ack = await send();
    } catch (err) {
      throw trace.fail('bridge', err?.message || 'bridge save failed', meta.metaError || null);
    }
    trace.passed('bridge');
    markSaved([record.url, postUrl], ack?.captureId || captureId, savedMediaUrls(ack), tab.id); // light this post's TL badge now
    // Surface metadata-fetch failure to the drop overlay (same partial-success
    // signal as the click-save banner) so a screenshot-less illustration that
    // saved without post info isn't shown as a plain success. grouped = prior
    // saves of this post this session (the overlay says the save merged).
    const grouped = await bumpRecentSave(record.url);
    return { ...ack, metaOk, metaReason: meta.metaError || null, grouped };
  }
}

// Build the sidecar record shared by both save paths. The click path adds image +
// media (the screenshot is the content; media[] carries the API originals the
// bridge downloads). The drag path leaves image/media to the bridge (the
// downloaded illustration becomes image, media stays []) and instead records
// which image of a multi-image post it was. Single source of truth so a new field
// can't drift between the two paths.
function buildRecord(meta, { captureId, capturedAt, postUrl, sendPlatform, replaces, extra }: { captureId: string; capturedAt: string; postUrl: string; sendPlatform: string; replaces?: string | null; extra: Record<string, unknown> }) {
  return Object.assign(
    {
      captureId,
      // #34: the captureId this save replaces, when the user answered the
      // duplicate warning with "replace". The host writes it through as a plain
      // record field — trashing the old capture is the app's job (write-once).
      replaces: replaces || null,
      url: meta.url || postUrl || null,
      // meta.platform is null only when the URL didn't parse; fall back to the
      // sender-reported platform (already origin-validated) so the record stays
      // visible in the viewer's platform filter rather than becoming platform:null.
      platform: meta.platform || sendPlatform || null,
      text: meta.text,
      title: meta.title || null,
      displayName: meta.displayName,
      screenName: meta.screenName,
      userId: meta.userId,
      avatar: meta.avatar,
      avatarReferer: meta.avatarReferer,
      followers: meta.followers,
      authorCreatedAt: meta.authorCreatedAt,
      likes: meta.likes,
      reposts: meta.reposts,
      replies: meta.replies,
      bookmarks: meta.bookmarks,
      views: meta.views,
      // No silent fallback to capture time: a fabricated "post date" pollutes the
      // viewer's date sort/filter. The viewer handles null dates.
      date: meta.date || null,
      capturedAt,
      updatedAt: capturedAt, // last modified in Hologram (bumped on tag edits etc.)
      lang: meta.lang,
      isReply: meta.isReply,
      isQuote: meta.isQuote,
      isThread: meta.isThread,
      quotedUrl: meta.quotedUrl,
      replyToId: meta.replyToId,
      hashtags: meta.hashtags || [],
      tags: meta.tags || [],
      // The acquisition originals (#292), still as received text — the native
      // host compresses, hashes and caps them (native-host/raw-payload.mts).
      // Carried on every save path, including a partial one: a response that
      // yielded no usable fields is precisely the one whose body has to survive.
      rawPayloads: meta.raw || [],
    },
    extra,
  );
}

function generateCaptureId() {
  const hex = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `${Date.now()}-${hex}`;
}

// Choose which original to save for a dragged image, preferring the platform
// API's original (matched to the dragged image) so we store full resolution.
// Returns { url, referer, index } where index = the 0-based position of the
// chosen image within the post's media[] (-1 if we couldn't determine it).
function pickPrimaryImage(platform, imageUrls, meta) {
  const media = (meta && meta.media) || [];
  const extractor = extractorFor(platform);
  // A site whose media[] is indexed by a page number in the file name (pixiv)
  // answers straight from the dragged URL, no key matching needed.
  if (extractor?.mediaPageIndex) {
    const page = extractor.mediaPageIndex(imageUrls);
    const referer = extractor.mediaReferer;
    const i = page !== null && page < media.length ? page : media.length === 1 ? 0 : -1;
    // Only substitute the API original when the dragged page was actually
    // matched — silently saving p0 for an unmatched drag asserted an image the
    // user never dragged. Unmatched → keep the dragged URL (like X/Bluesky).
    const pick = i >= 0 ? media[i] : null;
    if (pick && pick.url) return { url: pick.url, referer: pick.referer || referer, index: i };
    return { url: imageUrls[0], referer, index: -1 };
  }
  const i = matchMediaIndex(platform, imageUrls, media);
  if (i >= 0 && media[i] && media[i].url) return { url: media[i].url, referer: media[i].referer, index: i };
  return { url: hiRes(platform, imageUrls[0]), referer: undefined, index: media.length === 1 ? 0 : -1 };
}

// Index (0-based) of the post's media[] entry that the dragged image came from,
// matched by mediaKeyOf (the extractor owns the per-site rule — the overlay
// compares the library's saved pictures with the same one, #334).
// -1 if none matched (or the platform has no key scheme).
function matchMediaIndex(platform, imageUrls, media) {
  const keys = imageUrls.map((u) => mediaKeyOf(platform, u)).filter(Boolean);
  if (!keys.length) return -1;
  for (let i = 0; i < media.length; i++) {
    const k = mediaKeyOf(platform, media[i].url);
    if (k && keys.includes(k)) return i;
  }
  return -1;
}

// The site's original-resolution rewrite, falling back to the URL as given —
// a save has to send something even where no rewrite rule applies.
function hiRes(platform, url) {
  if (!url) return url;
  return highResUrlOf(platform, url) ?? url;
}

// Pure helpers with no chrome.* / DOM dependency, exported for direct unit
// testing (scripts/background-unit.test.ts) — the rest of this file only
// runs inside the extension service worker via startBackground().
export { isAllowedSender, pickPrimaryImage, matchMediaIndex, hiRes, buildRecord, generateCaptureId };
