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

  interface DropZone {
    el: HTMLDivElement;
    ring: HTMLDivElement;
    badge: HTMLDivElement;
    label: HTMLDivElement;
  }
  type ZoneState = 'idle' | 'over' | 'busy' | 'ok' | 'partial' | 'fail';

  let pending: PendingDrag | null = null;
  let zone: DropZone | null = null;
  let hideAnim: Animation | null = null; // in-flight exit fade, cancelled if the zone re-shows
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

  // Visual language mirrors the app's dark glass surfaces (design-tokens.css:
  // --glass-* / --sky-600 accent / --green-500 / --red-500 / --amber-500). A
  // dark frosted card reads on any host page theme; state is carried by the
  // badge fill + a tinted card border instead of repainting the whole card.
  // All styling is inline via element.style (no injected <style> — the host
  // page's CSP style-src would apply to it) and icons are built with
  // createElementNS (no innerHTML — Trusted Types-enforcing hosts like x.com
  // reject string sinks even from the isolated world).
  const ACCENT = '#28a8db';
  const OK_GREEN = '#30a46c';
  const FAIL_RED = '#e5484d';
  const WARN_AMBER = '#e8a13a'; // saved, but post metadata was unavailable
  const CARD_BORDER = 'rgba(255,255,255,0.14)';
  const CARD_SHADOW = '0 12px 36px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.10)';
  const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SVGNS = 'http://www.w3.org/2000/svg';
  const ICON_DROP = ['M12 4v9', 'm8.5 9.5 3.5 3.5 3.5-3.5', 'M4.5 15.5v2a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-2'];
  const ICON_CHECK = ['m6 12.5 4.2 4.2L18 8'];
  const ICON_CROSS = ['M7 7l10 10', 'M17 7 7 17'];
  const ICON_WARN = ['M12 6.5v6.5', 'M12 17.2v.05'];

  function makeIcon(paths: readonly string[]): SVGSVGElement {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of paths) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    svg.style.pointerEvents = 'none';
    return svg;
  }

  function makeSpinner(): HTMLDivElement {
    const sp = document.createElement('div');
    sp.style.cssText = 'width:22px;height:22px;border-radius:50%;border:2.5px solid rgba(255,255,255,0.22);border-top-color:#5ec5ec;box-sizing:border-box;pointer-events:none;';
    sp.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: 900, iterations: Number.POSITIVE_INFINITY });
    return sp;
  }

  function ensureOverlay(): DropZone {
    if (zone) return zone;
    // A local const (never reassigned) instead of reading the outer `zone`
    // let from inside these nested closures — TS's null-narrowing on a
    // closure-captured outer variable doesn't cross a function boundary, but a
    // const captured by the same closures narrows fine.
    const el = document.createElement('div');
    el.id = '__corpusDropZone';
    el.style.cssText = [
      'position:fixed',
      'right:24px',
      'bottom:24px',
      'z-index:2147483647',
      'width:236px',
      'box-sizing:border-box',
      'display:none',
      'flex-direction:column',
      'align-items:center',
      'gap:10px',
      'padding:22px 18px 18px',
      'border-radius:20px',
      `border:1px solid ${CARD_BORDER}`,
      'background:rgba(23,25,30,0.78)',
      'backdrop-filter:blur(20px) saturate(140%)',
      '-webkit-backdrop-filter:blur(20px) saturate(140%)',
      'color:#fff',
      'font:600 13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'text-align:center',
      `box-shadow:${CARD_SHADOW}`,
      'pointer-events:auto',
      'transition:transform .16s cubic-bezier(.22,1,.36,1), border-color .16s, box-shadow .16s',
    ].join(';');

    // Dashed inset ring = the "drop target" affordance; hidden on result states.
    // Children are pointer-events:none so dragenter/dragleave never flicker.
    const ring = document.createElement('div');
    ring.style.cssText = 'position:absolute;inset:7px;border-radius:14px;border:1.5px dashed rgba(255,255,255,0.30);pointer-events:none;transition:border-color .16s,opacity .16s;';
    el.appendChild(ring);

    const badge = document.createElement('div');
    badge.style.cssText = 'width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(40,168,219,0.18);color:#5ec5ec;pointer-events:none;transition:background .16s,color .16s;';
    el.appendChild(badge);

    const label = document.createElement('div');
    label.style.cssText = 'pointer-events:none;max-width:100%;color:rgba(255,255,255,0.92);';
    el.appendChild(label);

    const z: DropZone = { el, ring, badge, label };
    zone = z;
    el.addEventListener('dragenter', (e) => {
      e.preventDefault();
      setState(z, 'over');
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('dragleave', () => {
      setState(z, 'idle');
    });
    el.addEventListener('drop', onDrop, true);
    document.body.appendChild(el);
    return z;
  }

  function setState(z: DropZone, state: ZoneState, text?: string) {
    if (text !== undefined) z.label.textContent = text;
    z.badge.replaceChildren();
    z.el.style.transform = '';
    z.el.style.borderColor = CARD_BORDER;
    z.el.style.boxShadow = CARD_SHADOW;
    z.ring.style.opacity = state === 'idle' || state === 'over' ? '1' : '0';
    z.ring.style.borderColor = 'rgba(255,255,255,0.30)';
    switch (state) {
      case 'idle':
        z.badge.style.background = 'rgba(40,168,219,0.18)';
        z.badge.style.color = '#5ec5ec';
        z.badge.appendChild(makeIcon(ICON_DROP));
        break;
      case 'over':
        z.badge.style.background = ACCENT;
        z.badge.style.color = '#fff';
        z.badge.appendChild(makeIcon(ICON_DROP));
        z.el.style.transform = 'scale(1.04) translateY(-2px)';
        z.el.style.borderColor = 'rgba(40,168,219,0.85)';
        z.el.style.boxShadow = `${CARD_SHADOW}, 0 0 0 4px rgba(40,168,219,0.22)`;
        z.ring.style.borderColor = 'rgba(94,197,236,0.85)';
        break;
      case 'busy':
        z.badge.style.background = 'rgba(255,255,255,0.10)';
        z.badge.style.color = '#5ec5ec';
        z.badge.appendChild(makeSpinner());
        break;
      case 'ok':
        z.badge.style.background = OK_GREEN;
        z.badge.style.color = '#fff';
        z.badge.appendChild(makeIcon(ICON_CHECK));
        z.el.style.borderColor = 'rgba(48,164,108,0.65)';
        break;
      case 'partial':
        z.badge.style.background = WARN_AMBER;
        z.badge.style.color = '#fff';
        z.badge.appendChild(makeIcon(ICON_WARN));
        z.el.style.borderColor = 'rgba(232,161,58,0.65)';
        break;
      case 'fail':
        z.badge.style.background = FAIL_RED;
        z.badge.style.color = '#fff';
        z.badge.appendChild(makeIcon(ICON_CROSS));
        z.el.style.borderColor = 'rgba(229,72,77,0.65)';
        break;
    }
  }

  function showOverlay() {
    const z = ensureOverlay();
    if (hideAnim) {
      hideAnim.cancel();
      hideAnim = null;
    }
    z.el.style.opacity = '';
    setState(z, 'idle', t('dragDropHint'));
    const wasHidden = z.el.style.display === 'none';
    z.el.style.display = 'flex';
    if (wasHidden && !REDUCED_MOTION) {
      z.el.animate([{ opacity: 0, transform: 'translateY(14px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }
  function hideOverlay(fade = false) {
    const z = zone;
    if (!z || z.el.style.display === 'none') return;
    if (!fade || REDUCED_MOTION) {
      z.el.style.display = 'none';
      return;
    }
    const anim = z.el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 140, easing: 'ease-in' });
    hideAnim = anim;
    anim.onfinish = () => {
      if (hideAnim === anim) {
        z.el.style.display = 'none';
        hideAnim = null;
      }
    };
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
      hideOverlay(true);
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
    const z = ensureOverlay();
    setState(z, 'busy', t('bannerSaving'));
    chrome.runtime.sendMessage(p, (res: any) => {
      const ok = res && res.ok;
      const partial = ok && res.metaOk === false; // saved, but no post metadata
      const grouped = ok && !partial && res.grouped > 0; // same post saved earlier → merges into one card in the app
      const text = partial
        ? t('bannerSavedNoMeta')
        : grouped
          ? t('bannerSavedGrouped', [res.grouped + 1])
          : ok
            ? t('bannerSaved')
            : res && res.hostMissing
              ? t('bannerHostMissing') // missing native host → "restart Chrome"
              : t('bannerFailed') + (res && res.error ? `: ${res.error}` : '');
      setState(z, partial ? 'partial' : ok ? 'ok' : 'fail', text);
      if (ok && !REDUCED_MOTION) {
        // Small badge pop so the state flip reads even in peripheral vision.
        z.badge.animate([{ transform: 'scale(0.6)' }, { transform: 'scale(1.12)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
      }
      setTimeout(
        () => {
          hideOverlay(true);
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
