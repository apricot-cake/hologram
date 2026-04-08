const EAGLE_API = 'http://localhost:41595';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30000;
const DEBUG = false;
const log = (...args) => { if (DEBUG) console.log('[Eagle Info+]', ...args); };

let pollTimer = null;
let pollStartTime = 0;
let pendingDrag = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'resolveBlueskyDid') {
    resolveBlueskyDid(message.handle)
      .then((did) => sendResponse({ did }))
      .catch(() => sendResponse({ did: null }));
    return true; // 非同期レスポンス
  }

  if (message.type === 'imageDragged') {
    log('Drag detected, metadata:', message.metadata?.title);
    handleImageDragged(message);
  }
});

async function handleImageDragged(message) {
  let metadata = message.metadata;

  // メディアグリッドのフォールバック: Syndication APIでツイート詳細を取得
  if (metadata._enrichPostId) {
    try {
      const enriched = await fetchTweetDetails(metadata._enrichPostId, metadata._imageIndex);
      if (enriched) {
        metadata = { ...metadata, ...enriched };
      }
    } catch (e) {
      log('Tweet enrichment failed:', e.message);
    }
  }

  pendingDrag = {
    imageUrls: message.imageUrls,
    pageUrl: message.pageUrl,
    metadata,
    timestamp: Date.now()
  };
  startPolling();
}

async function fetchTweetDetails(postId, imageIndex) {
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(postId)}&token=0`);
  if (!res.ok) return null;
  const data = await res.json();

  const user = data.user;
  const screenName = user?.screen_name || null;
  const displayName = user?.name || null;
  const uid = user?.id_str || null;
  const publishedAt = data.created_at || null;
  const rawText = data.text || '';
  // t.co URLを除去してテキストをクリーン化
  const postText = rawText.replace(/https?:\/\/t\.co\/\S+/g, '').trim();
  const hashtags = data.entities?.hashtags?.map((h) => `#${h.text}`) || [];
  const totalMedia = data.mediaDetails?.length || 0;
  const altTexts = data.mediaDetails?.map((m) => m.ext_alt_text).filter(Boolean) || [];

  // 画像番号を総数付きに更新
  let fullImageIndex = imageIndex;
  if (imageIndex && totalMedia > 1) {
    fullImageIndex = `${imageIndex}/${totalMedia}`;
  }

  // altTextは画像番号に対応するものを取得
  const imgNum = parseInt(imageIndex, 10);
  const altText = (imgNum >= 1 && altTexts[imgNum - 1]) || altTexts[0] || null;

  const sanitize = (v) => String(v).replace(/[\r\n]+/g, ' ').trim();
  const truncate = (t, max) => t.length <= max ? t : t.slice(0, max - 1) + '…';

  const lines = [];
  lines.push(`Platform: ${sanitize('X (Twitter)')}`);
  if (displayName) lines.push(`Display Name: ${sanitize(displayName)}`);
  if (screenName) lines.push(`Author: @${sanitize(screenName)}`);
  if (uid && /^\d+$/.test(uid)) lines.push(`UID: ${sanitize(uid)}`);
  lines.push(`Post ID: ${sanitize(postId)}`);
  if (fullImageIndex) lines.push(`Image: ${sanitize(fullImageIndex)}`);
  if (publishedAt) lines.push(`Published: ${sanitize(publishedAt)}`);
  if (hashtags.length) lines.push(`Hashtags: ${hashtags.map(sanitize).join(' ')}`);
  if (altText && altText !== '画像' && altText !== 'Image') lines.push(`Alt: ${truncate(sanitize(altText), 200)}`);
  if (postText) lines.push(`Text: ${truncate(sanitize(postText), 200)}`);

  const title = screenName
    ? (postText ? `@${screenName} - ${truncate(postText, 60)}` : `@${screenName}`)
    : null;

  return {
    title,
    annotation: lines.join('\n')
  };
}

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
    log('[Eagle Info+] Polling timed out');
    pendingDrag = null;
    stopPolling();
    return;
  }

  try {
    const items = await fetchRecentItems();
    const matched = findMatchingItem(items);

    log('[Eagle Info+] Poll: found', items.length, 'items, pending urls:', pendingDrag?.imageUrls?.length, 'drag time:', pendingDrag?.timestamp);
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
      log('[Eagle Info+] Updated item:', itemId, metadata.title);
      return;
    }
  } catch (e) {
    log('Poll error:', e.message);
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
  if (did && /^did:[a-z]+:.+/.test(did)) {
    blueskyDidCache.set(handle, did);
    return did;
  }
  return null;
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

      // パス境界での前方一致: /status/123 は /status/123/photo/1 にマッチするが
      // /status/12 は /status/123 にマッチしない
      const shorter = a.pathname.length <= b.pathname.length ? a.pathname : b.pathname;
      const longer = a.pathname.length > b.pathname.length ? a.pathname : b.pathname;
      if (longer.startsWith(shorter) && (longer[shorter.length] === '/' || shorter.endsWith('/'))) {
        return true;
      }
    }
  } catch {
    // URL解析失敗時はマッチなし
  }

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
