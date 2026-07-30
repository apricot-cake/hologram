// Misskey.
//
// API: <instance>/api/notes/show (official, CORS * by default). The instance is
// an arbitrary host taken from the post URL, which is why this extractor
// declares derivedApiHost — see the SSRF guard in index.ts.

import { normalizeRect, prepareScopedCaptureState } from './dom.ts';
import { fileBasenameKey } from './media.ts';
import { emptyRecord, readJsonKeepingRaw, toIso } from './record.ts';
import type { Extractor, MediaIdentity, PostMediaElement, PostRect, PostRecord } from './types.ts';

// === DOM ===

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
    const id = match[1];
    if (id === undefined) return null;

    return {
      id: decodeURIComponent(id),
      url: url.href,
    };
  } catch {
    return null;
  }
}

// === Media identity (#238 — drag save + hover save on misskey.io) ===

// The same ancestor walk capture.ts uses to find the note under the pointer,
// reused here so a drag and (once #94 lands) a hover button can never resolve
// a picture to a different note than Alt+S would screenshot — the two save
// paths must never disagree about what a save records (drag.ts's own header
// comment).
function extractMisskeyIdentity(el: PostMediaElement): MediaIdentity | null {
  const post = findMisskeyPostElement(el);
  if (!post) return null;
  const link = getMisskeyPermalink(post);
  if (!link) return null;
  const parsed = parseMisskeyNoteLink(link);
  return parsed ? { postId: parsed.id, link } : null;
}

// The avatar sits in the same note and resolves to the same permalink as the
// note's own pictures (extractIdentity does not — and per types.ts's
// MediaIdentitySite contract must not — tell them apart): isPostMedia is the
// separate gate for that, exactly like the other sites' isPostMedia handles
// their own avatar. Misskey's DriveFile-backed URLs give post media and
// avatars no distinguishing CDN path (both are `<instance>/files/...`, unlike
// X's profile_images/ or Bluesky's img/avatar/), so the signal used here is
// structural instead: Misskey links an avatar to the AUTHOR'S profile
// (`/@user`), never to the note — the one part of the DOM shape that is a
// documented, stable Misskey URL convention rather than one of its internal
// (Vue-scoped, version-specific) class names. Not verified against a live
// instance (#238's constraints ruled that out) — worth a live check.
function isMisskeyPostMedia(el: PostMediaElement): boolean {
  return !el.closest('a[href^="/@"]');
}

// === API ===

function misskeyItemType(f) {
  const t = f && f.type ? f.type : '';
  if (t.startsWith('video/')) return /gif/i.test(t) ? 'gif' : 'video';
  if (t === 'image/gif') return 'gif';
  if (t.startsWith('image/')) return 'image';
  return null;
}
function misskeyMediaType(files) {
  return misskeyItemType(files && files[0]);
}

// Download/display type — distinct from misskeyItemType above (which also
// UI-labels a real image/gif as 'gif'): a genuine image/gif is a still,
// transferred and thumbnailed exactly like a jpg/png (MEDIA_MIME_EXT on the
// native host already handles image/gif) — undefined here means "treat as a
// still", same as an unset type on a photo entry. Only an actual video/*
// transport needs the video download path + poster (#119 St1).
function misskeyDownloadType(f): 'video' | 'gif' | undefined {
  const t = f && f.type ? f.type : '';
  if (t.startsWith('video/')) return /gif/i.test(t) ? 'gif' : 'video';
  return undefined;
}

// DriveFile exposes a direct `url` for every attachment type (image or video) —
// no variant selection needed, unlike X. `thumbnailUrl` is the poster frame for
// entries that DO need the video path.
function misskeyMedia(files) {
  if (!Array.isArray(files)) return [];
  return files
    .filter((f) => f && f.url && misskeyItemType(f))
    .map((f) => {
      const type = misskeyDownloadType(f);
      return {
        url: f.url,
        alt: f.comment || null,
        width: (f.properties && f.properties.width) || null,
        height: (f.properties && f.properties.height) || null,
        type,
        poster: type ? f.thumbnailUrl || null : undefined,
      };
    });
}

async function fetchMisskeyNote(parsed, url): Promise<PostRecord> {
  const rec = emptyRecord(url, 'misskey');
  // Canonical permalink: the saved URL may carry a query/hash; rebuild the bare
  // https://<instance>/notes/<id> form (opens on the instance the user viewed).
  rec.url = `https://${parsed.host}/notes/${parsed.noteId}`;
  try {
    const res = await fetch(`https://${parsed.host}/api/notes/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: parsed.noteId }),
    });
    if (!res.ok) return rec;
    const note = await readJsonKeepingRaw(rec, 'api:misskey/notes-show', res);
    rec.text = note.text || null;
    rec.date = toIso(note.createdAt);
    if (note.user) {
      rec.displayName = note.user.name || null;
      // Federated remote authors carry their home server in user.host — keep it
      // (user@host, like Mastodon's acct) so same-named users on different
      // instances don't collapse into one identity.
      rec.screenName = note.user.username ? (note.user.host ? `${note.user.username}@${note.user.host}` : note.user.username) : null;
      rec.userId = note.user.id || null;
      rec.avatar = note.user.avatarUrl || null; // UserLite carries the avatar URL
    }
    // Followers + account-creation date: the UserLite on a note lacks them —
    // fetch the full user by id from the same instance (already pinned by the
    // expectedHost SSRF guard, so no new host is contacted). A user who hides
    // their follower count returns null/0 → graceful. Failure keeps the avatar.
    if (note.user && note.user.id) {
      try {
        const ures = await fetch(`https://${parsed.host}/api/users/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: note.user.id }),
        });
        if (ures.ok) {
          const u = await readJsonKeepingRaw(rec, 'api:misskey/users-show', ures);
          rec.avatar = u.avatarUrl || rec.avatar;
          rec.followers = u.followersCount ?? null;
          rec.authorCreatedAt = toIso(u.createdAt);
        }
      } catch {
        /* keep avatar from note.user */
      }
    }
    if (note.reactions) {
      const total: number = Object.values(note.reactions as Record<string, number>).reduce((s: number, n: number) => s + n, 0);
      rec.likes = total > 0 ? total : 0;
    }
    rec.reposts = note.renoteCount ?? null;
    rec.replies = note.repliesCount ?? null;
    if (note.lang) rec.lang = note.lang;
    rec.mediaType = misskeyMediaType(note.files);
    rec.media = misskeyMedia(note.files);
    if (note.replyId) {
      rec.isReply = true;
      rec.replyToId = note.replyId;
      if (note.reply && note.reply.userId && note.reply.userId === note.userId) {
        rec.isThread = true;
        rec.isReply = null;
      }
    }
    // A renote counts as a QUOTE when it adds anything of its own — text, CW,
    // files or a poll (misskey-js isPureRenote semantics). Text-only checks
    // missed image-only quotes. (audit 2026-06-11)
    if (note.renoteId && (note.text || note.cw || (Array.isArray(note.files) && note.files.length) || (Array.isArray(note.fileIds) && note.fileIds.length) || note.poll)) {
      rec.isQuote = true;
      // Prefer the quoted note's own canonical URL — a federated remote note
      // exposes url/uri; a note local to this instance has neither, so fall back
      // to the local-host permalink.
      if (note.renote) {
        rec.quotedUrl = note.renote.url || note.renote.uri || `https://${parsed.host}/notes/${note.renoteId}`;
      }
    }
  } catch {
    // keep partial
  }
  return rec;
}

// === The extractor ===

const misskey: Extractor = {
  platform: 'misskey',

  parseUrl(u) {
    const m = u.pathname.match(/^\/notes\/([^/?#]+)/);
    if (!m) return null;
    return { platform: 'misskey', host: u.hostname, noteId: m[1] };
  },
  // An instance is an arbitrary host, so there is no allowlist to check — any
  // https origin may ask. What keeps a hostile page from aiming our privileged
  // background fetch somewhere is derivedApiHost + the caller's expectedHost.
  isAllowedOrigin: (tabUrl) => /^https:/i.test(tabUrl || ''),
  derivedApiHost: (parsed) => parsed.host ?? null,

  fetchPost: fetchMisskeyNote,

  mediaKey: fileBasenameKey,

  matchesPage: looksLikeMisskey,

  capture: {
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
  },

  mediaIdentity: {
    platform: 'misskey',
    extractIdentity: extractMisskeyIdentity,
    isPostMedia: isMisskeyPostMedia,
  },

  overlay: {
    // Mirrors isMisskeyNoteElement's article check (the permalink half is
    // left to capture.getPermalink/extractIdentity, which already fall back
    // to the URL bar on a note detail page — see getMisskeyPermalink) — this
    // is what keeps the reply-parent preview (no <article> of its own) out.
    unitSelector: 'div[tabindex="0"]:has(article)',
    // Scoped to the note's own <article>, same as getMisskeyPermalink: the
    // reply-parent preview renders before it and must not contribute media.
    // isPostMedia filters here rather than only gating the save button
    // (X's LI-tile branch does the same) since Misskey has no CDN-path
    // signal to filter on later.
    mediaIn: (unit) => {
      const scope = getMisskeyPrimaryArticle(unit) || unit;
      return [...scope.querySelectorAll<PostMediaElement>('img, video')].filter((el) => isMisskeyPostMedia(el));
    },
  },

  // #238: misskey.io only — the general "any Misskey instance" case is #204's
  // (optional host permission + user registration). See #238's decision log
  // for why misskey.io alone is worth a required host permission where
  // Mastodon's instances are not.
  residentMatches: ['https://misskey.io/*'],
};

export default misskey;
export { extractMisskeyIdentity, fetchMisskeyNote, findMisskeyPostElement, getMisskeyPermalink, isMisskeyPostMedia, looksLikeMisskey, misskeyMedia, parseMisskeyNoteLink };
export type { MisskeyNoteLink };
