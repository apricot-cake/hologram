// Persistent content script (manifest content_scripts for x / bsky / pixiv).
// Eagle-for-Chrome style: when the user starts dragging an image, a drop zone
// appears; the image is saved to Corpus ONLY if dropped into that zone. Dragging
// an image anywhere else (to disk, to reorder, etc.) does nothing — no accidental
// saves. On drop, the background fetches the post metadata and saves the dragged
// illustration itself (no screenshot) via the native host. Identity extraction is
// ported from eagle-info-plus, minus all Eagle coupling.
(() => {
  const siteConfig = getDragSiteConfig();
  if (!siteConfig) return;
  if (window.__corpusDragActive) return; // avoid double-binding on re-injection
  window.__corpusDragActive = true;

  let pending = null;        // {platform, postUrl, imageUrls} captured at dragstart
  let overlay = null;
  let savingViaDrop = false; // true between a drop-in-zone and its result, so dragend doesn't hide early

  const HINT = 'ここにドロップで Corpus に保存';
  const BG_IDLE = 'rgba(29,155,240,0.96)';
  const BG_OVER = 'rgba(0,186,124,0.96)';
  const BG_BUSY = 'rgba(83,100,113,0.96)';
  const BG_FAIL = 'rgba(244,33,46,0.96)';

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = '__corpusDropZone';
    overlay.style.cssText = [
      'position:fixed', 'right:24px', 'bottom:24px', 'z-index:2147483647',
      'width:220px', 'min-height:120px', 'box-sizing:border-box', 'display:none',
      'align-items:center', 'justify-content:center', 'padding:20px',
      'border-radius:16px', 'border:3px dashed rgba(255,255,255,0.75)',
      `background:${BG_IDLE}`, 'color:#fff',
      'font:600 14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'text-align:center', 'box-shadow:0 8px 28px rgba(0,0,0,0.35)',
      'pointer-events:auto', 'transition:transform .12s, background .12s'
    ].join(';');
    overlay.textContent = HINT;
    overlay.addEventListener('dragenter', (e) => { e.preventDefault(); overlay.style.transform = 'scale(1.05)'; overlay.style.background = BG_OVER; });
    overlay.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    overlay.addEventListener('dragleave', () => { overlay.style.transform = ''; overlay.style.background = BG_IDLE; });
    overlay.addEventListener('drop', onDrop, true);
    document.body.appendChild(overlay);
    return overlay;
  }

  function showOverlay() {
    ensureOverlay();
    overlay.textContent = HINT;
    overlay.style.background = BG_IDLE;
    overlay.style.transform = '';
    overlay.style.display = 'flex';
  }
  function hideOverlay() { if (overlay) overlay.style.display = 'none'; }

  document.addEventListener('dragstart', (e) => {
    if (!chrome.runtime?.id) return;
    const img = e.target.closest?.('img') || (e.target.tagName === 'IMG' ? e.target : null);
    if (!img) return;
    const identity = siteConfig.extractIdentity(img);
    if (!identity || !identity.link) return;
    pending = { type: 'imageDragged', platform: siteConfig.platform, postUrl: identity.link, imageUrls: collectImageUrls(img, siteConfig.platform) };
    showOverlay();
  }, true);

  // Drag ended without dropping into the zone (dropped elsewhere or cancelled).
  document.addEventListener('dragend', () => {
    if (savingViaDrop) return; // a zone drop is handling its own feedback/hide
    pending = null;
    hideOverlay();
  }, true);

  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const p = pending;
    pending = null;
    if (!p) { hideOverlay(); return; }
    savingViaDrop = true;
    overlay.textContent = '保存中…';
    overlay.style.background = BG_BUSY;
    overlay.style.transform = '';
    chrome.runtime.sendMessage(p, (res) => {
      const ok = res && res.ok;
      overlay.textContent = ok ? '保存しました' : ('保存に失敗' + (res && res.error ? `: ${res.error}` : ''));
      overlay.style.background = ok ? BG_OVER : BG_FAIL;
      setTimeout(() => { hideOverlay(); savingViaDrop = false; }, 1400);
    });
  }

  // === identity (per platform; ported from eagle-info-plus) ===

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
      try { const u = new URL(src); u.searchParams.set('name', 'orig'); return u.href; } catch { /* ignore */ }
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
        const viewer = location.pathname.match(/^\/([^/]+)\/status\/(\d+)\/photo\/\d+/);
        const link = !viewer && (img.closest('a[href*="/status/"]') || findAncestorContainerLink(img, 'a[href*="/status/"]'));
        const parsedAnchor = link ? parseUrlPath(link.href, /^\/([^/]+)\/status\/([^/?#]+)/) : null;
        const parsedLoc = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
        let screenName, postId, baseUrl;
        if (viewer) { [, screenName, postId] = viewer; baseUrl = location.href; }
        else if (parsedAnchor) { [, screenName, postId] = parsedAnchor.match; baseUrl = parsedAnchor.url; }
        else if (parsedLoc) { [, screenName, postId] = parsedLoc; baseUrl = location.href; }
        else return null;
        const sn = decodeURIComponent(screenName);
        const pid = decodeURIComponent(postId);
        let origin = 'https://x.com';
        try { origin = new URL(baseUrl).origin; } catch { /* ignore */ }
        return { postId: pid, link: `${origin}/${sn}/status/${pid}` };
      }
    };
  }

  function blueskyConfig() {
    return {
      platform: 'bluesky',
      extractIdentity(img) {
        const link = img.closest('a[href*="/post/"]') || findAncestorContainerLink(img, 'a[href*="/post/"]');
        const parsed = link ? parseUrlPath(link.href, /^\/profile\/([^/]+)\/post\/([^/?#]+)/) : null;
        if (!parsed) return null;
        const [, , postId] = parsed.match;
        return { postId: decodeURIComponent(postId), link: parsed.url };
      }
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
          if (m) { postId = m[1]; break; }
        }
        if (!postId) {
          const link = img.closest('a[href*="/artworks/"]') || findAncestorContainerLink(img, 'a[href*="/artworks/"]');
          if (link) { const parsed = parseUrlPath(link.href, ARTWORK_PATH); if (parsed) postId = parsed.match[1]; }
        }
        if (!postId) { const m = location.pathname.match(ARTWORK_PATH); if (m) postId = m[1]; }
        if (!postId) return null;
        return { postId: decodeURIComponent(postId), link: `https://www.pixiv.net/artworks/${postId}` };
      }
    };
  }

  // Nearest candidate link by DOM distance (avoids a neighboring post's link on
  // grids where several candidates share an ancestor).
  function findAncestorContainerLink(img, selector) {
    let el = img.parentElement;
    while (el && el !== document.body) {
      const candidates = el.querySelectorAll(selector);
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) {
        let best = null, bestDist = Infinity;
        for (const link of candidates) {
          const d = treeDistance(img, link);
          if (d < bestDist) { bestDist = d; best = link; }
        }
        return best;
      }
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
    return Infinity;
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
