const EAGLE_API = 'http://localhost:41595';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30000;

let pollTimer = null;
let pollStartTime = 0;
let pendingDrag = null; // { imageUrls: string[], pageUrl: string, metadata: object, timestamp: number }

console.log('[Eagle Meta] Service worker loaded, version:', chrome.runtime.getManifest().version);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'resolveBlueskyDid') {
    resolveBlueskyDid(message.handle)
      .then((did) => sendResponse({ did }))
      .catch(() => sendResponse({ did: null }));
    return true; // 非同期レスポンス
  }

  if (message.type === 'imageDragged') {
    console.log('[Eagle Meta] Drag detected, metadata:', message.metadata?.title);
    pendingDrag = {
      imageUrls: message.imageUrls,
      pageUrl: message.pageUrl,
      metadata: message.metadata,
      timestamp: Date.now()
    };
    startPolling();
  }
});

function startPolling() {
  stopPolling();
  pollStartTime = Date.now();
  poll();
}

function stopPolling() {
  if (pollTimer != null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

async function poll() {
  if (!pendingDrag) {
    stopPolling();
    return;
  }

  if (Date.now() - pollStartTime > POLL_TIMEOUT_MS) {
    console.log('[Eagle Meta] Polling timed out');
    pendingDrag = null;
    stopPolling();
    return;
  }

  try {
    const items = await fetchRecentItems();
    const matched = findMatchingItem(items);

    console.log('[Eagle Meta] Poll: found', items.length, 'items, pending urls:', pendingDrag?.imageUrls?.length, 'drag time:', pendingDrag?.timestamp);
    if (matched) {
      const metadata = pendingDrag.metadata;
      const itemId = matched.id;
      pendingDrag = null;
      stopPolling();

      // Eagle REST API は name の更新をサポートしていないため、
      // タイトル情報は annotation の先頭行に含める
      const annotation = metadata.title
        ? metadata.title + '\n\n' + (metadata.annotation || '')
        : metadata.annotation;
      await updateItemMetadata(itemId, { annotation, link: metadata.link });
      console.log('[Eagle Meta] Updated item:', itemId, metadata.title);
      return;
    }
  } catch (e) {
    console.warn('[Eagle Meta] Poll error:', e.message);
  }

  pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
}

const blueskyDidCache = new Map();

async function resolveBlueskyDid(handle) {
  if (!handle || handle.startsWith('did:')) return handle;
  if (blueskyDidCache.has(handle)) return blueskyDidCache.get(handle);

  const res = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
  const data = await res.json();
  const did = data.did || null;
  if (did) blueskyDidCache.set(handle, did);
  return did;
}

async function fetchRecentItems() {
  const res = await fetch(`${EAGLE_API}/api/item/list?limit=10`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  const data = await res.json();

  if (data.status !== 'success') {
    throw new Error('Eagle API error: ' + JSON.stringify(data));
  }

  return data.data || [];
}

function findMatchingItem(items) {
  if (!pendingDrag) return null;

  const dragTime = pendingDrag.timestamp;

  // 照合用URL群: 画像URL + ページURL + メタデータのリンク
  const candidateUrls = [
    ...pendingDrag.imageUrls,
    pendingDrag.pageUrl,
    pendingDrag.metadata?.link
  ].filter(Boolean);

  for (const item of items) {
    // ドラッグ開始より前のアイテムはスキップ（30秒マージン）
    const itemTime = item.modificationTime || item.lastModified || 0;
    if (itemTime < dragTime - 30000) continue;

    const itemUrl = item.url || '';
    if (!itemUrl) continue;

    for (const candidateUrl of candidateUrls) {
      if (urlMatches(itemUrl, candidateUrl)) {
        return item;
      }
    }
  }

  return null;
}

function urlMatches(eagleUrl, candidateUrl) {
  if (!eagleUrl || !candidateUrl) return false;

  // 完全一致
  if (eagleUrl === candidateUrl) return true;

  try {
    const a = new URL(eagleUrl);
    const b = new URL(candidateUrl);

    if (a.hostname === b.hostname) {
      // パス完全一致（クエリパラメータ無視）
      if (a.pathname === b.pathname) return true;

      // パス前方一致: Eagle の /status/123/photo/1 と metadata の /status/123 をマッチ
      if (a.pathname.startsWith(b.pathname) || b.pathname.startsWith(a.pathname)) return true;
    }
  } catch {
    // URL解析失敗時は文字列ベースにフォールバック
  }

  // 一方が他方を含む（サムネイルURL vs フルURL等）
  if (eagleUrl.includes(candidateUrl) || candidateUrl.includes(eagleUrl)) return true;

  return false;
}

async function updateItemMetadata(itemId, metadata) {
  const body = { id: itemId };

  if (metadata.annotation) {
    body.annotation = metadata.annotation;
  }
  if (metadata.link) {
    body.url = metadata.link;
  }

  const res = await fetch(`${EAGLE_API}/api/item/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();

  if (data.status !== 'success') {
    throw new Error('Eagle update failed: ' + JSON.stringify(data));
  }
}
