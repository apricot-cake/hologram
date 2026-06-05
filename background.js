importScripts('metadata.js');

const BUILD_FILES = ['background.js', 'content.js', 'i18n.js', 'manifest.json', 'metadata.js'];
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

const NATIVE_HOST = 'com.postsnap.host';

// Allowed capture origins per platform (used to validate the sender tab).
const PLATFORM_HOSTS = {
  x: ['x.com', 'twitter.com'],
  bluesky: ['bsky.app']
  // misskey: any https origin (instances are arbitrary hosts)
};

function getHostname(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function isAllowedSender(tabUrl, platformId) {
  const hostname = getHostname(tabUrl);
  if (!hostname) return false;
  const hosts = PLATFORM_HOSTS[platformId];
  if (hosts) return hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  if (platformId === 'misskey') return /^https:/i.test(tabUrl || '');
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
  if (command === 'reload-extension' && !('update_url' in chrome.runtime.getManifest())) {
    chrome.runtime.reload();
    return;
  }
  if (command !== 'activate') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) activateOnTab(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getBuildHash') {
    sendResponse({ hash: buildHash });
    return false;
  }

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
  captureAndSave(sender.tab, message.rect, message.postUrl)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error(error);
      notify(tabId, false);
      sendResponse({ ok: false, error: error?.message });
    });

  return true;
});

async function captureAndSave(tab, rect, postUrl) {
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
    platform: meta.platform,
    text: meta.text,
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
    mediaType: meta.mediaType,
    lang: meta.lang,
    isReply: meta.isReply,
    isQuote: meta.isQuote,
    isThread: meta.isThread,
    quotedUrl: meta.quotedUrl,
    tags: meta.tags || []
  };

  await sendToBridge(captureId, jpegBase64, record);
  notify(tab.id, true);
}

// Send the captured image + metadata to the native messaging host, which writes
// <captureId>.jpg and <captureId>.json into the user's save folder. The host is
// short-lived: Chrome spawns it per connection, so this works even when the
// desktop app is not running.
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
  chrome.tabs.sendMessage(tabId, { type: 'notify', success, ...extra }).catch(() => {});
}

function generateCaptureId() {
  const hex = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
  return `${Date.now()}-${hex}`;
}
