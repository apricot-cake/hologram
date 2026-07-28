// Which post does this <img> belong to, and what can be fetched for it.
//
// Both on-page save paths read this: drag.js (drag an image into the drop zone)
// and overlay.js's hover save button (#94). They have to agree — a button that
// saved a different post than a drag of the same image would be a silent
// mis-attribution — and the button's visibility gate is exactly the question
// this file answers: "would saving here produce an honest record?". No identity,
// no button.
//
import { hostnameMatches } from './site-detect';

interface MediaIdentity {
  postId: string;
  link: string;
}

interface MediaIdentitySite {
  platform: string;
  // null whenever the image cannot be attributed with certainty — an avatar, a
  // banner, a neighboring post's picture on a grid. Callers treat null as "do
  // nothing", never as "guess".
  extractIdentity(img: HTMLImageElement): MediaIdentity | null;
  // The image is a post's OWN media, judged by the CDN path the platform uses
  // for post pictures. Identity alone is not enough for the hover button: an
  // avatar inside a post resolves to that post's permalink perfectly well, and
  // saving it would file the author's icon as the artwork.
  isPostMedia(img: HTMLImageElement): boolean;
}

interface ParsedMediaPath {
  match: RegExpMatchArray;
  url: string;
}

function getMediaIdentitySite(): MediaIdentitySite | null {
  if (hostnameMatches('x.com') || hostnameMatches('twitter.com')) return xMediaConfig();
  if (hostnameMatches('bsky.app')) return blueskyMediaConfig();
  if (hostnameMatches('pixiv.net')) return pixivMediaConfig();
  return null;
}

// Every URL worth trying for one image, best first-class candidate included: the
// bridge downloads the first that works, so a thumbnail src is a usable fallback
// when the high-resolution rewrite 404s.
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

function anySrc(img: HTMLImageElement, test: (src: string) => boolean): boolean {
  return [img.src, img.currentSrc].some((src) => !!src && test(src));
}

function xMediaConfig(): MediaIdentitySite {
  return {
    platform: 'x',
    extractIdentity(img: HTMLImageElement): MediaIdentity | null {
      // The image's own enclosing /status/ anchor is ground truth. The URL
      // bar (photo viewer / detail page) only identifies anchor-less images
      // OUTSIDE any post container — with the lightbox open, every image on
      // the page (replies, recommendations) would otherwise be attributed
      // to the lightbox post. (audit 2026-06-11)
      const link = (img.closest('a[href*="/status/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(img, 'a[href*="/status/"]', 'article') as HTMLAnchorElement | null);
      const parsedAnchor = link ? parseMediaUrlPath(link.href, /^\/([^/]+)\/status\/([^/?#]+)/) : null;
      const viewer = location.pathname.match(/^\/([^/]+)\/status\/(\d+)\/photo\/\d+/);
      const parsedLoc = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      let screenName: string | undefined, postId: string | undefined;
      if (parsedAnchor) {
        [, screenName, postId] = parsedAnchor.match;
      } else if ((viewer || parsedLoc) && !img.closest('article')) {
        [, screenName, postId] = (viewer || parsedLoc) as RegExpMatchArray;
      } else return null;
      if (!screenName || !postId) return null;
      const sn = decodeURIComponent(screenName);
      const pid = decodeURIComponent(postId);
      return { postId: pid, link: `https://x.com/${sn}/status/${pid}` };
    },
    // profile_images/ (avatars) and card_img/ (link previews) share the host.
    isPostMedia: (img) => anySrc(img, (src) => src.includes('pbs.twimg.com/media/')),
  };
}

function blueskyMediaConfig(): MediaIdentitySite {
  const POST_CONTAINER = '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]';
  return {
    platform: 'bluesky',
    extractIdentity(img: HTMLImageElement): MediaIdentity | null {
      const link = (img.closest('a[href*="/post/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(img, 'a[href*="/post/"]', POST_CONTAINER) as HTMLAnchorElement | null);
      const parsed = link ? parseMediaUrlPath(link.href, /^\/profile\/([^/]+)\/post\/([^/?#]+)/) : null;
      let handle: string | undefined, postId: string | undefined;
      if (parsed) {
        [, handle, postId] = parsed.match;
      } else {
        // Anchor-less image outside any post container (e.g. the image
        // viewer) on a post detail page — the URL bar identifies it.
        const loc = location.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/);
        if (!loc || img.closest(POST_CONTAINER)) return null;
        [, handle, postId] = loc;
      }
      if (!handle || !postId) return null;
      // Canonical permalink — anchors can carry /liked-by, /reposted-by,
      // /quotes suffixes (engagement-count links on the thread anchor post).
      return { postId: decodeURIComponent(postId), link: `https://bsky.app/profile/${handle}/post/${postId}` };
    },
    // feed_thumbnail / feed_fullsize are post pictures; avatar/banner sit under
    // /img/avatar/ and /img/banner/ on the same CDN.
    isPostMedia: (img) => anySrc(img, (src) => src.includes('cdn.bsky.app/img/feed_')),
  };
}

function pixivMediaConfig(): MediaIdentitySite {
  const ARTWORK_PATH = /^\/(?:[a-z]+\/)?artworks\/(\d+)/;
  const PXIMG_FILENAME = /\/(\d+)_p\d+(?:_|\.)/;
  return {
    platform: 'pixiv',
    extractIdentity(img: HTMLImageElement): MediaIdentity | null {
      let postId: string | null = null;
      for (const src of [img.src, img.currentSrc]) {
        if (!src) continue;
        const m = src.match(PXIMG_FILENAME);
        if (m) {
          postId = m[1] ?? null;
          break;
        }
      }
      if (!postId) {
        const link = (img.closest('a[href*="/artworks/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(img, 'a[href*="/artworks/"]', 'li, figure') as HTMLAnchorElement | null);
        if (link) {
          const parsed = parseMediaUrlPath(link.href, ARTWORK_PATH);
          if (parsed) postId = parsed.match[1] ?? null;
        }
      }
      if (!postId) {
        const m = location.pathname.match(ARTWORK_PATH);
        if (m) postId = m[1] ?? null;
      }
      if (!postId) return null;
      return { postId: decodeURIComponent(postId), link: `https://www.pixiv.net/artworks/${postId}` };
    },
    // The <id>_p<N> filename is what makes a pximg URL an artwork page rather
    // than a novel cover or a user icon (both live on i.pximg.net too).
    isPostMedia: (img) => anySrc(img, (src) => src.includes('i.pximg.net') && PXIMG_FILENAME.test(src)),
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
      if (candidates.length === 1) return candidates[0] ?? null;
      let best: Element | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const link of candidates) {
        const d = mediaTreeDistance(img, link);
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

function mediaTreeDistance(a: Element, b: Element): number {
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

function parseMediaUrlPath(href: string, pathRegex: RegExp): ParsedMediaPath | null {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(pathRegex);
    if (!match) return null;
    return { match, url: url.href };
  } catch {
    return null;
  }
}

export { collectImageUrls, getMediaIdentitySite };
export type { MediaIdentity, MediaIdentitySite };
