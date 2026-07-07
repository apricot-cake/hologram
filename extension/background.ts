importScripts('metadata.js');

const NATIVE_HOST = 'com.corpus.host';

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

// Chrome reports an unregistered native host as "Specified native messaging host
// not found." A freshly-registered host reads the same way until Chrome restarts
// (the registry is read at startup), so the right first hint is "restart Chrome"
// — distinct from a host that launched and then errored (timeout / returned error).
function isHostMissing(message) {
  return /host not found|host unavailable|is it installed/i.test(String(message || ''));
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
  if (!tab.id || !/^https?:/i.test(tab.url || '')) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['i18n.js', 'site-detect.js', 'content.js'],
    });
  } catch (error) {
    console.error('Failed to inject content script:', error);
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
      void logCapture({ stage: error?.stage || 'unknown', phase: 'fail', platform: message.platform, host: senderHost, url: message.postUrl, error: error?.message });
      notify(tabId, false, { error: error?.message, hostMissing: isHostMissing(error?.message) });
      sendResponse({ ok: false, error: error?.message });
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
  try {
    await sendToBridge(captureId, jpegBase64, record, metaOk);
  } catch (err) {
    throw stageError('bridge', err?.message || 'bridge save failed');
  }
  // grouped = prior saves of this post this session → the banner says the save
  // merged with them (the app folds same-URL records into one card).
  const grouped = await bumpRecentSave(record.url);
  notify(tab.id, true, { metaOk, grouped });
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
      updatedAt: capturedAt, // last modified in Corpus (bumped on tag edits etc.)
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
function logCapture(entry: unknown): Promise<void> {
  const full = Object.assign({ ts: new Date().toISOString() }, entry);
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
      if (!viaHost) stashLogLocally(full);
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
function metaFetched(meta) {
  return !!(meta && (meta.screenName || meta.displayName || meta.userId || meta.text || meta.date || (Array.isArray(meta.media) && meta.media.length)));
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
      void logCapture({ stage: error?.stage || 'unknown', phase: 'fail', platform: message.platform, host: senderHost, url: message.postUrl, error: error?.message });
      sendResponse({ ok: false, error: error?.message, hostMissing: isHostMissing(error?.message) });
    });
  return true; // async response
});

// Diagnostics relays. content.js reports pre-bridge stage failures (select /
// permalink) here; {type:'dumpLogs'} reads back the local fallback ring buffer
// (entries that never reached the host's capture.log).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'logCapture') {
    void logCapture(Object.assign({ host: getHostname(sender.tab?.url) }, message.entry || {}));
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
  // Surface metadata-fetch failure to the drop overlay (same partial-success
  // signal as the click-save banner) so a screenshot-less illustration that
  // saved without post info isn't shown as a plain success. grouped = prior
  // saves of this post this session (the overlay says the save merged).
  const grouped = await bumpRecentSave(record.url);
  return { ...ack, metaOk, grouped };
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
