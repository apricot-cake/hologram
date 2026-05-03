const EAGLE_API = 'http://localhost:41595';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30000;
const DEBUG = false;
const log = (...args) => { if (DEBUG) console.log('[Eagle Info+]', ...args); };

let pollTimer = null;
let pollStartTime = 0;
let pendingDrag = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'imageDragged') {
    log('Drag detected:', message.platform, message.identity?.postId);
    handleImageDragged(message);
  }
});

async function handleImageDragged({ platform, pageUrl, imageUrls, identity }) {
  // API から投稿全体を取得 → annotation を組み立てる。失敗時は identity の URL 情報のみで保存。
  const post = await fetchPost(platform, identity).catch((e) => {
    log('API fetch failed:', e.message);
    return null;
  });

  const metadata = buildMetadata(platform, identity, post, imageUrls);

  // pixiv は img-master / img-original で URL が大きく異なるため、
  // API 由来のオリジナル URL を Eagle 側マッチング候補に追加する
  const augmentedImageUrls = (platform === 'pixiv' && post)
    ? [...imageUrls, ...derivePixivImageUrls(post)]
    : imageUrls;

  pendingDrag = {
    imageUrls: augmentedImageUrls,
    pageUrl,
    metadata,
    timestamp: Date.now()
  };
  startPolling();
}

function derivePixivImageUrls(illust) {
  const urls = [];
  const original = illust.urls?.original;
  const regular = illust.urls?.regular;
  if (regular) urls.push(regular);
  if (original) {
    urls.push(original);
    // 多ページ作品は _p0 を _pN に置換した連番が同一日付パスで存在
    const pageCount = illust.pageCount || 1;
    for (let i = 1; i < pageCount; i++) {
      urls.push(original.replace(/_p0(\.[a-z]+)$/, `_p${i}$1`));
    }
  }
  return urls;
}

// === Platform API クライアント ===

const postCache = new Map(); // 鍵: `${platform}:${postId}`、値: API 応答 (生)

async function fetchPost(platform, identity) {
  const key = `${platform}:${identity.postId}`;
  if (postCache.has(key)) return postCache.get(key);

  let post = null;
  if (platform === 'x') post = await fetchXPost(identity);
  else if (platform === 'bluesky') post = await fetchBlueskyPost(identity);
  else if (platform === 'pixiv') post = await fetchPixivIllust(identity);

  if (post) {
    if (postCache.size >= 100) postCache.delete(postCache.keys().next().value);
    postCache.set(key, post);
  }
  return post;
}

async function fetchXPost({ postId }) {
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(postId)}&token=0`);
  if (!res.ok) throw new Error(`Syndication API ${res.status}`);
  return res.json();
}

async function fetchBlueskyPost({ screenName, postId }) {
  const uri = `at://${screenName}/app.bsky.feed.post/${postId}`;
  const res = await fetch(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0`
  );
  if (!res.ok) throw new Error(`Bluesky API ${res.status}`);
  const data = await res.json();
  return data.thread?.post || null;
}

async function fetchPixivIllust({ postId }) {
  // 公式サイトのフロントエンドが叩く非ドキュメント AJAX。
  // credentials: include により、ログイン中なら R-18 / フォロー限定にもアクセス可能。
  const res = await fetch(
    `https://www.pixiv.net/ajax/illust/${encodeURIComponent(postId)}`,
    { credentials: 'include' }
  );
  if (!res.ok) throw new Error(`Pixiv API ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Pixiv API: ${data.message || 'unknown error'}`);
  return data.body;
}

// === メタデータ構築 ===

function buildMetadata(platform, identity, post, imageUrls) {
  const fields = post
    ? extractFields(platform, identity, post, imageUrls)
    : { screenName: identity.screenName, postId: identity.postId };

  return {
    title: buildTitle(fields.screenName, fields.postText),
    link: identity.link,
    annotation: buildAnnotation({
      platform: platformLabel(platform),
      ...fields
    })
  };
}

function platformLabel(platform) {
  return { x: 'X (Twitter)', bluesky: 'Bluesky', pixiv: 'Pixiv' }[platform] || platform;
}

function extractFields(platform, identity, post, imageUrls) {
  if (platform === 'x') return extractXFields(identity, post, imageUrls);
  if (platform === 'bluesky') return extractBlueskyFields(identity, post, imageUrls);
  if (platform === 'pixiv') return extractPixivFields(identity, post, imageUrls);
  return {};
}

function extractXFields(identity, data, imageUrls) {
  const user = data.user || {};
  const screenName = user.screen_name || identity.screenName || null;
  const displayName = user.name || null;
  const uid = user.id_str && /^\d+$/.test(user.id_str) ? user.id_str : null;
  const publishedAt = data.created_at || null;
  const rawText = data.text || '';
  const postText = rawText.replace(/https?:\/\/t\.co\/\S+/g, '').trim();
  const hashtags = (data.entities?.hashtags || []).map((h) => `#${h.text}`);
  const media = data.mediaDetails || [];
  const total = media.length;

  const matchedIdx = findXImageIndex(media, imageUrls);
  const imageIndex = total > 1 && matchedIdx != null
    ? `${matchedIdx + 1}/${total}`
    : null;

  const altText = (matchedIdx != null && media[matchedIdx]?.ext_alt_text)
    || media[0]?.ext_alt_text
    || null;

  return {
    screenName,
    displayName,
    uid,
    postId: identity.postId,
    publishedAt,
    postText,
    hashtags,
    altText,
    imageIndex
  };
}

function findXImageIndex(media, imageUrls) {
  // pbs.twimg.com/media/<MEDIA_ID> の MEDIA_ID 部分でマッチ
  const ids = imageUrls
    .map((u) => u.match(/pbs\.twimg\.com\/media\/([^.?]+)/)?.[1])
    .filter(Boolean);
  if (!ids.length) return null;
  for (let i = 0; i < media.length; i++) {
    const url = media[i].media_url_https || '';
    const mediaId = url.match(/\/media\/([^.?]+)/)?.[1];
    if (mediaId && ids.includes(mediaId)) return i;
  }
  return null;
}

function extractBlueskyFields(identity, post, imageUrls) {
  const author = post?.author || {};
  const record = post?.record || {};
  const screenName = author.handle || identity.screenName || null;
  const displayName = author.displayName || null;
  const uid = author.did || null;
  const publishedAt = record.createdAt || null;
  const postText = record.text || '';
  const hashtags = (record.facets || [])
    .flatMap((f) => f.features || [])
    .filter((feat) => feat.$type === 'app.bsky.richtext.facet#tag')
    .map((feat) => `#${feat.tag}`);
  const images = post?.embed?.images || post?.embed?.media?.images || [];
  const total = images.length;
  const matchedIdx = findBlueskyImageIndex(images, imageUrls);
  const imageIndex = total > 1 && matchedIdx != null
    ? `${matchedIdx + 1}/${total}`
    : null;
  const altText = (matchedIdx != null && images[matchedIdx]?.alt) || images[0]?.alt || null;

  return {
    screenName,
    displayName,
    uid,
    postId: identity.postId,
    publishedAt,
    postText,
    hashtags,
    altText,
    imageIndex
  };
}

function findBlueskyImageIndex(images, imageUrls) {
  // CDN URL 中の CID でマッチ
  const cids = imageUrls
    .map((u) => u.match(/\/([a-z0-9]{50,})(?:@|\b)/i)?.[1])
    .filter(Boolean);
  if (!cids.length) return null;
  for (let i = 0; i < images.length; i++) {
    const candidates = [images[i].thumb, images[i].fullsize].filter(Boolean);
    for (const c of candidates) {
      const cid = c.match(/\/([a-z0-9]{50,})(?:@|\b)/i)?.[1];
      if (cid && cids.includes(cid)) return i;
    }
  }
  return null;
}

function extractPixivFields(identity, illust, imageUrls) {
  const screenName = illust.userAccount || null;
  const displayName = illust.userName || null;
  const uid = illust.userId || null;
  const publishedAt = illust.uploadDate || illust.createDate || null;
  const postText = illust.illustTitle || '';
  const description = stripHtml(illust.illustComment || '');
  const hashtags = (illust.tags?.tags || []).map((t) => `#${t.tag}`);
  const altText = illust.alt || null;
  const total = illust.pageCount || 0;
  const matchedIdx = findPixivImageIndex(imageUrls);
  const imageIndex = total > 1 && matchedIdx != null
    ? `${matchedIdx + 1}/${total}`
    : null;

  return {
    screenName,
    displayName,
    uid,
    postId: identity.postId,
    publishedAt,
    postText,
    description,
    hashtags,
    altText,
    imageIndex
  };
}

function findPixivImageIndex(imageUrls) {
  // pximg URL の `_p<N>` (0-based) を抽出
  for (const u of imageUrls) {
    const m = u.match(/\/\d+_p(\d+)[._]/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .trim();
}

// === annotation 文字列構築 ===

function buildTitle(screenName, postText) {
  const maxLen = 60;
  const name = screenName ? `@${screenName}` : '';
  const text = postText ? truncate(postText, maxLen) : '';
  if (name && text) return `${name} - ${text}`;
  if (name) return name;
  if (text) return text;
  return null;
}

function buildAnnotation({ platform, screenName, displayName, uid, postId, publishedAt, postText, description, hashtags, altText, imageIndex }) {
  const lines = [];
  if (platform) lines.push(`Platform: ${sanitize(platform)}`);
  if (displayName) lines.push(`Display Name: ${sanitize(displayName)}`);
  if (screenName) lines.push(`Author: @${sanitize(screenName)}`);
  if (uid) lines.push(`UID: ${sanitize(uid)}`);
  if (postId) lines.push(`Post ID: ${sanitize(postId)}`);
  if (imageIndex) lines.push(`Image: ${sanitize(imageIndex)}`);
  if (publishedAt) lines.push(`Published: ${sanitize(publishedAt)}`);
  if (hashtags?.length) lines.push(`Hashtags: ${hashtags.map(sanitize).join(' ')}`);
  if (altText && altText !== '画像' && altText !== 'Image') lines.push(`Alt: ${truncate(sanitize(altText), 200)}`);
  if (postText) lines.push(`Text: ${truncate(sanitize(postText), 200)}`);
  if (description) lines.push(`Description: ${truncate(sanitize(description), 200)}`);
  return lines.length ? lines.join('\n') : null;
}

function sanitize(value) {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

// === Eagle ポーリング ===

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
    log('Polling timed out');
    pendingDrag = null;
    stopPolling();
    return;
  }

  try {
    const items = await fetchRecentItems();
    const matched = findMatchingItem(items);

    if (matched) {
      const metadata = pendingDrag.metadata;
      const itemId = matched.id;
      pendingDrag = null;
      stopPolling();

      // Eagle REST API は name の更新をサポートしないため、タイトルは annotation 先頭に含める
      const annotation = metadata.title
        ? metadata.title + '\n\n' + (metadata.annotation || '')
        : metadata.annotation;
      await updateItemMetadata(itemId, { annotation, link: metadata.link });
      log('Updated item:', itemId, metadata.title);
      return;
    }
  } catch (e) {
    log('Poll error:', e.message);
  }

  pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
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
  const candidateUrls = [
    ...pendingDrag.imageUrls,
    pendingDrag.pageUrl,
    pendingDrag.metadata?.link
  ].filter(Boolean);

  for (const item of items) {
    const itemTime = item.modificationTime || item.lastModified || 0;
    if (itemTime < dragTime - 30000) continue;

    const itemUrl = item.url || '';
    if (!itemUrl) continue;

    for (const candidateUrl of candidateUrls) {
      if (urlMatches(itemUrl, candidateUrl)) return item;
    }
  }
  return null;
}

function urlMatches(eagleUrl, candidateUrl) {
  if (!eagleUrl || !candidateUrl) return false;
  if (eagleUrl === candidateUrl) return true;

  try {
    const a = new URL(eagleUrl);
    const b = new URL(candidateUrl);

    if (a.hostname === b.hostname) {
      if (a.pathname === b.pathname) return true;

      // パス境界での前方一致: /status/123 は /status/123/photo/1 にマッチするが
      // /status/12 は /status/123 にマッチしない
      const shorter = a.pathname.length <= b.pathname.length ? a.pathname : b.pathname;
      const longer = a.pathname.length > b.pathname.length ? a.pathname : b.pathname;
      if (longer.startsWith(shorter) && (longer[shorter.length] === '/' || shorter.endsWith('/'))) {
        return true;
      }
    }
  } catch {}
  return false;
}

async function updateItemMetadata(itemId, metadata) {
  const body = { id: itemId };
  if (metadata.annotation) body.annotation = metadata.annotation;
  if (metadata.link) body.url = metadata.link;

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
