importScripts('vendor/piexif.js');

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

const DOWNLOAD_DIRECTORY = 'Post Snap';
const JPEG_QUALITY = 0.92;

async function activateOnTab(tab) {
  if (!tab.id || !/^https?:/i.test(tab.url || '')) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (error) {
    console.error('Failed to inject content script:', error);
  }
}

chrome.action.onClicked.addListener(activateOnTab);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'activate') {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    activateOnTab(tab);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'captureAndSend') {
    return false;
  }

  if (!sender.tab?.id) {
    sendResponse({ ok: false, error: 'Missing tab context' });
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
  if (captureInfo.id === 'bluesky' && postDetails?.screenName && !postDetails?.uid) {
    postDetails.uid = await resolveBlueskyDid(postDetails.screenName);
  }

  if (captureInfo.id === 'misskey') {
    const host = getHostname(postUrl || tab.url);
    await enrichMisskeyPostDetails(host, postDetails, postUrl);
  }

  const metadata = buildMetadata({
    captureInfo,
    capturedAt,
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

  await downloadDataUrl(jpegDataUrl, `${DOWNLOAD_DIRECTORY}/${baseFilename}.jpg`);

  notify(tab.id, true);
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
        if (!postDetails.userId) {
          postDetails.userId = note.user.id || null;
        }
        if (!postDetails.screenName) {
          postDetails.screenName = note.user.username || null;
        }
        if (!postDetails.displayName) {
          postDetails.displayName = note.user.name || null;
        }
      }
      if (note.text) {
        postDetails.postText = note.text;
      }
      if (note.createdAt) {
        postDetails.postPublishedAt = note.createdAt;
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

  const screenName = metadata.screenName ? `@${metadata.screenName}` : '';
  const displayName = metadata.displayName || '';
  const platform = metadata.platform || '';
  const postUrl = metadata.postUrl || '';

  const tags = [];
  if (displayName) tags.push(displayName);
  if (screenName) tags.push(screenName);
  if (metadata.userId) tags.push(metadata.userId);
  if (metadata.uid) tags.push(metadata.uid);
  if (tags.length) {
    zeroth[piexif.ImageIFD.XPKeywords] = encodeUCS2LE(tags.join(';'));
  }

  if (postUrl) {
    zeroth[piexif.ImageIFD.XPTitle] = encodeUCS2LE(postUrl);
  }

  if (metadata.postText) {
    zeroth[piexif.ImageIFD.XPComment] = encodeUCS2LE(metadata.postText);
  }

  const dateSource = metadata.postPublishedAt || metadata.capturedAt;
  if (dateSource) {
    exifIfd[piexif.ExifIFD.DateTimeOriginal] = formatExifDateTime(dateSource);
  }

  const manifest = chrome.runtime.getManifest();
  zeroth[piexif.ImageIFD.Software] = `${manifest.name} v${manifest.version}`;


  return { '0th': zeroth, 'Exif': exifIfd };
}

function toAscii(str) {
  return str.replace(/[^\x20-\x7e]/g, '?');
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

function buildMetadata({ captureInfo, capturedAt, pageTitle, pageUrl, postUrl, postDetails }) {
  const manifest = chrome.runtime.getManifest();
  const normalizedPostDetails = normalizePostDetails(postDetails);
  const resolvedPostUrl = sanitizeUrl(postUrl);
  const resolvedPageUrl = sanitizeUrl(pageUrl);

  return {
    schema: 'sns-post-to-save/v1',
    capturedAt,
    platform: captureInfo.id,
    pageTitle: pageTitle || '',
    pageUrl: resolvedPageUrl,
    postUrl: resolvedPostUrl,
    sourceHost: getHostname(resolvedPostUrl || resolvedPageUrl || ''),
    postId: normalizedPostDetails.postId,
    screenName: normalizedPostDetails.screenName,
    displayName: normalizedPostDetails.displayName,
    postText: normalizedPostDetails.postText,
    userId: normalizedPostDetails.userId,
    uid: normalizedPostDetails.uid,
    postPublishedAt: normalizedPostDetails.postPublishedAt,
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

function buildBaseFilename(captureInfo, metadata, capturedAt) {
  return formatFilenameDate(metadata.postPublishedAt || capturedAt);
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizePostDetails(postDetails) {
  return {
    postId: normalizeOptionalString(postDetails?.postId),
    screenName: normalizeOptionalString(postDetails?.screenName),
    displayName: normalizeOptionalString(postDetails?.displayName),
    postText: normalizeOptionalString(postDetails?.postText),
    userId: normalizeOptionalString(postDetails?.userId),
    uid: normalizeOptionalString(postDetails?.uid),
    postPublishedAt: normalizeOptionalIsoDate(postDetails?.postPublishedAt)
  };
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
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

function downloadDataUrl(url, filename) {
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

      resolve();
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
        saveAs: false
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
