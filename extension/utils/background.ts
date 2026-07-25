import { fetchPostMetadata } from './metadata';
import { classifySaveFailure } from './native-error';

export function startBackground(): void {
  const NATIVE_HOST = 'com.hologram.host';

  // Allowed capture origins per platform (used to validate the sender tab).
  const PLATFORM_HOSTS = {
    x: ['x.com', 'twitter.com'],
    bluesky: ['bsky.app'],
    pixiv: ['www.pixiv.net', 'pixiv.net'],
    // misskey / mastodon: any https origin (instances are arbitrary hosts)
  };

  function getHostname(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  // --- Capture diagnostics ------------------------------------------------------
  // Fallback ring buffer for log entries that couldn't reach the native host's
  // capture.log (the host failing to launch is exactly the failure we most want
  // recorded). See logCapture / stashLogLocally / the dumpLogs handler.
  const DIAG_PREFIX = 'diaglog_';
  const DIAG_KEEP = 50;

  interface StageError extends Error {
    stage: string;
  }

  // Tag an error with the pipeline stage it failed at, so the single catch in the
  // message handler can log WHICH stage broke. select/permalink are reported by
  // content.js; capture/crop/metadata/bridge are tagged here.
  function stageError(stage: string, message: string): StageError {
    const err = new Error(message) as StageError;
    err.stage = stage;
    return err;
  }

  function isAllowedSender(tabUrl, platformId) {
    const hostname = getHostname(tabUrl);
    if (!hostname) return false;
    const hosts = PLATFORM_HOSTS[platformId];
    if (hosts) return hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
    if (platformId === 'misskey' || platformId === 'mastodon') return /^https:/i.test(tabUrl || '');
    return false;
  }

  async function activateOnTab(tab) {
    // Log the attempt (and the silent non-http bail) to capture.log: an icon
    // click that "does nothing" is otherwise diagnosable only from the SW
    // DevTools console, which nobody has open when it happens.
    if (!tab.id || !/^https?:/i.test(tab.url || '')) {
      void logCapture({ stage: 'activate', phase: 'skip', url: tab.url || '(no url)' });
      return;
    }
    void logCapture({ stage: 'activate', phase: 'click', host: getHostname(tab.url), url: tab.url });
    try {
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

  chrome.action.onClicked.addListener(activateOnTab);

  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'activate') return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) activateOnTab(tab);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'captureAndSend') return false;

    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: 'Missing tab context' });
      return false;
    }

    if (!isAllowedSender(sender.tab.url, message.platform)) {
      sendResponse({ ok: false, error: 'Sender origin does not match platform' });
      return false;
    }

    const tabId = sender.tab.id;
    const senderHost = getHostname(sender.tab.url);
    captureAndSave(sender.tab, message.rect, message.postUrl, message.platform)
      // captureAndSave has no return value (it notifies the content script
      // directly via notify() instead) — content.js's capturePost() never reads
      // this sendResponse either, so `ok:true` is the whole payload.
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error(error);
        const errorKind = classifySaveFailure(error?.message);
        void logCapture({ stage: error?.stage || 'unknown', phase: 'fail', platform: message.platform, host: senderHost, url: message.postUrl, error: error?.message }, true);
        notify(tabId, false, { errorKind });
        sendResponse({ ok: false, errorKind });
      });

    return true;
  });

  async function captureAndSave(tab, rect, postUrl, sendPlatform) {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();

    // captureVisibleTab shoots the window's ACTIVE tab, not the sender — if the
    // user switched tabs in the click→capture gap, a different page would be
    // saved under this post's metadata. Verify and bail instead.
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (!active || active.id !== tab.id) throw stageError('capture', 'Tab changed before capture');

    let dataUrl: any;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 92 });
    } catch (err) {
      throw stageError('capture', err?.message || 'captureVisibleTab failed');
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'cropImage', dataUrl, rect });
    if (!response?.croppedDataUrl) throw stageError('crop', 'Cropping failed');
    const jpegBase64 = response.croppedDataUrl.split(',')[1];

    // Metadata comes from the platform's API (no DOM scraping).
    // fetchPostMetadata is defined in metadata.js (imported at the top).
    // expectedHost pins the Misskey/Mastodon instance fetch to the sender tab's
    // host (SSRF guard — a hostile page can't aim the fetch at another host).
    let meta: any;
    try {
      meta = await fetchPostMetadata(postUrl, { expectedHost: getHostname(tab.url) });
    } catch (err) {
      throw stageError('metadata', err?.message || 'metadata fetch threw');
    }

    const record = buildRecord(meta, {
      captureId,
      capturedAt,
      postUrl,
      sendPlatform,
      // The screenshot is the primary image; media[] (API original URLs) is what the
      // bridge downloads, then overwrites with the saved filenames.
      extra: { image: `${captureId}.jpg`, mediaType: meta.mediaType, media: meta.media || [] },
    });

    const metaOk = metaFetched(meta);
    let ack: any;
    try {
      ack = await sendToBridge(captureId, jpegBase64, record, metaOk);
    } catch (err) {
      throw stageError('bridge', err?.message || 'bridge save failed');
    }
    markSaved([record.url, postUrl], ack?.file || captureId, tab.id); // light this post's TL badge now
    // grouped = prior saves of this post this session → the banner says the save
    // merged with them (the app folds same-URL records into one card).
    const grouped = await bumpRecentSave(record.url);
    notify(tab.id, true, { metaOk, metaReason: meta.metaError || null, grouped });
  }

  // Build the sidecar record shared by both save paths. The click path adds image +
  // media (the screenshot is the content; media[] carries the API originals the
  // bridge downloads). The drag path leaves image/media to the bridge (the
  // downloaded illustration becomes image, media stays []) and instead records
  // which image of a multi-image post it was. Single source of truth so a new field
  // can't drift between the two paths.
  function buildRecord(meta, { captureId, capturedAt, postUrl, sendPlatform, extra }) {
    return Object.assign(
      {
        captureId,
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
      },
      extra,
    );
  }

  // Send a message to the native messaging host (which writes the sidecar + image
  // into the user's save folder) and resolve with its ack. The host is short-lived:
  // Chrome spawns it per connection, so this works even when the desktop app is not
  // running.
  function bridgeSend(message: unknown): Promise<any> {
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

      timer = setTimeout(() => finish(new Error('Native host timed out')), 30000);

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
  // API returned info) rides along so the host's capture.log records partial saves.
  function sendToBridge(captureId, jpegBase64, record, metaOk) {
    return bridgeSend({ type: 'save', captureId, image: jpegBase64, metadata: record, metaOk });
  }

  // Image-drag save: the host downloads the dragged image itself (no screenshot).
  function sendDraggedToBridge(captureId, imageUrl, imageReferer, record, metaOk) {
    return bridgeSend({ type: 'saveDragged', captureId, imageUrl, imageReferer, metadata: record, metaOk });
  }

  function notify(tabId, success, extra = {}) {
    chrome.tabs.sendMessage(tabId, { type: 'notify', success, ...extra }).catch(() => {});
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
  function queryBridge(urls: string[]): Promise<Record<string, string | null>> {
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
      }, 8000);
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
  // A "saved" answer can only be invalidated by a delete in the desktop app, which
  // this side never sees — so positives are kept for the life of the worker and a
  // deleted post keeps its badge until the SW restarts. A "not saved" answer goes
  // stale the moment the user saves that post, so negatives expire quickly (a save
  // made HERE updates the entry directly — see markSaved).
  const SAVED_TTL_MS = 60_000; // negatives only
  const SAVED_CACHE_MAX = 2000;
  const savedCache = new Map<string, { id: string | null; until: number }>();

  function cacheGet(url: string): { id: string | null } | undefined {
    const hit = savedCache.get(url);
    if (!hit) return undefined;
    if (hit.until && hit.until < Date.now()) {
      savedCache.delete(url);
      return undefined;
    }
    return hit;
  }

  function cacheSet(url: string, id: string | null) {
    savedCache.delete(url); // re-insert so Map iteration order is LRU-ish
    savedCache.set(url, { id, until: id === null ? Date.now() + SAVED_TTL_MS : 0 });
    if (savedCache.size > SAVED_CACHE_MAX) {
      for (const k of [...savedCache.keys()].slice(0, savedCache.size - SAVED_CACHE_MAX)) savedCache.delete(k);
    }
  }

  // A save just landed: the badge for that post must appear now, not after the
  // negative entry expires. Told to the saving tab directly — other tabs pick it
  // up when their own negatives expire.
  //
  // BOTH url forms are marked: the record's url comes from the platform API and
  // the page's permalink from the DOM, and the two can differ in spelling for the
  // same post (the host normalizes them to one key, this side deliberately does
  // not — see native-host/post-key.mts). Caching only one form would leave the
  // other's negative entry to expire on its own, and the badge would lag a minute
  // behind the save that just happened in front of the user.
  function markSaved(urls: Array<string | null | undefined>, captureId: string | null, tabId?: number) {
    const seen = new Set<string>();
    for (const url of urls) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      cacheSet(url, captureId || '');
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'savedUpdate', url }).catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'checkSaved') return false;
    const urls: string[] = Array.isArray(message.urls) ? message.urls.filter((u) => typeof u === 'string' && u) : [];
    const results: Record<string, string | null> = {};
    const ask: string[] = [];
    for (const u of urls) {
      const hit = cacheGet(u);
      if (hit) results[u] = hit.id;
      else ask.push(u);
    }
    if (!ask.length) {
      sendResponse({ ok: true, results });
      return false;
    }
    queryBridge(ask)
      .then((fresh) => {
        for (const u of ask) {
          const id = Object.hasOwn(fresh, u) ? fresh[u] : null;
          cacheSet(u, id);
          results[u] = id;
        }
        sendResponse({ ok: true, results });
      })
      // Unreachable host → report the failure instead of a page full of
      // "not saved": badge.js leaves those posts unmarked and retries later.
      .catch((error) => sendResponse({ ok: false, error: error?.message, results }));
    return true; // async response
  });

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
  function logCapture(entry: unknown, keepLocal = false): Promise<void> {
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
  function metaFetched(meta) {
    if (!meta || meta.metaError) return false;
    return !!(meta.displayName || meta.userId || meta.text || meta.date || (Array.isArray(meta.media) && meta.media.length));
  }

  function generateCaptureId() {
    const hex = Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, '0');
    return `${Date.now()}-${hex}`;
  }

  // --- Image-drag save (drag.js → here) ---
  // Same metadata as a post-click save, but no screenshot: the dragged image
  // itself becomes the record's primary image (the bridge downloads it). Produces
  // the "illustration record" shape (image = the art, media: []).
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'imageDragged') return false;
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: 'Missing tab context' });
      return false;
    }
    if (!isAllowedSender(sender.tab.url, message.platform)) {
      sendResponse({ ok: false, error: 'Sender origin does not match platform' });
      return false;
    }
    const senderHost = getHostname(sender.tab.url);
    captureAndSaveDragged(sender.tab, message.platform, message.postUrl, message.imageUrls || [])
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error(error);
        const errorKind = classifySaveFailure(error?.message);
        void logCapture({ stage: error?.stage || 'unknown', phase: 'fail', platform: message.platform, host: senderHost, url: message.postUrl, error: error?.message }, true);
        sendResponse({ ok: false, errorKind });
      });
    return true; // async response
  });

  // Diagnostics relays. content.js reports pre-bridge stage failures (select /
  // permalink) here; {type:'dumpLogs'} reads back the local fallback ring buffer
  // (entries that never reached the host's capture.log).
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'logCapture') {
      const entry = Object.assign({ host: getHostname(sender.tab?.url) }, message.entry || {});
      void logCapture(entry, entry.phase === 'fail');
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'dumpLogs') {
      chrome.storage.local.get(null, (all) => {
        const entries = Object.keys(all)
          .filter((k) => k.startsWith(DIAG_PREFIX))
          .sort()
          .map((k) => all[k]);
        sendResponse({ ok: true, entries });
      });
      return true; // async
    }
    return false;
  });

  async function captureAndSaveDragged(tab, sendPlatform, postUrl, imageUrls) {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();

    // expectedHost pins Misskey/Mastodon instance fetches to the sender tab's host
    // (SSRF guard). Drag is x/bsky/pixiv only today, but keep it consistent.
    let meta: any;
    try {
      meta = await fetchPostMetadata(postUrl, { expectedHost: getHostname(tab.url) });
    } catch (err) {
      throw stageError('metadata', err?.message || 'metadata fetch threw');
    }
    const primary = pickPrimaryImage(meta.platform || sendPlatform, imageUrls, meta);
    if (!primary || !primary.url) throw stageError('image', 'Could not resolve a dragged image URL');

    const record = buildRecord(meta, {
      captureId,
      capturedAt,
      postUrl,
      sendPlatform,
      extra: {
        mediaType: 'image',
        // Which image of a multi-image post this is (1-based) + the total. Only
        // recorded for multi-image posts; imageIndex is null when undeterminable.
        imageCount: (meta.media || []).length > 1 ? meta.media.length : null,
        imageIndex: (meta.media || []).length > 1 && primary.index >= 0 ? primary.index + 1 : null,
        // image + media[] are set by the bridge (image = downloaded original, media = [])
      },
    });

    const metaOk = metaFetched(meta);
    let ack: any;
    try {
      ack = await sendDraggedToBridge(captureId, primary.url, primary.referer, record, metaOk);
    } catch (err) {
      throw stageError('bridge', err?.message || 'bridge save failed');
    }
    markSaved([record.url, postUrl], ack?.file || captureId, tab.id); // light this post's TL badge now
    // Surface metadata-fetch failure to the drop overlay (same partial-success
    // signal as the click-save banner) so a screenshot-less illustration that
    // saved without post info isn't shown as a plain success. grouped = prior
    // saves of this post this session (the overlay says the save merged).
    const grouped = await bumpRecentSave(record.url);
    return { ...ack, metaOk, metaReason: meta.metaError || null, grouped };
  }

  // Choose which original to save for a dragged image, preferring the platform
  // API's original (matched to the dragged image) so we store full resolution.
  // Returns { url, referer, index } where index = the 0-based position of the
  // chosen image within the post's media[] (-1 if we couldn't determine it).
  function pickPrimaryImage(platform, imageUrls, meta) {
    const media = (meta && meta.media) || [];
    if (platform === 'pixiv') {
      let pidx = -1;
      for (const u of imageUrls) {
        const m = u && u.match(/\/\d+_p(\d+)[._]/);
        if (m) {
          pidx = Number.parseInt(m[1], 10);
          break;
        }
      }
      const i = pidx >= 0 && pidx < media.length ? pidx : media.length === 1 ? 0 : -1;
      // Only substitute the API original when the dragged page was actually
      // matched — silently saving p0 for an unmatched drag asserted an image the
      // user never dragged. Unmatched → keep the dragged URL (like X/Bluesky).
      const pick = i >= 0 ? media[i] : null;
      if (pick && pick.url) return { url: pick.url, referer: pick.referer || 'https://www.pixiv.net/', index: i };
      return { url: imageUrls[0], referer: 'https://www.pixiv.net/', index: -1 };
    }
    const i = matchMediaIndex(platform, imageUrls, media);
    if (i >= 0 && media[i] && media[i].url) return { url: media[i].url, referer: media[i].referer, index: i };
    return { url: hiRes(platform, imageUrls[0]), referer: undefined, index: media.length === 1 ? 0 : -1 };
  }

  function mediaKey(platform, url) {
    if (!url) return null;
    if (platform === 'x') return (url.match(/pbs\.twimg\.com\/media\/([^.?]+)/) || [])[1] || null;
    if (platform === 'bluesky') return (url.match(/\/([a-z0-9]{50,})(?:@|\b)/i) || [])[1] || null;
    if (platform === 'misskey' || platform === 'mastodon') {
      // Misskey/Mastodon serve direct file URLs; a thumbnail and its original share
      // the file id / hash (the URL basename, minus query and extension). Match on that.
      const base = (url.split(/[?#]/)[0].match(/([^/]+)$/) || [])[1] || '';
      return base.replace(/\.[a-z0-9]+$/i, '') || null;
    }
    return null;
  }

  // Index (0-based) of the post's media[] entry that the dragged image came from,
  // matched by mediaKey. -1 if none matched (or the platform has no key scheme).
  function matchMediaIndex(platform, imageUrls, media) {
    const keys = imageUrls.map((u) => mediaKey(platform, u)).filter(Boolean);
    if (!keys.length) return -1;
    for (let i = 0; i < media.length; i++) {
      const k = mediaKey(platform, media[i].url);
      if (k && keys.includes(k)) return i;
    }
    return -1;
  }

  function hiRes(platform, url) {
    if (!url) return url;
    if (platform === 'x' && url.includes('pbs.twimg.com/media/')) {
      try {
        const u = new URL(url);
        u.searchParams.set('name', 'orig');
        return u.href;
      } catch {
        /* ignore */
      }
    }
    if (platform === 'bluesky' && url.includes('cdn.bsky.app')) return url.replace(/@jpeg$/, '');
    return url;
  }
}
