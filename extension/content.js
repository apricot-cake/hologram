(async () => {
  // --- i18n ---
  // i18n.js is injected alongside this script (see background.js → executeScript).
  const { getMessage } = await window.corpusI18n;
  const MSG = {
    select: getMessage('bannerSelect'),
    saving: getMessage('bannerSaving'),
    saved: getMessage('bannerSaved'),
    savedNoMeta: getMessage('bannerSavedNoMeta'),
    failed: getMessage('bannerFailed'),
  };

  const siteConfig = getSiteConfig();
  if (!siteConfig) {
    return;
  }

  // Prevent double injection
  if (typeof window.__snsPostSaveCleanup === 'function') {
    window.__snsPostSaveCleanup();
    return;
  }
  window.__snsPostSaveActive = true;

  let isCleanedUp = false;
  let restoreCaptureState = null;
  let savedScrollPosition = null;
  let lastCapturedPost = null; // re-measured at crop time (scroll/layout drift)

  // === UI elements ===

  // Top banner
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

  // Highlight frame
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

  // === Post detection ===

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

  // === Diagnostic logging ===

  // A small, PII-light snapshot of the clicked element so a broken selector can
  // be diagnosed from capture.log without a repro. outerHTML is truncated (the
  // tag / data-testid / nearest anchor href is what identifies a selector break).
  function snapEl(el) {
    if (!(el instanceof Element)) return null;
    const anchor = el.closest('a[href]') || (el.querySelector ? el.querySelector('a[href]') : null);
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : null,
      testid: el.getAttribute ? el.getAttribute('data-testid') : null,
      role: el.getAttribute ? el.getAttribute('role') : null,
      closestAnchorHref: anchor ? anchor.getAttribute('href') : null,
      outerHTML: (el.outerHTML || '').slice(0, 400),
    };
  }

  // Report a pre-bridge failure (no post element / no permalink) to the
  // background, which relays it to the host's capture.log. Best-effort.
  function logCaptureFailure(stage, el) {
    try {
      chrome.runtime.sendMessage({
        type: 'logCapture',
        entry: { stage, phase: 'fail', platform: siteConfig.platform, locationHref: location.href, clickedSnap: snapEl(el) },
      });
    } catch {
      /* ignore — diagnostics are non-essential */
    }
  }

  // === Event handlers ===

  function onMouseMove(e) {
    const post = findPostElement(e.target);
    if (post) {
      const rect = getPostRect(post);
      highlight.style.display = 'block';
      highlight.style.top = rect.top + window.scrollY - 4 + 'px';
      highlight.style.left = rect.left + window.scrollX - 4 + 'px';
      highlight.style.width = rect.width + 8 + 'px';
      highlight.style.height = rect.height + 8 + 'px';
    } else {
      highlight.style.display = 'none';
    }
  }

  function capturePost(post) {
    // Metadata is fetched from the platform API in the background from this URL.
    // The page is only used to identify the clicked post and its permalink.
    const postUrl = siteConfig.getPermalink(post);

    // Without a permalink the API metadata can't be fetched either — the save
    // would produce a platform:null record the viewer never shows. Abort here,
    // surface the reason on the banner, and log the grabbed element so the
    // cause can be pinned down quickly.
    if (!postUrl) {
      logCaptureFailure('permalink', post);
      banner.textContent = getMessage('bannerFailedReason', [getMessage('reasonNoPermalink')]);
      banner.style.background = '#f4212e';
      setTimeout(cleanup, 2800);
      return;
    }

    // Remove event listeners (capture is single-shot)
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('contextmenu', onContextMenu, true);

    // Hide the highlight and banner before capturing
    highlight.style.display = 'none';
    banner.style.display = 'none';
    restoreCaptureState = siteConfig.prepareForCapture?.(post) || null;

    // If the post is cut off, scroll it fully into the viewport
    const preRect = getPostRect(post);
    if (preRect.top < 0 || preRect.bottom > window.innerHeight) {
      savedScrollPosition = { x: window.scrollX, y: window.scrollY };
      post.scrollIntoView({ block: 'start', behavior: 'instant' });
      // X/Bluesky overlay a sticky header (~50px) at the top of the column —
      // block:'start' would pin the author row underneath it.
      window.scrollBy(0, -64);
    }

    // Wait for a repaint before capturing
    lastCapturedPost = post;
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
        });
      });
    });
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const post = findPostElement(e.target);
    if (!post) {
      // Keep waiting (retry-friendly — a stray click shouldn't end the session),
      // but record what was clicked so a broken postSelector is diagnosable from
      // capture.log without a repro.
      logCaptureFailure('select', e.target);
      return;
    }
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

  // === Cleanup ===

  // Restore the scroll position (idempotent: runs once whichever path gets here
  // first — success, failure, or cancel — and a second call is a no-op).
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

  // === Message listener ===

  function onRuntimeMessage(msg, _sender, sendResponse) {
    // Crop request
    if (msg.type === 'cropImage') {
      const { dataUrl } = msg;
      const dpr = window.devicePixelRatio || 1;

      // Re-measure the post NOW (the screenshot was taken moments ago, not at
      // click time — inertial scroll / lazy-image relayout can shift it), then
      // clamp to the viewport: captureVisibleTab only has visible pixels, and
      // an overflowing rect would encode the missing area as black bands.
      let rect = msg.rect;
      if (lastCapturedPost && lastCapturedPost.isConnected) {
        try {
          rect = getPostRect(lastCapturedPost);
        } catch {
          rect = msg.rect;
        }
      }
      const cx = Math.max(0, rect.x);
      const cy = Math.max(0, rect.y);
      const cw = Math.max(1, Math.min(rect.x + rect.width, window.innerWidth) - cx);
      const ch = Math.max(1, Math.min(rect.y + rect.height, window.innerHeight) - cy);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const w = Math.round(cw * dpr);
        const h = Math.round(ch * dpr);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, Math.round(cx * dpr), Math.round(cy * dpr), w, h, 0, 0, w, h);
        sendResponse({ croppedDataUrl: canvas.toDataURL('image/jpeg', 0.92) });
        restoreScroll();
      };
      img.onerror = () => {
        restoreScroll();
        sendResponse(null);
      };
      img.src = dataUrl;
      return true; // async response
    }

    // Result notification
    if (msg.type === 'notify') {
      // Saved but the post-info API returned nothing → amber "partial" state so
      // the user notices (rather than a plain green success). Held longer.
      const partial = msg.success && msg.metaOk === false;
      if (!msg.success) {
        // Show WHY it failed (the background passes the stage error), so a broken
        // save is actionable instead of a bare "failed". A missing native host gets
        // a specific "restart Chrome" hint (the registry is read at startup).
        banner.textContent = msg.hostMissing ? getMessage('bannerHostMissing') : msg.error ? getMessage('bannerFailedReason', [msg.error]) : MSG.failed;
      } else {
        // grouped > 0: this post was already saved this session — the app folds
        // same-post saves into one stacked card, so say so instead of a plain
        // success (otherwise the save looks like a silent no-op in the grid).
        banner.textContent = partial ? MSG.savedNoMeta : msg.grouped > 0 ? getMessage('bannerSavedGrouped', [msg.grouped + 1]) : MSG.saved;
      }
      banner.style.background = partial ? '#f59e0b' : msg.success ? '#00ba7c' : '#f4212e';
      // Hold failures (and partials) longer so the reason is readable.
      setTimeout(cleanup, partial || !msg.success ? 2800 : 1500);
    }
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // === Listener registration ===
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
        return prepareScopedCaptureState('__snsCaptureXNoHover', [post, post.parentElement, post.closest('[data-testid="cellInnerDiv"]')]);
      },
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
        return prepareScopedCaptureState('__snsCaptureBskyNoHover', [post, post.parentElement, post.parentElement?.parentElement, post.closest('[data-testid^="feedItem-by-"]')?.parentElement, post.closest('[data-testid^="postThreadItem-by-"]')?.parentElement]);
      },
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
        return prepareScopedCaptureState('__snsCaptureMisskeyNoHover', [post, getMisskeyPrimaryArticle(post)]);
      },
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
        return getMastodonStatusLink(post)?.url || parseMastodonStatusLink(location.href)?.url || '';
      },
      prepareForCapture(post) {
        return prepareScopedCaptureState('__snsCaptureMastodonNoHover', [post, post.parentElement]);
      },
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
      },
    };
  }

  return null;
}

// === pixiv helpers ===

function pixivIdFromImg(img) {
  if (!(img instanceof Element)) return null;
  // pximg URL filename embeds the artwork id: <id>_p<N>_<size>.<ext>.
  // Declared INSIDE the function (not as a top-level `const`) on purpose: this
  // content script is re-injected on every Alt+S, and a top-level lexical
  // binding would trip an "already declared" SyntaxError during script
  // instantiation — before the runtime re-injection guard can run.
  const PXIMG_FILENAME = /\/(\d+)_p\d+(?:_|\.)/;
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
// than the clicked one. (This is the wrong-neighbor bug; anchoring at the
// target with closest() avoids it by construction.)
// Priority: the target's own pximg image (unambiguous) → nearest enclosing
// /artworks/ link → the nearest <figure>'s main image → the /artworks/ URL bar.
function resolvePixivTarget(target) {
  const el = target instanceof Element ? target : target?.parentElement;
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
  if (locId) {
    // Anchor the fallback to the artwork itself, not the raw click target —
    // otherwise clicking a commenter avatar / tag pill saved THAT element's
    // pixels under the artwork's metadata. (audit 2026-06-11)
    const mainImg = document.querySelector('main figure img, figure img[src*="i.pximg.net"]');
    return { id: locId, el: fig || (mainImg ? mainImg.closest('figure') || mainImg : el) };
  }
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
  const links = post instanceof Element ? Array.from(post.querySelectorAll('a[href*="/status/"]')) : [];

  // Prefer the timestamp anchor; failing that, a bare /user/status/<id> anchor
  // — the article's first /status/ link can be a /photo/N or /analytics one.
  const preferredLink =
    links.find((link) => link.querySelector('time')) ||
    links.find((link) => {
      try {
        return /^\/[^/]+\/status\/\d+\/?$/.test(new URL(link.href, location.origin).pathname);
      } catch {
        return false;
      }
    }) ||
    links[0];
  return preferredLink ? parseXPostLink(preferredLink.href) : null;
}

function parseXPostLink(href) {
  try {
    const url = new URL(href, location.origin);
    let match = url.pathname.match(/^\/([^/]+)\/status\/([^/?#]+)/);
    if (match) {
      return {
        // Canonical permalink: strip /photo/N, /analytics, query and hash —
        // the raw href is whatever anchor happened to be picked.
        url: `${url.origin}/${match[1]}/status/${match[2]}`,
        screenName: decodeURIComponent(match[1]),
        postId: decodeURIComponent(match[2]),
      };
    }

    match = url.pathname.match(/^\/i\/web\/status\/([^/?#]+)/);
    if (!match) {
      return null;
    }

    return {
      url: `${url.origin}/i/web/status/${match[1]}`,
      screenName: null,
      postId: decodeURIComponent(match[1]),
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
  // Exclude anchors that belong to an embedded quote card (a nested
  // [role="link"]) or to rich-text links in the post body — on a thread's
  // anchor post (which has NO self-permalink anchor) those were the only
  // candidates left and the QUOTED post's URL got saved. With them excluded,
  // returning null lets getPermalink fall back to location.href, which on a
  // detail page IS the clicked post. (audit 2026-06-11)
  const links =
    post instanceof Element
      ? Array.from(post.querySelectorAll('a[href]'))
          .filter((link) => {
            // Start from the parent: the anchor itself may carry role="link"
            // (react-native-web) and closest() would match it, excluding everything.
            const roleLink = link.parentElement && link.parentElement.closest('[role="link"]');
            if (roleLink && roleLink !== post && post.contains(roleLink)) return false;
            if (link.closest('[data-testid="postText"]')) return false;
            return true;
          })
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
      postId: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

function looksLikeMisskey() {
  const misskeyAccent = getComputedStyle(document.documentElement).getPropertyValue('--MI_THEME-accent').trim();

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
  return element instanceof HTMLElement && element.matches('div[tabindex="0"]') && Boolean(getMisskeyPrimaryArticle(element)) && Boolean(getMisskeyPermalink(element));
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
    bottom: Math.max(articleRect.bottom, rootRect.top + articleRect.height),
  };
}

function getMisskeyPermalink(post) {
  // Scope the link scan to the note's own <article>: the reply-parent preview
  // (MkNoteSub) and a detail page's ancestor chain render BEFORE the article,
  // so a document-order scan over the whole root returned the PARENT note's
  // permalink for any reply. (audit 2026-06-11)
  const scope = getMisskeyPrimaryArticle(post) || post;

  const timeLink = getMisskeyTimeLink(scope);
  if (timeLink) {
    return timeLink.url;
  }

  const links = scope instanceof Element ? Array.from(scope.querySelectorAll('a[href]')) : [];

  for (const link of links) {
    const parsed = parseMisskeyNoteLink(link.href);
    if (parsed) {
      return parsed.url;
    }
  }

  const currentPageNote = parseMisskeyNoteLink(location.href);
  return currentPageNote?.url || '';
}

function getMisskeyTimeLink(scope) {
  if (!(scope instanceof Element)) {
    return null;
  }

  const links = Array.from(scope.querySelectorAll('a[href]'));
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
      url: url.href,
    };
  } catch {
    return null;
  }
}

function normalizeRect(rect) {
  const x = rect?.x ?? rect?.left ?? 0;
  const y = rect?.y ?? rect?.top ?? 0;
  const width = rect?.width ?? (rect?.right ?? x) - (rect?.left ?? x);
  const height = rect?.height ?? (rect?.bottom ?? y) - (rect?.top ?? y);

  return {
    x,
    y,
    top: rect?.top ?? y,
    left: rect?.left ?? x,
    width,
    height,
    right: rect?.right ?? x + width,
    bottom: rect?.bottom ?? y + height,
  };
}

function looksLikeMastodon() {
  return Boolean(document.querySelector('#mastodon')) || document.querySelector('meta[name="application-name"]')?.getAttribute('content') === 'Mastodon';
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
    // Never take a link that belongs to an embedded quote preview (4.4+):
    // that's the QUOTED post's URL, not this status's.
    if (link.closest('.status__quote')) continue;
    parsed = parseMastodonStatusLink(link.getAttribute('href') || '');
    if (parsed) return parsed;
  }
  return null;
}

function findMastodonPostElement(target) {
  let el = target instanceof Element ? target : target?.parentElement;
  while (el) {
    // Skip status elements nested inside a quote preview (Mastodon 4.4+ quotes
    // render a full StatusContainer inside .status__quote) — keep walking so a
    // click inside the preview selects the QUOTING post, like X/Bluesky/Misskey.
    if (el.matches?.('.status__wrapper, .status, .detailed-status, article') && !el.closest('.status__quote') && getMastodonStatusLink(el)) {
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
