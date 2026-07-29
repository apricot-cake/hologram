// Bluesky.
//
// API: public.api.bsky.app (the official public AppView, CORS *), plus
// plc.directory for the author's DID document when a post carries video — that
// document names the PDS holding the original blob (see bskyMedia).

import { anySrc, findAncestorContainerLink, hostnameMatches, parseMediaUrlPath, prepareScopedCaptureState } from './dom.ts';
import { emptyRecord, readJsonKeepingRaw, toIso } from './record.ts';
import type { Extractor, MediaIdentity, PostMediaElement, PostRecord } from './types.ts';

const HOSTS = ['bsky.app'];
const POST_CONTAINER = '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]';

// === DOM ===

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

  return links.find((link) => !authorHandle || link.handle === authorHandle) || links[0] || null;
}

function parseBlueskyPostLink(href: string): BlueskyPostLink | null {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)\/?$/);
    if (!match) {
      return null;
    }
    const handle = match[1];
    const postId = match[2];
    if (handle === undefined || postId === undefined) return null;

    return {
      url: `${url.origin}/profile/${handle}/post/${postId}`,
      handle: decodeURIComponent(handle),
      postId: decodeURIComponent(postId),
    };
  } catch {
    return null;
  }
}

// === API ===

async function resolveBlueskyDid(rec: PostRecord, handle) {
  if (!handle || handle.startsWith('did:')) return handle || null;
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
    if (!res.ok) return null;
    const data = await readJsonKeepingRaw(rec, 'api:bluesky/resolveHandle', res);
    return data.did && /^did:[a-z]+:.+/.test(data.did) ? data.did : null;
  } catch {
    return null;
  }
}

// The PDS that hosts an account's repository — and therefore its blobs — is
// named only in the account's DID document, so a video save needs one
// resolution step beyond the AppView (#119 St2). did:plc lives in the PLC
// directory (CORS *), did:web at a well-known path on the domain the DID names.
function blueskyDidDocUrl(did) {
  if (typeof did !== 'string') return null;
  if (did.startsWith('did:plc:')) return `https://plc.directory/${encodeURIComponent(did)}`;
  if (did.startsWith('did:web:')) {
    // did:web:<host>[:<path>…] — the host is percent-decoded (a port arrives as
    // %3A) and any further colon-separated segments are a path, which replaces
    // the .well-known prefix.
    const parts = did.slice('did:web:'.length).split(':').map(decodeURIComponent);
    const host = parts.shift();
    if (!host || host.includes('/')) return null;
    return `https://${host}/${parts.length ? `${parts.join('/')}/` : '.well-known/'}did.json`;
  }
  return null; // an unknown DID method has no resolution rule we can follow
}

async function resolveBlueskyPds(rec: PostRecord, did): Promise<string | null> {
  const docUrl = blueskyDidDocUrl(did);
  if (!docUrl) return null;
  try {
    const res = await fetch(docUrl);
    if (!res.ok) return null;
    const doc = await readJsonKeepingRaw(rec, 'api:bluesky/didDocument', res);
    const services = Array.isArray(doc && doc.service) ? doc.service : [];
    // The service id is relative ('#atproto_pds') in the PLC directory's output
    // and may be absolute ('<did>#atproto_pds') in a hand-written did:web doc.
    const svc = services.find((s) => s && (s.id === '#atproto_pds' || s.id === `${did}#atproto_pds`));
    const ep = svc && svc.serviceEndpoint;
    // The endpoint is chosen by the account holder, so it is an arbitrary host
    // exactly like a Misskey/Mastodon instance: require https here, and let the
    // native host's SSRF guard re-check the resolved address at download time.
    if (typeof ep !== 'string' || !/^https:\/\//i.test(ep)) return null;
    return ep.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function bskyMediaType(post) {
  const e = post.embed || (post.record && post.record.embed);
  const type = e && e.$type ? e.$type : '';
  if (type.includes('app.bsky.embed.video')) return 'video';
  if (type.includes('app.bsky.embed.images')) return 'image';
  if (type.includes('recordWithMedia')) {
    const mt = e.media && e.media.$type ? e.media.$type : '';
    if (mt.includes('video')) return 'video';
    if (mt.includes('images')) return 'image';
  }
  return null;
}

// The video embed itself (the view, or the record's own embed), unwrapping the
// recordWithMedia envelope. Null when the post has no video.
function bskyVideoEmbed(post) {
  const e = post.embed || (post.record && post.record.embed);
  if (!e) return null;
  const type = e.$type || '';
  if (type.includes('app.bsky.embed.video')) return e;
  if (type.includes('recordWithMedia') && e.media && (e.media.$type || '').includes('app.bsky.embed.video')) return e.media;
  return null;
}

// Original-resolution media from an images or video embed (or recordWithMedia).
//
// Video (#119 St2): the embed view offers an HLS playlist, which is a
// TRANSCODE. The author's original upload is still a blob in their repo and
// any client may read it unauthenticated at
// <pds>/xrpc/com.atproto.sync.getBlob?did=…&cid=… — so Bluesky saves the same
// way as the St1 platforms: one request, one file, no segment stitching and no
// remuxer. `pds` is the endpoint resolveBlueskyPds found; without it the video
// is unreachable and the thumbnail is kept as a plain still instead, so the
// save still holds a picture of the post (the record-level mediaType stays
// 'video' either way).
//
// Do NOT swap the DID-document lookup for bsky.social's getBlob redirect: it
// answers for accounts it does not host by pointing at one of its own servers,
// which does not have the blob (measured 2026-07-29 —
// did:plc:44ybard66vv44zksje25o7dz lives on pds.robocracy.org and bsky.social
// sent the request to morel.us-east.host.bsky.network).
function bskyMedia(post, pds?: string | null) {
  const video = bskyVideoEmbed(post);
  if (video) {
    const did = (post.author && post.author.did) || null;
    const common = {
      alt: video.alt || null,
      width: (video.aspectRatio && video.aspectRatio.width) || null,
      height: (video.aspectRatio && video.aspectRatio.height) || null,
    };
    if (pds && did && video.cid) {
      return [{ ...common, url: `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(video.cid)}`, type: 'video' as const, poster: video.thumbnail || null }];
    }
    return video.thumbnail ? [{ ...common, url: video.thumbnail }] : [];
  }
  const e = post.embed || (post.record && post.record.embed);
  if (!e) return [];
  const type = e.$type || '';
  let images: any = null;
  if (type.includes('app.bsky.embed.images')) images = e.images;
  else if (type.includes('recordWithMedia') && e.media && (e.media.$type || '').includes('images')) images = e.media.images;
  if (!Array.isArray(images)) return [];
  return images
    .filter((im) => im && im.fullsize)
    .map((im) => ({
      url: im.fullsize,
      alt: im.alt || null,
      width: (im.aspectRatio && im.aspectRatio.width) || null,
      height: (im.aspectRatio && im.aspectRatio.height) || null,
    }));
}

async function fetchBlueskyPost(parsed, url): Promise<PostRecord> {
  const rec = emptyRecord(url, 'bluesky');
  rec.screenName = parsed.handle;
  const did = await resolveBlueskyDid(rec, parsed.handle);
  if (did) rec.userId = did;
  if (!did) return rec;
  try {
    const uri = `at://${did}/app.bsky.feed.post/${parsed.rkey}`;
    // parentHeight=0: the reply parent's id comes from the post's OWN record
    // (record.reply.parent.uri, below), so an ancestor post was already unused
    // here. It has to stay unrequested now that the response body is preserved
    // verbatim (#292) — the originals layer's boundary is the payload for THIS
    // record, and a neighbouring post nobody reads must not ride in with it.
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`);
    if (!res.ok) return rec;
    const data = await readJsonKeepingRaw(rec, 'api:bluesky/getPostThread', res);
    const thread = data && data.thread;
    const post = thread && thread.post;
    if (!post) return rec;
    const record = post.record || {};
    rec.text = record.text || null;
    rec.date = toIso(record.createdAt);
    rec.likes = post.likeCount ?? null;
    rec.reposts = post.repostCount ?? null;
    rec.replies = post.replyCount ?? null;
    if (post.author) {
      rec.displayName = post.author.displayName || null;
      rec.screenName = post.author.handle || rec.screenName;
      rec.userId = post.author.did || rec.userId;
      rec.avatar = post.author.avatar || null; // ProfileViewBasic carries the avatar
    }
    // Followers + account-creation date: the post's author view is a
    // ProfileViewBasic without them — fetch the full profile by DID. Failure
    // keeps the avatar we already have from the author view.
    const actor = (post.author && post.author.did) || did;
    if (actor) {
      try {
        const pres = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
        if (pres.ok) {
          const prof = await readJsonKeepingRaw(rec, 'api:bluesky/getProfile', pres);
          rec.avatar = prof.avatar || rec.avatar;
          rec.followers = prof.followersCount ?? null;
          rec.authorCreatedAt = toIso(prof.createdAt);
        }
      } catch {
        /* keep avatar from the author view */
      }
    }
    if (record.langs && record.langs.length) rec.lang = record.langs[0];
    rec.mediaType = bskyMediaType(post);
    // Only a video post pays for the DID-document round trip; an images post
    // already has its fullsize URLs from the AppView.
    const pds = bskyVideoEmbed(post) ? await resolveBlueskyPds(rec, (post.author && post.author.did) || did) : null;
    rec.media = bskyMedia(post, pds);
    if (record.reply) {
      rec.isReply = true;
      // self-reply (thread): parent author DID matches this author
      const parentUri = record.reply.parent && record.reply.parent.uri;
      const m = parentUri && parentUri.match(/^at:\/\/(did:[^/]+)\//);
      const pm = parentUri && parentUri.match(/\/app\.bsky\.feed\.post\/([^/?#]+)/);
      rec.replyToId = pm ? pm[1] : null;
      if (m && post.author && m[1] === post.author.did) {
        rec.isThread = true;
        rec.isReply = null;
      }
    }
    const embType = (post.embed && post.embed.$type) || (record.embed && record.embed.$type) || '';
    if (embType.includes('app.bsky.embed.record')) {
      const rec2 = (post.embed && post.embed.record) || {};
      const quri = rec2.uri || (rec2.record && rec2.record.uri);
      // Only a quoted POST is a quote. embed.record also wraps lists, feeds and
      // starter packs (their uri is app.bsky.graph.* / app.bsky.feed.generator),
      // which must NOT mark the post as a quote. Gate on the feed.post uri.
      const qm = typeof quri === 'string' ? quri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)/) : null;
      if (qm) {
        rec.isQuote = true;
        // recordWithMedia nests the quoted ViewRecord one level deeper
        // (embed.record.record) — read the handle from whichever level has it.
        const qhandle = (rec2.author && rec2.author.handle) || (rec2.record && rec2.record.author && rec2.record.author.handle);
        rec.quotedUrl = `https://bsky.app/profile/${qhandle || qm[1]}/post/${qm[2]}`;
      }
    }
  } catch {
    // keep partial
  }
  return rec;
}

// === The extractor ===

const bluesky: Extractor = {
  platform: 'bluesky',

  parseUrl(u) {
    if (u.hostname !== 'bsky.app') return null;
    const m = u.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (!m) return null;
    return { platform: 'bluesky', handle: m[1], rkey: m[2] };
  },
  isAllowedOrigin: (_tabUrl, hostname) => HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`)),

  fetchPost: fetchBlueskyPost,

  // The blob CID, shared by feed_thumbnail and feed_fullsize, with or without
  // the @jpeg format suffix.
  mediaKey: (url) => (url.match(/\/([a-z0-9]{50,})(?:@|\b)/i) || [])[1] || null,
  highResUrl: (url) => (url.includes('cdn.bsky.app') ? url.replace(/@jpeg$/, '') : null),

  matchesPage: () => hostnameMatches('bsky.app'),

  capture: {
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
  },

  mediaIdentity: {
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
  },

  overlay: {
    unitSelector: POST_CONTAINER,
    mediaIn: (unit) => [...unit.querySelectorAll('img[src*="/img/feed_thumbnail/"], img[src*="/img/feed_fullsize/"], video')],
  },

  residentMatches: ['https://bsky.app/*'],
};

export default bluesky;
export { bskyMedia, fetchBlueskyPost, getBlueskyPostLink, parseBlueskyPostLink };
export type { BlueskyPostLink };
