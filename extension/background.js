importScripts('metadata.js');

const NATIVE_HOST = 'com.corpus.host';

// Allowed capture origins per platform (used to validate the sender tab).
const PLATFORM_HOSTS = {
  x: ['x.com', 'twitter.com'],
  bluesky: ['bsky.app'],
  pixiv: ['www.pixiv.net', 'pixiv.net']
  // misskey / mastodon: any https origin (instances are arbitrary hosts)
};

function getHostname(url) {
  try { return new URL(url).hostname; } catch { return ''; }
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
      files: ['i18n.js', 'content.js']
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
  captureAndSave(sender.tab, message.rect, message.postUrl, message.platform)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error(error);
      notify(tabId, false);
      sendResponse({ ok: false, error: error?.message });
    });

  return true;
});

async function captureAndSave(tab, rect, postUrl, sendPlatform) {
  const captureId = generateCaptureId();
  const capturedAt = new Date().toISOString();

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 92 });
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'cropImage', dataUrl, rect });
  if (!response?.croppedDataUrl) throw new Error('Cropping failed');
  const jpegBase64 = response.croppedDataUrl.split(',')[1];

  // Metadata comes from the platform's API (no DOM scraping).
  // fetchPostMetadata is defined in metadata.js (imported at the top).
  const meta = await fetchPostMetadata(postUrl);
  const record = {
    captureId,
    image: `${captureId}.jpg`,
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
    likes: meta.likes,
    reposts: meta.reposts,
    replies: meta.replies,
    bookmarks: meta.bookmarks,
    views: meta.views,
    date: meta.date || capturedAt,
    capturedAt,
    updatedAt: capturedAt,                 // last modified in Corpus (bumped on tag edits etc.)
    mediaType: meta.mediaType,
    media: meta.media || [],
    lang: meta.lang,
    isReply: meta.isReply,
    isQuote: meta.isQuote,
    isThread: meta.isThread,
    quotedUrl: meta.quotedUrl,
    hashtags: meta.hashtags || [],
    tags: meta.tags || []
  };

  await sendToBridge(captureId, jpegBase64, record);
  notify(tab.id, true, { metaOk: metaFetched(meta) });
}

// Send a message to the native messaging host (which writes the sidecar + image
// into the user's save folder) and resolve with its ack. The host is short-lived:
// Chrome spawns it per connection, so this works even when the desktop app is not
// running.
function bridgeSend(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let port = null;

    function finish(error, result) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { port?.disconnect(); } catch { /* already disconnected */ }
      if (error) reject(error);
      else resolve(result);
    }

    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (error) {
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

// Post-click save: screenshot (base64 JPEG) + metadata.
function sendToBridge(captureId, jpegBase64, record) {
  return bridgeSend({ type: 'save', captureId, image: jpegBase64, metadata: record });
}

// Image-drag save: the host downloads the dragged image itself (no screenshot).
function sendDraggedToBridge(captureId, imageUrl, imageReferer, record) {
  return bridgeSend({ type: 'saveDragged', captureId, imageUrl, imageReferer, metadata: record });
}

function notify(tabId, success, extra = {}) {
  chrome.tabs.sendMessage(tabId, { type: 'notify', success, ...extra }).catch(() => {});
}

// A metadata fetch "succeeded" if the platform API returned any identifying
// field. An empty record (fetch failed / API down / unparseable URL) has null
// author/date/text and no media — the screenshot still saved, but the user
// should be told the post info is missing rather than seeing a plain success.
function metaFetched(meta) {
  return !!(meta && (meta.screenName || meta.displayName || meta.userId || meta.text || meta.date || (Array.isArray(meta.media) && meta.media.length)));
}

function generateCaptureId() {
  const hex = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
  return `${Date.now()}-${hex}`;
}

// --- Image-drag save (drag.js → here) ---
// Same metadata as a post-click save, but no screenshot: the dragged image
// itself becomes the record's primary image (the bridge downloads it). Produces
// the "illustration record" shape (image = the art, media: []).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'imageDragged') return false;
  if (!sender.tab?.id) { sendResponse({ ok: false, error: 'Missing tab context' }); return false; }
  if (!isAllowedSender(sender.tab.url, message.platform)) {
    sendResponse({ ok: false, error: 'Sender origin does not match platform' });
    return false;
  }
  captureAndSaveDragged(sender.tab, message.platform, message.postUrl, message.imageUrls || [])
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => { console.error(error); sendResponse({ ok: false, error: error?.message }); });
  return true; // async response
});

async function captureAndSaveDragged(tab, sendPlatform, postUrl, imageUrls) {
  const captureId = generateCaptureId();
  const capturedAt = new Date().toISOString();

  const meta = await fetchPostMetadata(postUrl);
  const primary = pickPrimaryImage(meta.platform || sendPlatform, imageUrls, meta);
  if (!primary || !primary.url) throw new Error('Could not resolve a dragged image URL');

  const record = {
    captureId,
    url: meta.url || postUrl || null,
    platform: meta.platform || sendPlatform || null,
    text: meta.text,
    title: meta.title || null,
    displayName: meta.displayName,
    screenName: meta.screenName,
    userId: meta.userId,
    likes: meta.likes,
    reposts: meta.reposts,
    replies: meta.replies,
    bookmarks: meta.bookmarks,
    views: meta.views,
    date: meta.date || capturedAt,
    capturedAt,
    updatedAt: capturedAt,                 // last modified in Corpus (bumped on tag edits etc.)
    mediaType: 'image',
    lang: meta.lang,
    isReply: meta.isReply,
    isQuote: meta.isQuote,
    isThread: meta.isThread,
    quotedUrl: meta.quotedUrl,
    hashtags: meta.hashtags || [],
    tags: meta.tags || [],
    // Which image of a multi-image post this is (1-based) + the total. Only
    // recorded for multi-image posts; imageIndex is null when undeterminable.
    imageCount: (meta.media || []).length > 1 ? meta.media.length : null,
    imageIndex: ((meta.media || []).length > 1 && primary.index >= 0) ? primary.index + 1 : null
    // image + media[] are set by the bridge (image = downloaded original, media = [])
  };

  const ack = await sendDraggedToBridge(captureId, primary.url, primary.referer, record);
  // Surface metadata-fetch failure to the drop overlay (same partial-success
  // signal as the click-save banner) so a screenshot-less illustration that
  // saved without post info isn't shown as a plain success.
  return { ...ack, metaOk: metaFetched(meta) };
}

// Choose which original to save for a dragged image, preferring the platform
// API's original (matched to the dragged image) so we store full resolution.
// Returns { url, referer, index } where index = the 0-based position of the
// chosen image within the post's media[] (-1 if we couldn't determine it).
function pickPrimaryImage(platform, imageUrls, meta) {
  const media = (meta && meta.media) || [];
  if (platform === 'pixiv') {
    let pidx = -1;
    for (const u of imageUrls) { const m = u && u.match(/\/\d+_p(\d+)[._]/); if (m) { pidx = parseInt(m[1], 10); break; } }
    const i = (pidx >= 0 && pidx < media.length) ? pidx : (media.length === 1 ? 0 : -1);
    const pick = media[i >= 0 ? i : 0];
    if (pick && pick.url) return { url: pick.url, referer: pick.referer || 'https://www.pixiv.net/', index: i };
    return { url: imageUrls[0], referer: 'https://www.pixiv.net/', index: i };
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
  for (let i = 0; i < media.length; i++) { const k = mediaKey(platform, media[i].url); if (k && keys.includes(k)) return i; }
  return -1;
}

function hiRes(platform, url) {
  if (!url) return url;
  if (platform === 'x' && url.includes('pbs.twimg.com/media/')) {
    try { const u = new URL(url); u.searchParams.set('name', 'orig'); return u.href; } catch { /* ignore */ }
  }
  if (platform === 'bluesky' && url.includes('cdn.bsky.app')) return url.replace(/@jpeg$/, '');
  return url;
}
