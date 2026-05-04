(() => {
  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.log('[Eagle Info+]', ...args); };

  const siteConfig = getSiteConfig();
  if (!siteConfig) return;

  // dragstart を監視し、最小限の identity (postId 等) と画像 URL のみを background に送る。
  // 表示名・本文・ハッシュタグ等の取得は background 側でプラットフォーム公式 API から行う。
  document.addEventListener('dragstart', (e) => {
    if (!chrome.runtime?.id) return;
    const img = e.target.closest('img') || (e.target.tagName === 'IMG' ? e.target : null);
    if (!img) return;

    const identity = siteConfig.extractIdentity(img);
    log('identity:', identity);
    if (!identity) return;

    chrome.runtime.sendMessage({
      type: 'imageDragged',
      platform: siteConfig.platform,
      pageUrl: location.href,
      imageUrls: collectImageUrls(img, siteConfig.platform),
      identity
    });
  }, true);

  function collectImageUrls(img, platform) {
    const urls = new Set();
    if (img.src) urls.add(img.src);
    if (img.currentSrc) urls.add(img.currentSrc);

    const highRes = getHighResImageUrl(img, platform);
    if (highRes) urls.add(highRes);

    const srcset = img.getAttribute('srcset');
    if (srcset) {
      for (const entry of srcset.split(',')) {
        const url = entry.trim().split(/\s+/)[0];
        if (url) urls.add(url);
      }
    }
    return [...urls];
  }

  function getHighResImageUrl(img, platform) {
    const src = img.src || '';
    if (platform === 'x' && src.includes('pbs.twimg.com/media/')) {
      try {
        const url = new URL(src);
        url.searchParams.set('name', 'orig');
        return url.href;
      } catch {}
    }
    if (platform === 'bluesky' && src.includes('cdn.bsky.app')) {
      return src.replace(/@jpeg$/, '');
    }
    return null;
  }

  // === サイト設定 ===

  function getSiteConfig() {
    if (hostnameMatches('x.com') || hostnameMatches('twitter.com')) return xConfig();
    if (hostnameMatches('bsky.app')) return blueskyConfig();
    if (hostnameMatches('pixiv.net')) return pixivConfig();
    return null;
  }

  function hostnameMatches(host) {
    return location.hostname === host || location.hostname.endsWith(`.${host}`);
  }

  // --- X (Twitter) ---
  function xConfig() {
    return {
      platform: 'x',
      extractIdentity(img) {
        const link = img.closest('a[href*="/status/"]')
          || findAncestorContainerLink(img, 'a[href*="/status/"]');
        const parsed = link ? parseUrlPath(link.href, /^\/([^/]+)\/status\/([^/?#]+)/) : null;
        if (!parsed) return null;
        const [, screenName, postId] = parsed.match;
        return {
          screenName: decodeURIComponent(screenName),
          postId: decodeURIComponent(postId),
          link: stripPathTail(parsed.url, /\/photo\/\d+$|\/video\/\d+$/)
        };
      }
    };
  }

  // --- Bluesky ---
  function blueskyConfig() {
    return {
      platform: 'bluesky',
      extractIdentity(img) {
        const link = img.closest('a[href*="/post/"]')
          || findAncestorContainerLink(img, 'a[href*="/post/"]');
        const parsed = link ? parseUrlPath(link.href, /^\/profile\/([^/]+)\/post\/([^/?#]+)/) : null;
        if (!parsed) return null;
        const [, handle, postId] = parsed.match;
        return {
          screenName: decodeURIComponent(handle),
          postId: decodeURIComponent(postId),
          link: parsed.url
        };
      }
    };
  }

  // --- pixiv ---
  function pixivConfig() {
    const ARTWORK_PATH = /^\/(?:[a-z]+\/)?artworks\/(\d+)/;
    return {
      platform: 'pixiv',
      extractIdentity(img) {
        // 1. 祖先 anchor から取得 (ユーザーページ・検索結果・推薦などから drag)
        const link = img.closest('a[href*="/artworks/"]')
          || findAncestorContainerLink(img, 'a[href*="/artworks/"]');
        let postId = null;
        if (link) {
          const parsed = parseUrlPath(link.href, ARTWORK_PATH);
          if (parsed) postId = parsed.match[1];
        }
        // 2. それでも無ければ作品ページに居る前提で location.pathname から
        if (!postId) {
          const m = location.pathname.match(ARTWORK_PATH);
          if (m) postId = m[1];
        }
        if (!postId) return null;
        return {
          screenName: null,
          postId: decodeURIComponent(postId),
          link: `https://www.pixiv.net/artworks/${postId}`
        };
      }
    };
  }

  // === ヘルパ ===

  // closest() で見つからないとき、画像の祖先 container 内から条件に合う最初のリンクを探す
  function findAncestorContainerLink(img, selector) {
    let el = img.parentElement;
    while (el && el !== document.body) {
      const link = el.querySelector(selector);
      if (link) return link;
      el = el.parentElement;
    }
    return null;
  }

  function parseUrlPath(href, pathRegex) {
    try {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(pathRegex);
      if (!match) return null;
      return { match, url: url.href };
    } catch {
      return null;
    }
  }

  function stripPathTail(href, tailRegex) {
    try {
      const url = new URL(href);
      url.pathname = url.pathname.replace(tailRegex, '');
      return url.href;
    } catch {
      return href;
    }
  }
})();
