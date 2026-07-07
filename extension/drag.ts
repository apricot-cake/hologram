// Persistent content script (manifest content_scripts for x / bsky / pixiv).
// Drag-to-save: when the user starts dragging an image, a drop zone
// appears; the image is saved to Corpus ONLY if dropped into that zone. Dragging
// an image anywhere else (to disk, to reorder, etc.) does nothing — no accidental
// saves. On drop, the background fetches the post metadata and saves the dragged
// illustration itself (no screenshot) via the native host. Identity extraction is
// self-contained per platform (no external coupling).
(() => {
  interface Identity {
    postId: string;
    link: string;
  }
  interface SiteConfig {
    platform: string;
    extractIdentity(img: HTMLImageElement): Identity | null;
  }
  interface PendingDrag {
    type: string;
    platform: string;
    postUrl: string;
    imageUrls: string[];
  }
  interface ParsedPath {
    match: RegExpMatchArray;
    url: string;
  }

  const siteConfig = getDragSiteConfig();
  if (!siteConfig) return;
  if (window.__corpusDragActive) return; // avoid double-binding on re-injection
  window.__corpusDragActive = true;

  let pending: PendingDrag | null = null;
  let overlay: HTMLDivElement | null = null;
  let savingViaDrop = false; // true between a drop-in-zone and its result, so dragend doesn't hide early

  // i18n: drag toasts share the banner strings. window.corpusI18n is set by the
  // i18n.js content script declared BEFORE this one in the same manifest entry
  // (same isolated world, runs first). Resolve once; until then t() echoes the
  // key — overlay text is only set at drag time, long after page load, so the
  // table is populated by the time it's read in practice.
  let t: (key: string, subs?: ReadonlyArray<unknown>) => string = (key) => key;
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

  function ensureOverlay(): HTMLDivElement {
    if (overlay) return overlay;
    // A local const (never reassigned) instead of reading the outer `overlay`
    // let from inside these nested closures — TS's null-narrowing on a
    // closure-captured outer variable doesn't cross a function boundary, but a
    // const captured by the same closures narrows fine.
    const el = document.createElement('div');
    overlay = el;
    el.id = '__corpusDropZone';
    el.style.cssText = [
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
    el.textContent = t('dragDropHint');
    el.addEventListener('dragenter', (e) => {
      e.preventDefault();
      el.style.transform = 'scale(1.05)';
      el.style.background = BG_OVER;
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('dragleave', () => {
      el.style.transform = '';
      el.style.background = BG_IDLE;
    });
    el.addEventListener('drop', onDrop, true);
    document.body.appendChild(el);
    return el;
  }

  function showOverlay() {
    const el = ensureOverlay();
    el.textContent = t('dragDropHint');
    el.style.background = BG_IDLE;
    el.style.transform = '';
    el.style.display = 'flex';
  }
  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
  }

  document.addEventListener(
    'dragstart',
    (e) => {
      if (!chrome.runtime?.id) return;
      const target = e.target as Element | null;
      const img = (target?.closest?.('img') as HTMLImageElement | null) || (target?.tagName === 'IMG' ? (target as HTMLImageElement) : null);
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

  function onDrop(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    const p = pending;
    pending = null;
    if (!p) {
      hideOverlay();
      return;
    }
    savingViaDrop = true;
    const el = ensureOverlay();
    el.textContent = t('bannerSaving');
    el.style.background = BG_BUSY;
    el.style.transform = '';
    chrome.runtime.sendMessage(p, (res: any) => {
      const ok = res && res.ok;
      const partial = ok && res.metaOk === false; // saved, but no post metadata
      const grouped = ok && !partial && res.grouped > 0; // same post saved earlier → merges into one card in the app
      el.textContent = partial
        ? t('bannerSavedNoMeta')
        : grouped
          ? t('bannerSavedGrouped', [res.grouped + 1])
          : ok
            ? t('bannerSaved')
            : res && res.hostMissing
              ? t('bannerHostMissing') // missing native host → "restart Chrome"
              : t('bannerFailed') + (res && res.error ? `: ${res.error}` : '');
      el.style.background = partial ? BG_PARTIAL : ok ? BG_OVER : BG_FAIL;
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

  function collectImageUrls(img: HTMLImageElement, platform: string): string[] {
    const urls = new Set<string>();
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

  function getHighResImageUrl(img: HTMLImageElement, platform: string): string | null {
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

  function getDragSiteConfig(): SiteConfig | null {
    if (hostnameMatches('x.com') || hostnameMatches('twitter.com')) return xConfig();
    if (hostnameMatches('bsky.app')) return blueskyConfig();
    if (hostnameMatches('pixiv.net')) return pixivConfig();
    return null;
  }

  function hostnameMatches(host: string): boolean {
    return location.hostname === host || location.hostname.endsWith(`.${host}`);
  }

  function xConfig(): SiteConfig {
    return {
      platform: 'x',
      extractIdentity(img: HTMLImageElement): Identity | null {
        // The image's own enclosing /status/ anchor is ground truth. The URL
        // bar (photo viewer / detail page) only identifies anchor-less images
        // OUTSIDE any post container — with the lightbox open, every image on
        // the page (replies, recommendations) would otherwise be attributed
        // to the lightbox post. (audit 2026-06-11)
        const link = (img.closest('a[href*="/status/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(img, 'a[href*="/status/"]', 'article') as HTMLAnchorElement | null);
        const parsedAnchor = link ? parseUrlPath(link.href, /^\/([^/]+)\/status\/([^/?#]+)/) : null;
        const viewer = location.pathname.match(/^\/([^/]+)\/status\/(\d+)\/photo\/\d+/);
        const parsedLoc = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
        let screenName: string, postId: string;
        if (parsedAnchor) {
          [, screenName, postId] = parsedAnchor.match;
        } else if ((viewer || parsedLoc) && !img.closest('article')) {
          [, screenName, postId] = (viewer || parsedLoc) as RegExpMatchArray;
        } else return null;
        const sn = decodeURIComponent(screenName);
        const pid = decodeURIComponent(postId);
        return { postId: pid, link: `https://x.com/${sn}/status/${pid}` };
      },
    };
  }

  function blueskyConfig(): SiteConfig {
    const POST_CONTAINER = '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]';
    return {
      platform: 'bluesky',
      extractIdentity(img: HTMLImageElement): Identity | null {
        const link = (img.closest('a[href*="/post/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(img, 'a[href*="/post/"]', POST_CONTAINER) as HTMLAnchorElement | null);
        const parsed = link ? parseUrlPath(link.href, /^\/profile\/([^/]+)\/post\/([^/?#]+)/) : null;
        let handle: string, postId: string;
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

  function pixivConfig(): SiteConfig {
    const ARTWORK_PATH = /^\/(?:[a-z]+\/)?artworks\/(\d+)/;
    const PXIMG_FILENAME = /\/(\d+)_p\d+(?:_|\.)/;
    return {
      platform: 'pixiv',
      extractIdentity(img: HTMLImageElement): Identity | null {
        let postId: string | null = null;
        for (const src of [img.src, img.currentSrc]) {
          if (!src) continue;
          const m = src.match(PXIMG_FILENAME);
          if (m) {
            postId = m[1];
            break;
          }
        }
        if (!postId) {
          const link = (img.closest('a[href*="/artworks/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(img, 'a[href*="/artworks/"]', 'li, figure') as HTMLAnchorElement | null);
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
  function findAncestorContainerLink(img: Element, selector: string, boundarySel: string): Element | null {
    let el = img.parentElement;
    while (el && el !== document.body) {
      const candidates = el.querySelectorAll(selector);
      if (candidates.length) {
        // Bounded: only trust a candidate while still inside a post container.
        // Once the widening search escapes it (avatar/banner/sidebar images),
        // the nearest match belongs to some unrelated post — give up instead.
        if (boundarySel && !el.closest(boundarySel)) return null;
        if (candidates.length === 1) return candidates[0];
        let best: Element | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
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

  function treeDistance(a: Element, b: Element): number {
    const ancestorsA: Element[] = [];
    for (let n: Element | null = a; n; n = n.parentElement) ancestorsA.push(n);
    const indexInA = new Map(ancestorsA.map((n, i) => [n, i]));
    let depthB = 0;
    for (let n: Element | null = b; n; n = n.parentElement) {
      const idx = indexInA.get(n);
      if (idx !== undefined) return idx + depthB;
      depthB++;
    }
    return Number.POSITIVE_INFINITY;
  }

  function parseUrlPath(href: string, pathRegex: RegExp): ParsedPath | null {
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
