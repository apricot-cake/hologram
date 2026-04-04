(() => {
  const PROCESSED_ATTR = '__eagle-meta-done';

  const siteConfig = getSiteConfig();
  if (!siteConfig) return;

  // 初回: 既存画像を処理
  processAllImages();

  // MutationObserver で動的追加を監視
  const observer = new MutationObserver((mutations) => {
    let hasNewNodes = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        hasNewNodes = true;
        break;
      }
    }
    if (hasNewNodes) processAllImages();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // === メイン処理 ===

  function processAllImages() {
    const images = document.querySelectorAll('img:not([__eagle-meta-done])');
    for (const img of images) {
      processImage(img);
    }
  }

  function processImage(img) {
    img.setAttribute(PROCESSED_ATTR, '1');

    const post = findPostElement(img);
    if (!post) return;

    const metadata = siteConfig.extractMetadata(post, img);
    if (!metadata) return;

    if (metadata.title) {
      img.setAttribute('eagle-title', metadata.title);
    }
    if (metadata.src) {
      img.setAttribute('eagle-src', metadata.src);
    }
    if (metadata.link) {
      img.setAttribute('eagle-link', metadata.link);
    }
    if (metadata.annotation) {
      img.setAttribute('eagle-annotation', metadata.annotation);
    }
  }

  function findPostElement(img) {
    let el = img.parentElement;
    while (el) {
      if (siteConfig.isPostElement(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  // === サイト設定 ===

  function getSiteConfig() {
    if (hostnameMatches('x.com') || hostnameMatches('twitter.com')) {
      return xConfig();
    }
    if (hostnameMatches('bsky.app')) {
      return blueskyConfig();
    }
    if (looksLikeMisskey()) {
      return misskeyConfig();
    }
    return null;
  }

  // --- X (Twitter) ---

  function xConfig() {
    return {
      isPostElement(el) {
        return el.matches('article[data-testid="tweet"]');
      },
      extractMetadata(post, img) {
        const postLink = getXPostLink(post);
        const screenName = postLink?.screenName || null;
        const publishedAt = getPostPublishedAt(post);
        const postText = getXPostText(post);
        const highResSrc = getHighResImageUrl(img, 'x');

        return {
          title: buildTitle(screenName, postText),
          src: highResSrc,
          link: postLink?.url || null,
          annotation: buildAnnotation({
            platform: 'X (Twitter)',
            screenName,
            postId: postLink?.postId,
            publishedAt,
            postText
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

  function getXPostText(post) {
    const textEl = post.querySelector('[data-testid="tweetText"]');
    return textEl?.textContent?.trim() || '';
  }

  // --- Bluesky ---

  function blueskyConfig() {
    return {
      isPostElement(el) {
        return el.matches('[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]');
      },
      extractMetadata(post, img) {
        const postLink = getBlueskyPostLink(post);
        const profile = getBlueskyProfileDetails(post);
        const screenName = profile.screenName || postLink?.handle || null;
        const publishedAt = getPostPublishedAt(post);
        const postText = getBlueskyPostText(post);
        const highResSrc = getHighResImageUrl(img, 'bluesky');

        return {
          title: buildTitle(screenName, postText),
          src: highResSrc,
          link: postLink?.url || null,
          annotation: buildAnnotation({
            platform: 'Bluesky',
            screenName,
            uid: profile.uid,
            postId: postLink?.postId,
            publishedAt,
            postText
          })
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

  function getBlueskyPostText(post) {
    // Blueskyの投稿テキストは複数のspanで構成される
    const textContainer = post.querySelector('[data-testid="postText"]');
    return textContainer?.textContent?.trim() || '';
  }

  // --- Misskey ---

  function misskeyConfig() {
    return {
      isPostElement(el) {
        return el instanceof HTMLElement
          && el.matches('div[tabindex="0"]')
          && Boolean(el.querySelector('article'))
          && Boolean(getMisskeyPermalink(el));
      },
      extractMetadata(post, img) {
        const noteLink = getMisskeyTimeLink(post) || parseMisskeyNoteLink(getMisskeyPermalink(post));
        const authorProfile = getMisskeyAuthorProfile(post);
        const publishedAt = getPostPublishedAt(post);
        const postText = getMisskeyPostText(post);
        const highResSrc = getHighResImageUrl(img, 'misskey');

        return {
          title: buildTitle(authorProfile?.screenName, postText),
          src: highResSrc,
          link: noteLink?.url || getMisskeyPermalink(post) || null,
          annotation: buildAnnotation({
            platform: 'Misskey',
            screenName: authorProfile?.screenName,
            postId: noteLink?.id,
            publishedAt,
            postText
          })
        };
      }
    };
  }

  function getMisskeyPermalink(post) {
    const timeLink = getMisskeyTimeLink(post);
    if (timeLink) return timeLink.url;

    const links = Array.from(post.querySelectorAll('a[href]'));
    for (const link of links) {
      const parsed = parseMisskeyNoteLink(link.href);
      if (parsed) return parsed.url;
    }
    return '';
  }

  function getMisskeyTimeLink(post) {
    const links = Array.from(post.querySelectorAll('a[href]'));
    for (const link of links) {
      if (!link.querySelector('time')) continue;
      const parsed = parseMisskeyNoteLink(link.href);
      if (parsed) return parsed;
    }
    return null;
  }

  function parseMisskeyNoteLink(href) {
    try {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(/^\/notes\/([^/?#]+)\/?$/);
      if (!match) return null;
      return { id: decodeURIComponent(match[1]), url: url.href };
    } catch {
      return null;
    }
  }

  function getMisskeyAuthorProfile(post) {
    const links = Array.from(post.querySelectorAll('a[href]'));
    for (const link of links) {
      const parsed = parseMisskeyProfileLink(link.href);
      if (parsed) return parsed;
    }
    return null;
  }

  function parseMisskeyProfileLink(href) {
    try {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(/^\/@([^/?#]+)\/?$/);
      if (!match) return null;
      return { screenName: decodeURIComponent(match[1]), url: url.href };
    } catch {
      return null;
    }
  }

  function getMisskeyPostText(post) {
    const article = post.querySelector('article');
    if (!article) return '';
    // Misskeyのノートテキストはarticle内のmfm関連要素に入る
    const textNodes = article.querySelectorAll('.mfm-text, [class*="content"] p');
    if (textNodes.length) {
      return Array.from(textNodes).map((n) => n.textContent).join(' ').trim();
    }
    return '';
  }

  // === 共通ユーティリティ ===

  function hostnameMatches(host) {
    return location.hostname === host || location.hostname.endsWith(`.${host}`);
  }

  function looksLikeMisskey() {
    const misskeyAccent = getComputedStyle(document.documentElement)
      .getPropertyValue('--MI_THEME-accent')
      .trim();
    return Boolean(misskeyAccent && document.querySelector('div[tabindex="0"] a[href] time'));
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
      // X: ?format=jpg&name=small → name=orig
      if (src.includes('pbs.twimg.com/media/')) {
        const url = new URL(src);
        url.searchParams.set('name', 'orig');
        return url.href;
      }
    }
    if (platform === 'bluesky') {
      // Bluesky CDN: @jpeg等のサフィックスを除去して原寸取得
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

  function buildAnnotation({ platform, screenName, uid, postId, publishedAt, postText }) {
    const lines = [];
    if (platform) lines.push(`Platform: ${platform}`);
    if (screenName) lines.push(`Author: @${screenName}`);
    if (uid) lines.push(`UID: ${uid}`);
    if (postId) lines.push(`Post ID: ${postId}`);
    if (publishedAt) lines.push(`Published: ${publishedAt}`);
    if (postText) lines.push(`Text: ${truncate(postText, 200)}`);
    return lines.length ? lines.join('\n') : null;
  }

  function truncate(text, maxLen) {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + '…';
  }
})();
