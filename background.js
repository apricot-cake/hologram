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

const DEFAULT_OPTIONS = {
  saveSidecarJson: false
};

const DOWNLOAD_DIRECTORY = 'SNS Post to Save';
const PNG_TEXT_KEYWORD = 'sns-post-to-save';
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const TEXT_ENCODER = new TextEncoder();
const CRC32_TABLE = createCrc32Table();

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
  const options = await chrome.storage.sync.get(DEFAULT_OPTIONS);
  const metadata = buildMetadata({
    captureInfo,
    capturedAt,
    pageTitle: tab.title,
    pageUrl: tab.url,
    postUrl,
    postDetails
  });

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: 'cropImage',
    dataUrl,
    rect
  });

  if (!response?.croppedDataUrl) {
    throw new Error('Cropping failed');
  }

  const pngDataUrl = await buildPngDataUrl(response.croppedDataUrl, metadata);
  const baseFilename = buildBaseFilename(captureInfo, metadata, capturedAt);

  await downloadDataUrl(pngDataUrl, `${DOWNLOAD_DIRECTORY}/${baseFilename}.png`);

  if (options.saveSidecarJson) {
    const jsonDataUrl = buildJsonDataUrl(metadata);
    await downloadDataUrl(jsonDataUrl, `${DOWNLOAD_DIRECTORY}/${baseFilename}.json`);
  }

  notify(tab.id, true, {
    savedJson: options.saveSidecarJson
  });

  return {
    savedJson: options.saveSidecarJson
  };
}

function notify(tabId, success, extra = {}) {
  chrome.tabs.sendMessage(tabId, {
    type: 'notify',
    success,
    ...extra
  }).catch(() => {});
}

async function buildPngDataUrl(croppedDataUrl, metadata) {
  const pngBytes = new Uint8Array(await fetch(croppedDataUrl).then((response) => response.arrayBuffer()));
  const metadataBytes = TEXT_ENCODER.encode(JSON.stringify(metadata));
  const enrichedPng = insertPngTextChunk(pngBytes, PNG_TEXT_KEYWORD, metadataBytes);
  return `data:image/png;base64,${uint8ArrayToBase64(enrichedPng)}`;
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
  const timestamp = formatFilenameTimestamp(metadata.postPublishedAt || capturedAt);
  const host = sanitizeFilenameSegment(
    metadata.sourceHost || getHostname(metadata.postUrl || metadata.pageUrl || '') || captureInfo.downloadPrefix,
    48
  );
  const screenName = sanitizeFilenameSegment(
    metadata.screenName || metadata.uid || metadata.userId || 'post',
    40
  );
  const postId = sanitizeFilenameSegment(metadata.postId || 'capture', 64);
  return [timestamp, host, screenName, postId].filter(Boolean).join('_');
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function buildJsonDataUrl(metadata) {
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(metadata, null, 2))}`;
}

function normalizePostDetails(postDetails) {
  return {
    postId: normalizeOptionalString(postDetails?.postId),
    screenName: normalizeOptionalString(postDetails?.screenName),
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

function formatFilenameTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown-date';
  }

  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate())
  ].join('-') + '_' + [
    padNumber(date.getHours()),
    padNumber(date.getMinutes()),
    padNumber(date.getSeconds())
  ].join('-');
}

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function sanitizeFilenameSegment(value, maxLength = 64) {
  const safeValue = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._@-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._@]+|[-._@]+$/g, '')
    .slice(0, maxLength);

  return safeValue || 'unknown';
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

function insertPngTextChunk(pngBytes, keyword, textBytes) {
  if (!hasPngSignature(pngBytes)) {
    throw new Error('Invalid PNG data');
  }

  const chunk = buildPngChunk('iTXt', buildITXtData(keyword, textBytes));
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  let offset = PNG_SIGNATURE.length;

  while (offset + 8 <= pngBytes.length) {
    const length = view.getUint32(offset);
    const type = readChunkType(pngBytes, offset + 4);

    if (type === 'IEND') {
      return concatUint8Arrays([
        pngBytes.slice(0, offset),
        chunk,
        pngBytes.slice(offset)
      ]);
    }

    offset += 12 + length;
  }

  throw new Error('PNG end chunk not found');
}

function hasPngSignature(bytes) {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false;
  }

  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }

  return true;
}

function buildITXtData(keyword, textBytes) {
  const keywordBytes = Uint8Array.from(keyword.split('').map((char) => char.charCodeAt(0)));
  const data = new Uint8Array(keywordBytes.length + 5 + textBytes.length);
  let offset = 0;

  data.set(keywordBytes, offset);
  offset += keywordBytes.length;
  data[offset++] = 0;
  data[offset++] = 0;
  data[offset++] = 0;
  data[offset++] = 0;
  data[offset++] = 0;
  data.set(textBytes, offset);

  return data;
}

function buildPngChunk(type, data) {
  const typeBytes = TEXT_ENCODER.encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);

  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(concatUint8Arrays([typeBytes, data])));

  return chunk;
}

function readChunkType(bytes, offset) {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}

function uint8ArrayToBase64(bytes) {
  let binary = '';

  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function crc32(bytes) {
  let crc = 0xffffffff;

  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table() {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i += 1) {
    let value = i;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }

    table[i] = value >>> 0;
  }

  return table;
}
