// Mastodon.
//
// API: <instance>/api/v1/statuses/<id> (official public REST). Like Misskey the
// instance is an arbitrary host taken from the post URL, hence derivedApiHost.

import { prepareScopedCaptureState } from './dom.ts';
import { parseCount } from './dom-meta.ts';
import { fileBasenameKey } from './media.ts';
import { emptyRecord, htmlToText, normalizeHashtags, readJsonKeepingRaw, toIso } from './record.ts';
import type { DomMeta, Extractor, LinkCard, Poll, PostRecord } from './types.ts';

// === DOM ===

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
    const id = match[1];
    if (id === undefined) return null;
    return { id: decodeURIComponent(id), url: `${url.origin}${url.pathname}` };
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

// #202 stage 2: what the page itself shows for this status, so the fields
// the instance's public API left null (a followers-only status, or an
// instance with anonymous API access closed — see the module header) can
// still be saved. Grounded in mastodon/mastodon's own source (main branch,
// read 2026-08-03), not guesswork: unlike Misskey, Mastodon's web client
// does NOT hash its class names — status_action_bar/index.jsx,
// display_name/*.tsx and relative_timestamp/index.tsx all emit the literal
// BEM-style classes matched below, the same kind of stable contract the
// existing .status__quote / .detailed-status__datetime selectors already
// lean on elsewhere in this file.
//
// SCOPED TO THE TIMELINE CARD SHAPE ONLY (.status__*): the permalink page's
// OWN component (features/status/components/detailed_status.tsx) renders a
// parallel but differently-named tree (.detailed-status__display-name, and
// reblog/favourite/quote counts as plain .detailed-status__reblogs/
// __favorites/__quotes links rather than the action bar's icon buttons) that
// this does not target. Capturing a post from ITS OWN permalink page (still
// possible — findMastodonPostElement's selector includes .detailed-status)
// degrades to the same "selector missed, nothing filled" safe outcome as a
// genuine redesign; it is not a crash risk either way.
function mastodonReadText(el: Element): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? '';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    // Mastodon 4.4+ can render a quote INLINE inside the quoting post's own
    // .status__content (a `quote-inline` placeholder token gets replaced by a
    // full nested .status__quote box — status_content.jsx's own
    // handleElement) — unlike X, where the quote card is a sibling of the
    // text node and never a descendant, so this guard has no equivalent
    // there. Skipping the subtree here is the only thing standing between a
    // captured quote and this feature's one real failure mode: writing
    // someone else's words into the quoting post's own text.
    if (child.classList.contains('status__quote')) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'img') out += child.getAttribute('alt') || '';
    else if (tag === 'br') out += '\n';
    else out += mastodonReadText(child);
  }
  return out;
}

// The first match that is not inside an embedded quote's own subtree — same
// shape as x.ts's xOwn, needed for the same reason (a quoted status renders
// its own .status__display-name / .status__content of its own).
function mastodonOwn(post: Element, selector: string): Element | null {
  for (const el of post.querySelectorAll(selector)) {
    if (!el.closest('.status__quote')) return el;
  }
  return null;
}

// icon_button.tsx renders the pressable count as <span
// class="icon-button__counter"><AnimatedNumber .../></span>, and
// AnimatedNumber's own display value is ShortNumber — the same K/M/B (and,
// per-locale, 万/億) abbreviated notation dom-meta.ts's parseCount already
// exists to read, so no separate parsing is needed here.
function mastodonActionCount(post: Element, iconClass: string): number | null {
  const btn = mastodonOwn(post, `.status__action-bar__button:has([class*="${iconClass}"])`);
  const counter = btn?.querySelector('.icon-button__counter');
  return counter ? parseCount(mastodonReadText(counter)) : null;
}

function extractMastodonDomMeta(post: Element): DomMeta {
  const meta: DomMeta = {};
  if (!(post instanceof Element)) return meta;

  // LinkedDisplayName (display_name/index.tsx) sets the wrapping <a>'s own
  // title to "@acct" — reading the attribute is one step shorter than
  // digging out .display-name__account's text and cannot be disturbed by
  // custom-emoji markup the way the name itself can.
  const nameLink = mastodonOwn(post, '.status__display-name');
  if (nameLink) {
    const acct = nameLink.getAttribute('title') || '';
    if (acct.startsWith('@')) meta.screenName = acct.slice(1);
    const nameEl = nameLink.querySelector('.display-name__html');
    if (nameEl) meta.displayName = mastodonReadText(nameEl);
  }

  const textEl = mastodonOwn(post, '.status__content');
  if (textEl) meta.text = mastodonReadText(textEl);

  // relative_timestamp/index.tsx's <time dateTime> is the API's own
  // created_at passed straight through — genuinely ISO, unlike Misskey's.
  const timeEl = mastodonOwn(post, '.status__relative-time time[datetime]');
  if (timeEl) meta.date = toIso(timeEl.getAttribute('datetime'));

  const replies = mastodonActionCount(post, 'icon-reply'); // matches icon-reply AND icon-reply-all
  if (replies != null) meta.replies = replies;
  const reposts = mastodonActionCount(post, 'icon-retweet'); // boost_button.tsx's own icon id — reblogs + quotes combined, same as the API field
  if (reposts != null) meta.reposts = reposts;
  const likes = mastodonActionCount(post, 'icon-star');
  if (likes != null) meta.likes = likes;
  // No bookmark count exists to read (Mastodon never publishes one) and no
  // view count exists in the UI at all — both stay permanently unset here,
  // same as they are on every other platform this Issue does not name.

  return meta;
}

// === API ===

function mastodonItemType(a): 'video' | 'gif' | 'image' | null {
  const t = a && a.type;
  if (t === 'video') return 'video';
  if (t === 'gifv') return 'gif'; // gifv is an mp4 loop, not a real .gif
  if (t === 'image') return 'image';
  return null;
}
function mastodonMediaType(atts) {
  return mastodonItemType(atts && atts[0]);
}

// `a.url` is the full-resolution attachment for every type (image or
// video/gifv) — `preview_url` is the poster frame for the latter two (#119 St1).
function mastodonMedia(atts) {
  if (!Array.isArray(atts)) return [];
  return atts
    .filter((a) => a && a.url && mastodonItemType(a))
    .map((a) => {
      // mastodonItemType is never null here (the filter above excludes it) —
      // `|| undefined` just satisfies MediaItem.type (no null variant).
      const type = mastodonItemType(a) || undefined;
      return {
        url: a.url,
        alt: a.description || null,
        width: (a.meta && a.meta.original && a.meta.original.width) || null,
        height: (a.meta && a.meta.original && a.meta.original.height) || null,
        type,
        poster: type !== 'image' ? a.preview_url || null : undefined,
      };
    });
}

// A Mastodon status permalink looks like /@user/<numericId>. Posts that federated
// in from non-Mastodon software (Lemmy/PieFed/Mbin/...) report a canonical s.url
// in that software's own scheme, which doesn't open as a status (404/forbidden).
function isMastodonStatusUrl(u) {
  try {
    return /^\/@[^/]+\/\d+\/?$/.test(new URL(u).pathname);
  } catch {
    return false;
  }
}

// #180: is this a full Status object, or just a quote stub that names one
// (ShallowQuote: {state, quoted_status_id})? A real Status always carries
// .content (even an empty-text post has the key, htmlToText just returns
// null for it) -- the one field a stub never has.
function mastodonFullStatus(x): any | null {
  return x && typeof x === 'object' && x.content !== undefined ? x : null;
}

// #179: status.poll is {id, expires_at, expired, multiple, votes_count,
// voters_count, options[{title, votes_count}], emojis[]} (confirmed live --
// scripts/canary/snapshots/mastodon.json's 'poll' source). Only the parts that
// describe the poll itself are kept:
//   - `expired` is dropped: it is expires_at against "now", which the viewer
//     can ask for itself at any later moment (see types.ts's Poll.expiresAt).
//   - `votes_count` is dropped: it is the sum of the options' own tallies.
//   - `emojis[]` is dropped: poll options can carry :shortcode: custom emoji,
//     but #290 scoped the emoji store to the post's OWN text and a
//     sub-structure's emoji is the same out-of-scope case QuotedPost.media is.
//     The shortcode text survives verbatim in the choice label either way.
// A per-option votes_count of null (results hidden until the viewer votes) is
// carried through as null rather than folded to 0 -- see types.ts's PollChoice.
function mastodonPoll(poll): Poll | null {
  if (!poll || !Array.isArray(poll.options)) return null;
  return {
    choices: poll.options.filter((o) => o && typeof o.title === 'string').map((o) => ({ text: o.title as string, votes: typeof o.votes_count === 'number' ? o.votes_count : null })),
    multiple: typeof poll.multiple === 'boolean' ? poll.multiple : null,
    expiresAt: toIso(poll.expires_at),
    votersCount: typeof poll.voters_count === 'number' ? poll.voters_count : null,
  };
}

// #290: status.emojis[] is {shortcode, url, static_url, visible_in_picker} —
// the official CustomEmoji shape (confirmed live against mstdn.jp/pawoo.net/
// mastodon.cloud, 2026-08-02). `url` is kept, never `static_url`: it is the
// ANIMATED original whenever the source image is (mstdn.jp's meow_beanbag is
// a real .webp example) — an emoji is meant to move, the same "keep the
// moving picture" rule #119's video/gif media follows.
// #289: status.account.fields[] is {name, value, verified_at} -- the official
// Account.Field entity (docs.joinmastodon.org/entities/Account/#Field, read
// 2026-08-02). `value` is documented as HTML (the instance auto-links a bare
// URL into an <a href>), so a field whose value IS a link is read off that
// href rather than the rendered text, which can be a shortened display form
// ("example.com/…") that differs from the real destination; a value with no
// anchor (e.g. "Pronouns: she/her") falls back to its stripped text via
// htmlToText, same as `note` below.
function mastodonFieldValue(html: unknown): string {
  if (typeof html !== 'string' || !html) return '';
  const m = html.match(/<a\s+[^>]*href="([^"]+)"/i);
  if (m?.[1]) return m[1];
  return htmlToText(html) || '';
}
function mastodonProfileLinks(fields: unknown): { name: string; value: string; verifiedAt: string | null }[] | null {
  if (!Array.isArray(fields) || !fields.length) return null;
  const out: { name: string; value: string; verifiedAt: string | null }[] = [];
  for (const f of fields) {
    if (!f || typeof f.name !== 'string' || !f.name) continue;
    const value = mastodonFieldValue(f.value);
    if (!value) continue;
    out.push({ name: f.name, value, verifiedAt: f.verified_at ? toIso(f.verified_at) : null });
  }
  return out.length ? out : null;
}

function mastodonCustomEmojis(emojis) {
  if (!Array.isArray(emojis)) return [];
  return emojis.filter((e) => e && typeof e.shortcode === 'string' && e.shortcode && typeof e.url === 'string' && e.url).map((e) => ({ shortcode: e.shortcode as string, url: e.url as string }));
}

// #181: status.card is the OGP preview the INSTANCE's own server fetched for
// a URL in the post text -- the official PreviewCard entity (docs.
// joinmastodon.org/entities/PreviewCard, read 2026-08-02: url/title/
// description/image, `type` one of link/photo/video/rich). Every `type`
// carries the same url/title/description/image shape, so nothing here
// branches on it -- a photo/video oEmbed preview (e.g. an embedded YouTube
// link) is just as much "a card describing a link this post shared" as a
// plain article link is. image is documented nullable (a linked page with no
// og:image still gets a card, just a textless-thumbnail one).
function mastodonLinkCard(card): LinkCard | null {
  if (!card || typeof card.url !== 'string' || !card.url) return null;
  return { url: card.url, title: card.title || null, description: card.description || null, thumbnail: card.image || null };
}

async function fetchMastodonStatus(parsed, url): Promise<PostRecord> {
  const rec = emptyRecord(url, 'mastodon');
  try {
    const res = await fetch(`https://${parsed.host}/api/v1/statuses/${parsed.id}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return rec;
    const s = await readJsonKeepingRaw(rec, 'api:mastodon/status', res);
    // Keep the canonical permalink only when it's a real Mastodon status URL;
    // otherwise fall back to the instance URL we captured (always opens in the
    // Mastodon UI), so federated Lemmy/PieFed posts don't become dead links.
    rec.url = s.url && isMastodonStatusUrl(s.url) ? s.url : url;
    rec.text = htmlToText(s.content);
    rec.customEmojis = mastodonCustomEmojis(s.emojis);
    // #178: spoiler_text is the CW the author wrote (empty string, not null,
    // when they set none — normalized to null here like every other free-text
    // field). sensitive is a real boolean the API always answers (unlike
    // isEdited's edit_control, which can be silent), so a definite false is
    // kept, not folded into null.
    rec.cw = s.spoiler_text || null;
    rec.sensitive = typeof s.sensitive === 'boolean' ? s.sensitive : null;
    rec.poll = mastodonPoll(s.poll);
    rec.linkCard = mastodonLinkCard(s.card);
    rec.date = toIso(s.created_at);
    if (s.account) {
      rec.displayName = s.account.display_name || s.account.username || null;
      rec.screenName = s.account.acct || s.account.username || null;
      rec.userId = s.account.id || null;
      // The status's account is a full Account object — avatar, follower count
      // and account-creation date are all inline (no extra request).
      rec.avatar = s.account.avatar || s.account.avatar_static || null;
      rec.followers = s.account.followers_count ?? null;
      rec.authorCreatedAt = toIso(s.account.created_at);
      // #289: bio/links ride the SAME full Account object above -- no extra
      // request. No banner: this Issue's acceptance scope names only
      // Misskey/Bluesky for banner (rec.banner stays emptyRecord()'s null)
      // even though Mastodon's Account also carries one (header/header_static).
      rec.bio = htmlToText(s.account.note);
      rec.profileLinks = mastodonProfileLinks(s.account.fields);
    }
    rec.likes = s.favourites_count ?? null;
    rec.reposts = s.reblogs_count ?? null;
    rec.replies = s.replies_count ?? null;
    // edited_at is the documented shape: an ISO timestamp once the author has
    // edited the status, null when they never have (#189). The field is
    // always present on a real status, so its absence here is read the same
    // as null — nothing is ever guessed as edited from silence.
    if (s.edited_at) {
      rec.isEdited = true;
      rec.editedAt = toIso(s.edited_at);
    }
    rec.lang = s.language || null;
    // status.tags[] is { name, url }, where name is documented as "the value of
    // the hashtag after the # sign" (#177) — the instance's own resolution, so
    // it also carries tags that only exist on a federated copy of the post.
    rec.hashtags = normalizeHashtags((Array.isArray(s.tags) ? s.tags : []).map((t) => t && t.name));
    rec.mediaType = mastodonMediaType(s.media_attachments);
    rec.media = mastodonMedia(s.media_attachments);
    if (s.in_reply_to_id) {
      rec.isReply = true;
      rec.replyToId = String(s.in_reply_to_id);
      if (s.account && s.in_reply_to_account_id && s.in_reply_to_account_id === s.account.id) {
        rec.isThread = true;
        rec.isReply = null;
      }
    }
    // Quotes: forks (Fedibird/glitch-soc) put a full status directly in
    // `quote`; mainline Mastodon 4.4+ wraps it as { state, quoted_status }
    // (ShallowQuote: { state, quoted_status_id }). Handle all three shapes.
    const q = s.quote;
    if (q && (q.url || q.uri || q.quoted_status || q.quoted_status_id)) {
      rec.isQuote = true;
      rec.quotedUrl = q.url || q.uri || (q.quoted_status && (q.quoted_status.url || q.quoted_status.uri)) || null;
      // #180: only the two FULL-status shapes (fork's bare `quote`, mainline's
      // `quote.quoted_status`) carry anything to build a sub-record from -- a
      // shallow ShallowQuote ({state, quoted_status_id}) names the quoted post
      // but does not include it, and fetching it is a second request this
      // Issue's v1 scope excludes (same reasoning as the reply-to platforms
      // that get no sub-record). Detected the same way #178/#189 tell a full
      // Status from an id-only stub: a real Status always has .content.
      const qStatus = mastodonFullStatus(q) || mastodonFullStatus(q.quoted_status);
      if (qStatus) {
        rec.quotedPost = {
          url: (qStatus.url && isMastodonStatusUrl(qStatus.url) ? qStatus.url : qStatus.url || qStatus.uri || null) || rec.quotedUrl,
          displayName: (qStatus.account && (qStatus.account.display_name || qStatus.account.username)) || null,
          screenName: (qStatus.account && (qStatus.account.acct || qStatus.account.username)) || null,
          userId: (qStatus.account && qStatus.account.id) || null,
          avatar: (qStatus.account && (qStatus.account.avatar || qStatus.account.avatar_static)) || null,
          text: htmlToText(qStatus.content),
          date: toIso(qStatus.created_at),
          cw: qStatus.spoiler_text || null,
          media: mastodonMedia(qStatus.media_attachments),
        };
      }
    }
  } catch {
    // keep partial
  }
  return rec;
}

// === The extractor ===

const mastodon: Extractor = {
  platform: 'mastodon',

  parseUrl(u) {
    // Mastodon web URL: /@user/<numericId> — the id starts with a digit, which
    // excludes profile sub-pages like /@user/media.
    const m = u.pathname.match(/^\/@[^/]+\/(\d[\w-]*)\/?$/);
    if (!m) return null;
    const id = m[1];
    if (id === undefined) return null;
    return { platform: 'mastodon', host: u.hostname, id: decodeURIComponent(id) };
  },
  isAllowedOrigin: (tabUrl) => /^https:/i.test(tabUrl || ''),
  derivedApiHost: (parsed) => parsed.host ?? null,

  fetchPost: fetchMastodonStatus,

  mediaKey: fileBasenameKey,

  matchesPage: looksLikeMastodon,

  capture: {
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
    extractDomMeta: extractMastodonDomMeta,
  },
};

export default mastodon;
export { extractMastodonDomMeta, fetchMastodonStatus, findMastodonPostElement, getMastodonStatusLink, looksLikeMastodon, mastodonCustomEmojis, mastodonMedia, parseMastodonStatusLink };
export type { MastodonStatusLink };
