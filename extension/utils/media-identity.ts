// Which post does this picture or video belong to, and what can be fetched for it.
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

// A post's media as it exists in the page. Usually an <img>, but a video or GIF
// post is a <video>: X replaces the poster <img> with a <video poster="…"> the
// moment the player initialises and never puts the <img> back, even after the
// post scrolls away — so on anything currently hoverable, the poster attribute
// is the only handle the page still offers (#450).
type PostMediaElement = HTMLImageElement | HTMLVideoElement;

interface MediaIdentitySite {
  platform: string;
  // null whenever the media cannot be attributed with certainty — an avatar, a
  // banner, a neighboring post's picture on a grid. Callers treat null as "do
  // nothing", never as "guess".
  extractIdentity(el: PostMediaElement): MediaIdentity | null;
  // The element is a post's OWN media, judged by the CDN path the platform uses
  // for post media. Identity alone is not enough for the hover button: an
  // avatar inside a post resolves to that post's permalink perfectly well, and
  // saving it would file the author's icon as the artwork.
  isPostMedia(el: PostMediaElement): boolean;
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
function collectImageUrls(el: PostMediaElement, platform: string): string[] {
  const urls = new Set<string>();
  for (const src of mediaSrcs(el)) urls.add(src);
  const highRes = getHighResImageUrl(el, platform);
  if (highRes) urls.add(highRes);
  const srcset = el.getAttribute('srcset');
  if (srcset) {
    for (const entry of srcset.split(',')) {
      const url = entry.trim().split(/\s+/)[0];
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

function getHighResImageUrl(el: PostMediaElement, platform: string): string | null {
  const src = mediaSrcs(el)[0] || '';
  // Only media/ is rewritten: X serves those with a ?name=<size> variant, so
  // name=orig is what upgrades a thumbnail to the full picture. The video/GIF
  // poster paths (see X_POST_MEDIA_PREFIXES) carry no name= parameter and are
  // already the original — name=orig on them answers 200 with byte-identical
  // content (measured on live X, 2026-07-28), so rewriting would only add a
  // duplicate candidate URL.
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

// The URLs an element can be recognised by. Tag name rather than instanceof:
// the fixture tests run these against a jsdom realm whose constructors are not
// the ones this module closed over.
function mediaSrcs(el: PostMediaElement): string[] {
  if (el.tagName === 'VIDEO') {
    const poster = (el as HTMLVideoElement).poster;
    return poster ? [poster] : [];
  }
  const img = el as HTMLImageElement;
  return [img.src, img.currentSrc].filter((src) => !!src);
}

function anySrc(el: PostMediaElement, test: (src: string) => boolean): boolean {
  return mediaSrcs(el).some(test);
}

function xMediaConfig(): MediaIdentitySite {
  // An allowlist of post-media paths, never the host alone: pbs.twimg.com also
  // serves avatars (profile_images/) and link-card previews (card_img/), and a
  // save button on an avatar is exactly what #94 must not do. Video and GIF
  // posts put their poster frame on a *_video_thumb/ path instead of media/,
  // which is why the button was missing from most video posts (#372). Every
  // entry below was counted on live X before being listed (2026-07-28):
  // amplify_video_thumb/ and ext_tw_video_thumb/ on `filter:videos`,
  // tweet_video_thumb/ on GIF posts — all three inside the post's own
  // videoPlayer box, never on an avatar or a card.
  const X_POST_MEDIA_PREFIXES = ['media', 'amplify_video_thumb', 'ext_tw_video_thumb', 'tweet_video_thumb'].map((p) => `pbs.twimg.com/${p}/`);
  return {
    platform: 'x',
    extractIdentity(el: PostMediaElement): MediaIdentity | null {
      // The image's own enclosing /status/ anchor is ground truth. The URL
      // bar (photo viewer / detail page) only identifies anchor-less images
      // OUTSIDE any post container — with the lightbox open, every image on
      // the page (replies, recommendations) would otherwise be attributed
      // to the lightbox post. (audit 2026-06-11)
      const link = (el.closest('a[href*="/status/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(el, 'a[href*="/status/"]', 'article') as HTMLAnchorElement | null);
      const parsedAnchor = link ? parseMediaUrlPath(link.href, /^\/([^/]+)\/status\/([^/?#]+)/) : null;
      const viewer = location.pathname.match(/^\/([^/]+)\/status\/(\d+)\/photo\/\d+/);
      const parsedLoc = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      let screenName: string | undefined, postId: string | undefined;
      if (parsedAnchor) {
        [, screenName, postId] = parsedAnchor.match;
      } else if ((viewer || parsedLoc) && !el.closest('article')) {
        [, screenName, postId] = (viewer || parsedLoc) as RegExpMatchArray;
      } else return null;
      if (!screenName || !postId) return null;
      const sn = decodeURIComponent(screenName);
      const pid = decodeURIComponent(postId);
      return { postId: pid, link: `https://x.com/${sn}/status/${pid}` };
    },
    isPostMedia: (el) => anySrc(el, (src) => X_POST_MEDIA_PREFIXES.some((prefix) => src.includes(prefix))),
  };
}

function blueskyMediaConfig(): MediaIdentitySite {
  const POST_CONTAINER = '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]';
  return {
    platform: 'bluesky',
    extractIdentity(el: PostMediaElement): MediaIdentity | null {
      const link = (el.closest('a[href*="/post/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(el, 'a[href*="/post/"]', POST_CONTAINER) as HTMLAnchorElement | null);
      const parsed = link ? parseMediaUrlPath(link.href, /^\/profile\/([^/]+)\/post\/([^/?#]+)/) : null;
      let handle: string | undefined, postId: string | undefined;
      if (parsed) {
        [, handle, postId] = parsed.match;
      } else {
        // Anchor-less image outside any post container (e.g. the image
        // viewer) on a post detail page — the URL bar identifies it.
        const loc = location.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/);
        if (!loc || el.closest(POST_CONTAINER)) return null;
        [, handle, postId] = loc;
      }
      if (!handle || !postId) return null;
      // Canonical permalink — anchors can carry /liked-by, /reposted-by,
      // /quotes suffixes (engagement-count links on the thread anchor post).
      return { postId: decodeURIComponent(postId), link: `https://bsky.app/profile/${handle}/post/${postId}` };
    },
    // feed_thumbnail / feed_fullsize are post pictures; avatar/banner sit under
    // /img/avatar/ and /img/banner/ on the same CDN.
    isPostMedia: (el) => anySrc(el, (src) => src.includes('cdn.bsky.app/img/feed_')),
  };
}

function pixivMediaConfig(): MediaIdentitySite {
  const ARTWORK_PATH = /^\/(?:[a-z]+\/)?artworks\/(\d+)/;
  const PXIMG_FILENAME = /\/(\d+)_p\d+(?:_|\.)/;
  return {
    platform: 'pixiv',
    extractIdentity(el: PostMediaElement): MediaIdentity | null {
      let postId: string | null = null;
      for (const src of mediaSrcs(el)) {
        const m = src.match(PXIMG_FILENAME);
        if (m) {
          postId = m[1] ?? null;
          break;
        }
      }
      if (!postId) {
        const link = (el.closest('a[href*="/artworks/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(el, 'a[href*="/artworks/"]', 'li, figure') as HTMLAnchorElement | null);
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
    isPostMedia: (el) => anySrc(el, (src) => src.includes('i.pximg.net') && PXIMG_FILENAME.test(src)),
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
export type { MediaIdentity, MediaIdentitySite, PostMediaElement };
