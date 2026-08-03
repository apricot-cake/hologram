// Misskey.
//
// API: <instance>/api/notes/show (official, CORS * by default). The instance is
// an arbitrary host taken from the post URL, which is why this extractor
// declares derivedApiHost — see the SSRF guard in index.ts.

import { normalizeRect, prepareScopedCaptureState } from './dom.ts';
import { parseCount } from './dom-meta.ts';
import { fileBasenameKey } from './media.ts';
import { emptyRecord, normalizeHashtags, readJsonKeepingRaw, toIso } from './record.ts';
import type { DomMeta, Extractor, MediaIdentity, Poll, PostMediaElement, PostRect, PostRecord } from './types.ts';

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

// #202 stage 2: what the page itself shows for this note, so the fields
// misskey.io's API left null (a followers-only note, or an instance with
// anonymous API access turned off) can still be saved. See dom-meta.ts's
// header for the merge rule this feeds into — the site's only job is finding
// the right elements.
//
// UNLIKE X, this can only cover author + engagement counts, never the note's
// OWN TEXT: misskey.io's build (MisskeyIO/misskey, main branch, read
// 2026-08-03) renders every note's style as Vue CSS Modules — MkNote.vue
// writes `:class="$style.text"` on the body div, which compiles to an opaque
// hashed token (confirmed live against misskey.io on the same date: an
// unrelated widget's class names came back as "xoIiV"/"xBHTS", not anything
// resembling the source's own names). There is no OTHER attribute or tag
// that marks the text div apart from its siblings (the CW paragraph, the
// media list, the poll, an embedded quote) — every one of them is an
// unmarked <div>, and guessing by position risks the exact cross-post
// mismatch this feature exists to avoid. Author name and engagement counts
// avoid this because MkNoteHeader.vue's <header> and MkNote.vue's <footer>
// are plain semantic elements, and the count buttons carry Tabler icon
// classes (ti-arrow-back-up / ti-repeat / ti-heart / ti-plus / ti-minus) —
// bundled as a versioned icon font, not hashed per build.
//
// Also unlike X, no date is extracted: MkTime.vue's <time> carries no
// datetime attribute at all (only a `title` holding an Intl-formatted,
// viewer-locale string, and relative/absolute text in the same vein) — the
// same "never parse a human-readable date" rule dom-meta.ts's own header
// states for X's <time> face applies here with no ISO attribute to fall
// back on.
const MISSKEY_REPLY_ICON = 'ti-arrow-back-up';
const MISSKEY_RENOTE_ICON = 'ti-repeat';
// Every icon the react button can show while anonymous cannot react on its
// behalf: the default (ti-plus / ti-heart for a likeOnly note), and — since
// the note being captured may be the viewer's OWN, already reacted to —
// ti-minus (either build) and the fork's two-token "ti-filled ti-filled-heart"
// (matched by the bare "heart" substring, since "ti-heart" itself is not a
// substring of "ti-filled-heart").
const MISSKEY_REACT_ICON_HINTS = ['heart', 'ti-plus', 'ti-minus'];

function misskeyReadText(el: Element): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? '';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    if (tag === 'img') out += child.getAttribute('alt') || '';
    else if (tag === 'br') out += '\n';
    else out += misskeyReadText(child);
  }
  return out;
}

// The footer button whose own icon carries one of the given hints as a
// substring — never a class EQUALITY check, since a hint like "ti-plus" must
// also match a multi-class attribute value and "heart" must match both
// "ti-heart" and "ti-filled-heart".
function misskeyFooterButton(article: Element, iconHints: readonly string[]): Element | null {
  for (const btn of article.querySelectorAll('footer button')) {
    const icon = btn.querySelector('i');
    const cls = icon?.className || '';
    if (iconHints.some((hint) => cls.includes(hint))) return btn;
  }
  return null;
}

function misskeyFooterCount(article: Element, iconHints: readonly string[]): number | null {
  const p = misskeyFooterButton(article, iconHints)?.querySelector('p');
  return p ? parseCount(p.textContent) : null;
}

function extractMisskeyDomMeta(post: Element): DomMeta {
  const meta: DomMeta = {};
  const article = getMisskeyPrimaryArticle(post);
  if (!(article instanceof Element)) return meta;

  const header = article.querySelector('header');
  if (header) {
    // The name link: MkNoteHeader.vue renders exactly two <a> in this
    // element, the author's (wrapping MkUserName) and the permalink's
    // (wrapping MkTime) — the one WITHOUT a <time> child is the author's.
    for (const link of header.querySelectorAll('a')) {
      if (link.querySelector('time')) continue;
      const label = misskeyReadText(link).trim();
      if (label) meta.displayName ??= label;
    }
    // MkAcct.vue renders "@user" then, federated, a second "@host" span — the
    // WRAPPING element's own text is the two concatenated ("@user@host"),
    // which document order visits before either child span, so the first
    // element anywhere in the header whose text starts with '@' is always
    // that wrapper, never a lone span. Stripping the one leading '@' leaves
    // exactly the "user@host" / "user" shape fetchMisskeyNote's own
    // screenName already uses.
    for (const el of header.querySelectorAll('div, span')) {
      const label = misskeyReadText(el).trim();
      if (label.startsWith('@')) {
        meta.screenName ??= label.slice(1);
        break;
      }
    }
  }

  const replies = misskeyFooterCount(article, [MISSKEY_REPLY_ICON]);
  if (replies != null) meta.replies = replies;
  const reposts = misskeyFooterCount(article, [MISSKEY_RENOTE_ICON]);
  if (reposts != null) meta.reposts = reposts;
  // Reaction counts default to HIDDEN on misskey.io (showReactionsCount's own
  // documented default is false) — null here far more often than not is the
  // correct, unforced answer, not a missed selector.
  const likes = misskeyFooterCount(article, MISSKEY_REACT_ICON_HINTS);
  if (likes != null) meta.likes = likes;

  return meta;
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

// #180: a renote/reply target arrives as a FULL Note object on this endpoint
// (note.renote / note.reply), the same shape as the top-level note -- so the
// sidecar sub-record is built with the exact same field reads as the parent,
// at no extra request.
function misskeyQuotedRef(note, host): { url: string | null; displayName: string | null; screenName: string | null; userId: string | null; avatar: string | null; text: string | null; date: string | null; cw: string | null; media: ReturnType<typeof misskeyMedia> } | null {
  if (!note) return null;
  return {
    url: note.url || note.uri || `https://${host}/notes/${note.id}`,
    displayName: (note.user && note.user.name) || null,
    screenName: note.user ? (note.user.host ? `${note.user.username}@${note.user.host}` : note.user.username) : null,
    userId: (note.user && note.user.id) || null,
    avatar: (note.user && note.user.avatarUrl) || null,
    text: note.text || null,
    date: toIso(note.createdAt),
    cw: note.cw || null,
    media: misskeyMedia(note.files),
  };
}

// #179: note.poll is {multiple, expiresAt, choices[{text, votes, isVoted}]}
// (confirmed live -- scripts/canary/snapshots/misskey.json's 'poll' source).
// choices[].isVoted is the VIEWER's own state and we are always anonymous, so
// it is dropped rather than saved as a permanent "not voted" that says nothing
// about the poll. expiresAt is null on a poll with no deadline, which Misskey
// allows.
function misskeyPoll(poll): Poll | null {
  if (!poll || !Array.isArray(poll.choices)) return null;
  return {
    choices: poll.choices.filter((c) => c && typeof c.text === 'string').map((c) => ({ text: c.text as string, votes: typeof c.votes === 'number' ? c.votes : null })),
    multiple: typeof poll.multiple === 'boolean' ? poll.multiple : null,
    expiresAt: toIso(poll.expiresAt),
    // Misskey has no distinct-voter count -- only the per-choice tallies.
    votersCount: null,
  };
}

// #289: users/show's fields[] is {name, value} pairs (no verification concept
// on Misskey, unlike Mastodon's fields[].verified_at) -- confirmed live
// against misskey.io, 2026-08-02.
function misskeyProfileLinks(fields: unknown): { name: string; value: string; verifiedAt: string | null }[] | null {
  if (!Array.isArray(fields) || !fields.length) return null;
  const out = fields.filter((f) => f && typeof f.name === 'string' && f.name && typeof f.value === 'string' && f.value).map((f) => ({ name: f.name as string, value: f.value as string, verifiedAt: null }));
  return out.length ? out : null;
}

// #290: note.emojis is a shortcode->URL map -- packedNoteSchema's own
// 'emojis' property, distinct from reactionEmojis (reaction picker icons) and
// user.emojis (the author's name-field emoji). Confirmed live against
// misskey.io's local-timeline, 2026-08-02: a note using :shortcode: text
// carries e.g. {"ha_to":"https://media.niri.la/misskey/....png"}; a note that
// used none omits the key entirely rather than sending an empty object,
// hence the typeof guard (Object.entries on undefined throws).
function misskeyCustomEmojis(emojis) {
  if (!emojis || typeof emojis !== 'object') return [];
  return Object.entries(emojis)
    .filter(([shortcode, emojiUrl]) => shortcode && typeof emojiUrl === 'string' && emojiUrl)
    .map(([shortcode, emojiUrl]) => ({ shortcode, url: emojiUrl as string }));
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
    rec.customEmojis = misskeyCustomEmojis(note.emojis);
    // #178: the CW text the author wrote (misskey.io, real note, 2026-07-30 —
    // scripts/canary/snapshots/misskey.json's 'cw' source). No note-level
    // sensitivity boolean exists on this endpoint (only a per-file isSensitive
    // on individual attachments, a different fact) — rec.sensitive stays null.
    rec.cw = note.cw || null;
    rec.poll = misskeyPoll(note.poll);
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
          // #289: bio/links/banner ride the SAME users/show response already
          // fetched for followers/authorCreatedAt above -- no extra request.
          rec.bio = u.description || null;
          rec.profileLinks = misskeyProfileLinks(u.fields);
          rec.banner = u.bannerUrl || null;
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
    // note.tags[] is the server's own extraction (#177): Misskey parses the
    // MFM of text, CW and poll choices at post time and stores the hashtags as
    // bare strings — no '#', and run through its normalizeForSearch, which
    // lower-cases them. Reading the field rather than re-parsing the text is
    // what keeps a tag written in the CW from going missing.
    rec.hashtags = normalizeHashtags(Array.isArray(note.tags) ? note.tags : []);
    rec.mediaType = misskeyMediaType(note.files);
    rec.media = misskeyMedia(note.files);
    if (note.replyId) {
      rec.isReply = true;
      rec.replyToId = note.replyId;
      if (note.reply && note.reply.userId && note.reply.userId === note.userId) {
        rec.isThread = true;
        rec.isReply = null;
      }
      // #180: the only platform whose reply target arrives with full content
      // already in this response (note.reply) -- see types.ts's
      // PostRecord.replyToPost for why the other three platforms don't get one.
      rec.replyToPost = misskeyQuotedRef(note.reply, parsed.host);
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
        rec.quotedPost = misskeyQuotedRef(note.renote, parsed.host);
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
    extractDomMeta: extractMisskeyDomMeta,
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
export { extractMisskeyDomMeta, extractMisskeyIdentity, fetchMisskeyNote, findMisskeyPostElement, getMisskeyPermalink, isMisskeyPostMedia, looksLikeMisskey, misskeyCustomEmojis, misskeyMedia, parseMisskeyNoteLink };
export type { MisskeyNoteLink };
