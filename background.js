importScripts('vendor/piexif.js');

const BUILD_FILES = ['background.js', 'content.js', 'i18n.js', 'manifest.json', 'viewer.html', 'viewer.js'];
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

const DEFAULT_DOWNLOAD_DIRECTORY = 'Post Snap';
const JPEG_QUALITY = 0.92;

async function getDownloadSettings() {
  try {
    const result = await chrome.storage.local.get(['downloadDirectory', 'saveAs']);
    let directory = result.downloadDirectory || DEFAULT_DOWNLOAD_DIRECTORY;
    if (/[.]{2}|[/\\]/.test(directory)) {
      directory = DEFAULT_DOWNLOAD_DIRECTORY;
    }
    return { directory, saveAs: !!result.saveAs };
  } catch {
    return { directory: DEFAULT_DOWNLOAD_DIRECTORY, saveAs: false };
  }
}

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
  if (command === 'open-viewer') {
    chrome.runtime.openOptionsPage();
    return;
  }

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
  if (message.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  if (message.type === 'getBuildHash') {
    sendResponse({ hash: buildHash });
    return false;
  }

  if (message.type === 'deleteLocalFile') {
    if (message.captureId) {
      chrome.downloads.search({ filenameRegex: message.captureId }).then(items => {
        for (const item of items) {
          chrome.downloads.removeFile(item.id).catch(() => {});
        }
      }).catch(() => {});
    }
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

  const jpegDataUrl = buildJpegDataUrl(response.croppedDataUrl, metadata);
  const baseFilename = buildBaseFilename(captureInfo, metadata, capturedAt);
  const settings = await getDownloadSettings();

  await downloadDataUrl(jpegDataUrl, `${settings.directory}/${baseFilename}.jpg`, settings.saveAs);

  // Store post data in chrome.storage.local for the viewer
  await storePost(metadata, jpegDataUrl);

  // Debug: write capture log
  await writeCaptureLog(metadata);

  notify(tab.id, true);
}

async function storePost(metadata, jpegDataUrl) {
  try {
    const result = await chrome.storage.local.get('posts');
    const posts = result.posts || [];
    posts.push({
      captureId: metadata.captureId || null,
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
      tags: metadata.tags?.length ? metadata.tags : [],
      image: jpegDataUrl
    });
    await chrome.storage.local.set({ posts });
  } catch (error) {
    console.error('Failed to store post:', error);
  }
}

async function writeCaptureLog(metadata) {
  try {
    const fields = [
      ['captureId', metadata.captureId],
      ['url', metadata.postUrl],
      ['platform', metadata.platform],
      ['displayName', metadata.displayName],
      ['screenName', metadata.screenName],
      ['userId', metadata.userId],
      ['text', (metadata.postText || '').substring(0, 120)],
      ['likes', metadata.likeCount],
      ['reposts', metadata.repostCount],
      ['replies', metadata.replyCount],
      ['bookmarks', metadata.bookmarkCount],
      ['views', metadata.viewCount],
      ['date', metadata.postPublishedAt],
      ['capturedAt', metadata.capturedAt],
      ['mediaType', metadata.mediaType],
      ['lang', metadata.lang],
      ['isReply', metadata.isReply],
      ['isQuote', metadata.isQuote],
      ['isThread', metadata.isThread],
      ['quotedUrl', metadata.quotedUrl],
    ];
    const warnings = [];
    if (!metadata.postUrl) warnings.push('WARN: url is empty');
    if (!metadata.platform) warnings.push('WARN: platform is empty');
    if (!metadata.displayName && !metadata.screenName) warnings.push('WARN: no user info');
    if (metadata.likeCount == null && metadata.repostCount == null) warnings.push('WARN: no engagement data');
    if (!metadata.postPublishedAt) warnings.push('WARN: date is empty');
    if (!metadata.captureId) warnings.push('WARN: captureId is empty');

    const lines = fields.map(([k, v]) => `${k}: ${v ?? '(null)'}`);
    if (warnings.length) lines.push('', '--- Warnings ---', ...warnings);
    else lines.push('', '--- OK ---');

    const text = lines.join('\n');
    const dataUrl = 'data:text/plain;base64,' + btoa(unescape(encodeURIComponent(text)));
    await chrome.downloads.download({ url: dataUrl, filename: 'post-snap-capture-log.txt', conflictAction: 'overwrite' });
  } catch (e) {
    console.error('Failed to write capture log:', e);
  }
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

function buildJpegDataUrl(croppedDataUrl, metadata) {
  const exifObj = buildExifObj(metadata);
  const exifBytes = piexif.dump(exifObj);
  return piexif.insert(exifBytes, croppedDataUrl);
}

function buildExifObj(metadata) {
  const zeroth = {};
  const exifIfd = {};

  // XPComment: all metadata as JSON
  const jsonData = {
    captureId: metadata.captureId || null,
    url: metadata.postUrl || null,
    platform: metadata.platform || null,
    text: metadata.postText || null,
    displayName: metadata.displayName || null,
    screenName: metadata.screenName || null,
    userId: metadata.userId || null,
    likes: metadata.likeCount,
    reposts: metadata.repostCount,
    replies: metadata.replyCount,
    bookmarks: metadata.bookmarkCount,
    views: metadata.viewCount,
    date: metadata.postPublishedAt || null,
    capturedAt: metadata.capturedAt || null,
    mediaType: metadata.mediaType || null,
    lang: metadata.lang || null,
    isReply: metadata.isReply || null,
    isQuote: metadata.isQuote || null,
    isThread: metadata.isThread || null,
    quotedUrl: metadata.quotedUrl || null,
    tags: metadata.tags?.length ? metadata.tags : null
  };
  zeroth[piexif.ImageIFD.XPComment] = encodeUCS2LE(JSON.stringify(jsonData));

  // DateTimeOriginal: post publish date (for Explorer date filtering)
  const dateSource = metadata.postPublishedAt || metadata.capturedAt;
  if (dateSource) {
    exifIfd[piexif.ExifIFD.DateTimeOriginal] = formatExifDateTime(dateSource);
  }

  // Software: extension name + version + build hash
  const manifest = chrome.runtime.getManifest();
  zeroth[piexif.ImageIFD.Software] = `${manifest.name} v${manifest.version} [${buildHash}]`;

  return { '0th': zeroth, 'Exif': exifIfd };
}

function encodeUCS2LE(str) {
  const bytes = [];

  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    bytes.push(code & 0xff);
    bytes.push((code >> 8) & 0xff);
  }

  bytes.push(0, 0);
  return bytes;
}

function formatExifDateTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate())
  ].join(':') + ' ' + [
    padNumber(date.getHours()),
    padNumber(date.getMinutes()),
    padNumber(date.getSeconds())
  ].join(':');
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

function buildBaseFilename(captureInfo, metadata, capturedAt) {
  return metadata.captureId || formatFilenameDate(metadata.postPublishedAt || capturedAt);
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

function formatFilenameDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown-date';
  }

  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate())
  ].join('-');
}

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function downloadDataUrl(url, filename, saveAs = false) {
  return new Promise((resolve, reject) => {
    let downloadId = null;
    let settled = false;

    function finish(error) {
      if (settled) {
        return;
      }

      settled = true;
      chrome.downloads.onChanged.removeListener(listener);

      if (error) {
        reject(error);
        return;
      }

      resolve(downloadId);
    }

    function listener(delta) {
      if (delta.id !== downloadId) {
        return;
      }

      if (delta.state?.current === 'complete') {
        finish();
        return;
      }

      if (delta.state?.current === 'interrupted' || delta.error?.current) {
        finish(new Error(delta.error?.current || 'Download interrupted'));
      }
    }

    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads.download(
      {
        url,
        filename,
        conflictAction: 'uniquify',
        saveAs
      },
      (createdDownloadId) => {
        if (chrome.runtime.lastError || !createdDownloadId) {
          finish(new Error(chrome.runtime.lastError?.message || 'Download failed'));
          return;
        }

        downloadId = createdDownloadId;
      }
    );
  });
}
