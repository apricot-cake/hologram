// pixiv.
//
// API: www.pixiv.net/ajax/* (the site's own undocumented frontend API; needs
// host_permissions and credentials so a logged-in user can read R-18 /
// follower-only works).

import { anySrc, findAncestorContainerLink, hostnameMatches, mediaSrcs, normalizeRect, parseMediaUrlPath, prepareScopedCaptureState } from './dom.ts';
import { emptyRecord, htmlToText, normalizeHashtags, readJsonKeepingRaw, toIso } from './record.ts';
import type { Extractor, MediaIdentity, MediaItem, PostMediaElement, PostRect, PostRecord } from './types.ts';

const HOSTS = ['www.pixiv.net', 'pixiv.net'];
const PIXIV_REFERER = 'https://www.pixiv.net/';

// Three views of the SAME pximg file name, <artworkId>_p<page>_<size>.<ext>.
// They stay separate patterns rather than one with two groups because their
// tails differ where it matters: ARTWORK_ID never accepts an end-of-string
// after the page number, MEDIA_KEY does, and PAGE_INDEX asks only for the page.
// Merging them would quietly change which URLs each caller recognizes.
//
// Module scope is safe even though the capture entry is re-injected on every
// Alt+S: the capture entry is bundled as a standalone script, so every injection evaluates these
// in a fresh function scope (an un-wrapped top-level `const` used to throw
// "already declared" before the script could run its own re-injection guard).
const PXIMG_ARTWORK_ID = /\/(\d+)_p\d+(?:_|\.)/;
const PXIMG_MEDIA_KEY = /\/(\d+_p\d+)(?:[._]|$)/;
const PXIMG_PAGE_INDEX = /\/\d+_p(\d+)[._]/;
const ARTWORK_PATH = /^\/(?:[a-z]+\/)?artworks\/(\d+)/;

// === DOM ===

function pixivIdFromImg(img: Element | null): string | null {
  if (!(img instanceof HTMLImageElement)) return null;
  for (const src of [img.src, img.currentSrc]) {
    const m = src && src.match(PXIMG_ARTWORK_ID);
    if (m) return m[1] ?? null;
  }
  return null;
}

function pixivIdFromArtworkLink(link: Element | null): string | null {
  if (!(link instanceof Element)) return null;
  const m = (link.getAttribute('href') || '').match(/\/artworks\/(\d+)/);
  return m ? (m[1] ?? null) : null;
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

// === API ===

// ugoira (#119 St3): illustType 2 is an animation pixiv delivers as a ZIP of
// frame images plus a separate table of per-frame display times. Neither is in
// the illust payload — /ugoira_meta carries both — and the archive is saved
// UNCHANGED (no transcode, so no encoder rides into the distribution and the
// frames keep the quality pixiv served). `originalSrc` is the original-size
// archive; `src` is the 600x600 preview archive and is only a fallback.
// `urls.original` on the illust is frame 0 as a plain jpg, which serves as the
// poster with no frame extraction of our own.
function pixivUgoiraFrames(body) {
  const frames = Array.isArray(body && body.frames) ? body.frames : [];
  return frames.filter((f) => f && typeof f.file === 'string' && typeof f.delay === 'number' && Number.isFinite(f.delay)).map((f) => ({ file: f.file, delay: f.delay }));
}

async function pixivUgoiraMedia(rec: PostRecord, id, il): Promise<MediaItem[]> {
  try {
    const res = await fetch(`https://www.pixiv.net/ajax/illust/${encodeURIComponent(id)}/ugoira_meta`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await readJsonKeepingRaw(rec, 'api:pixiv/ugoira-meta', res);
    if (data.error || !data.body) return [];
    const url = data.body.originalSrc || data.body.src;
    const frames = pixivUgoiraFrames(data.body);
    // No frame table means nothing can play the archive back — treat it as a
    // failed acquisition rather than saving an animation we cannot time.
    if (typeof url !== 'string' || !url || !frames.length) return [];
    return [{ url, alt: null, width: il.width || null, height: il.height || null, referer: PIXIV_REFERER, type: 'ugoira', poster: (il.urls && il.urls.original) || null, frames }];
  } catch {
    return [];
  }
}

// Original-resolution still images. Multi-page works expose page 0 at
// urls.original; the other pages share the same path with _p0 → _pN. Each entry
// carries a Referer because i.pximg.net 403s downloads without it (the native
// host honors media[].referer).
function pixivMedia(il) {
  const original = il && il.urls && il.urls.original;
  if (!original) return [];
  const pageCount = il.pageCount || 1;
  const out: MediaItem[] = [];
  for (let i = 0; i < pageCount; i++) {
    const url = i === 0 ? original : original.replace(/_p0(\.[a-z]+)$/i, `_p${i}$1`);
    out.push({
      url,
      alt: null,
      width: i === 0 ? il.width || null : null,
      height: i === 0 ? il.height || null : null,
      referer: PIXIV_REFERER,
    });
  }
  return out;
}

async function fetchPixivIllust(parsed, url): Promise<PostRecord> {
  const rec = emptyRecord(url, 'pixiv');
  try {
    // credentials:include so logged-in users can read R-18 / follower-only works.
    const res = await fetch(`https://www.pixiv.net/ajax/illust/${encodeURIComponent(parsed.id)}`, { credentials: 'include' });
    if (!res.ok) return rec;
    const data = await readJsonKeepingRaw(rec, 'api:pixiv/illust', res);
    // pixiv returns 200 + { error:true } for deleted / private / R-18-logged-out.
    if (data.error) return rec;
    const il = data.body || {};
    rec.title = il.illustTitle || null;
    // Caption (HTML) → text, so caption words are searchable in the viewer.
    rec.text = htmlToText(il.illustComment || il.description || '');
    rec.displayName = il.userName || null;
    rec.screenName = il.userId || null; // pixiv has no @handle; userId is the stable id
    rec.userId = il.userId || null;
    rec.likes = il.likeCount ?? null;
    rec.bookmarks = il.bookmarkCount ?? null;
    rec.views = il.viewCount ?? null;
    rec.replies = il.commentCount ?? null;
    rec.date = toIso(il.createDate || il.uploadDate);
    // pixiv's tags.tags[].tag is the bare tag already; the shared rule (#177)
    // only has to dedupe it and is what keeps every platform's spelling equal.
    rec.hashtags = normalizeHashtags((il.tags && Array.isArray(il.tags.tags) ? il.tags.tags : []).map((t) => t && t.tag));
    // Series membership (#188): seriesNavData is present only on a work that
    // belongs to a series (confirmed against a live capture — schema-canary's
    // scripts/canary/snapshots/pixiv.json shows it null on a standalone work
    // and an object on one in a series). Its own top-level `order` is THIS
    // work's 1-based position — next.order/prev.order describe the NEIGHBORING
    // works, not this one, so they are not used here.
    if (il.seriesNavData) {
      rec.seriesId = il.seriesNavData.seriesId || null;
      rec.seriesTitle = il.seriesNavData.title || null;
      rec.seriesOrder = typeof il.seriesNavData.order === 'number' ? il.seriesNavData.order : null;
    }
    // ugoira is a silent looping animation — to the person browsing their
    // library that is the same kind of thing as an X animated_gif or a Mastodon
    // gifv, which already label as 'gif'. mediaType is the DISPLAY label (what
    // the post is), media[].type the transport (how it downloads), and the two
    // deliberately disagree here, exactly as they do for a real image/gif on
    // Misskey. No new facet value, and no invented word in the UI.
    const ugoira = il.illustType === 2 ? await pixivUgoiraMedia(rec, parsed.id, il) : [];
    rec.mediaType = ugoira.length ? 'gif' : 'image';
    rec.media = ugoira.length ? ugoira : pixivMedia(il);
    // Multi-page works can MIX file formats per page (p0=.jpg, p2=.png …), so
    // the _p0→_pN substitution above can 404. Prefer the per-page originals
    // from /ajax/illust/<id>/pages; keep the substitution as the fallback.
    if (!ugoira.length && (il.pageCount || 1) > 1) {
      try {
        const pres = await fetch(`https://www.pixiv.net/ajax/illust/${encodeURIComponent(parsed.id)}/pages`, { credentials: 'include' });
        if (pres.ok) {
          const pdata = await readJsonKeepingRaw(rec, 'api:pixiv/illust-pages', pres);
          if (!pdata.error && Array.isArray(pdata.body) && pdata.body.length) {
            rec.media = pdata.body
              .map((p) => ({
                url: p.urls && p.urls.original,
                alt: null,
                width: p.width || null,
                height: p.height || null,
                referer: PIXIV_REFERER,
              }))
              .filter((m) => m.url);
          }
        }
      } catch {
        /* keep the substituted fallback */
      }
    }
    // Author avatar: the illust payload carries no avatar — fetch the user record.
    // pixiv's public ajax exposes neither follower count nor account-creation
    // date, so those stay null (graceful hide, like X). Failure leaves avatar null.
    if (il.userId) {
      try {
        const ures = await fetch(`https://www.pixiv.net/ajax/user/${encodeURIComponent(il.userId)}?full=1`, { credentials: 'include' });
        if (ures.ok) {
          const udata = await readJsonKeepingRaw(rec, 'api:pixiv/user', ures);
          if (!udata.error && udata.body) {
            rec.avatar = udata.body.imageBig || udata.body.image || null;
            // i.pximg.net 403s without a pixiv Referer — tell the bridge to send one.
            if (rec.avatar) rec.avatarReferer = PIXIV_REFERER;
          }
        }
      } catch {
        /* no avatar */
      }
    }
  } catch {
    // network/parse failure — keep what we have (URL only)
  }
  return rec;
}

// === The extractor ===

const pixiv: Extractor = {
  platform: 'pixiv',

  parseUrl(u) {
    // pixiv artwork: /artworks/<id> (with optional /en /ja locale prefix).
    if (!(u.hostname === 'www.pixiv.net' || u.hostname === 'pixiv.net')) return null;
    const m = u.pathname.match(/^(?:\/[a-z]{2})?\/artworks\/(\d+)/);
    if (!m) return null;
    return { platform: 'pixiv', id: m[1] };
  },
  isAllowedOrigin: (_tabUrl, hostname) => HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`)),

  fetchPost: fetchPixivIllust,

  // <artworkId>_p<page> survives every pximg rewrite: the square/master
  // thumbnails carry a size suffix after it, the original carries none.
  mediaKey: (url) => (url.match(PXIMG_MEDIA_KEY) || [])[1] || null,
  mediaReferer: PIXIV_REFERER,
  // A page number in the file name says WHICH entry of the post's media[] a
  // dragged picture is, without any URL matching (pixiv's media[] is one entry
  // per page, in page order).
  mediaPageIndex(imageUrls) {
    for (const u of imageUrls) {
      const m = u && u.match(PXIMG_PAGE_INDEX);
      if (m) return Number.parseInt(m[1] as string, 10);
    }
    return null;
  },

  matchesPage: () => hostnameMatches('pixiv.net'),

  capture: {
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
  },

  mediaIdentity: {
    platform: 'pixiv',
    extractIdentity(el: PostMediaElement): MediaIdentity | null {
      let postId: string | null = null;
      for (const src of mediaSrcs(el)) {
        const m = src.match(PXIMG_ARTWORK_ID);
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
    isPostMedia: (el) => anySrc(el, (src) => src.includes('i.pximg.net') && PXIMG_ARTWORK_ID.test(src)),
  },

  overlay: {
    // Two shapes, both anchors:
    //  - FEED thumbnail: a[href*="/artworks/"] — the card's own link (a card
    //    also carries a title link to the same artwork, so requiring the
    //    image keeps one control per card).
    //  - ARTWORK PAGE main illustration: a[href*="i.pximg.net"] — the
    //    full-size viewer link that wraps each page image. This is the ONE
    //    surface X and Bluesky cover for free (their post container appears on
    //    the detail page too) but pixiv did not, so the button never reached
    //    the illustration you actually came to save (#340). It reads apart
    //    from related-works thumbnails cleanly: those use /artworks/ links,
    //    the main image uses an i.pximg.net link. Manga pages are one such
    //    anchor each → one button per page; ugoira is a <canvas>, not a
    //    _p image, so isPostMedia rejects it and no button appears.
    unitSelector: 'a[href*="/artworks/"], a[href*="i.pximg.net"]',
    mediaIn: (unit) => [...unit.querySelectorAll('img')],
  },

  residentMatches: ['https://www.pixiv.net/*', 'https://pixiv.net/*'],
  apiHostPermissions: ['https://www.pixiv.net/*'],
};

export default pixiv;
export { fetchPixivIllust, findPixivPostElement, getPixivCaptureRect, getPixivPermalink, pixivMedia, resolvePixivTarget, PIXIV_REFERER };
