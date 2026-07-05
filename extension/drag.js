// Persistent content script (manifest content_scripts for x / bsky / pixiv).
// Drag-to-save: when the user starts dragging an image, a drop zone
// appears; the image is saved to Corpus ONLY if dropped into that zone. Dragging
// an image anywhere else (to disk, to reorder, etc.) does nothing — no accidental
// saves. On drop, the background fetches the post metadata and saves the dragged
// illustration itself (no screenshot) via the native host. Identity extraction is
// self-contained per platform (no external coupling).
(() => {
  const siteConfig = getDragSiteConfig();
  if (!siteConfig) return;
  if (window.__corpusDragActive) return; // avoid double-binding on re-injection
  window.__corpusDragActive = true;

  let pending = null; // {platform, postUrl, imageUrls} captured at dragstart
  let overlay = null;
  let savingViaDrop = false; // true between a drop-in-zone and its result, so dragend doesn't hide early

  // i18n: drag toasts share the banner strings. window.corpusI18n is set by the
  // i18n.js content script declared BEFORE this one in the same manifest entry
  // (same isolated world, runs first). Resolve once; until then t() echoes the
  // key — overlay text is only set at drag time, long after page load, so the
  // table is populated by the time it's read in practice.
  let t = (key) => key;
  if (window.corpusI18n && typeof window.corpusI18n.then === 'function') {
    window.corpusI18n.then((api) => {
      if (api && api.getMessage) t = api.getMessage;
    });
  }

  const BG_IDLE = 'rgba(29,155,240,0.96)';
  const BG_OVER = 'rgba(0,186,124,0.96)';
  const BG_BUSY = 'rgba(83,100,113,0.96)';
  const BG_FAIL = 'rgba(244,33,46,0.96)';
  const BG_PARTIAL = 'rgba(245,158,11,0.96)'; // saved, but post metadata was unavailable

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = '__corpusDropZone';
    overlay.style.cssText = [
      'position:fixed',
      'right:24px',
      'bottom:24px',
      'z-index:2147483647',
      'width:220px',
      'min-height:120px',
      'box-sizing:border-box',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'padding:20px',
      'border-radius:16px',
      'border:3px dashed rgba(255,255,255,0.75)',
      `background:${BG_IDLE}`,
      'color:#fff',
      'font:600 14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'text-align:center',
      'box-shadow:0 8px 28px rgba(0,0,0,0.35)',
      'pointer-events:auto',
      'transition:transform .12s, background .12s',
    ].join(';');
    overlay.textContent = t('dragDropHint');
    overlay.addEventListener('dragenter', (e) => {
      e.preventDefault();
      overlay.style.transform = 'scale(1.05)';
      overlay.style.background = BG_OVER;
    });
    overlay.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    overlay.addEventListener('dragleave', () => {
      overlay.style.transform = '';
      overlay.style.background = BG_IDLE;
    });
    overlay.addEventListener('drop', onDrop, true);
    document.body.appendChild(overlay);
    return overlay;
  }

  function showOverlay() {
    ensureOverlay();
    overlay.textContent = t('dragDropHint');
    overlay.style.background = BG_IDLE;
    overlay.style.transform = '';
    overlay.style.display = 'flex';
  }
  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
  }

  document.addEventListener(
    'dragstart',
    (e) => {
      if (!chrome.runtime?.id) return;
      const img = e.target.closest?.('img') || (e.target.tagName === 'IMG' ? e.target : null);
      if (!img) return;
      const identity = siteConfig.extractIdentity(img);
      if (!identity || !identity.link) return;
      pending = { type: 'imageDragged', platform: siteConfig.platform, postUrl: identity.link, imageUrls: collectImageUrls(img, siteConfig.platform) };
      showOverlay();
    },
    true,
  );

  // Drag ended without dropping into the zone (dropped elsewhere or cancelled).
  document.addEventListener(
    'dragend',
    () => {
      if (savingViaDrop) return; // a zone drop is handling its own feedback/hide
      pending = null;
      hideOverlay();
    },
    true,
  );

  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const p = pending;
    pending = null;
    if (!p) {
      hideOverlay();
      return;
    }
    savingViaDrop = true;
    overlay.textContent = t('bannerSaving');
    overlay.style.background = BG_BUSY;
    overlay.style.transform = '';
    chrome.runtime.sendMessage(p, (res) => {
      const ok = res && res.ok;
      const partial = ok && res.metaOk === false; // saved, but no post metadata
      const grouped = ok && !partial && res.grouped > 0; // same post saved earlier → merges into one card in the app
      overlay.textContent = partial
        ? t('bannerSavedNoMeta')
        : grouped
          ? t('bannerSavedGrouped', [res.grouped + 1])
          : ok
            ? t('bannerSaved')
            : res && res.hostMissing
              ? t('bannerHostMissing') // missing native host → "restart Chrome"
              : t('bannerFailed') + (res && res.error ? `: ${res.error}` : '');
      overlay.style.background = partial ? BG_PARTIAL : ok ? BG_OVER : BG_FAIL;
      setTimeout(
        () => {
          hideOverlay();
          savingViaDrop = false;
        },
        // grouped: hold a beat longer — it explains where the image "went"
        partial ? 2600 : grouped ? 2200 : 1400,
      );
    });
  }

  // === identity (per platform) ===

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
        const u = new URL(src);
        u.searchParams.set('name', 'orig');
        return u.href;
      } catch {
        /* ignore */
      }
    }
    if (platform === 'bluesky' && src.includes('cdn.bsky.app')) return src.replace(/@jpeg$/, '');
    return null;
  }

  function getDragSiteConfig() {
    if (hostnameMatches('x.com') || hostnameMatches('twitter.com')) return xConfig();
    if (hostnameMatches('bsky.app')) return blueskyConfig();
    if (hostnameMatches('pixiv.net')) return pixivConfig();
    return null;
  }

  function hostnameMatches(host) {
    return location.hostname === host || location.hostname.endsWith(`.${host}`);
  }

  function xConfig() {
    return {
      platform: 'x',
      extractIdentity(img) {
        // The image's own enclosing /status/ anchor is ground truth. The URL
        // bar (photo viewer / detail page) only identifies anchor-less images
        // OUTSIDE any post container — with the lightbox open, every image on
        // the page (replies, recommendations) would otherwise be attributed
        // to the lightbox post. (audit 2026-06-11)
        const link = img.closest('a[href*="/status/"]') || findAncestorContainerLink(img, 'a[href*="/status/"]', 'article');
        const parsedAnchor = link ? parseUrlPath(link.href, /^\/([^/]+)\/status\/([^/?#]+)/) : null;
        const viewer = location.pathname.match(/^\/([^/]+)\/status\/(\d+)\/photo\/\d+/);
        const parsedLoc = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
        let screenName, postId;
        if (parsedAnchor) {
          [, screenName, postId] = parsedAnchor.match;
        } else if ((viewer || parsedLoc) && !img.closest('article')) {
          [, screenName, postId] = viewer || parsedLoc;
        } else return null;
        const sn = decodeURIComponent(screenName);
        const pid = decodeURIComponent(postId);
        return { postId: pid, link: `https://x.com/${sn}/status/${pid}` };
      },
    };
  }

  function blueskyConfig() {
    const POST_CONTAINER = '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]';
    return {
      platform: 'bluesky',
      extractIdentity(img) {
        const link = img.closest('a[href*="/post/"]') || findAncestorContainerLink(img, 'a[href*="/post/"]', POST_CONTAINER);
        const parsed = link ? parseUrlPath(link.href, /^\/profile\/([^/]+)\/post\/([^/?#]+)/) : null;
        let handle, postId;
        if (parsed) {
          [, handle, postId] = parsed.match;
        } else {
          // Anchor-less image outside any post container (e.g. the image
          // viewer) on a post detail page — the URL bar identifies it.
          const loc = location.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/);
          if (!loc || img.closest(POST_CONTAINER)) return null;
          [, handle, postId] = loc;
        }
        // Canonical permalink — anchors can carry /liked-by, /reposted-by,
        // /quotes suffixes (engagement-count links on the thread anchor post).
        return { postId: decodeURIComponent(postId), link: `https://bsky.app/profile/${handle}/post/${postId}` };
      },
    };
  }

  function pixivConfig() {
    const ARTWORK_PATH = /^\/(?:[a-z]+\/)?artworks\/(\d+)/;
    const PXIMG_FILENAME = /\/(\d+)_p\d+(?:_|\.)/;
    return {
      platform: 'pixiv',
      extractIdentity(img) {
        let postId = null;
        for (const src of [img.src, img.currentSrc]) {
          if (!src) continue;
          const m = src.match(PXIMG_FILENAME);
          if (m) {
            postId = m[1];
            break;
          }
        }
        if (!postId) {
          const link = img.closest('a[href*="/artworks/"]') || findAncestorContainerLink(img, 'a[href*="/artworks/"]', 'li, figure');
          if (link) {
            const parsed = parseUrlPath(link.href, ARTWORK_PATH);
            if (parsed) postId = parsed.match[1];
          }
        }
        if (!postId) {
          const m = location.pathname.match(ARTWORK_PATH);
          if (m) postId = m[1];
        }
        if (!postId) return null;
        return { postId: decodeURIComponent(postId), link: `https://www.pixiv.net/artworks/${postId}` };
      },
    };
  }

  // Nearest candidate link by DOM distance (avoids a neighboring post's link on
  // grids where several candidates share an ancestor). The walk is BOUNDED by
  // the nearest post container (boundarySel): walking past it would attribute
  // the image to whatever unrelated post is DOM-nearest — avatars, banners and
  // sidebar images must yield no identity instead of a fabricated record.
  // (audit 2026-06-11)
  function findAncestorContainerLink(img, selector, boundarySel) {
    let el = img.parentElement;
    while (el && el !== document.body) {
      const candidates = el.querySelectorAll(selector);
      if (candidates.length) {
        // Bounded: only trust a candidate while still inside a post container.
        // Once the widening search escapes it (avatar/banner/sidebar images),
        // the nearest match belongs to some unrelated post — give up instead.
        if (boundarySel && !el.closest(boundarySel)) return null;
        if (candidates.length === 1) return candidates[0];
        let best = null,
          bestDist = Number.POSITIVE_INFINITY;
        for (const link of candidates) {
          const d = treeDistance(img, link);
          if (d < bestDist) {
            bestDist = d;
            best = link;
          }
        }
        return best;
      }
      if (boundarySel && el.matches(boundarySel)) return null; // container exhausted — stop
      el = el.parentElement;
    }
    return null;
  }

  function treeDistance(a, b) {
    const ancestorsA = [];
    for (let n = a; n; n = n.parentElement) ancestorsA.push(n);
    const indexInA = new Map(ancestorsA.map((n, i) => [n, i]));
    let depthB = 0;
    for (let n = b; n; n = n.parentElement) {
      if (indexInA.has(n)) return indexInA.get(n) + depthB;
      depthB++;
    }
    return Number.POSITIVE_INFINITY;
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
})();
