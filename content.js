(async () => {
  // --- i18n ---
  // i18n.js is injected alongside this script (see background.js → executeScript).
  const { getMessage } = await window.postSnapI18n;
  const MSG = {
    select: getMessage('bannerSelect'),
    saving: getMessage('bannerSaving'),
    saved: getMessage('bannerSaved'),
    failed: getMessage('bannerFailed')
  };

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
  banner.textContent = MSG.select;
  document.body.appendChild(banner);

  // ハイライト枠
  const highlight = document.createElement('div');
  highlight.style.cssText = `
    position: absolute; pointer-events: none; z-index: 2147483646;
    box-sizing: border-box;
    border: 3px solid #1d9bf0; border-radius: 4px;
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

  function capturePost(post) {
    // page-context.js (MAIN world) に userId 抽出を強制実行させる
    document.dispatchEvent(new CustomEvent('__postSnap_extractUserIds'));

    const postUrl = siteConfig.getPermalink(post);
    const postDetails = siteConfig.getPostDetails?.(post, postUrl) || {};

    // イベントリスナー除去（クリックは1回だけ）
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('contextmenu', onContextMenu, true);

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
        banner.textContent = MSG.saving;
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

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const post = findPostElement(e.target);
    if (!post) return;
    capturePost(post);
  }

  function onContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    chrome.runtime.sendMessage({ type: 'openOptions' });
    cleanup();
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
    document.removeEventListener('contextmenu', onContextMenu, true);
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
      banner.textContent = msg.success ? MSG.saved : MSG.failed;
      banner.style.background = msg.success ? '#00ba7c' : '#f4212e';
      setTimeout(cleanup, 1500);
    }
  }


  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // === ビルドハッシュをDOMに埋め込む（リロードチェック用） ===
  chrome.runtime.sendMessage({ type: 'getBuildHash' }, (res) => {
    if (res?.hash) document.documentElement.dataset.postSnapBuild = res.hash;
  });

  // === リスナー登録 ===
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('contextmenu', onContextMenu, true);
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
        const isRetweet = !!post.querySelector('[data-testid="socialContext"]');
        return {
          postId: parsed?.postId || null,
          screenName: parsed?.screenName || null,
          displayName: getXDisplayName(post),
          userId: getXUserId(post),
          postText: getXPostText(post),
          postPublishedAt: getPostPublishedAt(post),
          likeCount: getAriaCount(post, '[data-testid="like"], [data-testid="unlike"]'),
          repostCount: getAriaCount(post, '[data-testid="retweet"], [data-testid="unretweet"]'),
          replyCount: getAriaCount(post, '[data-testid="reply"]'),
          bookmarkCount: getAriaCount(post, '[data-testid="bookmark"], [data-testid="removeBookmark"]'),
          viewCount: getXViewCount(post),
          mediaType: getMediaType(post),
          lang: post.querySelector('[data-testid="tweetText"]')?.getAttribute('lang') || null,
          isReply: isXReply(post) && !isXThread(post, postUrl),
          isQuote: isXQuote(post),
          isThread: isXThread(post, postUrl),
          quotedUrl: getQuotedUrl(post, 'x')
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
          userId: profile.uid,
          postText: getBlueskyPostText(post),
          postPublishedAt: getPostPublishedAt(post),
          likeCount: getAriaCount(post, '[data-testid="likeBtn"]') ?? getAdjacentCount(post, '[data-testid="likeBtn"]'),
          repostCount: getAriaCount(post, '[data-testid="repostBtn"]') ?? getAdjacentCount(post, '[data-testid="repostBtn"]'),
          replyCount: getAriaCount(post, '[data-testid="replyBtn"]'),
          bookmarkCount: null,
          mediaType: getMediaType(post),
          lang: post.querySelector('[data-testid="postText"]')?.getAttribute('lang')
            || post.querySelector('div[dir="auto"][lang]')?.getAttribute('lang') || null,
          isReply: !!post.querySelector('[data-testid="replyLine"]'),
          isQuote: !!post.querySelector('[data-testid="quotePost"]'),
          isThread: false,
          quotedUrl: getQuotedUrl(post, 'bluesky')
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
          postText: getMisskeyPostText(post),
          postPublishedAt: getMisskeyPostPublishedAt(post),
          likeCount: null,
          repostCount: null,
          replyCount: null,
          bookmarkCount: null,
          mediaType: getMediaType(post),
          isReply: !!getMisskeyPrimaryArticle(post)?.querySelector('a[href*="/notes/"] + span'),
          isQuote: isMisskeyQuote(post),
          isThread: false,
          quotedUrl: getQuotedUrl(post, 'misskey')
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
    // Bluesky: date may appear as text "YYYY/MM/DD HH:MM" in div[dir="auto"]
    for (const el of post.querySelectorAll('div[dir="auto"]')) {
      const m = el.textContent?.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
      if (m) {
        const parsed = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
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

function getXViewCount(post) {
  if (!(post instanceof Element)) return null;
  const analyticsLink = post.querySelector('a[href*="/analytics"]');
  if (analyticsLink) {
    const label = analyticsLink.getAttribute('aria-label') || '';
    const match = label.match(/(\d[\d,]*)/);
    if (match) return parseInt(match[1].replace(/,/g, ''), 10);
  }
  return null;
}

function getXUserId(post) {
  // Check article directly
  const uid = post.getAttribute('__x-user-id');
  if (uid && /^\d+$/.test(uid)) {
    return uid;
  }

  // Follow/unfollow button testid contains userId
  const followBtn = post.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]');
  if (followBtn) {
    const match = followBtn.getAttribute('data-testid').match(/^(\d+)-/);
    if (match) return match[1];
  }

  // Fallback: scan all articles for matching screenName
  const screenName = getXPostLink(post)?.screenName || parseXPostLink(location.href)?.screenName;
  const articlesWithUid = document.querySelectorAll('article[data-testid="tweet"][__x-user-id]');
  if (screenName) {
    for (const article of articlesWithUid) {
      const link = article.querySelector(`a[href*="/${screenName}" i]`);
      if (link) return article.getAttribute('__x-user-id');
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

  // Bluesky removed data-testid="postText". Find text from div[dir="auto"] candidates.
  const skipPatterns = /^(@[\w.-]+|フォロー|Follow|誰でも返信可能|Thread reply|返信$|\d{4}\/\d{2}\/\d{2}|\d+ (リポスト|いいね|保存|repost|like|bookmark))/i;
  const candidates = post.querySelectorAll('div[dir="auto"]');
  let best = null;
  for (const el of candidates) {
    const text = el.textContent?.trim();
    if (!text) continue;
    // Skip UI elements: buttons, links with testid, very short generic text
    if (el.closest('button, [data-testid="followBtn"]')) continue;
    if (el.parentElement?.tagName === 'BUTTON') continue;
    if (el.parentElement?.tagName === 'A') continue;
    if (skipPatterns.test(text)) continue;
    if (!best || text.length > best.length) {
      best = text;
    }
  }
  return best || null;
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

function getAriaCount(post, selector) {
  if (!(post instanceof Element)) return null;
  const el = post.querySelector(selector);
  if (!el) return null;
  const label = el.getAttribute('aria-label') || '';
  const match = label.match(/(\d[\d,]*)/);
  if (match) return parseInt(match[1].replace(/,/g, ''), 10);
  const text = el.textContent?.trim();
  const textMatch = text?.match(/^(\d[\d,]*)$/);
  if (textMatch) return parseInt(textMatch[1].replace(/,/g, ''), 10);
  return null;
}

function getAdjacentCount(post, selector) {
  if (!(post instanceof Element)) return null;
  const el = post.querySelector(selector);
  if (!el) return null;
  const parent = el.closest('[role="button"]') || el.parentElement;
  if (!parent) return null;
  const text = parent.textContent?.trim();
  const match = text?.match(/(\d[\d,]*)/);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
}

function isXReply(post) {
  if (!(post instanceof Element)) return false;
  // Timeline: "返信先" / "Replying to" text in article
  const text = post.innerText || '';
  if (/^返信先[:：\s]|^Replying to\s/m.test(text)) return true;
  // Individual post page: focused post has full date format, parent articles above it
  if (/\d{1,2}:\d{2}\s*·\s*\d{4}年|\d{1,2}:\d{2}\s[AP]M\s*·\s*[A-Z][a-z]{2}\s/.test(text)) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const idx = [...articles].indexOf(post);
    if (idx > 0) return true;
  }
  return false;
}

function isXQuote(post) {
  if (!(post instanceof Element)) return false;
  const cards = post.querySelectorAll('[role="link"]');
  for (const card of cards) {
    if (card.closest('[data-testid="User-Name"]')) continue;
    if (card.querySelector('[data-testid="tweetText"]') || card.querySelector('[data-testid="like"]')) {
      return true;
    }
  }
  return false;
}

function isXThread(post, postUrl) {
  if (!isXReply(post)) return false;
  const parsed = parseXPostLink(postUrl) || getXPostLink(post);
  if (!parsed?.screenName) return false;
  // Timeline: "返信先 @handle" text match
  const text = post.innerText || '';
  const replyMatch = text.match(/^(?:返信先[:：\s]*|Replying to\s+)@(\S+)/m);
  if (replyMatch) return replyMatch[1].toLowerCase() === parsed.screenName.toLowerCase();
  // Individual post page: compare with parent article's screenName
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  const idx = [...articles].indexOf(post);
  if (idx > 0) {
    const parentArticle = articles[idx - 1];
    const parentLink = parentArticle?.querySelector('a[href*="/status/"]');
    const parentParsed = parentLink ? parseXPostLink(parentLink.href) : null;
    if (parentParsed?.screenName) {
      return parentParsed.screenName.toLowerCase() === parsed.screenName.toLowerCase();
    }
  }
  return false;
}

function isMisskeyQuote(post) {
  const article = getMisskeyPrimaryArticle(post);
  if (!article) return false;
  const nestedNotes = article.querySelectorAll('a[href*="/notes/"]');
  const mainLink = getMisskeyTimeLink(post);
  for (const link of nestedNotes) {
    if (link.querySelector('time')) continue;
    const parsed = parseMisskeyNoteLink(link.href);
    if (parsed && mainLink && parsed.id !== mainLink.id) return true;
  }
  return false;
}

function getMediaType(post) {
  if (!(post instanceof Element)) return 'none';
  if (post.querySelector('video, [data-testid="videoPlayer"], [data-testid="videoComponent"]')) return 'video';
  if (post.querySelector('[data-testid="tweetPhoto"], [data-testid="postMedia"] img, img[src*="feed_thumbnail"], .xvRSv img, article img[src*="proxy"]')) return 'image';
  if (post.querySelector('img[src*="tenor.com"], img[src*="giphy.com"]')) return 'gif';
  // Generic fallback: any substantial image (not avatars/icons)
  const imgs = post.querySelectorAll('img[src]');
  for (const img of imgs) {
    const src = img.src || '';
    if (src.includes('profile_images') || src.includes('avatar') || src.includes('emoji')) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width > 100 && rect.height > 100) return 'image';
  }
  return 'none';
}

function getQuotedUrl(post, platform) {
  if (!(post instanceof Element)) return null;
  if (platform === 'x') {
    // X: quoted tweet appears as a card linking to another status
    const links = post.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      if (link.closest('[data-testid="User-Name"]')) continue;
      if (link.querySelector('time')) continue;
      const href = link.getAttribute('href') || '';
      // Skip analytics, quotes, likes, retweets pages
      if (/\/(analytics|quotes|likes|retweets|hidden)/.test(href)) continue;
      if (/\/status\/\d+$/.test(href)) {
        try { return new URL(href, location.origin).href; } catch { /* skip */ }
      }
    }
  }
  if (platform === 'bluesky') {
    // Bluesky: embedded quote has a link to another post
    const embeds = post.querySelectorAll('[data-testid="quotePost"] a[href*="/post/"], a[href*="/post/"]');
    for (const link of embeds) {
      const parsed = parseBlueskyPostLink(link.href);
      if (parsed) {
        const mainPostLink = parseBlueskyPostLink(post.querySelector('a[href*="/post/"]')?.href || '');
        if (mainPostLink && parsed.postId !== mainPostLink.postId) return parsed.url;
      }
    }
  }
  if (platform === 'misskey') {
    // Misskey: renote/quote has embedded note link
    const article = getMisskeyPrimaryArticle(post);
    if (!article) return null;
    const nestedNotes = article.querySelectorAll('a[href*="/notes/"]');
    const mainLink = getMisskeyTimeLink(post);
    for (const link of nestedNotes) {
      if (link.querySelector('time')) continue;
      const parsed = parseMisskeyNoteLink(link.href);
      if (parsed && mainLink && parsed.id !== mainLink.id) return parsed.url;
    }
  }
  return null;
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
