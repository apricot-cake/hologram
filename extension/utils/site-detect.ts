// Platform detection, post-element location, and permalink/rect extraction for
// the capture and resident content-script entrypoints. These side-effect-free
// functions are imported by WXT and directly by the Node/jsdom fixtures.

interface PostRect {
  x: number;
  y: number;
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

interface SiteConfig {
  platform: string;
  postSelector?: string;
  captureStyleText?: string;
  findPostElement?(target: EventTarget | null): Element | null;
  isPostElement?(el: Element): boolean;
  getPermalink(post: Element): string;
  getCaptureRect?(post: Element): PostRect;
  prepareForCapture?(post: Element): (() => void) | null;
}

function getSiteConfig(): SiteConfig | null {
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
      getPermalink(post: Element): string {
        // Fall back to the URL bar on a single-status page (parity with Bluesky/
        // Mastodon/Misskey), so an article whose own permalink anchor isn't
        // rendered still yields a usable URL.
        return getXPostLink(post)?.url || parseXPostLink(location.href)?.url || '';
      },
      prepareForCapture(post: Element) {
        return prepareScopedCaptureState('__snsCaptureXNoHover', [post, post.parentElement, post.closest('[data-testid="cellInnerDiv"]')]);
      },
    };
  }

  if (hostnameMatches('bsky.app')) {
    return {
      platform: 'bluesky',
      postSelector: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"], [role="link"]',
      isPostElement(el: Element): boolean {
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
      getPermalink(post: Element): string {
        return getBlueskyPostLink(post)?.url || parseBlueskyPostLink(location.href)?.url || '';
      },
      prepareForCapture(post: Element) {
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
      findPostElement(target: EventTarget | null) {
        return findMisskeyPostElement(target);
      },
      getPermalink(post: Element): string {
        return getMisskeyPermalink(post);
      },
      getCaptureRect(post: Element): PostRect {
        return getMisskeyCaptureRect(post);
      },
      prepareForCapture(post: Element) {
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
      findPostElement(target: EventTarget | null) {
        return findMastodonPostElement(target);
      },
      getPermalink(post: Element): string {
        return getMastodonStatusLink(post)?.url || parseMastodonStatusLink(location.href)?.url || '';
      },
      prepareForCapture(post: Element) {
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
      findPostElement(target: EventTarget | null) {
        return findPixivPostElement(target);
      },
      getPermalink(post: Element): string {
        return getPixivPermalink(post);
      },
      getCaptureRect(post: Element): PostRect {
        return getPixivCaptureRect(post);
      },
      prepareForCapture(post: Element) {
        return prepareScopedCaptureState('__snsCapturePixivNoHover', [post, post.parentElement]);
      },
    };
  }

  return null;
}

// === pixiv helpers ===

function pixivIdFromImg(img: Element | null): string | null {
  if (!(img instanceof HTMLImageElement)) return null;
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

function pixivIdFromArtworkLink(link: Element | null): string | null {
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
function resolvePixivTarget(target: EventTarget | null): { id: string; el: Element } | null {
  const el = target instanceof Element ? target : (target as Node | null)?.parentElement;
  if (!el) return null;

  const img = el.matches('img') ? el : el.closest('img');
  const idFromImg = pixivIdFromImg(img);
  if (idFromImg && img) return { id: idFromImg, el: img };

  const link = el.closest('a[href*="/artworks/"]');
  const idFromLink = pixivIdFromArtworkLink(link);
  if (idFromLink && link) return { id: idFromLink, el: link };

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

function findPixivPostElement(target: EventTarget | null): Element | null {
  return resolvePixivTarget(target)?.el || null;
}

// post is the element findPixivPostElement returned; re-resolving from it yields
// the same id (consistent with what was highlighted/clicked).
function getPixivPermalink(post: Element): string {
  const r = resolvePixivTarget(post);
  return r ? `https://www.pixiv.net/artworks/${r.id}` : '';
}

// Capture the artwork image itself, not an oversized enclosing <figure>.
function getPixivCaptureRect(post: Element): PostRect {
  let img: Element | null = null;
  if (post?.matches?.('img')) img = post;
  else if (post?.querySelector) img = post.querySelector('img');
  return normalizeRect((img || post).getBoundingClientRect());
}

interface XPostLink {
  url: string;
  screenName: string | null;
  postId: string;
}

function getXPostLink(post: Element): XPostLink | null {
  const links = post instanceof Element ? Array.from(post.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) : [];

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

function parseXPostLink(href: string): XPostLink | null {
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

function hostnameMatches(host: string): boolean {
  return location.hostname === host || location.hostname.endsWith(`.${host}`);
}

function getBlueskyAuthorHandle(post: Element): string {
  const testId = post.getAttribute('data-testid') || '';
  const match = testId.match(/-by-(.+)$/);
  return match?.[1] || '';
}

interface BlueskyPostLink {
  url: string;
  handle: string;
  postId: string;
}

function getBlueskyPostLink(post: Element): BlueskyPostLink | null {
  const authorHandle = getBlueskyAuthorHandle(post);
  // Exclude anchors that belong to an embedded quote card (a nested
  // [role="link"]) or to rich-text links in the post body — on a thread's
  // anchor post (which has NO self-permalink anchor) those were the only
  // candidates left and the QUOTED post's URL got saved. With them excluded,
  // returning null lets getPermalink fall back to location.href, which on a
  // detail page IS the clicked post. (audit 2026-06-11)
  const links: BlueskyPostLink[] =
    post instanceof Element
      ? Array.from(post.querySelectorAll<HTMLAnchorElement>('a[href]'))
          .filter((link) => {
            // Start from the parent: the anchor itself may carry role="link"
            // (react-native-web) and closest() would match it, excluding everything.
            const roleLink = link.parentElement && link.parentElement.closest('[role="link"]');
            if (roleLink && roleLink !== post && post.contains(roleLink)) return false;
            if (link.closest('[data-testid="postText"]')) return false;
            return true;
          })
          .map((link) => parseBlueskyPostLink(link.href))
          .filter((v): v is BlueskyPostLink => Boolean(v))
      : [];

  if (!links.length) {
    return null;
  }

  return links.find((link) => !authorHandle || link.handle === authorHandle) || links[0];
}

function parseBlueskyPostLink(href: string): BlueskyPostLink | null {
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

function looksLikeMisskey(): boolean {
  const misskeyAccent = getComputedStyle(document.documentElement).getPropertyValue('--MI_THEME-accent').trim();

  if (!misskeyAccent) {
    return false;
  }

  return Boolean(document.querySelector('div[tabindex="0"] a[href] time'));
}

function findMisskeyPostElement(target: EventTarget | null): Element | null {
  let el: Element | null = target instanceof Element ? target : ((target as Node | null)?.parentElement ?? null);
  while (el) {
    if (isMisskeyNoteElement(el)) {
      return el;
    }

    el = el.parentElement;
  }

  return null;
}

function isMisskeyNoteElement(element: Element): boolean {
  return element instanceof HTMLElement && element.matches('div[tabindex="0"]') && Boolean(getMisskeyPrimaryArticle(element)) && Boolean(getMisskeyPermalink(element));
}

function getMisskeyPrimaryArticle(post: Element | null): Element | null {
  if (!(post instanceof Element)) {
    return null;
  }

  return post.querySelector('article');
}

function getMisskeyCaptureRect(post: Element): PostRect {
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

function getMisskeyPermalink(post: Element): string {
  // Scope the link scan to the note's own <article>: the reply-parent preview
  // (MkNoteSub) and a detail page's ancestor chain render BEFORE the article,
  // so a document-order scan over the whole root returned the PARENT note's
  // permalink for any reply. (audit 2026-06-11)
  const scope = getMisskeyPrimaryArticle(post) || post;

  const timeLink = getMisskeyTimeLink(scope);
  if (timeLink) {
    return timeLink.url;
  }

  const links = scope instanceof Element ? Array.from(scope.querySelectorAll<HTMLAnchorElement>('a[href]')) : [];

  for (const link of links) {
    const parsed = parseMisskeyNoteLink(link.href);
    if (parsed) {
      return parsed.url;
    }
  }

  const currentPageNote = parseMisskeyNoteLink(location.href);
  return currentPageNote?.url || '';
}

interface MisskeyNoteLink {
  id: string;
  url: string;
}

function getMisskeyTimeLink(scope: Element): MisskeyNoteLink | null {
  if (!(scope instanceof Element)) {
    return null;
  }

  const links = Array.from(scope.querySelectorAll<HTMLAnchorElement>('a[href]'));
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

function parseMisskeyNoteLink(href: string): MisskeyNoteLink | null {
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

function normalizeRect(rect: { x?: number; y?: number; top?: number; left?: number; width?: number; height?: number; right?: number; bottom?: number } | DOMRect): PostRect {
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

function looksLikeMastodon(): boolean {
  return Boolean(document.querySelector('#mastodon')) || document.querySelector('meta[name="application-name"]')?.getAttribute('content') === 'Mastodon';
}

interface MastodonStatusLink {
  id: string;
  url: string;
}

function parseMastodonStatusLink(href: string): MastodonStatusLink | null {
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

function getMastodonStatusLink(post: Element): MastodonStatusLink | null {
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

function findMastodonPostElement(target: EventTarget | null): Element | null {
  let el: Element | null = target instanceof Element ? target : ((target as Node | null)?.parentElement ?? null);
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

function prepareScopedCaptureState(className: string, elements: ReadonlyArray<Element | null | undefined>): () => void {
  const captureTargets = [...new Set(elements.filter((e): e is Element => Boolean(e)))];

  captureTargets.forEach((element) => {
    element.classList.add(className);
  });

  return () => {
    captureTargets.forEach((element) => {
      element.classList.remove(className);
    });
  };
}

export {
  getSiteConfig,
  hostnameMatches,
  looksLikeMisskey,
  looksLikeMastodon,
  findPixivPostElement,
  getPixivPermalink,
  getPixivCaptureRect,
  resolvePixivTarget,
  getXPostLink,
  parseXPostLink,
  getBlueskyPostLink,
  parseBlueskyPostLink,
  findMisskeyPostElement,
  findMastodonPostElement,
  getMastodonStatusLink,
  parseMastodonStatusLink,
  normalizeRect,
  prepareScopedCaptureState,
};
export type { PostRect, SiteConfig };
