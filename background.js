const BUILD_FILES = ['background.js', 'content.js', 'i18n.js', 'manifest.json'];
let buildHash = 'unknown';

(async () => {
  try {
    let combined = '';
    for (const f of BUILD_FILES) {
      const res = await fetch(chrome.runtime.getURL(f));
      combined += (await res.text()).replace(/\r\n/g, '\n');
    }
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combined));
    buildHash = Array.from(new Uint8Array(buf)).slice(0, 4)
      .map(b => b.toString(16).padStart(2, '0')).join('');
    console.log(`[Post Snap] Build: ${buildHash}`);
  } catch { /* non-critical */ }
})();

const PLATFORM_CONFIGS = [
  {
    id: 'x',
    hosts: ['x.com', 'twitter.com'],
    itemNamePrefix: 'Tweet',
    downloadPrefix: 'tweet'
  },
  {
    id: 'bluesky',
    hosts: ['bsky.app'],
    itemNamePrefix: 'Bluesky',
    downloadPrefix: 'bluesky'
  },
  {
    id: 'misskey',
    itemNamePrefix: 'Misskey',
    downloadPrefix: 'misskey'
  }
];

const NATIVE_HOST = 'com.postsnap.host';

function isAllowedSender(tabUrl, platformId) {
  const hostname = getHostname(tabUrl);
  if (!hostname) return false;

  const config = getPlatformConfigById(platformId);
  if (config?.hosts) {
    return config.hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  }

  // Misskey has no fixed host list — allow any https origin
  if (platformId === 'misskey') {
    return /^https:/i.test(tabUrl || '');
  }

  return false;
}

async function activateOnTab(tab) {
  if (!tab.id || !/^https?:/i.test(tab.url || '')) {
    return;
  }

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
  if (command === 'reload-extension' && !('update_url' in chrome.runtime.getManifest())) {
    chrome.runtime.reload();
    return;
  }


  if (command !== 'activate') {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    activateOnTab(tab);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getBuildHash') {
    sendResponse({ hash: buildHash });
    return false;
  }


  if (message.type !== 'captureAndSend') {
    return false;
  }

  if (!sender.tab?.id) {
    sendResponse({ ok: false, error: 'Missing tab context' });
    return false;
  }

  if (!isAllowedSender(sender.tab.url, message.platform)) {
    sendResponse({ ok: false, error: 'Sender origin does not match platform' });
    return false;
  }

  const tabId = sender.tab.id;
  captureAndSave(sender.tab, message.rect, message.postUrl, message.platform, message.postDetails)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error(error);
      notify(tabId, false);
      sendResponse({ ok: false, error: error?.message });
    });

  return true;
});

async function captureAndSave(tab, rect, postUrl, platformId, postDetails) {
  const captureInfo = getCaptureInfo(platformId, postUrl || tab.url);
  const capturedAt = new Date().toISOString();
  const captureId = generateCaptureId();

  if (captureInfo.id === 'bluesky' && postDetails) {
    await enrichBlueskyPostDetails(postDetails);
  }

  if (captureInfo.id === 'misskey') {
    const host = getHostname(postUrl || tab.url);
    const tabHost = getHostname(tab.url);
    if (host && host === tabHost) {
      await enrichMisskeyPostDetails(host, postDetails, postUrl);
    }
  }

  const metadata = buildMetadata({
    captureInfo,
    capturedAt,
    captureId,
    pageTitle: tab.title,
    pageUrl: tab.url,
    postUrl,
    postDetails
  });

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 92 });
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: 'cropImage',
    dataUrl,
    rect
  });

  if (!response?.croppedDataUrl) {
    throw new Error('Cropping failed');
  }

  // No EXIF: the cropped JPEG is sent as-is. All metadata travels in a
  // sidecar JSON written next to the image by the native host.
  const jpegBase64 = response.croppedDataUrl.split(',')[1];
  const record = buildSidecarRecord(metadata);

  await sendToBridge(captureId, jpegBase64, record);

  notify(tab.id, true);
}

function buildSidecarRecord(metadata) {
  return {
    captureId: metadata.captureId || null,
    image: metadata.captureId ? `${metadata.captureId}.jpg` : null,
    url: metadata.postUrl,
    platform: metadata.platform,
    text: metadata.postText,
    displayName: metadata.displayName,
    screenName: metadata.screenName,
    userId: metadata.userId,
    likes: metadata.likeCount,
    reposts: metadata.repostCount,
    replies: metadata.replyCount,
    bookmarks: metadata.bookmarkCount,
    views: metadata.viewCount,
    date: metadata.postPublishedAt || metadata.capturedAt,
    capturedAt: metadata.capturedAt,
    mediaType: metadata.mediaType || null,
    lang: metadata.lang || null,
    isReply: metadata.isReply || null,
    isQuote: metadata.isQuote || null,
    isThread: metadata.isThread || null,
    quotedUrl: metadata.quotedUrl || null,
    tags: metadata.tags?.length ? metadata.tags : []
  };
}

// Send the captured image + metadata to the native messaging host, which
// writes <captureId>.jpg and <captureId>.json into the user's save folder.
// The host is short-lived: Chrome spawns it per connection, so this works
// even when the desktop app is not running.
function sendToBridge(captureId, jpegBase64, record) {
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

    port.postMessage({ type: 'save', captureId, image: jpegBase64, metadata: record });
  });
}

function notify(tabId, success, extra = {}) {
  chrome.tabs.sendMessage(tabId, {
    type: 'notify',
    success,
    ...extra
  }).catch(() => {});
}

const blueskyDidCache = new Map();

async function resolveBlueskyDid(handle) {
  if (!handle || handle.startsWith('did:')) return handle;
  if (blueskyDidCache.has(handle)) return blueskyDidCache.get(handle);

  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
    const data = await res.json();
    const did = data.did || null;
    if (did && /^did:[a-z]+:.+/.test(did)) {
      blueskyDidCache.set(handle, did);
      return did;
    }
  } catch {
    // API failure is not critical
  }

  return null;
}

async function enrichBlueskyPostDetails(postDetails) {
  if (!postDetails) return;
  const handle = postDetails.screenName;
  const rkey = postDetails.postId;

  // Resolve DID (also sets userId)
  const did = await resolveBlueskyDid(handle);
  if (did) postDetails.userId = did;
  if (!did || !rkey) return;

  try {
    const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`);
    const data = await res.json();
    const post = data?.thread?.post;
    if (!post) return;

    if (post.record?.text) postDetails.postText = post.record.text;
    if (post.record?.createdAt) postDetails.postPublishedAt = post.record.createdAt;
    if (post.likeCount != null) postDetails.likeCount = post.likeCount;
    if (post.repostCount != null) postDetails.repostCount = post.repostCount;
    if (post.replyCount != null) postDetails.replyCount = post.replyCount;
    if (post.author?.displayName) postDetails.displayName = post.author.displayName;
    if (post.author?.handle) postDetails.screenName = post.author.handle;
    if (post.record?.langs?.length) postDetails.lang = post.record.langs[0];
  } catch {
    // API failure is not critical — DOM data remains as fallback
  }
}

async function enrichMisskeyPostDetails(host, postDetails, postUrl) {
  if (!host || !postDetails) return;

  const noteId = parseMisskeyNoteId(postUrl);
  if (noteId) {
    try {
      const res = await fetch(`https://${host}/api/notes/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId })
      });
      const note = await res.json();
      if (note.user) {
        if (note.user.id) postDetails.userId = note.user.id;
        if (note.user.username) postDetails.screenName = note.user.username;
        if (note.user.name) postDetails.displayName = note.user.name;
      }
      if (note.text) {
        postDetails.postText = note.text;
      }
      if (note.createdAt) {
        postDetails.postPublishedAt = note.createdAt;
      }
      if (note.renoteCount != null) {
        postDetails.repostCount = note.renoteCount;
      }
      if (note.repliesCount != null) {
        postDetails.replyCount = note.repliesCount;
      }
      if (note.reactions) {
        const total = Object.values(note.reactions).reduce((sum, n) => sum + n, 0);
        if (total > 0) postDetails.likeCount = total;
      }
      if (note.lang) {
        postDetails.lang = note.lang;
      }
    } catch {
      // API failure is not critical
    }
  }
}

function parseMisskeyNoteId(url) {
  try {
    const match = new URL(url).pathname.match(/^\/notes\/([^/?#]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function buildMetadata({ captureInfo, capturedAt, captureId, pageTitle, pageUrl, postUrl, postDetails }) {
  const manifest = chrome.runtime.getManifest();
  const normalizedPostDetails = normalizePostDetails(postDetails);
  const resolvedPostUrl = sanitizeUrl(postUrl);
  const resolvedPageUrl = sanitizeUrl(pageUrl);

  return {
    captureId,
    capturedAt,
    platform: captureInfo.id,
    pageTitle: pageTitle || '',
    pageUrl: resolvedPageUrl,
    postUrl: resolvedPostUrl,
    sourceHost: getHostname(resolvedPostUrl || resolvedPageUrl || ''),
    screenName: normalizedPostDetails.screenName,
    displayName: normalizedPostDetails.displayName,
    postText: normalizedPostDetails.postText,
    userId: normalizedPostDetails.userId,
    postPublishedAt: normalizedPostDetails.postPublishedAt,
    likeCount: normalizedPostDetails.likeCount,
    repostCount: normalizedPostDetails.repostCount,
    replyCount: normalizedPostDetails.replyCount,
    bookmarkCount: normalizedPostDetails.bookmarkCount,
    viewCount: normalizedPostDetails.viewCount,
    mediaType: normalizedPostDetails.mediaType,
    lang: normalizedPostDetails.lang,
    isReply: normalizedPostDetails.isReply,
    isQuote: normalizedPostDetails.isQuote,
    isThread: normalizedPostDetails.isThread,
    quotedUrl: normalizedPostDetails.quotedUrl,
    tags: normalizedPostDetails.tags,
    extension: {
      name: manifest.name,
      version: manifest.version
    }
  };
}

function getCaptureInfo(platformId, url) {
  return getPlatformConfigById(platformId) || getPlatformConfigForUrl(url) || {
    id: 'post',
    itemNamePrefix: 'Post',
    downloadPrefix: 'post'
  };
}

function getPlatformConfigById(platformId) {
  return PLATFORM_CONFIGS.find((config) => config.id === platformId) || null;
}

function getPlatformConfigForUrl(url) {
  const hostname = getHostname(url);
  return PLATFORM_CONFIGS.find((config) =>
    config.hosts?.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  ) || null;
}

function generateCaptureId() {
  const hex = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
  return `${Date.now()}-${hex}`;
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const MAX_SHORT_STRING = 256;
const MAX_TEXT_STRING = 10000;

function normalizePostDetails(postDetails) {
  return {
    screenName: normalizeOptionalString(postDetails?.screenName, MAX_SHORT_STRING),
    displayName: normalizeOptionalString(postDetails?.displayName, MAX_SHORT_STRING),
    postText: normalizeOptionalString(postDetails?.postText, MAX_TEXT_STRING),
    userId: normalizeOptionalString(postDetails?.userId, MAX_SHORT_STRING),
    postPublishedAt: normalizeOptionalIsoDate(postDetails?.postPublishedAt),
    likeCount: normalizeOptionalCount(postDetails?.likeCount),
    repostCount: normalizeOptionalCount(postDetails?.repostCount),
    replyCount: normalizeOptionalCount(postDetails?.replyCount),
    bookmarkCount: normalizeOptionalCount(postDetails?.bookmarkCount),
    viewCount: normalizeOptionalCount(postDetails?.viewCount),
    mediaType: normalizeOptionalString(postDetails?.mediaType, MAX_SHORT_STRING),
    lang: normalizeOptionalString(postDetails?.lang, MAX_SHORT_STRING),
    isReply: postDetails?.isReply === true ? true : null,
    isQuote: postDetails?.isQuote === true ? true : null,
    isThread: postDetails?.isThread === true ? true : null,
    quotedUrl: normalizeOptionalString(postDetails?.quotedUrl, MAX_TEXT_STRING),
    tags: Array.isArray(postDetails?.tags) ? postDetails.tags.map(t => String(t).slice(0, MAX_SHORT_STRING)).slice(0, 50) : []
  };
}

function normalizeOptionalString(value, maxLength = MAX_TEXT_STRING) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim().slice(0, maxLength);
  return normalized ? normalized : null;
}

function normalizeOptionalCount(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : null;
}

function normalizeOptionalIsoDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function sanitizeUrl(value) {
  if (!value) {
    return '';
  }

  try {
    return new URL(value).href;
  } catch {
    return '';
  }
}

