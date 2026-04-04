(() => {
  const siteConfig = getSiteConfig();
  if (!siteConfig) {
    return;
  }

  // 二重注入防止
  if (typeof window.__snsPostSaveCleanup === 'function') {
    window.__snsPostSaveCleanup();
    return;
  }
  window.__snsPostSaveActive = true;

  let isCleanedUp = false;
  let restoreCaptureState = null;
  let savedScrollPosition = null;

  // === UI要素 ===

  // 上部バナー
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    background: #1d9bf0; color: #fff; padding: 8px 20px; border-radius: 24px;
    font: 600 14px/1.4 -apple-system, sans-serif; z-index: 2147483647;
    pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    transition: opacity 0.2s;
  `;
  banner.textContent = '保存する投稿をクリック（Escでキャンセル）';
  document.body.appendChild(banner);

  // ハイライト枠
  const highlight = document.createElement('div');
  highlight.style.cssText = `
    position: absolute; pointer-events: none; z-index: 2147483646;
    box-sizing: border-box;
    border: 3px solid #1d9bf0; border-radius: 16px;
    background: rgba(29, 155, 240, 0.06);
    transition: top 0.08s, left 0.08s, width 0.08s, height 0.08s;
    display: none;
  `;
  document.body.appendChild(highlight);

  let captureStyle = null;
  if (siteConfig.captureStyleText) {
    captureStyle = document.createElement('style');
    captureStyle.textContent = siteConfig.captureStyleText;
    document.head.appendChild(captureStyle);
  }

  // === 投稿検出 ===

  function findPostElement(target) {
    if (typeof siteConfig.findPostElement === 'function') {
      return siteConfig.findPostElement(target);
    }

    let el = target instanceof Element ? target : target?.parentElement;
    while (el) {
      if (el.matches?.(siteConfig.postSelector)) {
        if (!siteConfig.isPostElement || siteConfig.isPostElement(el)) {
          return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function getPostRect(post) {
    return normalizeRect(siteConfig.getCaptureRect?.(post) || post.getBoundingClientRect());
  }

  // === イベントハンドラ ===

  function onMouseMove(e) {
    const post = findPostElement(e.target);
    if (post) {
      const rect = getPostRect(post);
      highlight.style.display = 'block';
      highlight.style.top = (rect.top + window.scrollY - 4) + 'px';
      highlight.style.left = (rect.left + window.scrollX - 4) + 'px';
      highlight.style.width = (rect.width + 8) + 'px';
      highlight.style.height = (rect.height + 8) + 'px';
    } else {
      highlight.style.display = 'none';
    }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const post = findPostElement(e.target);
    if (!post) return;

    const postUrl = siteConfig.getPermalink(post);
    const postDetails = siteConfig.getPostDetails?.(post, postUrl) || {};

    // イベントリスナー除去（クリックは1回だけ）
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);

    // ハイライト・バナーを一旦すべて非表示にしてからキャプチャ
    highlight.style.display = 'none';
    banner.style.display = 'none';
    restoreCaptureState = siteConfig.prepareForCapture?.(post) || null;

    // 見切れていればスクロールしてビューポート内に収める
    const preRect = getPostRect(post);
    if (preRect.top < 0 || preRect.bottom > window.innerHeight) {
      savedScrollPosition = { x: window.scrollX, y: window.scrollY };
      post.scrollIntoView({ block: 'start', behavior: 'instant' });
    }

    // 再描画を待ってからキャプチャ
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const rect = getPostRect(post);

        banner.style.display = '';
        banner.textContent = '保存中...';
        banner.style.background = '#536471';

        chrome.runtime.sendMessage({
          type: 'captureAndSend',
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          postUrl,
          platform: siteConfig.platform,
          postDetails
        });
      });
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') cleanup();
  }

  // === クリーンアップ ===

  function cleanup() {
    if (isCleanedUp) return;
    isCleanedUp = true;

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    restoreCaptureState?.();
    restoreCaptureState = null;
    banner.remove();
    highlight.remove();
    captureStyle?.remove();
    window.__snsPostSaveActive = false;

    if (window.__snsPostSaveCleanup === cleanup) {
      delete window.__snsPostSaveCleanup;
    }
  }

  window.__snsPostSaveCleanup = cleanup;

  // === メッセージリスナー ===

  function onRuntimeMessage(msg, _sender, sendResponse) {
    // クロップ要求
    if (msg.type === 'cropImage') {
      const { dataUrl, rect } = msg;
      const dpr = window.devicePixelRatio || 1;

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const w = Math.round(rect.width * dpr);
        const h = Math.round(rect.height * dpr);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(
          img,
          Math.round(rect.x * dpr), Math.round(rect.y * dpr), w, h,
          0, 0, w, h
        );
        sendResponse({ croppedDataUrl: canvas.toDataURL('image/jpeg', 0.92) });

        // スクロール位置を復元
        if (savedScrollPosition) {
          window.scrollTo({ left: savedScrollPosition.x, top: savedScrollPosition.y, behavior: 'instant' });
          savedScrollPosition = null;
        }
      };
      img.onerror = () => sendResponse(null);
      img.src = dataUrl;
      return true; // 非同期レスポンス
    }

    // 結果通知
    if (msg.type === 'notify') {
      banner.textContent = msg.success
        ? '画像を保存しました'
        : '保存に失敗しました';
      banner.style.background = msg.success ? '#00ba7c' : '#f4212e';
      setTimeout(cleanup, 1500);
    }
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // === リスナー登録 ===
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
})();

function getSiteConfig() {
  if (hostnameMatches('x.com') || hostnameMatches('twitter.com')) {
    return {
      platform: 'x',
      postSelector: 'article[data-testid="tweet"]',
      captureStyleText: `
        .__snsCaptureXNoHover,
        .__snsCaptureXNoHover * {
          pointer-events: none !important;
          transition: none !important;
        }

        .__snsCaptureXNoHover,
        .__snsCaptureXNoHover:hover,
        .__snsCaptureXNoHover > div,
        .__snsCaptureXNoHover > div:hover,
        .__snsCaptureXNoHover > article,
        .__snsCaptureXNoHover > article:hover {
          background-color: transparent !important;
        }
      `,
      getPermalink(post) {
        return getXPostLink(post)?.url || '';
      },
      getPostDetails(post, postUrl) {
        const parsed = parseXPostLink(postUrl) || getXPostLink(post);
        return {
          postId: parsed?.postId || null,
          screenName: parsed?.screenName || null,
          displayName: getXDisplayName(post),
          userId: getXUserId(post),
          uid: null,
          postText: getXPostText(post),
          postPublishedAt: getPostPublishedAt(post)
        };
      },
      prepareForCapture(post) {
        return prepareScopedCaptureState('__snsCaptureXNoHover', [
          post,
          post.parentElement,
          post.closest('[data-testid="cellInnerDiv"]')
        ]);
      }
    };
  }

  if (hostnameMatches('bsky.app')) {
    return {
      platform: 'bluesky',
      postSelector: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"], [role="link"]',
      isPostElement(el) {
        if (el.getAttribute('data-testid')) return true;
        return el.getAttribute('role') === 'link' && !!el.querySelector('[data-testid="postText"], [data-testid="repostBtn"]');
      },
      captureStyleText: `
        .__snsCaptureBskyNoHover,
        .__snsCaptureBskyNoHover * {
          pointer-events: none !important;
          transition: none !important;
        }

        .__snsCaptureBskyNoHover,
        .__snsCaptureBskyNoHover:hover,
        .__snsCaptureBskyNoHover > div,
        .__snsCaptureBskyNoHover > div:hover,
        .__snsCaptureBskyNoHover article,
        .__snsCaptureBskyNoHover article:hover {
          background-color: transparent !important;
          filter: none !important;
        }
      `,
      getPermalink(post) {
        return getBlueskyPostLink(post)?.url || parseBlueskyPostLink(location.href)?.url || '';
      },
      getPostDetails(post, postUrl) {
        const postLink = parseBlueskyPostLink(postUrl) || getBlueskyPostLink(post) || parseBlueskyPostLink(location.href);
        const profile = getBlueskyProfileDetails(post);
        return {
          postId: postLink?.postId || null,
          screenName: profile.screenName || postLink?.handle || null,
          displayName: getBlueskyDisplayName(post),
          userId: null,
          uid: profile.uid,
          postText: getBlueskyPostText(post),
          postPublishedAt: getPostPublishedAt(post)
        };
      },
      prepareForCapture(post) {
        return prepareScopedCaptureState('__snsCaptureBskyNoHover', [
          post,
          post.parentElement,
          post.parentElement?.parentElement,
          post.closest('[data-testid^="feedItem-by-"]')?.parentElement,
          post.closest('[data-testid^="postThreadItem-by-"]')?.parentElement
        ]);
      }
    };
  }

  if (looksLikeMisskey()) {
    return {
      platform: 'misskey',
      captureStyleText: `
        .__snsCaptureMisskeyNoHover,
        .__snsCaptureMisskeyNoHover * {
          pointer-events: none !important;
          transition: none !important;
        }

        .__snsCaptureMisskeyNoHover a,
        .__snsCaptureMisskeyNoHover a:hover,
        .__snsCaptureMisskeyNoHover button,
        .__snsCaptureMisskeyNoHover button:hover {
          color: inherit !important;
          text-decoration: none !important;
        }
      `,
      findPostElement(target) {
        return findMisskeyPostElement(target);
      },
      getPermalink(post) {
        return getMisskeyPermalink(post);
      },
      getPostDetails(post, postUrl) {
        const noteLink = parseMisskeyNoteLink(postUrl) || getMisskeyTimeLink(post);
        const authorProfile = getMisskeyAuthorProfile(post);
        return {
          postId: noteLink?.id || null,
          screenName: authorProfile?.screenName || null,
          displayName: getMisskeyDisplayName(post),
          userId: null,
          uid: null,
          postText: getMisskeyPostText(post),
          postPublishedAt: getMisskeyPostPublishedAt(post)
        };
      },
      getCaptureRect(post) {
        return getMisskeyCaptureRect(post);
      },
      prepareForCapture(post) {
        return prepareScopedCaptureState('__snsCaptureMisskeyNoHover', [
          post,
          getMisskeyPrimaryArticle(post)
        ]);
      }
    };
  }

  return null;
}

function getPostPublishedAt(post) {
  if (!(post instanceof Element)) {
    return null;
  }

  const timeElement = post.querySelector('time[datetime], time');
  const rawValue = timeElement?.getAttribute('datetime')
    || timeElement?.getAttribute('title')
    || '';

  if (!rawValue) {
    const postLink = post.querySelector('a[href*="/post/"], a[href*="/status/"]');
    const ariaLabel = postLink?.getAttribute('aria-label') || '';
    if (ariaLabel) {
      const normalized = ariaLabel.replace(/(\d+)年(\d+)月(\d+)日/, '$1/$2/$3');
      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
    return null;
  }

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getXPostLink(post) {
  const links = post instanceof Element
    ? Array.from(post.querySelectorAll('a[href*="/status/"]'))
    : [];

  const preferredLink = links.find((link) => link.querySelector('time')) || links[0];
  return preferredLink ? parseXPostLink(preferredLink.href) : null;
}

function parseXPostLink(href) {
  try {
    const url = new URL(href, location.origin);
    let match = url.pathname.match(/^\/([^/]+)\/status\/([^/?#]+)/);
    if (match) {
      return {
        url: url.href,
        screenName: decodeURIComponent(match[1]),
        postId: decodeURIComponent(match[2])
      };
    }

    match = url.pathname.match(/^\/i\/web\/status\/([^/?#]+)/);
    if (!match) {
      return null;
    }

    return {
      url: url.href,
      screenName: null,
      postId: decodeURIComponent(match[1])
    };
  } catch {
    return null;
  }
}

function getXPostText(post) {
  const textEl = post.querySelector('[data-testid="tweetText"]');
  return textEl?.textContent?.trim() || null;
}

function getXDisplayName(post) {
  const userNameEl = post.querySelector('[data-testid="User-Name"]');
  const firstSpan = userNameEl?.querySelector('a span');
  return firstSpan?.textContent?.trim() || null;
}

function getXUserId(post) {
  const uid = post.getAttribute('__x-user-id');
  if (uid && /^\d+$/.test(uid)) {
    return uid;
  }

  const followBtn = post.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]');
  if (followBtn) {
    const match = followBtn.getAttribute('data-testid').match(/^(\d+)-/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function hostnameMatches(host) {
  return location.hostname === host || location.hostname.endsWith(`.${host}`);
}

function getBlueskyPostText(post) {
  const textEl = post.querySelector('[data-testid="postText"]');
  if (textEl) {
    return textEl.textContent?.trim() || null;
  }

  const candidates = post.querySelectorAll('div[dir="auto"]');
  let longest = null;
  for (const el of candidates) {
    const text = el.textContent?.trim();
    if (text && !el.querySelector('a') && (!longest || text.length > longest.length)) {
      longest = text;
    }
  }
  if (longest) {
    return longest;
  }

  return null;
}

function getBlueskyDisplayName(post) {
  const links = Array.from(post.querySelectorAll('a[href*="/profile/"]'));
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    if (href.includes('/liked-by') || href.includes('/reposted-by') || href.includes('/post/')) {
      continue;
    }

    const candidates = link.children.length
      ? Array.from(link.querySelectorAll('div, span, b, strong'))
      : [link];

    for (const el of candidates) {
      const text = el.textContent?.trim();
      if (text && text.length > 1
        && text === el.innerText?.trim()
        && !text.startsWith('@') && !text.startsWith('did:')
        && !text.includes('.') && !/^\d/.test(text)
        && !/リポスト|Reposted/i.test(text)) {
        return text;
      }
    }
  }

  return null;
}

function getBlueskyAuthorHandle(post) {
  const testId = post.getAttribute('data-testid') || '';
  const match = testId.match(/-by-(.+)$/);
  return match?.[1] || '';
}

function getBlueskyPostLink(post) {
  const authorHandle = getBlueskyAuthorHandle(post);
  const links = post instanceof Element
    ? Array.from(post.querySelectorAll('a[href]'))
      .map((link) => parseBlueskyPostLink(link.href))
      .filter(Boolean)
    : [];

  if (!links.length) {
    return null;
  }

  return links.find((link) => !authorHandle || link.handle === authorHandle) || links[0];
}

function getBlueskyProfileDetails(post) {
  const links = post instanceof Element
    ? Array.from(post.querySelectorAll('a[href]'))
      .map((link) => parseBlueskyProfileLink(link.href))
      .filter(Boolean)
    : [];

  const uidLink = links.find((link) => link.uid);
  const screenName = getBlueskyAuthorHandle(post)
    || links.find((link) => link.screenName)?.screenName
    || null;

  return {
    screenName,
    uid: uidLink?.uid || null
  };
}

function parseBlueskyPostLink(href) {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)\/?$/);
    if (!match) {
      return null;
    }

    return {
      url: `${url.origin}/profile/${match[1]}/post/${match[2]}`,
      handle: decodeURIComponent(match[1]),
      postId: decodeURIComponent(match[2])
    };
  } catch {
    return null;
  }
}

function parseBlueskyProfileLink(href) {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(/^\/profile\/([^/?#]+)/);
    if (!match) {
      return null;
    }

    const value = decodeURIComponent(match[1]);
    if (value.startsWith('did:')) {
      return {
        screenName: null,
        uid: value
      };
    }

    return {
      screenName: value,
      uid: null
    };
  } catch {
    return null;
  }
}

function looksLikeMisskey() {
  const misskeyAccent = getComputedStyle(document.documentElement)
    .getPropertyValue('--MI_THEME-accent')
    .trim();

  if (!misskeyAccent) {
    return false;
  }

  return Boolean(document.querySelector('div[tabindex="0"] a[href] time'));
}

function findMisskeyPostElement(target) {
  let el = target instanceof Element ? target : target?.parentElement;
  while (el) {
    if (isMisskeyNoteElement(el)) {
      return el;
    }

    el = el.parentElement;
  }

  return null;
}

function isMisskeyNoteElement(element) {
  return element instanceof HTMLElement
    && element.matches('div[tabindex="0"]')
    && Boolean(getMisskeyPrimaryArticle(element))
    && Boolean(getMisskeyPermalink(element));
}

function getMisskeyPrimaryArticle(post) {
  if (!(post instanceof Element)) {
    return null;
  }

  return post.querySelector('article');
}

function getMisskeyCaptureRect(post) {
  const rootRect = normalizeRect(post.getBoundingClientRect());
  const article = getMisskeyPrimaryArticle(post);
  if (!article) {
    return rootRect;
  }

  const articleRect = normalizeRect(article.getBoundingClientRect());
  return {
    x: rootRect.x,
    y: rootRect.y,
    top: rootRect.top,
    left: rootRect.left,
    width: rootRect.width,
    height: Math.max(articleRect.bottom - rootRect.top, articleRect.height),
    right: rootRect.right,
    bottom: Math.max(articleRect.bottom, rootRect.top + articleRect.height)
  };
}

function getMisskeyPermalink(post) {
  const timeLink = getMisskeyTimeLink(post);
  if (timeLink) {
    return timeLink.url;
  }

  const links = post instanceof Element
    ? Array.from(post.querySelectorAll('a[href]'))
    : [];

  for (const link of links) {
    const parsed = parseMisskeyNoteLink(link.href);
    if (parsed) {
      return parsed.url;
    }
  }

  const currentPageNote = parseMisskeyNoteLink(location.href);
  return currentPageNote?.url || '';
}

function getMisskeyTimeLink(post) {
  if (!(post instanceof Element)) {
    return null;
  }

  const links = Array.from(post.querySelectorAll('a[href]'));
  for (const link of links) {
    if (!link.querySelector('time')) {
      continue;
    }

    const parsed = parseMisskeyNoteLink(link.href);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function getMisskeyPostPublishedAt(post) {
  if (!(post instanceof Element)) {
    return null;
  }

  const article = getMisskeyPrimaryArticle(post);
  if (!article) {
    return getPostPublishedAt(post);
  }

  const container = getMisskeyContentContainer(article);
  const timeElement = container.querySelector('time[datetime], time');
  const rawValue = timeElement?.getAttribute('datetime')
    || timeElement?.getAttribute('title')
    || '';
  if (!rawValue) {
    return getPostPublishedAt(post);
  }

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getMisskeyPostText(post) {
  if (!(post instanceof Element)) {
    return null;
  }

  const article = getMisskeyPrimaryArticle(post);
  if (!article) {
    return null;
  }

  const mfm = article.querySelector('.mfm');
  if (mfm) {
    return mfm.textContent?.trim() || null;
  }

  const container = getMisskeyContentContainer(article);
  const header = container.querySelector('header');
  const footer = container.querySelector('footer');
  for (const child of container.children) {
    if (child === header || child === footer || child.querySelector('header')) continue;
    if (child.classList.contains('xlT1y')) continue;
    const text = child.textContent?.trim();
    if (text) return text;
  }

  return null;
}

function getMisskeyContentContainer(article) {
  for (const child of article.children) {
    if (child.tagName === 'DIV' && child.querySelector('header')) {
      return child;
    }
  }

  return article;
}

function getMisskeyDisplayName(post) {
  if (!(post instanceof Element)) {
    return null;
  }

  const article = getMisskeyPrimaryArticle(post);
  if (!article) {
    return null;
  }

  const container = getMisskeyContentContainer(article);
  const header = container.querySelector('header');
  const searchRoot = header || container;

  const profileLinks = searchRoot.querySelectorAll('a[href^="/@"]');
  for (const link of profileLinks) {
    const text = link.textContent?.trim();
    if (text && !text.startsWith('@')) {
      return text;
    }
  }

  return null;
}

function getMisskeyAuthorProfile(post) {
  if (!(post instanceof Element)) {
    return null;
  }

  const article = getMisskeyPrimaryArticle(post);
  if (!article) {
    return null;
  }

  const container = getMisskeyContentContainer(article);
  const header = container.querySelector('header');
  const searchRoot = header || container;

  const links = Array.from(searchRoot.querySelectorAll('a[href]'));
  for (const link of links) {
    const parsed = parseMisskeyProfileLink(link.href);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function parseMisskeyNoteLink(href) {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(/^\/notes\/([^/?#]+)\/?$/);
    if (!match) {
      return null;
    }

    return {
      id: decodeURIComponent(match[1]),
      url: url.href
    };
  } catch {
    return null;
  }
}

function parseMisskeyProfileLink(href) {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(/^\/@([^/?#]+)\/?$/);
    if (!match) {
      return null;
    }

    return {
      screenName: decodeURIComponent(match[1]),
      url: url.href
    };
  } catch {
    return null;
  }
}

function normalizeRect(rect) {
  const x = rect?.x ?? rect?.left ?? 0;
  const y = rect?.y ?? rect?.top ?? 0;
  const width = rect?.width ?? ((rect?.right ?? x) - (rect?.left ?? x));
  const height = rect?.height ?? ((rect?.bottom ?? y) - (rect?.top ?? y));

  return {
    x,
    y,
    top: rect?.top ?? y,
    left: rect?.left ?? x,
    width,
    height,
    right: rect?.right ?? (x + width),
    bottom: rect?.bottom ?? (y + height)
  };
}

function prepareScopedCaptureState(className, elements) {
  const captureTargets = [...new Set(elements.filter(Boolean))];

  captureTargets.forEach((element) => {
    element.classList.add(className);
  });

  return () => {
    captureTargets.forEach((element) => {
      element.classList.remove(className);
    });
  };
}
