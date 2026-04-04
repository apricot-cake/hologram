(() => {
  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.log('[Eagle Meta]', ...args); };

  const siteConfig = getSiteConfig();
  if (!siteConfig) return;

  // dragstart イベントを監視し、ドラッグされた画像のメタデータを background に送信
  document.addEventListener('dragstart', (e) => {
    const img = e.target.closest('img') || (e.target.tagName === 'IMG' ? e.target : null);
    log('[Eagle Meta Content] dragstart', img ? 'img found' : 'no img', e.target.tagName);
    if (!img) return;

    const post = findPostElement(img);
    const metadata = post
      ? siteConfig.extractMetadata(post, img)
      : siteConfig.extractFallbackMetadata?.(img);
    log('[Eagle Meta Content] post:', !!post, 'metadata:', !!metadata, metadata?.title);
    if (!metadata) return;

    const imageUrls = collectImageUrls(img);

    // まず即座にメッセージ送信（ポーリング開始を遅らせない）
    // Bluesky: DID解決は並行して行い、annotationに後から追加
    if (siteConfig.platform === 'bluesky' && metadata._handle && !metadata._uid) {
      log('[Eagle Meta Content] resolving DID for', metadata._handle);
      chrome.runtime.sendMessage(
        { type: 'resolveBlueskyDid', handle: metadata._handle },
        (response) => {
          log('[Eagle Meta Content] DID resolved:', response?.did);
          if (response?.did) {
            if (metadata.annotation.includes('Post ID:')) {
              metadata.annotation = metadata.annotation.replace(
                /\nPost ID:/,
                `\nUID: ${response.did}\nPost ID:`
              );
            } else {
              metadata.annotation += `\nUID: ${response.did}`;
            }
          }
          sendDragMessage(imageUrls, metadata);
        }
      );
    } else {
      sendDragMessage(imageUrls, metadata);
    }
  }, true);

  function sendDragMessage(imageUrls, metadata) {
    chrome.runtime.sendMessage({
      type: 'imageDragged',
      imageUrls,
      pageUrl: location.href,
      metadata
    });
  }

  // === 投稿検出 ===

  function findPostElement(img) {
    let el = img.parentElement;
    while (el) {
      if (siteConfig.isPostElement(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function collectImageUrls(img) {
    const urls = new Set();
    if (img.src) urls.add(img.src);
    if (img.currentSrc) urls.add(img.currentSrc);

    // 高解像度URLも追加
    const highRes = getHighResImageUrl(img, siteConfig.platform);
    if (highRes) urls.add(highRes);

    // srcset からも収集
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      for (const entry of srcset.split(',')) {
        const url = entry.trim().split(/\s+/)[0];
        if (url) urls.add(url);
      }
    }

    return [...urls];
  }

  // === サイト設定 ===

  function getSiteConfig() {
    if (hostnameMatches('x.com') || hostnameMatches('twitter.com')) {
      return xConfig();
    }
    if (hostnameMatches('bsky.app')) {
      return blueskyConfig();
    }
    return null;
  }

  // --- X (Twitter) ---

  function xConfig() {
    return {
      platform: 'x',
      isPostElement(el) {
        return el.matches('article[data-testid="tweet"]');
      },
      extractMetadata(post, img) {
        const postLink = getXPostLink(post);
        const screenName = postLink?.screenName || null;
        const uid = getXUserId(post);
        const displayName = getXDisplayName(post);
        const publishedAt = getPostPublishedAt(post);
        const postText = getXPostText(post);
        const hashtags = getXHashtags(post);
        const altText = img.alt || null;
        const imageIndex = getXImageIndex(post, img);

        return {
          title: buildTitle(screenName, postText),
          link: postLink?.url || null,
          annotation: buildAnnotation({
            platform: 'X (Twitter)',
            screenName,
            displayName,
            uid,
            postId: postLink?.postId,
            publishedAt,
            postText,
            hashtags,
            altText,
            imageIndex
          })
        };
      },
      // メディアグリッド等、article 要素がない場合のフォールバック
      // _enrichPostId を設定し、background.js で Syndication API から詳細を取得
      extractFallbackMetadata(img) {
        const link = img.closest('a[href*="/status/"]');
        const postLink = link ? parseXPostLink(link.href) : null;
        if (!postLink) return null;

        const screenName = postLink.screenName || getScreenNameFromUrl();
        const uid = getXPageUserId();
        const imageIndex = getXPhotoIndexFromUrl(link.href);

        return {
          title: buildTitle(screenName, null),
          link: postLink.url,
          _enrichPostId: postLink.postId,
          _imageIndex: imageIndex,
          annotation: buildAnnotation({
            platform: 'X (Twitter)',
            screenName,
            uid,
            postId: postLink.postId,
            imageIndex
          })
        };
      }
    };
  }

  function getXPostLink(post) {
    const links = Array.from(post.querySelectorAll('a[href*="/status/"]'));
    const preferredLink = links.find((link) => link.querySelector('time')) || links[0];
    return preferredLink ? parseXPostLink(preferredLink.href) : null;
  }

  function parseXPostLink(href) {
    try {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(/^\/([^/]+)\/status\/([^/?#]+)/);
      if (match) {
        return {
          url: url.href,
          screenName: decodeURIComponent(match[1]),
          postId: decodeURIComponent(match[2])
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  function getXUserId(post) {
    // ページコンテキスト経由で React fiber から user.id_str を取得
    // content script は隔離環境のため、ページ側に注入した属性を読む
    const uid = post.getAttribute('__x-user-id');
    if (uid && /^\d+$/.test(uid)) return uid;

    // フォールバック: data-testid="<userId>-follow" から取得
    const followBtn = post.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]');
    if (followBtn) {
      const match = followBtn.getAttribute('data-testid').match(/^(\d+)-/);
      if (match) return match[1];
    }
    return null;
  }

  function getXPhotoIndexFromUrl(href) {
    // /status/123/photo/2 → "2" (総数は不明なので番号のみ)
    try {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(/\/photo\/(\d+)/);
      if (match) return match[1];
    } catch {}
    return null;
  }

  function getXPageUserId() {
    // プロフィールページのフォローボタンからユーザーIDを取得
    const followBtn = document.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]');
    if (followBtn) {
      const match = followBtn.getAttribute('data-testid').match(/^(\d+)-/);
      if (match) return match[1];
    }
    return null;
  }

  function getScreenNameFromUrl() {
    const match = location.pathname.match(/^\/([^/]+)/);
    if (match && !['home', 'explore', 'search', 'notifications', 'messages', 'i', 'settings'].includes(match[1])) {
      return decodeURIComponent(match[1]);
    }
    return null;
  }

  function getXDisplayName(post) {
    const userNameEl = post.querySelector('[data-testid="User-Name"]');
    const firstSpan = userNameEl?.querySelector('a span');
    return firstSpan?.textContent?.trim() || null;
  }

  function getXHashtags(post) {
    const textEl = post.querySelector('[data-testid="tweetText"]');
    if (!textEl) return [];
    const links = Array.from(textEl.querySelectorAll('a[href*="/hashtag/"]'));
    return links.map((a) => a.textContent.trim()).filter(Boolean);
  }

  function getXImageIndex(post, img) {
    const photos = Array.from(post.querySelectorAll('[data-testid="tweetPhoto"] img'));
    if (photos.length <= 1) return null;
    const index = photos.indexOf(img);
    if (index === -1) return null;
    return `${index + 1}/${photos.length}`;
  }

  function getXPostText(post) {
    const textEl = post.querySelector('[data-testid="tweetText"]');
    return textEl?.textContent?.trim() || '';
  }

  // --- Bluesky ---

  function blueskyConfig() {
    return {
      platform: 'bluesky',
      isPostElement(el) {
        return el.matches('[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]');
      },
      extractMetadata(post, img) {
        const postLink = getBlueskyPostLink(post);
        const profile = getBlueskyProfileDetails(post);
        const screenName = profile.screenName || postLink?.handle || null;
        const displayName = getBlueskyDisplayName(post);
        const publishedAt = getPostPublishedAt(post);
        const postText = getBlueskyPostText(post);
        const altText = img.alt || null;
        const imageIndex = getBlueskyImageIndex(post, img);

        return {
          title: buildTitle(screenName, postText),
          link: postLink?.url || null,
          annotation: buildAnnotation({
            platform: 'Bluesky',
            screenName,
            displayName,
            uid: profile.uid,
            postId: postLink?.postId,
            publishedAt,
            postText,
            altText,
            imageIndex
          }),
          _handle: !profile.uid ? screenName : null,
          _uid: profile.uid
        };
      },
      extractFallbackMetadata(img) {
        // 検索結果等で feedItem がない場合、role="link" の祖先からリンクを探す
        const container = img.closest('[role="link"]');
        if (!container) return null;

        const postLink = Array.from(container.querySelectorAll('a[href*="/post/"]'))
          .map((a) => parseBlueskyPostLink(a.href))
          .filter(Boolean)[0];

        const profileLinks = Array.from(container.querySelectorAll('a[href*="/profile/"]'))
          .map((a) => parseBlueskyProfileLink(a.href))
          .filter(Boolean);

        const screenName = profileLinks.find((p) => p.screenName)?.screenName || null;
        const uid = profileLinks.find((p) => p.uid)?.uid || null;

        return {
          title: buildTitle(screenName, null),
          link: postLink?.url || null,
          annotation: buildAnnotation({
            platform: 'Bluesky',
            screenName,
            uid,
            postId: postLink?.postId
          }),
          _handle: !uid ? screenName : null,
          _uid: uid
        };
      }
    };
  }

  function getBlueskyPostLink(post) {
    const links = Array.from(post.querySelectorAll('a[href*="/post/"]'))
      .map((link) => parseBlueskyPostLink(link.href))
      .filter(Boolean);

    if (!links.length) return null;

    const authorHandle = getBlueskyAuthorHandle(post);
    return links.find((link) => !authorHandle || link.handle === authorHandle) || links[0];
  }

  function getBlueskyAuthorHandle(post) {
    const testId = post.getAttribute('data-testid') || '';
    const match = testId.match(/-by-(.+)$/);
    return match?.[1] || '';
  }

  function parseBlueskyPostLink(href) {
    try {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/);
      if (!match) return null;
      return {
        url: url.href,
        handle: decodeURIComponent(match[1]),
        postId: decodeURIComponent(match[2])
      };
    } catch {
      return null;
    }
  }

  function getBlueskyProfileDetails(post) {
    const links = Array.from(post.querySelectorAll('a[href*="/profile/"]'))
      .map((link) => parseBlueskyProfileLink(link.href))
      .filter(Boolean);

    const uidLink = links.find((link) => link.uid);
    const screenName = getBlueskyAuthorHandle(post)
      || links.find((link) => link.screenName)?.screenName
      || null;

    return { screenName, uid: uidLink?.uid || null };
  }

  function parseBlueskyProfileLink(href) {
    try {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(/^\/profile\/([^/?#]+)/);
      if (!match) return null;
      const value = decodeURIComponent(match[1]);
      if (value.startsWith('did:')) {
        return { screenName: null, uid: value };
      }
      return { screenName: value, uid: null };
    } catch {
      return null;
    }
  }

  function getBlueskyDisplayName(post) {
    // Blueskyの表示名はプロフィールリンク内の最初のテキスト
    const links = Array.from(post.querySelectorAll('a[href*="/profile/"]'));
    for (const link of links) {
      const text = link.textContent?.trim();
      // ハンドル（@付きやdid:）ではなく表示名を探す
      if (text && !text.startsWith('@') && !text.startsWith('did:') && !text.includes('.')) {
        return text;
      }
    }
    return null;
  }

  function getBlueskyImageIndex(post, img) {
    const imgs = Array.from(post.querySelectorAll('img'))
      .filter((i) => i.src?.includes('cdn.bsky.app') && !i.closest('[data-testid="userAvatarImage"]'));
    if (imgs.length <= 1) return null;
    const index = imgs.indexOf(img);
    if (index === -1) return null;
    return `${index + 1}/${imgs.length}`;
  }

  function getBlueskyPostText(post) {
    const textContainer = post.querySelector('[data-testid="postText"]');
    return textContainer?.textContent?.trim() || '';
  }

  // === 共通ユーティリティ ===

  function hostnameMatches(host) {
    return location.hostname === host || location.hostname.endsWith(`.${host}`);
  }

  function getPostPublishedAt(post) {
    const timeEl = post.querySelector('time[datetime], time');
    const rawValue = timeEl?.getAttribute('datetime') || '';
    if (!rawValue) return null;
    const parsed = new Date(rawValue);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  function getHighResImageUrl(img, platform) {
    const src = img.src || '';
    if (platform === 'x') {
      if (src.includes('pbs.twimg.com/media/')) {
        const url = new URL(src);
        url.searchParams.set('name', 'orig');
        return url.href;
      }
    }
    if (platform === 'bluesky') {
      if (src.includes('cdn.bsky.app')) {
        return src.replace(/@jpeg$/, '');
      }
    }
    return null;
  }

  function buildTitle(screenName, postText) {
    const maxLen = 60;
    const name = screenName ? `@${screenName}` : '';
    const text = postText ? truncate(postText, maxLen) : '';

    if (name && text) return `${name} - ${text}`;
    if (name) return name;
    if (text) return text;
    return null;
  }

  function buildAnnotation({ platform, screenName, displayName, uid, postId, publishedAt, postText, hashtags, altText, imageIndex }) {
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
    return lines.length ? lines.join('\n') : null;
  }

  function sanitize(value) {
    // 改行を除去して偽フィールド注入を防止
    return String(value).replace(/[\r\n]+/g, ' ').trim();
  }

  function truncate(text, maxLen) {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + '…';
  }
})();
