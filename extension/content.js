(async () => {
  // --- i18n ---
  // i18n.js is injected alongside this script (see background.js → executeScript).
  const { getMessage } = await window.corpusI18n;
  const MSG = {
    select: getMessage('bannerSelect'),
    saving: getMessage('bannerSaving'),
    saved: getMessage('bannerSaved'),
    savedNoMeta: getMessage('bannerSavedNoMeta'),
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
    // Metadata is fetched from the platform API in the background from this URL.
    // The page is only used to identify the clicked post and its permalink.
    const postUrl = siteConfig.getPermalink(post);

    // パーマリンクが取れないとAPIメタデータも取れず、保存しても platform:null の
    // レコードになりビューアに表示されない。ここで中止する。
    if (!postUrl) {
      banner.textContent = MSG.failed;
      banner.style.background = '#f4212e';
      setTimeout(cleanup, 1500);
      return;
    }

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
          platform: siteConfig.platform
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
    cleanup();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') cleanup();
  }

  // === クリーンアップ ===

  // スクロール位置を復元（idempotent: 成功・失敗・キャンセルのどの経路からでも
  // 1回だけ実行され、二重呼び出しは no-op）。
  function restoreScroll() {
    if (savedScrollPosition) {
      window.scrollTo({ left: savedScrollPosition.x, top: savedScrollPosition.y, behavior: 'instant' });
      savedScrollPosition = null;
    }
  }

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
    restoreScroll();
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
        restoreScroll();
      };
      img.onerror = () => { restoreScroll(); sendResponse(null); };
      img.src = dataUrl;
      return true; // 非同期レスポンス
    }


    // 結果通知
    if (msg.type === 'notify') {
      // Saved but the post-info API returned nothing → amber "partial" state so
      // the user notices (rather than a plain green success). Held longer.
      const partial = msg.success && msg.metaOk === false;
      banner.textContent = partial ? MSG.savedNoMeta : (msg.success ? MSG.saved : MSG.failed);
      banner.style.background = partial ? '#f59e0b' : (msg.success ? '#00ba7c' : '#f4212e');
      setTimeout(cleanup, partial ? 2800 : 1500);
    }
  }


  chrome.runtime.onMessage.addListener(onRuntimeMessage);

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
        // Fall back to the URL bar on a single-status page (parity with Bluesky/
        // Mastodon/Misskey), so an article whose own permalink anchor isn't
        // rendered still yields a usable URL.
        return getXPostLink(post)?.url || parseXPostLink(location.href)?.url || '';
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

  if (looksLikeMastodon()) {
    return {
      platform: 'mastodon',
      captureStyleText: `
        .__snsCaptureMastodonNoHover,
        .__snsCaptureMastodonNoHover * {
          pointer-events: none !important;
          transition: none !important;
        }

        .__snsCaptureMastodonNoHover,
        .__snsCaptureMastodonNoHover:hover,
        .__snsCaptureMastodonNoHover .status,
        .__snsCaptureMastodonNoHover .status:hover {
          background-color: transparent !important;
        }
      `,
      findPostElement(target) {
        return findMastodonPostElement(target);
      },
      getPermalink(post) {
        return getMastodonStatusLink(post)?.url
          || parseMastodonStatusLink(location.href)?.url
          || '';
      },
      prepareForCapture(post) {
        return prepareScopedCaptureState('__snsCaptureMastodonNoHover', [post, post.parentElement]);
      }
    };
  }

  if (hostnameMatches('pixiv.net')) {
    return {
      platform: 'pixiv',
      captureStyleText: `
        .__snsCapturePixivNoHover,
        .__snsCapturePixivNoHover * {
          pointer-events: none !important;
          transition: none !important;
        }
      `,
      findPostElement(target) {
        return findPixivPostElement(target);
      },
      getPermalink(post) {
        return getPixivPermalink(post);
      },
      getCaptureRect(post) {
        return getPixivCaptureRect(post);
      },
      prepareForCapture(post) {
        return prepareScopedCaptureState('__snsCapturePixivNoHover', [post, post.parentElement]);
      }
    };
  }

  return null;
}

// === pixiv helpers ===
// pximg URL filename embeds the artwork id: <id>_p<N>_<size>.<ext>.
const PXIMG_FILENAME = /\/(\d+)_p\d+(?:_|\.)/;

function pixivIdFromImg(img) {
  if (!(img instanceof Element)) return null;
  for (const src of [img.src, img.currentSrc]) {
    const m = src && src.match(PXIMG_FILENAME);
    if (m) return m[1];
  }
  return null;
}

function pixivIdFromArtworkLink(link) {
  if (!(link instanceof Element)) return null;
  const m = (link.getAttribute('href') || '').match(/\/artworks\/(\d+)/);
  return m ? m[1] : null;
}

// Resolve { id, el } anchored at the click/hover TARGET, walking UP via closest()
// — never scanning a wide scope's descendants by document order, which on a
// multi-artwork grid would pick a neighbor (the first pximg in DOM order) rather
// than the clicked one. (This is the wrong-neighbor bug eagle-info-plus fixed with
// treeDistance; anchoring at the target with closest() avoids it by construction.)
// Priority: the target's own pximg image (unambiguous) → nearest enclosing
// /artworks/ link → the nearest <figure>'s main image → the /artworks/ URL bar.
function resolvePixivTarget(target) {
  let el = target instanceof Element ? target : target?.parentElement;
  if (!el) return null;

  const img = el.matches('img') ? el : el.closest('img');
  const idFromImg = pixivIdFromImg(img);
  if (idFromImg) return { id: idFromImg, el: img };

  const link = el.closest('a[href*="/artworks/"]');
  const idFromLink = pixivIdFromArtworkLink(link);
  if (idFromLink) return { id: idFromLink, el: link };

  const fig = el.closest('figure');
  if (fig) {
    const figImg = fig.querySelector('img');
    const idFromFig = pixivIdFromImg(figImg);
    if (idFromFig) return { id: idFromFig, el: figImg || fig };
  }

  const locId = (location.pathname.match(/\/artworks\/(\d+)/) || [])[1];
  if (locId) return { id: locId, el: fig || el };
  return null;
}

function findPixivPostElement(target) {
  return resolvePixivTarget(target)?.el || null;
}

// post is the element findPixivPostElement returned; re-resolving from it yields
// the same id (consistent with what was highlighted/clicked).
function getPixivPermalink(post) {
  const r = resolvePixivTarget(post);
  return r ? `https://www.pixiv.net/artworks/${r.id}` : '';
}

// Capture the artwork image itself, not an oversized enclosing <figure>.
function getPixivCaptureRect(post) {
  let img = null;
  if (post && post.matches && post.matches('img')) img = post;
  else if (post && post.querySelector) img = post.querySelector('img');
  return normalizeRect((img || post).getBoundingClientRect());
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

function hostnameMatches(host) {
  return location.hostname === host || location.hostname.endsWith(`.${host}`);
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

function looksLikeMastodon() {
  return Boolean(document.querySelector('#mastodon'))
    || document.querySelector('meta[name="application-name"]')?.getAttribute('content') === 'Mastodon';
}

function parseMastodonStatusLink(href) {
  try {
    const url = new URL(href, location.origin);
    if (url.hostname !== location.hostname) return null; // only this instance's statuses
    const match = url.pathname.match(/^\/@[^/]+\/(\d[\w-]*)\/?$/);
    if (!match) return null;
    return { id: decodeURIComponent(match[1]), url: `${url.origin}${url.pathname}` };
  } catch {
    return null;
  }
}

function getMastodonStatusLink(post) {
  if (!(post instanceof Element)) return null;
  const timeLink = post.querySelector('a[class*="relative-time"], a[class*="detailed-status__datetime"]');
  let parsed = timeLink ? parseMastodonStatusLink(timeLink.getAttribute('href') || '') : null;
  if (parsed) return parsed;
  for (const link of post.querySelectorAll('a[href]')) {
    parsed = parseMastodonStatusLink(link.getAttribute('href') || '');
    if (parsed) return parsed;
  }
  return null;
}

function findMastodonPostElement(target) {
  let el = target instanceof Element ? target : target?.parentElement;
  while (el) {
    if (el.matches?.('.status__wrapper, .status, .detailed-status, article') && getMastodonStatusLink(el)) {
      return el;
    }
    el = el.parentElement;
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
